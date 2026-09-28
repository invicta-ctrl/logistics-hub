import { InputError, catalogRevision, createItem, itemDetail, parseItemInput, publicCatalog, recordMovement, staffInventory, updateItem, type Actor } from "./inventory";
import { createSession, hashPassword, readCookie, verifyPassword, verifySession } from "./session";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
};

type Account = Actor & { displayName: string; username: string };
type RateWindow = { count: number; resetAt: number };
const loginAttempts = new Map<string, RateWindow>();
const SESSION_NAME = "lh_staff_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const ITEM_PATH = /^\/api\/staff\/items\/(ITM-[A-Za-z0-9-]{1,24})(\/movements)?$/;
let dummyHash: Promise<string> | undefined;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function secureHeaders(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("Origin") === url.origin;
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

function rateLimited(request: Request): boolean {
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

/** Answers 304 when the client already holds the current catalog revision. */
async function revisioned(request: Request, db: D1Database, load: () => Promise<object>): Promise<Response> {
  const revision = await catalogRevision(db);
  const etag = `"r${revision}"`;
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  return json({ revision, ...await load() }, 200, { etag });
}

async function accountFor(request: Request, env: Env): Promise<Account | null> {
  const session = await verifySession(readCookie(request, SESSION_NAME), env.SESSION_SECRET);
  if (!session) return null;
  return env.DB.prepare(`SELECT a.id AS accountId, a.display_name AS displayName, a.username FROM staff_sessions s
    JOIN staff_accounts a ON a.id = s.account_id WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.active = 1`)
    .bind(session.id, Date.now()).first<Account>();
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (rateLimited(request)) return json({ error: "Too many attempts. Please wait a minute before trying again." }, 429);
  if (!env.SESSION_SECRET) return json({ error: "Staff sign-in is not configured for this environment." }, 503);
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || username.length > 64 || password.length > 256) return json({ error: "Enter your username and password." }, 400);
  const account = await env.DB.prepare("SELECT id, password_hash AS passwordHash FROM staff_accounts WHERE username = ? AND active = 1")
    .bind(username).first<{ id: string; passwordHash: string }>();
  // Verify against a throwaway hash for unknown users so timing does not reveal which usernames exist.
  const valid = await verifyPassword(password, account?.passwordHash ?? await (dummyHash ??= hashPassword(crypto.randomUUID())));
  if (!account || !valid) return json({ error: "That username and password were not accepted." }, 401);
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const token = await createSession({ id, subject: account.id, role: "STAFF", exp: expiresAt }, env.SESSION_SECRET);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO staff_sessions (id, expires_at, account_id) VALUES (?, ?, ?)").bind(id, expiresAt, account.id),
    env.DB.prepare("UPDATE staff_accounts SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), account.id)
  ]);
  loginAttempts.delete(request.headers.get("CF-Connecting-IP") ?? "local");
  return json({ ok: true }, 200, { "set-cookie": cookie(token, SESSION_DURATION_MS / 1000, url.protocol === "https:") });
}

async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  const session = await verifySession(readCookie(request, SESSION_NAME), env.SESSION_SECRET);
  if (session) await env.DB.prepare("UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").bind(session.id).run();
  return json({ ok: true }, 200, { "set-cookie": cookie("", 0, url.protocol === "https:") });
}

async function staffApi(request: Request, env: Env, url: URL): Promise<Response> {
  const mutating = request.method !== "GET";
  if (mutating && !sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  const account = await accountFor(request, env);
  if (!account) return json({ error: "Your staff session has ended. Please sign in again." }, 401);
  const path = url.pathname;
  const body = () => request.json().catch(() => null);
  if (path === "/api/staff/session" && request.method === "GET") return json({ authenticated: true, displayName: account.displayName, username: account.username });
  if (path === "/api/staff/inventory" && request.method === "GET") return revisioned(request, env.DB, () => staffInventory(env.DB));
  if (path === "/api/staff/items" && request.method === "POST") {
    const input = await body() as Record<string, unknown> | null;
    const opening = input?.openingQuantity ?? 0;
    if (typeof opening !== "number" || !Number.isInteger(opening) || opening < 0 || opening > 100_000) throw new InputError(400, "Opening quantity must be a whole number from 0 to 100000.");
    return json(await createItem(env.DB, account, parseItemInput(input), opening), 201);
  }
  const match = ITEM_PATH.exec(path);
  if (match && !match[2] && request.method === "GET") return json(await itemDetail(env.DB, match[1]));
  if (match && !match[2] && request.method === "PATCH") return json(await updateItem(env.DB, account, match[1], parseItemInput(await body())));
  if (match && match[2] && request.method === "POST") return json(await recordMovement(env.DB, account, match[1], await body()));
  const known = match || ["/api/staff/session", "/api/staff/inventory", "/api/staff/items"].includes(path);
  return json({ error: known ? "Method not allowed." : "Not found." }, known ? 405 : 404);
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/api/public/catalog") {
    return request.method === "GET" ? revisioned(request, env.DB, () => publicCatalog(env.DB)) : json({ error: "Method not allowed." }, 405, { allow: "GET" });
  }
  if (path === "/api/staff/login" || path === "/api/staff/logout") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    return path === "/api/staff/login" ? login(request, env, url) : logout(request, env, url);
  }
  if (path.startsWith("/api/staff/")) return staffApi(request, env, url);
  if (path.startsWith("/api/")) return json({ error: "Not found." }, 404);
  // Every staff page below /staff requires a live session before any HTML is served.
  if (path.startsWith("/staff/") && !await accountFor(request, env)) return Response.redirect(new URL("/staff", url), 302);
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      return secureHeaders(await route(request, env, url), url);
    } catch (error) {
      if (error instanceof InputError) return secureHeaders(json({ error: error.message }, error.status), url);
      console.error("request_failed", { path: url.pathname, message: error instanceof Error ? error.message : "unknown" });
      return secureHeaders(json({ error: "The service is temporarily unavailable." }, 500), url);
    }
  }
} satisfies ExportedHandler<Env>;
