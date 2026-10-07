import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { hashPassword } from "../src/session";
import { migratedD1 } from "./d1-sqlite";

/*
 * V1.15 (V2 consolidation): the three kinds of private media stay apart. Catalog pictures (items, places, kits) live in
 * CATALOG_MEDIA, transaction evidence (loan and held Self-Service photos) in EVIDENCE, and official staff ID scans in
 * STAFF_IDS. Every bucket here answers any key with its own name, so a route that read the wrong bucket, or served bytes
 * past a missing permission or policy check, would show up as a body naming that bucket.
 */

const origin = "https://hub.example.test";
const PASSWORD = "correct horse battery";
const UUID = "0b8c1f6e-3d2a-4c5b-9e7f-1a2b3c4d5e6f";
const PERSON = `PER-${UUID}`;
type Bucket = "CATALOG_MEDIA" | "EVIDENCE" | "STAFF_IDS";

let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
const reads: Array<{ bucket: Bucket; key: string }> = [];

/** A bucket that holds every key: each read is logged and answered with the bucket's own name. */
function anyKeyBucket(name: Bucket): R2Bucket {
  return {
    get: async (key: string) => {
      reads.push({ bucket: name, key });
      return { body: new Blob([name]).stream(), httpMetadata: { contentType: "image/jpeg" } };
    },
    put: async () => undefined,
    delete: async () => undefined,
    list: async () => ({ objects: [], truncated: false })
  } as unknown as R2Bucket;
}

const call = (path: string, cookie = "") => worker.fetch(new Request(`${origin}${path}`, { headers: cookie ? { origin, cookie } : { origin } }), env);

async function signIn(id: string, username: string, role: string): Promise<string> {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, username, await hashPassword(PASSWORD), role);
  const response = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD }) }), env);
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

/** Rows that point at evidence and an ID card, written without their unrelated foreign rows: only the lookups matter here. */
function seedPointers() {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  const now = new Date().toISOString();
  sqlite.prepare(`INSERT INTO loans(id, item_id, quantity, purpose, borrower_name, student_id, photo_key, movement_id, created_at, created_by)
    VALUES('LN-BOUNDARY', 'ITM-NONE', 1, 'INDIVIDUAL', 'A Borrower', 'S-1', 'loans/LN-BOUNDARY.jpg', 'MV-BOUNDARY', ?, 'ACC-STAFF')`).run(now);
  sqlite.prepare(`INSERT INTO self_service_events(id, device_id, seq, event_type, item_id, quantity, person_name, photo_key, device_time, sent_at, occurred_at, received_at, applied, review)
    VALUES(?, 'DEV-1', 1, 'BORROW', 'ITM-NONE', 1, 'A Borrower', 'self-service/held.jpg', ?, ?, ?, ?, 0, 'HELD')`).run(UUID, now, now, now, now);
  sqlite.prepare("INSERT INTO staff_directory(id, full_name, department, created_at, updated_at) VALUES(?, 'A Person', 'USC', ?, ?)").run(PERSON, now, now);
  sqlite.prepare("INSERT INTO staff_id_cards(person_id, media_id, front_width, front_height, back_width, back_height, created_at) VALUES(?, ?, 100, 63, 100, 63, ?)").run(PERSON, UUID, now);
  sqlite.exec("PRAGMA foreign_keys = ON");
}

/** Every route that streams private media, the bucket it must read, and who may open it. */
const PRIVATE: Array<{ path: string; bucket: Bucket; adminOnly: boolean; cache: string }> = [
  { path: `/api/staff/media/${UUID}/thumb`, bucket: "CATALOG_MEDIA", adminOnly: false, cache: "private, max-age=86400" },
  { path: `/api/staff/location-media/${UUID}/thumb`, bucket: "CATALOG_MEDIA", adminOnly: false, cache: "private, max-age=86400" },
  { path: `/api/staff/kit-media/${UUID}/thumb`, bucket: "CATALOG_MEDIA", adminOnly: false, cache: "private, max-age=86400" },
  { path: "/api/staff/loans/LN-BOUNDARY/photo", bucket: "EVIDENCE", adminOnly: false, cache: "private, no-store" },
  { path: `/api/staff/self-service/${UUID}/photo`, bucket: "EVIDENCE", adminOnly: false, cache: "private, no-store" },
  { path: `/api/staff/admin/directory/${PERSON}/id/front`, bucket: "STAFF_IDS", adminOnly: true, cache: "private, no-store" },
  { path: `/api/staff/admin/directory/${PERSON}/id/back`, bucket: "STAFF_IDS", adminOnly: true, cache: "private, no-store" },
  { path: `/api/staff/admin/directory/${PERSON}/id/thumb`, bucket: "STAFF_IDS", adminOnly: true, cache: "private, no-store" },
  { path: `/api/staff/admin/directory/${PERSON}/id/face`, bucket: "STAFF_IDS", adminOnly: true, cache: "private, no-store" }
];

beforeEach(() => {
  const database = migratedD1();
  sqlite = database.sqlite;
  reads.length = 0;
  env = {
    DB: database.d1, CATALOG_MEDIA: anyKeyBucket("CATALOG_MEDIA"), EVIDENCE: anyKeyBucket("EVIDENCE"), STAFF_IDS: anyKeyBucket("STAFF_IDS"),
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret"
  };
  seedPointers();
});

describe("V2 media boundaries", () => {
  it("serves no private media to a visitor who is not signed in, and reads no bucket", async () => {
    for (const { path } of PRIVATE) expect((await call(path)).status, path).toBe(401);
    expect(reads).toEqual([]);
  });

  it("reads each kind of media only from its own bucket, with its own cache rule", async () => {
    const admin = await signIn("ACC-ADMIN", "admin.one", "ADMIN");
    for (const { path, bucket, cache } of PRIVATE) {
      reads.length = 0;
      const response = await call(path, admin);
      expect(response.status, path).toBe(200);
      expect(await response.text(), path).toBe(bucket);
      expect(response.headers.get("cache-control"), path).toBe(cache);
      expect(reads.map((read) => read.bucket), path).toEqual([bucket]);
    }
  });

  it("keeps official staff IDs from staff who are not administrators, without opening the bucket", async () => {
    const staff = await signIn("ACC-STAFF", "staff.one", "STAFF");
    for (const { path, bucket, adminOnly } of PRIVATE) {
      reads.length = 0;
      const response = await call(path, staff);
      if (adminOnly) {
        expect(response.status, path).toBe(403);
        expect(reads, path).toEqual([]);
      } else {
        expect(await response.text(), path).toBe(bucket);
      }
    }
  });

  it("answers the public picture routes only for what a public list shows, and never from evidence or ID buckets", async () => {
    // Nothing is listed or shared: both public routes refuse before any bucket is read.
    expect((await call(`/api/public/media/${UUID}/thumb`)).status).toBe(404);
    expect((await call(`/api/public/location-media/${UUID}/thumb`)).status).toBe(404);
    expect(reads).toEqual([]);
    // No public route reaches the evidence or staff ID buckets, under any id.
    for (const path of [`/api/public/media/${UUID}/display`, "/api/public/loans/LN-BOUNDARY/photo", `/api/public/self-service/${UUID}/photo`, `/api/public/directory/${PERSON}/id/front`]) {
      expect((await call(path)).status, path).toBe(404);
    }
    expect(reads.filter((read) => read.bucket !== "CATALOG_MEDIA")).toEqual([]);
  });
});
