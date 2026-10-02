import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { cleanJpeg } from "../src/item-media";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";

/* V1.2 item profile photos: the JPEG check, then add / replace / remove through the Worker, with R2 and D1 kept in step. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let media: ReturnType<typeof memoryR2>;
let cookie: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** A small valid JPEG: tables, a frame of the given size, one scan with a stuffed byte, then whatever `around` adds. */
const segment = (marker: number, payload: number[]) => [0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
function jpeg(options: { width?: number; height?: number; before?: number[]; after?: number[]; marker?: number; components?: number; precision?: number } = {}): Uint8Array {
  const { width = 8, height = 6, before = [], after = [], marker = 0xc0, components = 3, precision = 8 } = options;
  const frame = segment(marker, [precision, height >> 8, height & 255, width >> 8, width & 255, components, ...Array.from({ length: components }, (_, index) => [index + 1, 0x11, 0]).flat()]);
  return Uint8Array.from([0xff, 0xd8, ...before, ...segment(0xdb, [0, ...Array(64).fill(1)]), ...frame, ...segment(0xc4, [0, ...Array(16).fill(0), 0]),
    ...segment(0xda, [components, ...Array.from({ length: components }, (_, index) => [index + 1, 0]).flat(), 0, 63, 0]), 0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0xff, 0xd9, ...after]);
}
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
/** An APP1 EXIF block carrying one orientation entry, in either byte order. */
function exif(orientation: number, little: boolean): number[] {
  const two = (value: number) => little ? [value & 255, value >> 8] : [value >> 8, value & 255];
  const four = (value: number) => little ? [...two(value), 0, 0] : [0, 0, ...two(value)];
  return segment(0xe1, [...ascii("Exif"), 0, 0, ...ascii(little ? "II" : "MM"), ...two(42), ...four(8), ...two(1), ...two(0x0112), ...two(3), ...four(1), ...two(orientation), 0, 0, ...four(0)]);
}
const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

describe("cleanJpeg", () => {
  it("keeps the frame and scan and drops every APPn, comment and byte after the end marker", () => {
    const dirty = jpeg({
      before: [...segment(0xe0, ascii("JFIF\0")), ...exif(1, true), ...segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/\0"), ...ascii("<GPSLatitude>14.5</GPSLatitude>")]), ...segment(0xe2, ascii("ICC_PROFILE\0")), ...segment(0xfe, ascii("camera comment"))],
      after: [...ascii("<?php secret ?>")]
    });
    const { bytes, width, height } = cleanJpeg(dirty, "display");
    expect({ width, height }).toEqual({ width: 8, height: 6 });
    expect([...bytes.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    expect([...bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
    for (const gone of ["JFIF", "Exif", "GPSLatitude", "ICC_PROFILE", "camera comment", "php"]) expect(contains(bytes, gone), gone).toBe(false);
    // The scan data, with its stuffed byte and restart marker, is untouched.
    expect(Buffer.from(bytes).includes(Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56]))).toBe(true);
    expect(cleanJpeg(bytes, "display").bytes).toEqual(bytes);
  });

  it("accepts progressive and grey photos and an upright EXIF orientation", () => {
    expect(cleanJpeg(jpeg({ marker: 0xc2 }), "display").width).toBe(8);
    expect(cleanJpeg(jpeg({ components: 1 }), "thumb").width).toBe(8);
    expect(cleanJpeg(jpeg({ before: exif(1, false) }), "display").width).toBe(8);
  });

  it("refuses a photo that still needs rotating, whichever byte order says so", () => {
    for (const orientation of [2, 3, 6, 8]) {
      for (const little of [true, false]) expect(() => cleanJpeg(jpeg({ before: exif(orientation, little) }), "display"), `${orientation} ${little}`).toThrow(/needs rotating/);
    }
  });

  it("refuses anything that is not an ordinary browser JPEG", () => {
    const png = Uint8Array.from([0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a, 0, 0, 0, 0]);
    const whole = jpeg();
    const cases: Array<[string, Uint8Array]> = [
      ["a PNG", png],
      ["empty", new Uint8Array()],
      ["truncated before the end marker", whole.subarray(0, whole.length - 2)],
      ["truncated mid-segment", whole.subarray(0, 30)],
      ["arithmetic coding", jpeg({ marker: 0xc9 })],
      ["lossless coding", jpeg({ marker: 0xc3 })],
      ["four components (CMYK)", jpeg({ components: 4 })],
      ["12-bit samples", jpeg({ precision: 12 })],
      ["no frame", Uint8Array.from([0xff, 0xd8, ...segment(0xda, [1, 1, 0, 0, 63, 0]), 0x12, 0xff, 0xd9])],
      ["no scan", Uint8Array.from([0xff, 0xd8, ...segment(0xc0, [8, 0, 6, 0, 8, 1, 1, 0x11, 0]), 0xff, 0xd9])],
      ["junk between segments", Uint8Array.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])],
      ["a second frame", jpeg({ before: segment(0xc0, [8, 0, 6, 0, 8, 1, 1, 0x11, 0]) })],
      ["a stray marker", jpeg({ before: segment(0xf0, [1, 2]) })]
    ];
    for (const [name, bytes] of cases) expect(() => cleanJpeg(bytes, "display"), name).toThrow();
  });

  it("refuses a frame larger than its variant allows or with no size", () => {
    expect(() => cleanJpeg(jpeg({ width: 1601 }), "display")).toThrow(/1600 pixels/);
    expect(cleanJpeg(jpeg({ width: 1600 }), "display").width).toBe(1600);
    expect(() => cleanJpeg(jpeg({ height: 481 }), "thumb")).toThrow(/480 pixels/);
    expect(() => cleanJpeg(jpeg({ width: 0 }), "display")).toThrow();
  });
});

beforeEach(async () => {
  const database = migratedD1();
  sqlite = database.sqlite;
  media = memoryR2();
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: media.bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

const ITEM = "ITM-0001";
const photoForm = (expected: string | null, display: Uint8Array = jpeg({ width: 40, height: 30 }), thumb: Uint8Array = jpeg({ width: 16, height: 12 })) => {
  const form = new FormData();
  form.set("display", new File([display as BlobPart], "display.jpg", { type: "image/jpeg" }));
  form.set("thumb", new File([thumb as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
  form.set("expected", expected ?? "");
  return form;
};
const put = (expected: string | null = null, item = ITEM, form = photoForm(expected)) => call(`/api/staff/items/${item}/photo`, { method: "PUT", headers: { origin, cookie }, body: form });
const remove = (expected: string, item = ITEM) => call(`/api/staff/items/${item}/photo?expected=${expected}`, { method: "DELETE", headers: { origin, cookie } });
const add = async () => (await (await put()).json() as { photo: { id: string } }).photo.id;
const keys = () => [...media.objects.keys()].sort();
const rows = () => sqlite.prepare("SELECT item_id AS itemId, media_id AS mediaId, width, height, created_by AS by FROM item_media").all() as Array<{ itemId: string; mediaId: string; width: number; height: number; by: string }>;
const actions = () => (sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'ITEM_PHOTO_%' ORDER BY rowid").all() as Array<{ action: string }>).map((entry) => entry.action);
const revision = () => (sqlite.prepare("SELECT value FROM catalog_revision").get() as { value: number }).value;
const listed = async () => ((await (await staff("/api/staff/inventory")).json()) as { items: Array<{ id: string; photoId: string | null }> }).items.find((item) => item.id === ITEM)!;
const detail = async () => ((await (await staff(`/api/staff/items/${ITEM}`)).json()) as { item: { photo: { id: string; width: number; height: number } | null } }).item;

describe("adding a photo", () => {
  it("stores both variants, one reference and one audit entry, and shows the photo in the list and the profile", async () => {
    const before = revision();
    expect(await listed()).toMatchObject({ photoId: null });
    expect((await detail()).photo).toBeNull();
    const response = await put();
    expect(response.status).toBe(200);
    const { photo } = await response.json() as { photo: { id: string; width: number; height: number } };
    expect(photo).toMatchObject({ width: 40, height: 30 });
    expect(rows()).toEqual([{ itemId: ITEM, mediaId: photo.id, width: 40, height: 30, by: "ACC-1" }]);
    expect(keys()).toEqual([`items/${photo.id}/display`, `items/${photo.id}/thumb`]);
    expect(media.objects.get(`items/${photo.id}/thumb`)!.contentType).toBe("image/jpeg");
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED"]);
    expect(revision()).toBe(before + 1);
    expect((await listed()).photoId).toBe(photo.id);
    expect((await detail()).photo).toEqual({ id: photo.id, width: 40, height: 30 });
  });

  it("stores the cleaned bytes, never what the client sent", async () => {
    const dirty = jpeg({ width: 40, height: 30, before: [...segment(0xe1, ascii("Exif\0\0GPSLatitude")), ...segment(0xfe, ascii("note"))], after: ascii("trailing") });
    const response = await put(null, ITEM, photoForm(null, dirty));
    const { photo } = await response.json() as { photo: { id: string } };
    const stored = media.objects.get(`items/${photo.id}/display`)!.bytes;
    expect(stored.length).toBeLessThan(dirty.length);
    for (const gone of ["GPSLatitude", "note", "trailing"]) expect(contains(stored, gone)).toBe(false);
  });

  it("refuses what is not a usable photo, and stores nothing", async () => {
    const png = Uint8Array.from([0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a, 0, 0, 0, 0]);
    expect((await put(null, ITEM, photoForm(null, png))).status).toBe(400);
    expect((await put(null, ITEM, photoForm(null, jpeg({ width: 2000 })))).status).toBe(400);
    expect((await put(null, ITEM, photoForm(null, jpeg(), jpeg({ width: 600 })))).status).toBe(400);
    expect((await put(null, ITEM, photoForm(null, jpeg({ before: exif(6, true) })))).status).toBe(400);
    const missing = photoForm(null);
    missing.delete("thumb");
    expect((await put(null, ITEM, missing)).status).toBe(400);
    expect((await put("not-a-media-id")).status).toBe(400);
    expect((await put(null, "ITM-9999")).status).toBe(404);
    expect(keys()).toEqual([]);
    expect(rows()).toEqual([]);
    expect(actions()).toEqual([]);
  });

  it("is a same-origin, signed-in action", async () => {
    expect((await call(`/api/staff/items/${ITEM}/photo`, { method: "PUT", headers: { cookie }, body: photoForm(null) })).status).toBe(403);
    expect((await call(`/api/staff/items/${ITEM}/photo`, { method: "PUT", headers: { origin }, body: photoForm(null) })).status).toBe(401);
    expect((await call(`/api/staff/items/${ITEM}/photo?expected=${crypto.randomUUID()}`, { method: "DELETE", headers: { origin } })).status).toBe(401);
    expect(keys()).toEqual([]);
  });

  it("lets only one of two people adding at the same moment win, and keeps no stray file", async () => {
    const [first, second] = await Promise.all([put(), put()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(rows()).toHaveLength(1);
    expect(keys()).toEqual([`items/${rows()[0]!.mediaId}/display`, `items/${rows()[0]!.mediaId}/thumb`]);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED"]);
  });

  it("refuses an add when the item already has a photo, leaving that photo alone", async () => {
    const first = await add();
    const again = await put(null);
    expect(again.status).toBe(409);
    expect(rows()[0]!.mediaId).toBe(first);
    expect(keys()).toEqual([`items/${first}/display`, `items/${first}/thumb`]);
  });
});

describe("replacing a photo", () => {
  it("switches the reference, then removes the old files, and audits it", async () => {
    const first = await add();
    const before = revision();
    const response = await put(first, ITEM, photoForm(first, jpeg({ width: 50, height: 20 })));
    expect(response.status).toBe(200);
    const { photo } = await response.json() as { photo: { id: string; width: number } };
    expect(photo.id).not.toBe(first);
    expect(rows()).toMatchObject([{ mediaId: photo.id, width: 50, height: 20 }]);
    expect(keys()).toEqual([`items/${photo.id}/display`, `items/${photo.id}/thumb`]);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED", "ITEM_PHOTO_REPLACED"]);
    expect(revision()).toBe(before + 1);
    // The old address is gone for good.
    expect((await staff(`/api/staff/media/${first}/thumb`)).status).toBe(404);
  });

  it("refuses a replacement made from an out-of-date view, and keeps the current photo and its files", async () => {
    const first = await add();
    const second = await (await put(first)).json() as { photo: { id: string } };
    const stale = await put(first);
    expect(stale.status).toBe(409);
    expect((await stale.json() as { error: string }).error).toMatch(/Someone else changed this photo/);
    expect(rows()[0]!.mediaId).toBe(second.photo.id);
    expect(keys()).toEqual([`items/${second.photo.id}/display`, `items/${second.photo.id}/thumb`]);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED", "ITEM_PHOTO_REPLACED"]);
  });

  it("keeps the old photo and leaves no new file when R2 or D1 fails part-way", async () => {
    const first = await add();
    const original = { put: env.CATALOG_MEDIA.put.bind(env.CATALOG_MEDIA), batch: env.DB.batch.bind(env.DB) };
    let puts = 0;
    env.CATALOG_MEDIA.put = (async (...args: Parameters<R2Bucket["put"]>) => { puts += 1; if (puts === 2) throw new Error("R2 unavailable"); return original.put(...args); }) as R2Bucket["put"];
    expect((await put(first)).status).toBe(500);
    env.CATALOG_MEDIA.put = original.put;
    expect(keys()).toEqual([`items/${first}/display`, `items/${first}/thumb`]);

    env.DB.batch = (async () => { throw new Error("D1 unavailable"); }) as D1Database["batch"];
    expect((await put(first)).status).toBe(500);
    env.DB.batch = original.batch;
    expect(keys()).toEqual([`items/${first}/display`, `items/${first}/thumb`]);
    expect(rows()[0]!.mediaId).toBe(first);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED"]);
  });

  it("still succeeds when the old files cannot be deleted: D1 points at the new photo, which exists", async () => {
    const first = await add();
    env.CATALOG_MEDIA.delete = (async () => { throw new Error("R2 unavailable"); }) as R2Bucket["delete"];
    const response = await put(first);
    expect(response.status).toBe(200);
    const { photo } = await response.json() as { photo: { id: string } };
    expect(rows()[0]!.mediaId).toBe(photo.id);
    expect(keys()).toContain(`items/${photo.id}/display`);
    expect(keys()).toContain(`items/${photo.id}/thumb`);
    // Only an unused file is left behind; nothing in D1 refers to it.
    expect(keys()).toContain(`items/${first}/thumb`);
    expect(rows().map((row) => row.mediaId)).toEqual([photo.id]);
  });
});

describe("removing a photo", () => {
  it("removes the reference and the files and audits it", async () => {
    const id = await add();
    const before = revision();
    expect((await remove(id)).status).toBe(200);
    expect(rows()).toEqual([]);
    expect(keys()).toEqual([]);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED", "ITEM_PHOTO_REMOVED"]);
    expect(revision()).toBe(before + 1);
    expect((await listed()).photoId).toBeNull();
    expect((await detail()).photo).toBeNull();
  });

  it("refuses to remove a photo that is already gone or was replaced since it was seen", async () => {
    const id = await add();
    const replaced = (await (await put(id)).json() as { photo: { id: string } }).photo.id;
    expect((await remove(id)).status).toBe(409);
    expect(rows()[0]!.mediaId).toBe(replaced);
    expect(keys()).toEqual([`items/${replaced}/display`, `items/${replaced}/thumb`]);
    expect((await remove(replaced)).status).toBe(200);
    expect((await remove(replaced)).status).toBe(409);
    expect((await call(`/api/staff/items/${ITEM}/photo`, { method: "DELETE", headers: { origin, cookie } })).status).toBe(400);
    expect(actions()).toEqual(["ITEM_PHOTO_ADDED", "ITEM_PHOTO_REPLACED", "ITEM_PHOTO_REMOVED"]);
  });

  it("keeps the file when the database refuses, and still succeeds when only the file delete fails", async () => {
    const id = await add();
    const batch = env.DB.batch.bind(env.DB);
    env.DB.batch = (async () => { throw new Error("D1 unavailable"); }) as D1Database["batch"];
    expect((await remove(id)).status).toBe(500);
    env.DB.batch = batch;
    expect(rows()).toHaveLength(1);
    expect(keys()).toHaveLength(2);
    env.CATALOG_MEDIA.delete = (async () => { throw new Error("R2 unavailable"); }) as R2Bucket["delete"];
    expect((await remove(id)).status).toBe(200);
    expect(rows()).toEqual([]);
  });
});

describe("serving a photo", () => {
  it("streams either variant to a signed-in staff member with a cache that never goes stale", async () => {
    const id = await add();
    for (const variant of ["display", "thumb"]) {
      const response = await staff(`/api/staff/media/${id}/${variant}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect([...new Uint8Array(await response.arrayBuffer()).subarray(0, 2)]).toEqual([0xff, 0xd8]);
    }
  });

  it("answers 401 signed out, and 404 for an unknown id, a bad id or another size", async () => {
    const id = await add();
    expect((await call(`/api/staff/media/${id}/thumb`)).status).toBe(401);
    expect((await staff(`/api/staff/media/${crypto.randomUUID()}/thumb`)).status).toBe(404);
    expect((await staff(`/api/staff/media/${id}/original`)).status).toBe(404);
    expect((await staff(`/api/staff/media/${id}/constructor`)).status).toBe(404);
    expect((await staff("/api/staff/media/..%2F..%2Fitems/thumb")).status).toBe(404);
  });
});

describe("privacy and history", () => {
  it("keeps photos out of the public and Self-Service catalogs", async () => {
    await add();
    sqlite.exec("UPDATE system_settings SET value = 'open' WHERE key = 'self_service'");
    sqlite.prepare("UPDATE items SET status = 'ACTIVE', needs_review = 0, item_type = 'Loanable', lending_audience = 'STUDENTS_AND_USC_STAFF' WHERE id = ?").run(ITEM);
    for (const path of ["/api/public/catalog", "/api/self-service/catalog"]) {
      const text = await (await call(path)).text();
      expect(text, path).toContain(ITEM);
      expect(text, path).not.toMatch(/photo|media|items\/[0-9a-f]{8}-/i);
    }
  });

  it("reads each change as a sentence in Activity", async () => {
    const id = await add();
    const replaced = (await (await put(id)).json() as { photo: { id: string } }).photo.id;
    await remove(replaced);
    const feed = await (await staff("/api/staff/activity?source=CATALOG")).json() as { events: Array<{ type: string; summary: string }> };
    const name = (sqlite.prepare("SELECT name FROM items WHERE id = ?").get(ITEM) as { name: string }).name;
    expect(feed.events.filter((event) => event.type.startsWith("ITEM_PHOTO_")).map((event) => [event.type, event.summary])).toEqual([
      ["ITEM_PHOTO_REMOVED", `Staff One removed the photo of ${name}.`],
      ["ITEM_PHOTO_REPLACED", `Staff One replaced the photo of ${name}.`],
      ["ITEM_PHOTO_ADDED", `Staff One added a photo to ${name}.`]
    ]);
  });
});
