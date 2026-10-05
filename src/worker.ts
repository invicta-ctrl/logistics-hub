import { EXPORT_ROWS, activityCsv, activityPage, activityTag, exportName, parseActivityQuery } from "./activity";
import { type Account, accessOf, changeOwnPassword, clearThrottle, createAccount, hubAccess, isAdmin, listAccounts, recoverOwner, recoveryStatus, resetPassword, revokeAccountSessions, revokeRecoveryKey, rotateRecoveryKey, securityActivity, sweepStale, throttled, updateAccount, updateSelf } from "./accounts";
import { auditDetail, auditReview, auditState, finishAudit, itemFreshness, observe, resolveObservation, startAudit, updateAudit } from "./audits";
import { bulkUpdate } from "./bulk";
import { capture, capturedBy, catalogueSnapshot, catalogueState, finishSession, sessionDetail, setSessionPlace, startSession, unreviewed } from "./catalogue";
import { updateItemVisual } from "./item-visuals";
import { dropObjects, itemPhoto, publicThumb, putItemPhoto, removeItemPhoto } from "./item-media";
import { locationPicture, publicLocationPicture, putLocationPhoto, removeLocationPhoto } from "./location-media";
import { reportLocation, resolveReport } from "./location-reports";
import { createLocation, deleteLocation, locationList, moveItems, updateLocation } from "./locations";
import { openUnitAction } from "./open-units";
import { InputError, audit, catalogRevision, createItem, itemDetail, parseItemInput, publicCatalog, recordMovement, staffInventory, updateItem } from "./inventory";
import { createSession, hashPassword, readCookie, verifyPassword, verifySession } from "./session";
import { closeLoan, createLoan, loanPhoto, loansOverview } from "./loans";
import { eraseOldDetails, retentionPreview } from "./retention";
import { selfServiceState, setSelfService } from "./settings";
import { MAX_SCAN_BODY, createLinkedAccount, idDerived, missingDerived, putDerived, createPerson, directory, idScan, importPair, linkAccount, linkableAccounts, linkedPerson, personAccess, personActivity, personDetail, personLoans, personUsage, putIdCard, removeIdCard, unlinkAccount, updatePerson } from "./staff-directory";
import { openReorder, stockOverview, updateReorder } from "./stock";
import { heldPhoto, networkOf, readBatch, resolveReview, reviewDecisions, selfServiceCatalog, selfServiceReview, syncEvents } from "./self-service";

export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  EVIDENCE: R2Bucket;
  /** Item profile photos: a separate bucket from loan evidence, so a fault in one route cannot reach the other. */
  CATALOG_MEDIA: R2Bucket;
  /** Official USC ID scans (V1.3): their own bucket, reached only through the Staff Directory's Administration routes. */
  STAFF_IDS: R2Bucket;
  SESSION_SECRET?: string;
};

/** Phones keep anything waiting and show the maintenance screen on this answer (offline-sync.ts). */
const selfServicePaused = () => json({ error: "Self-Service is under maintenance. Please ask DOL staff in person.", maintenance: true }, 503);

/**
 * Closed to this request (the setting in Administration: phones show the maintenance screen and nothing new is recorded):
 * everyone, except an administrator testing it from Administration (admin.ts), whose records are held as tests.
 */
async function selfServiceClosed(request: Request, env: Env): Promise<boolean> {
  if (await selfServiceState(env.DB) === "open") return false;
  if (request.headers.get("x-self-service-test") !== "1") return true;
  const account = await accountFor(request, env);
  return !account || !isAdmin(account) || account.mustChangePassword;
}

const SESSION_NAME = "lh_staff_session";
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
/**
 * Offline cataloguing (V1.6). A lease is a `staff_sessions` row whose id starts `CL-` (a full session's id is a plain UUID). Only
 * someone signed in with a full session can take one, for the device they are on; it travels in its own cookie, signed with its own
 * key, and lets that device keep cataloguing, and send what it catalogued, without a password until it expires (see leaseMayUse).
 * Being a session row, every way a session ends (sign out everywhere, a password change or reset, a change of role or access,
 * deactivation, owner recovery) ends it too; signing out on the device ends it there.
 */
const LEASE_NAME = "lh_catalogue_lease";
const LEASE_PREFIX = "CL-";
const LEASE_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const leaseKey = (secret: string) => `catalogue-lease:${secret}`;
const ITEM_PATH = /^\/api\/staff\/items\/(ITM-[A-Za-z0-9-]{1,24})(\/movements|\/loans|\/open-units|\/photo|\/location-report|\/visual)?$/;
const LOCATION_PATH = /^\/api\/staff\/locations\/(LOC-\d{4,})(\/photo|\/move-items)?$/;
const LOCATION_MEDIA_PATH = /^\/api\/staff\/location-media\/([0-9a-f-]{36})\/([a-z]{1,10})$/;
const REPORT_PATH = /^\/api\/staff\/location-reports\/([0-9a-f-]{36})\/resolve$/;
/** Self-Service shows a shared place's picture by id and size. */
const PUBLIC_LOCATION_MEDIA_PATH = /^\/api\/public\/location-media\/([0-9a-f-]{36})\/([a-z]{1,10})$/;
const CATALOGUE_PATH = /^\/api\/staff\/catalogue\/sessions\/(CS-[0-9a-f-]{36})(\/captures|\/finish|\/unreviewed)?$/;
const AUDIT_PATH = /^\/api\/staff\/audits\/(LA-[0-9a-f-]{36})(\/observations|\/finish|\/review)?$/;
const RESOLVE_PATH = /^\/api\/staff\/audits\/observations\/([0-9a-f-]{36})\/resolve$/;
const ITEM_ID = /^ITM-[A-Za-z0-9-]{1,24}$/;
const MEDIA_PATH = /^\/api\/staff\/media\/([0-9a-f-]{36})\/([a-z]{1,10})$/;
/** The only public image address: a thumbnail, by id. The 1280 px size has no public address. */
const PUBLIC_THUMB_PATH = /^\/api\/public\/media\/([0-9a-f-]{36})\/thumb$/;
const LOAN_PATH = /^\/api\/staff\/loans\/(LN-[A-Za-z0-9-]{1,60})\/(return|photo)$/;
const REORDER_PATH = /^\/api\/staff\/reorders\/(RO-[A-Za-z0-9-]{1,60})$/;
const REVIEW_PATH = /^\/api\/staff\/self-service\/([0-9a-f-]{36})\/(resolve|photo)$/;
/** A sync carries at most a few compressed photos; anything larger is not from the app. */
const MAX_SYNC_BYTES = 12 * 1024 * 1024;
/** An item photo upload is a 1 MB and a 150 KB JPEG plus form framing. */
const MAX_PHOTO_BODY = 1_300_000;
const PERSON_PATH = /^\/api\/staff\/admin\/directory\/(PER-[0-9a-f-]{36})(\/account|\/account\/new|\/access|\/usage|\/loans|\/activity|\/id|\/id\/front|\/id\/back|\/id\/thumb|\/id\/face|\/id\/derived)?$/;
const ACCOUNT_PATH = /^\/api\/staff\/admin\/accounts\/(ACC-[A-Za-z0-9-]{1,60})(\/password|\/sessions\/revoke)?$/;
// Paths still usable while an account must replace a password someone else set.
const PASSWORD_CHANGE_ALLOWED = new Set(["/api/staff/session", "/api/staff/me/password"]);
/** What a sign-in without Logistics Hub access may still do: see and look after its own account. */
const OWN_ACCOUNT_PATHS = new Set(["/api/staff/session", "/api/staff/me", "/api/staff/me/password", "/api/staff/me/sessions/revoke"]);
let dummyHash: Promise<string> | undefined;

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function secureHeaders(response: Response, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Only this site may frame a page: Administration shows Self-Service in a test panel.
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "default-src 'self'; style-src 'self'; font-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (url.pathname.startsWith("/staff") || url.pathname.startsWith("/api/")) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sameOrigin(request: Request, url: URL): boolean {
  return request.headers.get("Origin") === url.origin;
}

function cookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

/** The lease is only ever needed by staff API calls, so no page request carries it. */
function leaseCookie(value: string, maxAge: number, secure: boolean): string {
  return `${LEASE_NAME}=${value}; Path=/api/staff/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

const clientKey = (request: Request, purpose: string) => `${purpose}:${request.headers.get("CF-Connecting-IP") ?? "local"}`;

/**
 * Activity has no catalog revision to go by (it also reads the audit log and renames), so its ETag is a
 * digest of this reader's own answer. The query runs on every refresh; only the body is saved on a 304.
 */
async function activity(request: Request, db: D1Database, account: Account, url: URL): Promise<Response> {
  const admin = isAdmin(account);
  const query = parseActivityQuery(url.searchParams);
  const result = await activityPage(db, admin, query);
  const etag = await activityTag(admin, query, result);
  if (request.headers.get("If-None-Match")?.replace(/^W\//, "") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  return json(result, 200, { etag });
}

/**
 * The CSV of exactly the filtered list, newest first, up to EXPORT_ROWS. A POST because it writes its
 * own audit entry (who, when, which filters, how many rows) before any byte leaves; so it is
 * same-origin like every staff write, limited per account, and never cached.
 */
async function activityExport(db: D1Database, account: Account, url: URL): Promise<Response> {
  const { filters } = parseActivityQuery(url.searchParams);
  if (await throttled(db, `activity-export:${account.accountId}`, 10, 10 * 60_000)) return json({ error: "Too many exports in a short time. Please wait a few minutes." }, 429, { "retry-after": "600" });
  const { events, nextCursor } = await activityPage(db, isAdmin(account), { filters, cursor: null, limit: EXPORT_ROWS });
  const truncated = nextCursor !== null;
  await audit(db, account.accountId, "ACTIVITY_EXPORTED", "EXPORT", "ACTIVITY", { rows: events.length, truncated, filters }).run();
  return new Response(activityCsv(events, truncated), { headers: {
    "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${exportName(new Date())}"`, "cache-control": "private, no-store",
    "x-export-rows": String(events.length), "x-export-truncated": truncated ? "1" : "0"
  } });
}

/** Answers 304 when the client already holds the current catalog revision. */
async function revisioned(request: Request, db: D1Database, load: () => Promise<object>): Promise<Response> {
  const revision = await catalogRevision(db);
  const etag = `"r${revision}"`;
  // Compression at the edge may turn a strong ETag into a weak validator for the same revision.
  if (request.headers.get("If-None-Match")?.replace(/^W\//, "") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "no-store" } });
  return json({ revision, ...await load() }, 200, { etag });
}

type SignedIn = Account & { expiresAt: number };

/**
 * The account behind the full session cookie, or (`lease`) behind this device's offline cataloguing lease. Neither can pass as the
 * other: each cookie is signed with its own key and must name its own kind of row.
 */
async function signedIn(request: Request, env: Env, lease = false): Promise<SignedIn | null> {
  const secret = env.SESSION_SECRET && (lease ? leaseKey(env.SESSION_SECRET) : env.SESSION_SECRET);
  const session = await verifySession(readCookie(request, lease ? LEASE_NAME : SESSION_NAME), secret);
  if (!session || session.id.startsWith(LEASE_PREFIX) !== lease) return null;
  const row = await env.DB.prepare(`SELECT a.id AS accountId, s.id AS sessionId, a.display_name AS displayName, a.username, a.role, a.must_change_password AS mustChangePassword, g.value AS "group", s.expires_at AS expiresAt
    FROM staff_sessions s JOIN staff_accounts a ON a.id = s.account_id LEFT JOIN system_settings g ON g.key = 'account_access:' || a.id
    WHERE s.id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.active = 1`)
    .bind(session.id, Date.now()).first<Omit<SignedIn, "mustChangePassword"> & { mustChangePassword: number }>();
  return row ? { ...row, mustChangePassword: row.mustChangePassword === 1 } : null;
}

const accountFor = (request: Request, env: Env) => signedIn(request, env);
const leaseFor = (request: Request, env: Env) => signedIn(request, env, true);

/** What an offline cataloguing lease may do without a full session: catalogue, and nothing else. */
function leaseMayUse(method: string, path: string): boolean {
  // The Catalogue page, answered with this member's own open session only (staffApi).
  if (path === "/api/staff/catalogue") return method === "GET";
  if (path === "/api/staff/catalogue/offline") return method === "GET" || method === "DELETE";
  if (path === "/api/staff/catalogue/snapshot") return method === "GET";
  if (path === "/api/staff/catalogue/sessions") return method === "POST";
  const session = CATALOGUE_PATH.exec(path);
  if (session) return session[2] === undefined ? method === "GET" || method === "PATCH" : (session[2] === "/captures" || session[2] === "/finish") && method === "POST";
  // Checking a place (V1.7): its own checks, observed and finished offline alike. Settling what a check found changes stock or a
  // record, so it needs a full sign-in.
  if (path === "/api/staff/audits") return method === "GET" || method === "POST";
  const check = AUDIT_PATH.exec(path);
  if (check) return check[2] === undefined ? method === "GET" || method === "PATCH" : (check[2] === "/observations" || check[2] === "/finish") && method === "POST";
  // The first photo of an item this account catalogued; staffApi checks the item.
  return ITEM_PATH.exec(path)?.[2] === "/photo" && method === "PUT";
}

const endSession = (db: D1Database, id: string) => db.prepare("UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL").bind(id);

/** Whether this device may catalogue offline (until `expiresAt`), and as whom. */
const offlineView = (account: SignedIn, signedIn: boolean, expiresAt: number | null) => ({
  signedIn, lease: expiresAt === null ? null : { expiresAt },
  account: { id: account.accountId, displayName: account.displayName, username: account.username, role: account.role, access: accessOf(account.role, account.group) }
});

/** The Catalogue asks on every visit it can make online. */
async function offlineState(request: Request, env: Env, account: SignedIn, leased: boolean): Promise<Response> {
  const lease = leased ? account : await leaseFor(request, env);
  return json(offlineView(account, !leased, lease?.accountId === account.accountId ? lease.expiresAt : null));
}

/** Turns offline cataloguing on for this device, or extends it: a signed-in visit keeps the lease a full week ahead. */
async function enableOffline(request: Request, env: Env, url: URL, account: SignedIn): Promise<Response> {
  const current = await leaseFor(request, env);
  const expiresAt = Date.now() + LEASE_DURATION_MS;
  let id = current?.accountId === account.accountId ? current.sessionId : "";
  if (id && !(await env.DB.prepare("UPDATE staff_sessions SET expires_at = ? WHERE id = ? AND revoked_at IS NULL").bind(expiresAt, id).run()).meta.changes) id = "";
  if (!id) {
    id = `${LEASE_PREFIX}${crypto.randomUUID()}`;
    await env.DB.batch([
      // A device holds one lease: one left here by someone else ends now.
      ...(current ? [endSession(env.DB, current.sessionId)] : []),
      env.DB.prepare("INSERT INTO staff_sessions (id, expires_at, account_id) VALUES (?, ?, ?)").bind(id, expiresAt, account.accountId),
      audit(env.DB, account.accountId, "CATALOGUE_OFFLINE_ON", "ACCOUNT", account.accountId, { username: account.username, until: new Date(expiresAt).toISOString() })
    ]);
  }
  const token = await createSession({ id, subject: account.accountId, role: "CATALOGUE", exp: expiresAt }, leaseKey(env.SESSION_SECRET!));
  return json(offlineView(account, true, expiresAt), 200, { "set-cookie": leaseCookie(token, LEASE_DURATION_MS / 1000, url.protocol === "https:") });
}

/** Turns offline cataloguing off for this device. Whatever it has not sent stays on it until someone signs in there. */
async function disableOffline(request: Request, env: Env, url: URL, account: SignedIn, leased: boolean): Promise<Response> {
  const lease = leased ? account : await leaseFor(request, env);
  if (lease?.accountId === account.accountId) {
    await env.DB.batch([endSession(env.DB, lease.sessionId), audit(env.DB, account.accountId, "CATALOGUE_OFFLINE_OFF", "ACCOUNT", account.accountId, { username: account.username })]);
  }
  return json({ ok: true }, 200, { "set-cookie": leaseCookie("", 0, url.protocol === "https:") });
}

async function login(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (await throttled(env.DB, clientKey(request, "login"), 5, 60_000)) return json({ error: "Too many attempts. Please wait a minute before trying again." }, 429);
  if (!env.SESSION_SECRET) return json({ error: "Staff sign-in is not configured for this environment." }, 503);
  const body = await request.json().catch(() => null) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!username || !password || username.length > 64 || password.length > 256) return json({ error: "Enter your username and password." }, 400);
  // Beside the per-network limit: guessing one account from many networks. It only ever waits out its window.
  const userKey = `login-user:${username.toLowerCase()}`;
  if (await throttled(env.DB, userKey, 20, 15 * 60_000)) return json({ error: "Too many attempts for this account. Please wait a few minutes before trying again." }, 429, { "retry-after": "900" });
  const account = await env.DB.prepare("SELECT id, role, password_hash AS passwordHash, must_change_password AS mustChangePassword FROM staff_accounts WHERE username = ? AND active = 1")
    .bind(username).first<{ id: string; role: string; passwordHash: string; mustChangePassword: number }>();
  // Verify against a throwaway hash for unknown users so timing does not reveal which usernames exist.
  const valid = await verifyPassword(password, account?.passwordHash ?? await (dummyHash ??= hashPassword(crypto.randomUUID())));
  if (!account || !valid) return json({ error: "That username and password were not accepted." }, 401);
  const id = crypto.randomUUID();
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const token = await createSession({ id, subject: account.id, role: account.role, exp: expiresAt }, env.SESSION_SECRET);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO staff_sessions (id, expires_at, account_id) VALUES (?, ?, ?)").bind(id, expiresAt, account.id),
    env.DB.prepare("UPDATE staff_accounts SET last_login_at = ? WHERE id = ?").bind(new Date().toISOString(), account.id)
  ]);
  await clearThrottle(env.DB, clientKey(request, "login"), userKey);
  await sweepStale(env.DB);
  const secure = url.protocol === "https:";
  const response = json({ ok: true, mustChangePassword: account.mustChangePassword === 1 }, 200, { "set-cookie": cookie(token, SESSION_DURATION_MS / 1000, secure) });
  // Someone else's offline cataloguing lease left on this device ends now: when this sign-in lapses, the device must not act as them.
  const lease = await verifySession(readCookie(request, LEASE_NAME), leaseKey(env.SESSION_SECRET));
  if (lease && lease.subject !== account.id) {
    await endSession(env.DB, lease.id).run();
    response.headers.append("set-cookie", leaseCookie("", 0, secure));
  }
  return response;
}

/** Signing out on a device also ends offline cataloguing there; anything not yet sent stays on the device for the next sign-in. */
async function logout(request: Request, env: Env, url: URL): Promise<Response> {
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  const session = await verifySession(readCookie(request, SESSION_NAME), env.SESSION_SECRET);
  const lease = await verifySession(readCookie(request, LEASE_NAME), env.SESSION_SECRET && leaseKey(env.SESSION_SECRET));
  const ended = [session, lease].filter((each) => each !== null).map((each) => endSession(env.DB, each.id));
  if (ended.length) await env.DB.batch(ended);
  const secure = url.protocol === "https:";
  const response = json({ ok: true }, 200, { "set-cookie": cookie("", 0, secure) });
  response.headers.append("set-cookie", leaseCookie("", 0, secure));
  return response;
}

async function staffApi(request: Request, env: Env, url: URL): Promise<Response> {
  const mutating = request.method !== "GET";
  if (mutating && !sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  const path = url.pathname;
  const method = request.method;
  const full = await accountFor(request, env);
  const account = full ?? (leaseMayUse(method, path) ? await leaseFor(request, env) : null);
  if (!account) return json({ error: "Your staff session has ended. Please sign in again." }, 401);
  /** Signed in only by this device's offline cataloguing lease, not a full session. */
  const leased = !full;
  const body = () => request.json().catch(() => null);
  if (account.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(path)) return json({ error: "Set a new password before continuing.", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  // Staff of other departments and officers sign in to their own account only (Earl, 2026-10-03).
  if (!hubAccess(account) && !OWN_ACCOUNT_PATHS.has(path)) return json({ error: "The Logistics Hub is for the Department of Logistics. Your sign-in opens your account only.", code: "NO_HUB_ACCESS" }, 403);

  if (path === "/api/staff/session" && method === "GET") {
    const { accountId, sessionId, group, expiresAt, ...profile } = account;
    const reviews = await env.DB.prepare(`SELECT (SELECT COUNT(*) FROM self_service_events WHERE review IS NOT NULL AND resolved_at IS NULL)
      + (SELECT COUNT(*) FROM location_reports WHERE source = 'SELF_SERVICE' AND resolved_at IS NULL) AS total`).first<number>("total");
    return json({ authenticated: true, id: accountId, ...profile, access: accessOf(account.role, group), hub: hubAccess(account), recovery: await recoveryStatus(env.DB, account), selfServiceReviews: reviews ?? 0, selfServiceClosed: await selfServiceState(env.DB) === "paused", directory: await linkedPerson(env.DB, accountId) });
  }
  if (path === "/api/staff/me" && method === "PATCH") return json(await updateSelf(env.DB, account, await body()));
  if (path === "/api/staff/me/password" && method === "POST") return json(await changeOwnPassword(env.DB, account, await body()));
  if (path === "/api/staff/me/sessions/revoke" && method === "POST") return json(await revokeAccountSessions(env.DB, account, account.accountId));
  if (path === "/api/staff/me/recovery-key" && method === "POST") return json(await rotateRecoveryKey(env.DB, account));
  if (path === "/api/staff/me/recovery-key" && method === "DELETE") return json(await revokeRecoveryKey(env.DB, account));

  if (path.startsWith("/api/staff/admin/")) {
    if (!isAdmin(account)) return json({ error: "Administration requires an administrator or owner account." }, 403);
    if (path === "/api/staff/admin/accounts" && method === "GET") return json(await listAccounts(env.DB));
    if (path === "/api/staff/admin/accounts" && method === "POST") return json(await createAccount(env.DB, account, await body()), 201);
    if (path === "/api/staff/admin/activity" && method === "GET") return json(await securityActivity(env.DB));
    if (path === "/api/staff/admin/self-service" && method === "PATCH") return json(await setSelfService(env.DB, account, await body()));
    if (path === "/api/staff/admin/retention") {
      if (account.role !== "OWNER") return json({ error: "Removing old personal details is for the owner." }, 403);
      if (method === "GET") return json(await retentionPreview(env.DB));
      if (method === "POST") return json(await eraseOldDetails(env.DB, env.EVIDENCE, account));
      return json({ error: "Method not allowed." }, 405);
    }
    if (path.startsWith("/api/staff/admin/directory")) return staffDirectory(request, env, account, url);
    const target = ACCOUNT_PATH.exec(path);
    if (target && !target[2] && method === "PATCH") return json(await updateAccount(env.DB, account, target[1]!, await body()));
    if (target?.[2] === "/password" && method === "POST") return json(await resetPassword(env.DB, account, target[1]!, await body()));
    if (target?.[2] === "/sessions/revoke" && method === "POST") return json(await revokeAccountSessions(env.DB, account, target[1]!));
    return json({ error: target ? "Method not allowed." : "Not found." }, target ? 405 : 404);
  }

  if (path === "/api/staff/inventory" && method === "GET") return revisioned(request, env.DB, async () => ({ ...await staffInventory(env.DB), locations: await locationList(env.DB) }));
  if (path === "/api/staff/locations" && method === "GET") return revisioned(request, env.DB, async () => ({ locations: await locationList(env.DB) }));
  if (path === "/api/staff/locations" && method === "POST") return json(await createLocation(env.DB, account, await body()), 201);
  const place = LOCATION_PATH.exec(path);
  if (place && !place[2] && method === "PATCH") return json(await updateLocation(env.DB, account, place[1]!, await body()));
  if (place && !place[2] && method === "DELETE") {
    const { deleted, photoId } = await deleteLocation(env.DB, account, place[1]!, url.searchParams.get("expected"));
    if (photoId) await dropObjects(env.CATALOG_MEDIA, photoId, "locations");
    return json({ deleted });
  }
  if (place?.[2] === "/move-items" && method === "POST") return json(await moveItems(env.DB, account, place[1]!, await body()));
  if (place?.[2] === "/photo" && method === "PUT") {
    if (Number(request.headers.get("content-length")) > MAX_PHOTO_BODY) throw new InputError(413, "That photo is too large.");
    const form = await request.formData().catch(() => null);
    if (!form) throw new InputError(400, "Invalid photo form.");
    return json(await putLocationPhoto(env.DB, env.CATALOG_MEDIA, account, place[1]!, form));
  }
  if (place?.[2] === "/photo" && method === "DELETE") return json(await removeLocationPhoto(env.DB, env.CATALOG_MEDIA, account, place[1]!, url.searchParams.get("expected")));
  const picture = LOCATION_MEDIA_PATH.exec(path);
  if (picture && method === "GET") return locationPicture(env.CATALOG_MEDIA, picture[1]!, picture[2]!);
  const resolving = REPORT_PATH.exec(path);
  if (resolving && method === "POST") return json(await resolveReport(env.DB, account, resolving[1]!, await body()));
  if (path === "/api/staff/catalogue" && method === "GET") {
    const state = await catalogueState(env.DB, account);
    // A lease sees only its member's own open session: who else is cataloguing and what waits for review need a sign-in.
    return json(leased ? { session: state.session, others: [], reviewLater: { total: 0, items: [] } } : state);
  }
  if (path === "/api/staff/catalogue/offline" && method === "GET") return offlineState(request, env, account, leased);
  if (path === "/api/staff/catalogue/offline" && method === "POST") return enableOffline(request, env, url, account);
  if (path === "/api/staff/catalogue/offline" && method === "DELETE") return disableOffline(request, env, url, account, leased);
  if (path === "/api/staff/catalogue/snapshot" && method === "GET") return revisioned(request, env.DB, () => catalogueSnapshot(env.DB));
  if (path === "/api/staff/catalogue/sessions" && method === "POST") { const started = await startSession(env.DB, account, await body()); return json(started, started.resumed ? 200 : 201); }
  const session = CATALOGUE_PATH.exec(path);
  if (session && !session[2] && method === "GET") {
    const detail = await sessionDetail(env.DB, account, session[1]!);
    // Any Logistics member may read a session; a lease, only its own member's.
    if (leased && !detail.session.mine) throw new InputError(403, "Sign in again to see someone else's session.");
    return json(detail);
  }
  if (session && !session[2] && method === "PATCH") return json(await setSessionPlace(env.DB, account, session[1]!, await body()));
  if (session?.[2] === "/unreviewed" && method === "GET") return json(await unreviewed(env.DB, session[1]!));
  if (session?.[2] === "/finish" && method === "POST") return json(await finishSession(env.DB, account, session[1]!));
  if (session?.[2] === "/captures" && method === "POST") {
    const saved = await capture(env.DB, account, session[1]!, await body());
    return "duplicates" in saved ? json({ error: "This may already be in the catalog.", ...saved }, 409) : json(saved, saved.replayed ? 200 : 201);
  }
  if (path === "/api/staff/audits" && method === "GET") {
    const state = await auditState(env.DB, account);
    // A lease sees only its member's own checks: who else is checking and what was finished need a sign-in.
    return json(leased ? { mine: state.mine, others: [], finished: [] } : state);
  }
  if (path === "/api/staff/audits" && method === "POST") { const started = await startAudit(env.DB, account, await body()); return json(started, started.resumed ? 200 : 201); }
  const check = AUDIT_PATH.exec(path);
  if (check && !check[2] && method === "GET") {
    const detail = await auditDetail(env.DB, account, check[1]!);
    if (leased && !detail.audit.mine) throw new InputError(403, "Sign in again to see someone else's check.");
    return json(detail);
  }
  if (check && !check[2] && method === "PATCH") return json(await updateAudit(env.DB, account, check[1]!, await body()));
  if (check?.[2] === "/observations" && method === "POST") { const seen = await observe(env.DB, account, check[1]!, await body()); return json(seen, seen.replayed ? 200 : 201); }
  if (check?.[2] === "/finish" && method === "POST") return json(await finishAudit(env.DB, account, check[1]!));
  if (check?.[2] === "/review" && method === "GET") return json(await auditReview(env.DB, account, check[1]!));
  const settling = RESOLVE_PATH.exec(path);
  if (settling && method === "POST") return json(await resolveObservation(env.DB, account, settling[1]!, await body()));
  if (path === "/api/staff/items/bulk" && method === "POST") return json(await bulkUpdate(env.DB, account, await body()));
  if (path === "/api/staff/stock" && method === "GET") return revisioned(request, env.DB, () => stockOverview(env.DB));
  if (path === "/api/staff/loans" && method === "GET") return revisioned(request, env.DB, () => loansOverview(env.DB));
  if (path === "/api/staff/self-service" && method === "GET") return revisioned(request, env.DB, () => selfServiceReview(env.DB));
  if (path === "/api/staff/activity" && method === "GET") return activity(request, env.DB, account, url);
  if (path === "/api/staff/activity/export" && method === "POST") return activityExport(env.DB, account, url);
  if (path === "/api/staff/reorders" && method === "POST") return json(await openReorder(env.DB, account, await body()), 201);
  const review = REVIEW_PATH.exec(path);
  if (review?.[2] === "resolve" && method === "POST") return json(await resolveReview(env.DB, env.EVIDENCE, account, review[1]!, await body()));
  if (review?.[2] === "photo" && method === "GET") return heldPhoto(env.DB, env.EVIDENCE, review[1]!);
  const loan = LOAN_PATH.exec(path);
  if (loan?.[2] === "return" && method === "POST") return json(await closeLoan(env.DB, account, loan[1]!, await body()));
  if (loan?.[2] === "photo" && method === "GET") return loanPhoto(env.DB, env.EVIDENCE, loan[1]!);
  const reorder = REORDER_PATH.exec(path);
  if (reorder && method === "PATCH") return json(await updateReorder(env.DB, account, reorder[1]!, await body()));
  if (path === "/api/staff/items" && method === "POST") {
    const input = await body() as Record<string, unknown> | null;
    const opening = input?.openingQuantity ?? 0;
    if (typeof opening !== "number" || !Number.isInteger(opening) || opening < 0 || opening > 100_000) throw new InputError(400, "Opening quantity must be a whole number from 0 to 100000.");
    return json(await createItem(env.DB, account, parseItemInput(input), opening), 201);
  }
  const media = MEDIA_PATH.exec(path);
  if (media && method === "GET") return itemPhoto(env.CATALOG_MEDIA, media[1]!, media[2]!);
  const match = ITEM_PATH.exec(path);
  if (match && !match[2] && method === "GET") {
    const [detail, freshness] = await Promise.all([itemDetail(env.DB, match[1]!), itemFreshness(env.DB, match[1]!)]);
    return json({ ...detail, freshness });
  }
  if (match && !match[2] && method === "PATCH") {
    const input = await body() as Record<string, unknown> | null;
    return json(await updateItem(env.DB, account, match[1]!, parseItemInput(input), input?.updatedAt));
  }
  if (match?.[2] === "/visual" && method === "PATCH") return json(await updateItemVisual(env.DB, account, match[1]!, await body()));
  if (match?.[2] === "/movements" && method === "POST") return json(await recordMovement(env.DB, account, match[1]!, await body()));
  if (match?.[2] === "/location-report" && method === "POST") return json(await reportLocation(env.DB, account, match[1]!, await body()), 201);
  if (match?.[2] === "/photo" && method === "PUT") {
    // Two small JPEGs: refuse a larger body before reading it into memory.
    if (Number(request.headers.get("content-length")) > MAX_PHOTO_BODY) throw new InputError(413, "That photo is too large.");
    const form = await request.formData().catch(() => null);
    if (!form) throw new InputError(400, "Invalid photo form.");
    // On a lease, only the first photo of an item this account catalogued.
    if (leased && (form.get("expected") !== "" || !await capturedBy(env.DB, account.accountId, match[1]!))) throw new InputError(403, "Sign in again to change this item's photo.");
    return json(await putItemPhoto(env.DB, env.CATALOG_MEDIA, account, match[1]!, form));
  }
  if (match?.[2] === "/photo" && method === "DELETE") return json(await removeItemPhoto(env.DB, env.CATALOG_MEDIA, account, match[1]!, url.searchParams.get("expected")));
  if (match?.[2] === "/open-units" && method === "POST") return json(await openUnitAction(env.DB, account, match[1]!, await body()));
  if (match?.[2] === "/loans" && method === "POST") {
    const form = await request.formData().catch(() => null);
    if (!form) throw new InputError(400, "Invalid loan form.");
    return json(await createLoan(env.DB, env.EVIDENCE, account, match[1]!, form), 201);
  }
  const known = match || session || media || reorder || loan || review || place || picture || resolving || ["/api/staff/session", "/api/staff/inventory", "/api/staff/stock", "/api/staff/loans", "/api/staff/self-service", "/api/staff/activity", "/api/staff/activity/export", "/api/staff/reorders", "/api/staff/items", "/api/staff/items/bulk", "/api/staff/catalogue", "/api/staff/catalogue/offline", "/api/staff/catalogue/snapshot", "/api/staff/catalogue/sessions", "/api/staff/locations", "/api/staff/me", "/api/staff/me/password", "/api/staff/me/sessions/revoke", "/api/staff/me/recovery-key"].includes(path);
  return json({ error: known ? "Method not allowed." : "Not found." }, known ? 405 : 404);
}

/** Administration → Staff Directory. The caller is already an ADMIN or OWNER; the owner-only steps check again inside. */
async function staffDirectory(request: Request, env: Env, account: Account, url: URL): Promise<Response> {
  const { pathname: path } = url;
  const method = request.method;
  const body = () => request.json().catch(() => null);
  const scans = async () => {
    // Two card scans: refuse a larger body before reading it into memory.
    const size = Number(request.headers.get("content-length"));
    if (!size) throw new InputError(411, "Missing content length.");
    if (size > MAX_SCAN_BODY) throw new InputError(413, "Those scans are too large.");
    const form = await request.formData().catch(() => null);
    if (!form) throw new InputError(400, "Invalid upload.");
    return form;
  };
  if (path === "/api/staff/admin/directory" && method === "GET") return json(await directory(env.DB));
  if (path === "/api/staff/admin/directory" && method === "POST") return json(await createPerson(env.DB, account, await body()), 201);
  if (path === "/api/staff/admin/directory/accounts" && method === "GET") return json(await linkableAccounts(env.DB, account));
  if (path === "/api/staff/admin/directory/derived" && method === "GET") return json(await missingDerived(env.DB, env.STAFF_IDS, account));
  if (path === "/api/staff/admin/directory/import" && method === "POST") return json(await importPair(env.DB, env.STAFF_IDS, account, await scans()));
  const match = PERSON_PATH.exec(path);
  const [, id, part] = match ?? [];
  if (match && !part && method === "GET") return json(await personDetail(env.DB, id!));
  if (match && !part && method === "PATCH") return json(await updatePerson(env.DB, account, id!, await body()));
  if (part === "/account" && method === "PUT") return json(await linkAccount(env.DB, account, id!, await body()));
  if (part === "/account" && method === "DELETE") return json(await unlinkAccount(env.DB, account, id!));
  if (part === "/account/new" && method === "POST") return json(await createLinkedAccount(env.DB, account, id!, await body()), 201);
  if (part === "/access" && method === "GET") return json(await personAccess(env.DB, account, id!));
  if (part === "/usage" && method === "GET") return json(await personUsage(env.DB, id!, url.searchParams));
  if (part === "/loans" && method === "GET") return json(await personLoans(env.DB, id!));
  if (part === "/activity" && method === "GET") return json(await personActivity(env.DB, id!, url.searchParams.get("cursor")));
  if (part === "/id" && method === "PUT") return json(await putIdCard(env.DB, env.STAFF_IDS, account, id!, await scans()));
  if (part === "/id" && method === "DELETE") return json(await removeIdCard(env.DB, env.STAFF_IDS, account, id!, url.searchParams.get("expected")));
  if ((part === "/id/front" || part === "/id/back") && method === "GET") return idScan(env.DB, env.STAFF_IDS, account, id!, part.slice(4), url.searchParams.get("derive") === "1");
  if ((part === "/id/thumb" || part === "/id/face") && method === "GET") return idDerived(env.DB, env.STAFF_IDS, account, id!, part.slice(4));
  if (part === "/id/derived" && method === "PUT") return json(await putDerived(env.DB, env.STAFF_IDS, account, id!, await scans()));
  const known = match || ["/api/staff/admin/directory", "/api/staff/admin/directory/accounts", "/api/staff/admin/directory/derived", "/api/staff/admin/directory/import"].includes(path);
  return json({ error: known ? "Method not allowed." : "Not found." }, known ? 405 : 404);
}

/**
 * Phone self-service sync: public and anonymous, so same-origin, size-capped and rate-limited
 * per network and per phone (by events, not requests). A 429 just makes the phone retry later.
 */
async function selfServiceSync(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (await selfServiceClosed(request, env)) return selfServicePaused();
  const size = Number(request.headers.get("content-length"));
  if (!size) return json({ error: "Missing content length." }, 411);
  if (size > MAX_SYNC_BYTES) return json({ error: "Too much at once." }, 413);
  const busy = () => json({ error: "Too many records at once. They are safe on your phone and will be sent shortly." }, 429, { "retry-after": "60" });
  const network = networkOf(request);
  // Requests are counted before anything is parsed; records are counted once the batch is read.
  if (await throttled(env.DB, `self-service-requests:${network}`, 120, 10 * 60_000)) return busy();
  const form = await request.formData().catch(() => null);
  if (!form) throw new InputError(400, "Malformed sync request.");
  const batch = { ...readBatch(form), network, clientTag: await networkTag(network, env) };
  const weight = batch.events.length;
  if (await throttled(env.DB, `self-service:${network}`, 300, 10 * 60_000, weight) || await throttled(env.DB, `self-service-device:${batch.deviceId}`, 100, 10 * 60_000, weight)) return busy();
  // Phones choose their own device ids, so old throttle rows are swept now and then.
  if (Math.random() < 0.02) await sweepStale(env.DB);
  return json(await syncEvents(env.DB, env.EVIDENCE, batch, (id) => form.get(`photo:${id}`)));
}

/**
 * A phone's "I can’t find it" / "Location looks wrong": public and anonymous, so same-origin, tiny, rate-limited per network,
 * only for an item Self-Service offers, and no free text but the reporter's name. It records an attention signal (location-reports.ts) and changes
 * nothing else. In the Administration test panel nothing is recorded.
 */
async function selfServiceLocationReport(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (await selfServiceClosed(request, env)) return selfServicePaused();
  const size = Number(request.headers.get("content-length"));
  if (!size) return json({ error: "Missing content length." }, 411);
  if (size > 1024) return json({ error: "Too much at once." }, 413);
  const network = networkOf(request);
  if (await throttled(env.DB, `location-report:${network}`, 10, 10 * 60_000)) return json({ error: "Too many reports at once. Please ask DOL staff in person." }, 429, { "retry-after": "600" });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const itemId = body?.itemId;
  if (typeof itemId !== "string" || !ITEM_ID.test(itemId)) throw new InputError(400, "Choose an item.");
  if (request.headers.get("x-self-service-test") === "1") return json({ id: body?.id ?? null, recorded: false, test: true });
  return json(await reportLocation(env.DB, null, itemId, body, await networkTag(network, env)), 201);
}

/**
 * A short keyed hash of the sender's network, so staff can see that records came from the same
 * place without anyone storing or seeing the address itself. None without the signing secret.
 */
async function networkTag(network: string, env: Env): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`self-service network:${network}`)));
  return [...digest.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Owner recovery: public, same-origin, throttled, and able to do exactly one thing. */
async function recovery(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  if (!sameOrigin(request, url)) return json({ error: "Invalid request origin." }, 403);
  if (await throttled(env.DB, clientKey(request, "recovery"), 5, 15 * 60_000)) return json({ error: "Too many recovery attempts. Please wait 15 minutes." }, 429);
  return json(await recoverOwner(env.DB, await request.json().catch(() => null)));
}

async function route(request: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  if (path === "/api/public/catalog") {
    return request.method === "GET" ? revisioned(request, env.DB, () => publicCatalog(env.DB)) : json({ error: "Method not allowed." }, 405, { allow: "GET" });
  }
  const thumb = PUBLIC_THUMB_PATH.exec(path);
  if (thumb) {
    return request.method === "GET" ? publicThumb(env.DB, env.CATALOG_MEDIA, thumb[1]!, request.headers.get("If-None-Match"), async () => await selfServiceState(env.DB) === "open") : json({ error: "Method not allowed." }, 405, { allow: "GET" });
  }
  const locationPictureMatch = PUBLIC_LOCATION_MEDIA_PATH.exec(path);
  if (locationPictureMatch) {
    return request.method === "GET" ? publicLocationPicture(env.DB, env.CATALOG_MEDIA, locationPictureMatch[1]!, locationPictureMatch[2]!, request.headers.get("If-None-Match"), async () => await selfServiceState(env.DB) === "open") : json({ error: "Method not allowed." }, 405, { allow: "GET" });
  }
  if (path === "/api/staff/login" || path === "/api/staff/logout") {
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
    return path === "/api/staff/login" ? login(request, env, url) : logout(request, env, url);
  }
  if (path === "/api/recovery/owner") return recovery(request, env, url);
  if (path === "/api/self-service/catalog") {
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { allow: "GET" });
    return await selfServiceClosed(request, env) ? selfServicePaused() : revisioned(request, env.DB, () => selfServiceCatalog(env.DB));
  }
  if (path === "/api/self-service/sync") return selfServiceSync(request, env, url);
  if (path === "/api/self-service/location-report") return selfServiceLocationReport(request, env, url);
  if (path === "/api/self-service/decisions") {
    return request.method === "GET" ? json(await reviewDecisions(env.DB, url.searchParams.get("ids"))) : json({ error: "Method not allowed." }, 405, { allow: "GET" });
  }
  if (path.startsWith("/api/staff/")) return staffApi(request, env, url);
  if (path.startsWith("/api/")) return json({ error: "Not found." }, 404);
  // Items lived at /staff/inventory until V1.1; keep saved links and bookmarks working.
  if (path === "/staff/inventory") return Response.redirect(new URL(`/staff/items${url.search}`, url), 301);
  // Every staff page below /staff requires a live session before any HTML is served, except the Catalogue: it also opens on a
  // device's offline cataloguing lease (and offline, from the service worker), so the page itself decides. A signed-in visit to
  // the login page goes straight to the workspace.
  if (path.startsWith("/staff/") && path !== "/staff/catalogue") {
    const account = await accountFor(request, env);
    if (!account) return Response.redirect(new URL("/staff", url), 302);
    if (path.startsWith("/staff/admin") && !isAdmin(account)) return Response.redirect(new URL("/staff/items", url), 302);
  }
  if (path === "/staff" && request.method === "GET" && await accountFor(request, env)) return Response.redirect(new URL("/staff/items", url), 302);
  return assetCaching(await env.ASSETS.fetch(request), path);
}

/**
 * Build files under /assets/ are named by their content, so browsers may keep them for a year.
 * The service worker script must always be revalidated, or installed phones would miss updates.
 */
function assetCaching(response: Response, path: string): Response {
  const cacheControl = path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : path === "/sw.js" ? "no-cache" : null;
  const manifest = path.endsWith(".webmanifest");
  if (!response.ok || (!cacheControl && !manifest)) return response;
  const headers = new Headers(response.headers);
  if (cacheControl) headers.set("cache-control", cacheControl);
  if (manifest) headers.set("content-type", "application/manifest+json");
  return new Response(response.body, { status: response.status, headers });
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
