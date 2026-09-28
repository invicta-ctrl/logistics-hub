import { isPubliclyLendable, lendingAvailability, type InventoryCandidate } from "./catalog-policy";
import { createSession, readCookie, verifySession } from "./session";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  DEV_AUTH_ENABLED?: string;
  ENVIRONMENT?: string;
  DEV_STAFF_USERNAME?: string;
  DEV_STAFF_PASSWORD?: string;
};

type CatalogRow = InventoryCandidate & { id: string; name: string; category: string; unit: string };
type RateWindow = { count: number; resetAt: number };
const loginAttempts = new Map<string, RateWindow>();
const SESSION_NAME = "lh_staff_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function secureHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function isLoopback(url: URL): boolean {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
}

function sameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  return origin === url.origin;
}

function canUseDevAuth(env: Env, url: URL): boolean {
  return env.ENVIRONMENT === "development" && env.DEV_AUTH_ENABLED === "true" && isLoopback(url) && Boolean(env.SESSION_SECRET && env.DEV_STAFF_USERNAME && env.DEV_STAFF_PASSWORD);
}

function cookie(value: string, secure: boolean): string {
  return `${SESSION_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_DURATION_MS / 1000}${secure ? "; Secure" : ""}`;
}

function rateLimit(request: Request): boolean {
  const key = request.headers.get("CF-Connecting-IP") ?? "local";
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (!current || current.resetAt < now) {
    loginAttempts.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 5;
}

export async function getCatalog(db: D1Database, url: URL): Promise<Response> {
  const query = url.searchParams.get("q")?.trim().slice(0, 80) ?? "";
  const category = url.searchParams.get("category")?.trim().slice(0, 100) ?? "";
  const where: string[] = [];
  const bindings: string[] = [];
  if (query) {
    where.push("(i.name LIKE ? OR i.category LIKE ?)");
    bindings.push(`%${query}%`, `%${query}%`);
  }
  if (category) {
    where.push("i.category = ?");
    bindings.push(category);
  }
  const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const statement = db.prepare(`SELECT i.id, i.name, i.category, i.item_type AS itemType, i.unit, i.status, i.needs_review AS needsReview, i.lending_audience AS lendingAudience, COALESCE(b.on_hand, 0) AS onHand FROM items i LEFT JOIN inventory_balances b ON b.id = i.id ${condition} ORDER BY i.name COLLATE NOCASE`).bind(...bindings);
  const result = await statement.all<CatalogRow>();
  const items = (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    itemType: row.itemType,
    unit: row.unit,
    lendingAvailability: lendingAvailability(row),
    availableToBorrow: isPubliclyLendable(row)
  }));
  return json({ items, categories: [...new Set(items.map((item) => item.category))].sort((a, b) => a.localeCompare(b)) });
}

async function sessionFor(request: Request, env: Env) {
  const session = await verifySession(readCookie(request, SESSION_NAME), env.SESSION_SECRET);
  if (!session) return null;
  const record = await env.DB.prepare("SELECT id FROM staff_sessions WHERE id = ? AND revoked_at IS NULL AND expires_at > ?").bind(session.id, Date.now()).first<{ id: string }>();
  return record ? session : null;
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (rateLimit(request)) return json({ error: "Too many attempts. Please wait before trying again." }, 429);
  if (!canUseDevAuth(env, url)) return json({ error: "Staff sign-in is not configured for this environment." }, 503);
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  if (typeof body?.username !== "string" || typeof body.password !== "string") return json({ error: "Enter a username and password." }, 400);
  if (body.username !== env.DEV_STAFF_USERNAME || body.password !== env.DEV_STAFF_PASSWORD) return json({ error: "Sign-in was not accepted." }, 401);
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const session = await createSession({ id: crypto.randomUUID(), subject: "local-development-staff", role: "STAFF", exp: expiresAt }, env.SESSION_SECRET!);
  const decoded = await verifySession(session, env.SESSION_SECRET!);
  if (!decoded) return json({ error: "Staff sign-in is temporarily unavailable." }, 500);
  await env.DB.prepare("INSERT INTO staff_sessions (id, expires_at) VALUES (?, ?)").bind(decoded.id, expiresAt).run();
  return json({ ok: true }, 200, { "set-cookie": cookie(session, url.protocol === "https:") });
}

async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  const session = await verifySession(readCookie(request, SESSION_NAME), env.SESSION_SECRET);
  if (session) await env.DB.prepare("UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").bind(session.id).run();
  return json({ ok: true }, 200, { "set-cookie": `${SESSION_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${url.protocol === "https:" ? "; Secure" : ""}` });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/api/public/catalog") return secureHeaders(await getCatalog(env.DB, url));
      if (request.method === "GET" && url.pathname === "/api/staff/session") {
        const session = await sessionFor(request, env);
        return secureHeaders(session ? json({ authenticated: true, role: session.role }) : json({ authenticated: false }, 401));
      }
      if (request.method === "POST" && url.pathname === "/api/staff/login") return secureHeaders(await login(request, env, url));
      if (request.method === "POST" && url.pathname === "/api/staff/logout") return secureHeaders(await logout(request, env, url));
      if (url.pathname.startsWith("/api/")) {
        const knownPath = ["/api/public/catalog", "/api/staff/session", "/api/staff/login", "/api/staff/logout"].includes(url.pathname);
        return secureHeaders(json({ error: knownPath ? "Method not allowed." : "Not found." }, knownPath ? 405 : 404, knownPath ? { allow: "GET, POST" } : {}));
      }
      if (url.pathname === "/staff/home" || url.pathname.startsWith("/staff/home/")) {
        if (!await sessionFor(request, env)) return secureHeaders(Response.redirect(new URL("/staff", url), 302));
      }
      return secureHeaders(await env.ASSETS.fetch(request));
    } catch (error) {
      console.error("request_failed", { path: url.pathname, message: error instanceof Error ? error.message : "unknown" });
      return secureHeaders(json({ error: "The service is temporarily unavailable." }, 500));
    }
  }
} satisfies ExportedHandler<Env>;
