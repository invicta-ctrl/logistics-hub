import { deflateSync } from "node:zlib";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { CUTOUT_MONTHLY_CAP, type ImagesRunner, cutoutsThisMonth, inspectCutout, resetCutoutBreaker } from "../src/item-cutout";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { jpeg } from "./jpeg";

/* FP-E: picture cleanup with Cloudflare Images. The binding is a stand-in here; the real provider run is recorded in the evidence file. */

const origin = "https://hub.example.test";
const ITEM = "ITM-0001";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let media: ReturnType<typeof memoryR2>;
let cookie: string;

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const staff = (path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes: Uint8Array) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(Buffer.from(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc(out.subarray(4, 8 + body.length)));
  return out;
};
/** An RGBA PNG whose alpha comes from `alpha(x, y)`; `filter` picks the PNG row filter so every decoder branch is exercised. */
function png(width: number, height: number, alpha: (x: number, y: number) => number, { filter = 0, colour = 6, depth = 8 }: { filter?: number; colour?: number; depth?: number } = {}): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels.set([(x * 7) & 255, (y * 13) & 255, (x + y) & 255, alpha(x, y)], (y * width + x) * 4);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i += 1) {
      const at = (row: number, index: number) => (row < 0 || index < 0 ? 0 : pixels[row * stride + index]!);
      const left = at(y, i - 4); const up = at(y - 1, i); const upLeft = at(y - 1, i - 4);
      const estimate = left + up - upLeft;
      const paeth = Math.abs(estimate - left) <= Math.abs(estimate - up) && Math.abs(estimate - left) <= Math.abs(estimate - upLeft) ? left : Math.abs(estimate - up) <= Math.abs(estimate - upLeft) ? up : upLeft;
      const predicted = [0, left, up, (left + up) >> 1, paeth][filter]!;
      raw[y * (stride + 1) + 1 + i] = (pixels[y * stride + i]! - predicted) & 255;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width); view.setUint32(4, height);
  header.set([depth, colour, 0, 0, 0], 8);
  return Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", header), ...chunk("IDAT", deflateSync(raw)), ...chunk("IEND", new Uint8Array())]);
}
/** The left 40% is kept, the rest is background. */
const subject = (x: number) => (x < 16 ? 255 : 0);
const GOOD = png(40, 30, subject);

describe("inspectCutout", () => {
  it("reads the transparent share through every PNG row filter", async () => {
    for (const filter of [0, 1, 2, 3, 4]) {
      const check = await inspectCutout(png(40, 30, subject, { filter }));
      expect({ filter, removed: check.removed, kept: check.kept }).toEqual({ filter, removed: 0.6, kept: 0.4 });
    }
  });

  it("refuses a picture that is not a cutout", async () => {
    const cases: Array<[string, Uint8Array, RegExp]> = [
      ["no background removed", png(40, 30, () => 255), /no background/],
      ["the item lost", png(40, 30, () => 0), /too little/],
      ["no transparency channel", png(40, 30, subject, { colour: 2 }), /8-bit PNG with transparency/],
      ["16-bit", png(40, 30, subject, { depth: 16 }), /8-bit PNG with transparency/],
      ["not a PNG", Uint8Array.from(jpeg()), /not a PNG/],
      ["cut short", GOOD.subarray(0, GOOD.length - 20), /cut short|not a valid/],
      ["larger than the photo it came from", png(1601, 2, subject), /larger/]
    ];
    for (const [name, bytes, why] of cases) await expect(inspectCutout(bytes), name).rejects.toThrow(why);
  });

  it("refuses data that inflates to more or less than its header says", async () => {
    // IHDR height sits at byte 20: claim 30 rows but carry 31, then 32 rows but carry 31.
    for (const claimed of [30, 32]) {
      const forged = Uint8Array.from(png(40, 31, subject));
      new DataView(forged.buffer).setUint32(20, claimed);
      await expect(inspectCutout(forged), `${claimed}`).rejects.toThrow(/picture data/);
    }
    await expect(inspectCutout(png(40, 30, subject).subarray(0, 33))).rejects.toThrow();
  });
});

/** A binding that answers with `answer()`, and remembers what it was asked. */
function images(answer: () => Response | Promise<Response>) {
  const asked: unknown[] = [];
  const runner: ImagesRunner = {
    input: () => ({ transform: (options) => { asked.push(options); return { output: async (format) => { asked.push(format); const response = await answer(); return { response: () => response }; } }; } })
  };
  return { asked, runner };
}
const ok = (bytes: Uint8Array = GOOD) => () => new Response(bytes as BodyInit, { headers: { "content-type": "image/png" } });

beforeEach(async () => {
  resetCutoutBreaker();
  const database = migratedD1();
  sqlite = database.sqlite;
  media = memoryR2();
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: media.bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret" };
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash) VALUES('ACC-1', 'staff.one', 'Staff One', ?)").run(await hashPassword("correct horse battery"));
  const login = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "staff.one", password: "correct horse battery" }) });
  cookie = login.headers.get("set-cookie")!.split(";")[0]!;
});

const addPhoto = async () => {
  const form = new FormData();
  form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
  form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
  form.set("expected", "");
  return (await (await call(`/api/staff/items/${ITEM}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).json() as { photo: { id: string } }).photo.id;
};
const cut = (expected: string) => staff(`/api/staff/items/${ITEM}/cutout`, "POST", { expected });
const uncut = (expected: string) => staff(`/api/staff/items/${ITEM}/cutout?expected=${expected}`, "DELETE");
const detail = async () => ((await (await staff(`/api/staff/items/${ITEM}`)).json()) as { item: { photo: { id: string; cutout: boolean; cleanable: boolean } | null } }).item.photo;
const actions = () => (sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'ITEM_CUTOUT_%' ORDER BY rowid").all() as Array<{ action: string }>).map((entry) => entry.action);

describe("picture cleanup", () => {
  it("is not offered, and changes nothing, without the Images binding", async () => {
    const id = await addPhoto();
    expect(await detail()).toMatchObject({ id, cutout: false, cleanable: false });
    const response = await cut(id);
    expect(response.status).toBe(503);
    expect(await cutoutsThisMonth(env.DB)).toBe(0);
    expect(media.objects.has(`items/${id}/cutout`)).toBe(false);
  });

  it("cuts the foreground, keeps the original, serves a PNG and audits it", async () => {
    const { asked, runner } = images(ok());
    env.IMAGES = runner;
    const id = await addPhoto();
    const before = [...media.objects.keys()].sort();
    expect(await detail()).toMatchObject({ cutout: false, cleanable: true });
    const response = await cut(id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cutout: true, removed: 0.6, kept: 0.4 });
    expect(asked).toContainEqual({ segment: "foreground" });
    expect(asked).toContainEqual({ format: "image/png" });
    expect([...media.objects.keys()].sort()).toEqual([...before, `items/${id}/cutout`].sort());
    expect(media.objects.get(`items/${id}/display`)!.bytes).toEqual(Uint8Array.from(jpeg({ width: 40, height: 30 })));
    expect(await detail()).toMatchObject({ cutout: true });
    const served = await staff(`/api/staff/media/${id}/cutout`);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(GOOD);
    expect(actions()).toEqual(["ITEM_CUTOUT_ADDED"]);
    expect(await cutoutsThisMonth(env.DB)).toBe(1);
  });

  it("needs a signed-in staff member and the photo the client was looking at", async () => {
    env.IMAGES = images(ok()).runner;
    const id = await addPhoto();
    expect((await call(`/api/staff/media/${id}/cutout`, { headers: { origin } })).status).toBe(401);
    expect((await call(`/api/staff/items/${ITEM}/cutout`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ expected: id }) })).status).toBe(401);
    expect((await cut("00000000-0000-4000-8000-000000000000")).status).toBe(409);
    expect((await staff(`/api/staff/items/${ITEM}/cutout`, "POST", {})).status).toBe(400);
    expect(await cutoutsThisMonth(env.DB)).toBe(0);
  });

  it("goes back to the original by deleting only the cutout", async () => {
    env.IMAGES = images(ok()).runner;
    const id = await addPhoto();
    await cut(id);
    expect((await uncut(id)).status).toBe(200);
    expect(await detail()).toMatchObject({ cutout: false });
    expect(media.objects.has(`items/${id}/display`)).toBe(true);
    expect((await uncut(id)).status).toBe(200);
    expect(actions()).toEqual(["ITEM_CUTOUT_ADDED", "ITEM_CUTOUT_REMOVED"]);
  });

  it("removes the cutout with its photo, and a replacement photo starts without one", async () => {
    env.IMAGES = images(ok()).runner;
    const id = await addPhoto();
    await cut(id);
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([jpeg({ width: 16, height: 12 }) as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", id);
    const replaced = await (await call(`/api/staff/items/${ITEM}/photo`, { method: "PUT", headers: { origin, cookie }, body: form })).json() as { photo: { id: string } };
    expect([...media.objects.keys()].filter((name) => name.endsWith("/cutout"))).toEqual([]);
    expect(await detail()).toMatchObject({ id: replaced.photo.id, cutout: false });
    await cut(replaced.photo.id);
    await staff(`/api/staff/items/${ITEM}/photo?expected=${replaced.photo.id}`, "DELETE");
    expect([...media.objects.keys()]).toEqual([]);
  });

  it("stops at the monthly cap and never calls the provider past it", async () => {
    const { asked, runner } = images(ok());
    env.IMAGES = runner;
    const id = await addPhoto();
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES(?, ?, '2026-10-01')").run(`image_cutouts:${new Date().toISOString().slice(0, 7)}`, String(CUTOUT_MONTHLY_CAP));
    const response = await cut(id);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toMatch(/allowance is used/);
    expect(asked).toEqual([]);
    expect(await cutoutsThisMonth(env.DB)).toBe(CUTOUT_MONTHLY_CAP);
  });

  it("keeps the original when the provider fails or returns something that is not a cutout, and rests after repeated failures", async () => {
    const answers: Array<() => Response> = [() => new Response("no", { status: 500 }), () => new Response(png(40, 30, () => 255) as BodyInit), () => { throw new Error("down"); }, ok()];
    const { runner } = images(() => answers.shift()!());
    env.IMAGES = runner;
    const id = await addPhoto();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await cut(id);
      expect(response.status, `attempt ${attempt}`).toBe(503);
      expect(((await response.json()) as { error: string }).error).toMatch(/original photo is still in use/);
    }
    expect(media.objects.has(`items/${id}/cutout`)).toBe(false);
    // The breaker is open: the provider is not asked, and no allowance is spent.
    const spent = await cutoutsThisMonth(env.DB);
    const resting = await cut(id);
    expect(((await resting.json()) as { error: string }).error).toMatch(/resting/);
    expect(await cutoutsThisMonth(env.DB)).toBe(spent);
    expect(answers).toHaveLength(1);
    expect(actions()).toEqual([]);
  });
});
