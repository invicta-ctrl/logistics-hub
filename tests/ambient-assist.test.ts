import { afterEach, beforeEach, describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";
import { BANDS, PHOTO_MODEL, PHOTO_RESERVE, type AiRunner, bandOf, mayCall, neuronsToday, photoName, readPhotoName, resetBreaker } from "../src/ambient-assist";
import { attention } from "../src/attention";
import { hashPassword } from "../src/session";
import { memoryR2, migratedD1 } from "./d1-sqlite";
import { jpeg } from "./jpeg";

/* Ambient assist (accepted amendment 2026-10-08): photo names while cataloguing, one check after sync, and the limits around both. */

const origin = "https://hub.example.test";
let env: Env;
let sqlite: ReturnType<typeof migratedD1>["sqlite"];
let staff: string;
let owner: string;
let admin: string;
/** What the fake model was sent, and what it answers next. */
let sent: Array<{ model: string; input: unknown }>;
let answer: () => unknown;

const chat = (content: string, neurons = 3.6) => ({ object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content } }], usage: { neurons } });
const fakeAi = (): AiRunner => ({ run: async (model, input) => { sent.push({ model, input }); return answer(); } });

const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${origin}${path}`, init), env);
const as = (cookie: string, path: string, method = "GET", body?: unknown) =>
  call(path, { method, headers: { origin, cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function seed(id: string, username: string, role: string): Promise<string> {
  sqlite.prepare("INSERT INTO staff_accounts(id, username, display_name, password_hash, role) VALUES(?, ?, ?, ?, ?)").run(id, username, username, await hashPassword("correct horse battery"), role);
  const response = await call("/api/staff/login", { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `ip-${username}` }, body: JSON.stringify({ username, password: "correct horse battery" }) });
  return response.headers.get("set-cookie")!.split(";")[0]!;
}

beforeEach(async () => {
  resetBreaker();
  sent = [];
  answer = () => chat('{"name":"hammer"}');
  const database = migratedD1();
  sqlite = database.sqlite;
  env = { DB: database.d1, EVIDENCE: memoryR2().bucket, CATALOG_MEDIA: memoryR2().bucket, STAFF_IDS: memoryR2().bucket, ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher, SESSION_SECRET: "test-secret", AI: fakeAi() };
  staff = await seed("ACC-1", "staff.one", "STAFF");
  owner = await seed("ACC-O", "owner.one", "OWNER");
  admin = await seed("ACC-A", "admin.one", "ADMIN");
});
afterEach(() => resetBreaker());

const PHOTO = jpeg({ width: 32, height: 24 });
const nameOf = (bytes: Uint8Array = PHOTO, cookie = staff) => call("/api/staff/catalogue/photo-name", { method: "POST", headers: { origin, cookie, "content-type": "image/jpeg", "content-length": String(bytes.length) }, body: bytes as BlobPart });

describe("the owner's daily Neuron bands", () => {
  it("names the band at each line and stops each kind of call where the owner said", () => {
    expect([0, 6_499, 6_500, 7_999, 8_000, 8_999, 9_000, 9_499, 9_500, 10_000].map(bandOf))
      .toEqual(["NORMAL", "NORMAL", "CONSERVE", "CONSERVE", "RESERVE", "RESERVE", "CRITICAL", "CRITICAL", "STOPPED", "STOPPED"]);
    // A person waiting may use the reserve up to the stop line, with the next call's cost held back; work nobody waits for stops at the critical line.
    expect(mayCall(BANDS.stop - PHOTO_RESERVE, "USER")).toBe(true);
    expect(mayCall(BANDS.stop - PHOTO_RESERVE + 0.1, "USER")).toBe(false);
    expect(mayCall(BANDS.critical - PHOTO_RESERVE, "BACKGROUND")).toBe(true);
    expect(mayCall(BANDS.critical - PHOTO_RESERVE + 0.1, "BACKGROUND")).toBe(false);
  });

  it("counts what Workers AI reports, per UTC day, and forgets counts older than a week", async () => {
    const now = Date.parse("2026-10-07T23:00:00Z");
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES('ai_neurons:2026-09-20', '50', 'x')").run();
    await photoName(env.DB, env.AI, PHOTO, "USER", "PHOTO_NAME", now);
    await photoName(env.DB, env.AI, PHOTO, "USER", "PHOTO_NAME", now);
    expect(await neuronsToday(env.DB, now)).toBeCloseTo(7.2, 5);
    expect(await neuronsToday(env.DB, Date.parse("2026-10-08T00:00:01Z"))).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM system_settings WHERE key = 'ai_neurons:2026-09-20'").get()).toEqual({ n: 0 });
  });

  it("makes no call at the stop line, and none after the owner turns suggestions off", async () => {
    const now = Date.now();
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES(?, '9500', 'x')").run(`ai_neurons:${new Date(now).toISOString().slice(0, 10)}`);
    expect(await photoName(env.DB, env.AI, PHOTO, "USER", "PHOTO_NAME", now)).toEqual({ name: null, outcome: "BUDGET" });
    sqlite.prepare("DELETE FROM system_settings WHERE key LIKE 'ai_neurons:%'").run();
    expect((await as(owner, "/api/staff/admin/assist", "PATCH", { on: false })).status).toBe(200);
    expect(await photoName(env.DB, env.AI, PHOTO, "USER")).toEqual({ name: null, outcome: "OFF" });
    expect(sent).toHaveLength(0);
  });
});

describe("what a model is sent and what is kept", () => {
  it("sends only the fixed instruction and the photo to the chosen vision model", async () => {
    expect(await photoName(env.DB, env.AI, PHOTO, "USER")).toEqual({ name: "Hammer", outcome: "NAMED" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.model).toBe(PHOTO_MODEL);
    const input = sent[0]!.input as { messages: Array<{ role: string; content: unknown }> };
    expect(Object.keys(input).sort()).toEqual(["chat_template_kwargs", "max_tokens", "messages", "response_format", "temperature"]);
    expect(input.messages).toHaveLength(2);
    const parts = input.messages[1]!.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
    expect(parts.map((part) => part.type)).toEqual(["text", "image_url"]);
    expect(parts[0]!.text).toBe("What is this item?");
    expect(parts[1]!.image_url!.url).toBe(`data:image/jpeg;base64,${Buffer.from(PHOTO).toString("base64")}`);
  });

  it("keeps a short name in title case and drops anything else, including any answer about people", () => {
    expect(readPhotoName(chat('{"name":"hdmi to vga adapter"}'))).toBe("Hdmi To Vga Adapter");
    expect(readPhotoName({ response: { name: " light  bulb! " } })).toBe("Light Bulb");
    for (const name of ["a man holding a box", "student", "Woman's face", "x", "1234", "a very long name with far too many words in it", null, 42]) expect(readPhotoName(chat(JSON.stringify({ name })))).toBeNull();
    for (const reply of [null, "nope", chat("not json"), { choices: [] }, chat("[\"hammer\"]")]) expect(readPhotoName(reply)).toBeNull();
  });

  it("never sends what is not a JPEG, and a failing model opens the breaker after three tries", async () => {
    expect((await photoName(env.DB, env.AI, new TextEncoder().encode("GIF89a"), "USER")).outcome).toBe("NO_NAME");
    expect(sent).toHaveLength(0);
    answer = () => { throw new Error("provider down"); };
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await photoName(env.DB, env.AI, PHOTO, "USER")).outcome).toBe("FAILED");
    expect((await photoName(env.DB, env.AI, PHOTO, "USER")).outcome).toBe("BREAKER");
    expect(sent).toHaveLength(3);
    // A failed call may still have run: it is counted at its reserve.
    expect(await neuronsToday(env.DB)).toBe(3 * PHOTO_RESERVE);
  });
});

describe("POST /api/staff/catalogue/photo-name", () => {
  it("answers a name for a signed-in member, and null when there is no AI, without ever failing the page", async () => {
    expect((await call("/api/staff/catalogue/photo-name", { method: "POST", headers: { origin, "content-type": "image/jpeg" }, body: PHOTO as BlobPart })).status).toBe(401);
    const named = await nameOf();
    expect(named.status).toBe(200);
    expect(named.headers.get("cache-control")).toBe("private, no-store");
    expect(await named.json()).toEqual({ name: "Hammer" });
    env.AI = undefined;
    expect(await (await nameOf()).json()).toEqual({ name: null });
    env.AI = fakeAi();
    answer = () => { throw new Error("down"); };
    expect(await (await nameOf()).json()).toEqual({ name: null });
  });

  it("refuses a photo larger than a catalogue thumbnail before reading it", async () => {
    expect((await nameOf(new Uint8Array(400_001))).status).toBe(413);
    expect(sent).toHaveLength(0);
  });
});

describe("one check after an offline capture syncs", () => {
  let place: string;
  let session: string;
  let count = 0;
  const id = () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
  beforeEach(async () => {
    place = ((await (await as(staff, "/api/staff/locations", "POST", { name: "Shelf A", parentId: null })).json()) as { id: string }).id;
    session = `CS-00000000-0000-4000-9000-${String(++count).padStart(12, "0")}`;
    expect((await as(staff, "/api/staff/catalogue/sessions", "POST", { id: session, locationId: place })).status).toBe(201);
  });
  const capture = async (name: string, acknowledged: string[] = []) => {
    const response = await as(staff, `/api/staff/catalogue/sessions/${session}/captures`, "POST", { id: id(), behaviour: "CONSUME", name, category: "SUPPLIES", unit: "piece", quantity: 1, locationId: place, acknowledged });
    expect(response.status).toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const upload = (itemId: string, recheck: boolean) => {
    const form = new FormData();
    form.set("display", new File([jpeg({ width: 40, height: 30 }) as BlobPart], "display.jpg", { type: "image/jpeg" }));
    form.set("thumb", new File([PHOTO as BlobPart], "thumb.jpg", { type: "image/jpeg" }));
    form.set("expected", "");
    form.set("hash", "ffff0000ffff0000");
    if (recheck) form.set("recheck", "1");
    return call(`/api/staff/items/${itemId}/photo`, { method: "PUT", headers: { origin, cookie: staff }, body: form });
  };
  const hammer = () => (sqlite.prepare("SELECT id FROM items WHERE name = 'Hammer'").get() as { id: string }).id;
  const possible = async () => (await attention(env.DB)).entries.filter((entry) => entry.reason === "POSSIBLE_DUPLICATE");

  it("raises an existing item the photo looks like, once, in Attention, and Keep both settles it with an audit entry", async () => {
    const mine = await capture("Black tool");
    expect((await upload(mine, true)).status).toBe(200);
    expect(sent).toHaveLength(1);
    const [entry] = await possible();
    expect(entry).toMatchObject({ title: "Black tool", source: "Catalog", urgency: "LATER", href: `/staff/items?item=${mine}`, keepBoth: { itemId: mine } });
    expect(entry!.why).toContain("Its photo looks like Hammer");
    // The repeat of a lost upload answer is refused and checks nothing again.
    expect((await upload(mine, true)).status).toBe(409);
    expect(sent).toHaveLength(1);
    expect((await as(staff, `/api/staff/attention/possible-duplicate/${mine}`, "POST")).status).toBe(200);
    expect(await possible()).toEqual([]);
    expect(sqlite.prepare("SELECT actor_user_id AS actor, details_json AS details FROM audit_log WHERE action = 'POSSIBLE_DUPLICATE_KEPT'").get()).toEqual({ actor: "ACC-1", details: JSON.stringify({ other: hammer() }) });
    expect((await as(staff, `/api/staff/attention/possible-duplicate/${mine}`, "POST")).status).toBe(409);
  });

  it("settles by itself when either item is made inactive, the ordinary way to retire a duplicate", async () => {
    const mine = await capture("Black tool");
    await upload(mine, true);
    expect(await possible()).toHaveLength(1);
    sqlite.prepare("UPDATE items SET status = 'INACTIVE' WHERE id = ?").run(mine);
    expect(await possible()).toEqual([]);
  });

  it("stays silent when the photo names nothing in the catalog, when the person already saw that match, or when not asked", async () => {
    answer = () => chat('{"name":"spaceship"}');
    await upload(await capture("Mystery thing"), true);
    expect(sent).toHaveLength(1);
    answer = () => chat('{"name":"hammer"}');
    // Saved as a separate item after the Hub showed the same-name match at capture: not raised a second time.
    await upload(await capture("Hammer", [hammer()]), true);
    expect(sent).toHaveLength(2);
    // Checked online when it was taken: no recheck is asked for, so no call.
    await upload(await capture("Another tool"), false);
    expect(sent).toHaveLength(2);
    expect(await possible()).toEqual([]);
  });

  it("skips the check without a call past the critical line, and saves the photo either way", async () => {
    sqlite.prepare("INSERT INTO system_settings(key, value, updated_at) VALUES(?, '9000', 'x')").run(`ai_neurons:${new Date().toISOString().slice(0, 10)}`);
    const mine = await capture("Black tool");
    expect((await upload(mine, true)).status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM item_media WHERE item_id = ?").get(mine)).toEqual({ n: 1 });
  });
});

describe("Administration", () => {
  it("shows the switch and today's use on System, and only the owner may change it, audited", async () => {
    const status = await (await as(admin, "/api/staff/admin/system")).json() as { assist: unknown };
    expect(status.assist).toEqual({ on: true, available: true, neuronsToday: 0, band: "NORMAL", stopAt: 9_500 });
    expect((await as(admin, "/api/staff/admin/assist", "PATCH", { on: false })).status).toBe(403);
    expect((await as(staff, "/api/staff/admin/assist", "PATCH", { on: false })).status).toBe(403);
    expect((await as(owner, "/api/staff/admin/assist", "PATCH", { on: "no" })).status).toBe(400);
    expect(await (await as(owner, "/api/staff/admin/assist", "PATCH", { on: false })).json()).toEqual({ on: false });
    expect(await (await as(owner, "/api/staff/admin/assist", "PATCH", { on: false })).json()).toEqual({ on: false });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'SETTING_CHANGED' AND entity_id = 'ambient_assist'").get()).toEqual({ n: 1 });
  });
});
