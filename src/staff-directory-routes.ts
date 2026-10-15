import type { Account } from "./accounts";
import { json } from "./http";
import { InputError } from "./inventory";
import { MAX_SCAN_BODY, createLinkedAccount, idDerived, missingDerived, putDerived, createPerson, directory, findPeople, idScan, importPair, linkAccount, linkableAccounts, personAccess, personActivity, personDetail, personLoans, personUsage, putIdCard, removeIdCard, unlinkAccount, updatePerson } from "./staff-directory";

const PERSON_PATH = /^\/api\/staff\/admin\/directory\/(PER-[0-9a-f-]{36})(\/account|\/account\/new|\/access|\/usage|\/loans|\/activity|\/id|\/id\/front|\/id\/back|\/id\/thumb|\/id\/face|\/id\/derived)?$/;

/** What the Staff Directory uses: the database and its own bucket of official ID scans. */
type DirectoryEnv = { DB: D1Database; STAFF_IDS: R2Bucket };

/**
 * Administration → Staff Directory. worker.ts sends a request here only after its central checks (same origin for a write, a full
 * session, no password left to replace, an administrator or owner), so the caller is already an ADMIN or OWNER; the owner-only
 * steps check again inside staff-directory.ts.
 */
export async function staffDirectory(request: Request, env: DirectoryEnv, account: Account, url: URL): Promise<Response> {
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
  if (path === "/api/staff/admin/directory/search" && method === "GET") return json(await findPeople(env.DB, url.searchParams.get("q") ?? ""), 200, { "cache-control": "private, no-store" });
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
  const known = match || ["/api/staff/admin/directory", "/api/staff/admin/directory/search", "/api/staff/admin/directory/accounts", "/api/staff/admin/directory/derived", "/api/staff/admin/directory/import"].includes(path);
  return json({ error: known ? "Method not allowed." : "Not found." }, known ? 405 : 404);
}
