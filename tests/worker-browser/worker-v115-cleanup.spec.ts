import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { type Page, type Request, expect, test } from "@playwright/test";

// A completed cleanup starts a profile refresh; let its route handler finish before disposing the request context.
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: "wait" }); });

/*
 * FP-E, the screen: "Remove background" appears only when the Worker can clean pictures, shows the cleaned picture, and "Use original" goes
 * back. The local Worker has no Images binding, so the three provider-facing answers are stubbed here; the cut itself is covered in
 * tests/item-cutout.test.ts and the real provider run in the evidence file.
 */

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
/** A 4 × 4 PNG: red on the left (the whole picture when `opaque`), transparent on the right. */
const tiny = (opaque: boolean) => {
  const raw = Buffer.alloc(4 * (1 + 16));
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) raw.set(opaque || x < 2 ? [200, 30, 30, 255] : [0, 0, 0, 0], y * 17 + 1 + x * 4);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 4); view.setUint32(4, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk("IHDR", header), ...chunk("IDAT", deflateSync(raw)), ...chunk("IEND", new Uint8Array())]);
};
/** What Cloudflare Images returned for tests/fixtures/cutout-source-320x240.jpg on 2026-10-08 (segment=foreground): a real cutout. */
const providerCutout = readFileSync(new URL("../fixtures/cutout-provider-320x240.png", import.meta.url));

const CUTOUT_ETAG = '"fixture-cutout"';
const thumbnailSrc = (id: string, revision = 0) => `/api/staff/media/${id}/thumb?v=2${revision ? `&r=${revision}` : ""}`;
type CleanupBody = { expected: string; accept?: true };
type Setup = { id: string; photoId: string; state: { cleaned: boolean; thumb: Buffer | null; posted: CleanupBody[]; deletes: number } };

async function cleanupRequest(request: Request): Promise<{ body: CleanupBody; thumb?: Buffer }> {
  const contentType = request.headers()["content-type"] ?? "";
  if (!contentType.startsWith("multipart/form-data")) return { body: request.postDataJSON() };
  const form = await new Response(new Uint8Array(request.postDataBuffer()!), { headers: { "content-type": contentType } }).formData();
  expect(form.get("expected")).toEqual(expect.any(String));
  expect(form.get("accept")).toBe("1");
  expect(form.get("source")).toBe(CUTOUT_ETAG);
  expect(form.get("pending")).toBe("1");
  const thumb = form.get("thumb");
  expect(thumb).toBeInstanceOf(Blob);
  expect((thumb as Blob).type).toBe("image/jpeg");
  const bytes = Buffer.from(await (thumb as Blob).arrayBuffer());
  expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  return { body: { expected: form.get("expected") as string, accept: true }, thumb: bytes };
}

/** Signs in, makes an item with a photo, and stands in for the Images binding: the Worker answers cleanup as if it were on, and `cutoutBody` is the picture served. */
async function itemWithPhoto(page: Page, baseURL: string, cutoutBody: Buffer): Promise<Setup> {
  await page.goto("/staff");
  await page.getByRole("textbox", { name: "Username" }).fill(process.env.E2E_USERNAME!);
  await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  const created = await page.request.post("/api/staff/items", { headers: { origin: baseURL }, data: {
    name: "Cleanup test stapler", aliases: "", category: "Miscellaneous", itemType: "Loanable", unit: "piece", status: "ACTIVE", locationId: null,
    reorderThreshold: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", needsReview: false, notes: "", openingQuantity: 1
  } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const state = { cleaned: false, thumb: null as Buffer | null, posted: [] as CleanupBody[], deletes: 0 };
  await page.route(new RegExp(`/api/staff/items/${id}(/photo)?$`), async (route) => {
    if (route.request().method() === "DELETE") return route.fallback();
    const real = await route.fetch();
    const body = await real.json();
    const { photo } = body.item ?? body;
    const photoCleanup = { cleanable: true, canEnable: false, cleanupReason: "" };
    const marked = photo ? { ...photo, ...photoCleanup, cutout: state.cleaned, cutoutThumb: state.cleaned } : null;
    await route.fulfill({ response: real, json: body.item ? { ...body, item: { ...body.item, photoCleanup, photo: marked } } : { photo: marked } });
  });
  await page.route(`**/api/staff/items/${id}/cutout**`, async (route) => {
    if (route.request().method() === "POST") {
      const { body: sent, thumb } = await cleanupRequest(route.request());
      state.posted.push(sent);
      // A new cut waits as pending; only the browser's accept makes it the item's picture.
      if (sent.accept) { state.cleaned = true; state.thumb = thumb!; }
      await route.fulfill({ json: sent.accept ? { cutout: true } : { pending: true } });
    }
    else {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get("expected")).toBe(state.posted.at(-1)?.expected);
      if (query.has("pending")) expect(query.get("pending")).toBe(CUTOUT_ETAG);
      else { state.cleaned = false; state.thumb = null; }
      state.deletes += 1;
      await route.fulfill({ json: { cutout: state.cleaned } });
    }
  });
  await page.route(/\/api\/staff\/media\/[^/]+\/(cutout|pending)$/, (route) => route.fulfill({ body: cutoutBody, contentType: "image/png", headers: { etag: CUTOUT_ETAG } }));
  await page.route(/\/api\/staff\/media\/[^/]+\/thumb\?v=2(?:&r=\d+)?$/, (route) => state.cleaned && state.thumb
    ? route.fulfill({ body: state.thumb, contentType: "image/jpeg" }) : route.fallback());
  await page.goto(`/staff/items?item=${id}`);
  const panel = page.locator("#photo-panel");
  await expect(panel.getByRole("button", { name: "Remove background" })).toHaveCount(0);
  const image = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    const draw = canvas.getContext("2d")!; draw.fillStyle = "#45685a"; draw.fillRect(0, 0, 600, 400);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  await panel.locator("input[type=file]:not([capture])").setInputFiles({ name: "stapler.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64") });
  await panel.getByRole("button", { name: "Save photo" }).click();
  await expect(panel.locator("[data-tile] .item-visual--loaded img")).toBeVisible();
  const photoId = (await (await page.request.get(`/api/staff/items/${id}`)).json()).item.photo.id as string;
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(photoId));
  await panel.locator("[data-view]").click();
  await page.locator("dialog.viewer").getByRole("button", { name: "Edit photo", exact: true }).click();
  await expect(page.locator("dialog.viewer")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !history.state?.viewer)).toBe(true);
  return { id, photoId, state };
}

test("picture cleanup: remove the background, see the cleaned picture, go back to the original", async ({ page, baseURL }) => {
  const { photoId, state } = await itemWithPhoto(page, baseURL!, providerCutout);
  const original = await (await page.request.get(`/api/staff/media/${photoId}/display`)).body();
  const panel = page.locator("#photo-panel");
  await panel.getByRole("button", { name: "Remove background" }).click();
  await expect(panel.getByRole("button", { name: "Use original" })).toBeVisible();
  expect(state.posted).toEqual([{ expected: photoId }, { expected: photoId, accept: true }]);
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(photoId, 1));
  expect(await (await page.request.get(`/api/staff/media/${photoId}/display`)).body()).toEqual(original);
  // Focus lands on the button that now undoes it.
  await expect(panel.getByRole("button", { name: "Use original" })).toBeFocused();

  await panel.getByRole("button", { name: "Use original" }).click();
  await expect(panel.getByRole("button", { name: "Remove background" })).toBeVisible();
  expect(state.deletes).toBe(1);
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(photoId, 2));
});

test("a cut that is not a real cutout is undone at once and the original stays", async ({ page, baseURL }) => {
  const { photoId, state } = await itemWithPhoto(page, baseURL!, tiny(true));
  const panel = page.locator("#photo-panel");
  await panel.getByRole("button", { name: "Remove background" }).click();
  await expect(panel.getByRole("alert")).toContainText("No background was found to remove. The original photo is still in use.");
  expect(state.cleaned).toBe(false);
  // Asked for a cut, judged it, rejected it: never accepted.
  expect(state.posted).toEqual([{ expected: photoId }]);
  expect(state.deletes).toBe(1);
  await expect(panel.getByRole("button", { name: "Remove background" })).toBeVisible();
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(photoId));
});

async function replacement(page: Page) {
  const image = await page.evaluate(() => {
    const canvas = Object.assign(document.createElement("canvas"), { width: 400, height: 600 });
    const context = canvas.getContext("2d")!; context.fillStyle = "#d9b76c"; context.fillRect(0, 0, 400, 600);
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  await page.locator('#photo-panel input[type=file]:not([capture])').setInputFiles({ name: "replacement.jpg", mimeType: "image/jpeg", buffer: Buffer.from(image, "base64") });
  await expect(page.getByRole("button", { name: "Save & remove background", exact: true })).toBeEnabled();
}

test("an existing photo crops at full phone width with reachable controls", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 650 });
  const { id, state } = await itemWithPhoto(page, baseURL!, providerCutout);
  const panel = page.locator("#photo-panel");
  await panel.getByRole("button", { name: "Crop thumbnail", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Resize crop from bottom right", exact: true })).toBeEnabled();
  await expect(panel.locator("[data-tile]")).toBeHidden();
  const crop = (await panel.locator(".photo-crop").boundingBox())!;
  expect(crop.width).toBeGreaterThan(280);
  const apply = (await panel.getByRole("button", { name: "Apply crop", exact: true }).boundingBox())!;
  expect(apply.y + apply.height).toBeLessThanOrEqual(650);
  await page.screenshot({ path: "/tmp/logistics-inventory-crop-mobile.png" });
  await panel.getByRole("button", { name: "Cancel crop", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.posted).toHaveLength(0);
  expect((await (await page.request.get(`/api/staff/items/${id}`)).json()).item.photo).not.toBeNull();
});

test("a replacement saves before cleanup, cleans its new media id and preserves original bytes", async ({ page, baseURL }) => {
  const { id, photoId, state } = await itemWithPhoto(page, baseURL!, providerCutout);
  let original: Buffer | null = null;
  await page.route(`**/api/staff/items/${id}/cutout**`, async (route) => {
    const { body: sent, thumb } = await cleanupRequest(route.request()); state.posted.push(sent);
    if (!sent.accept) original = await (await page.request.get(`/api/staff/media/${sent.expected}/display`)).body();
    else { state.cleaned = true; state.thumb = thumb!; }
    await route.fulfill({ json: sent.accept ? { cutout: true } : { pending: true } });
  });
  await replacement(page); await page.getByRole("button", { name: "Save & remove background", exact: true }).click();
  await expect(page.getByText("Background removed.", { exact: true })).toBeVisible();
  await page.locator("#photo-panel [data-view]").click();
  await page.locator("dialog.viewer").getByRole("button", { name: "Edit photo", exact: true }).click();
  await expect(page.locator("dialog.viewer")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => !history.state?.viewer)).toBe(true);
  await expect(page.getByRole("button", { name: "Use original", exact: true })).toBeVisible();
  const next = (await (await page.request.get(`/api/staff/items/${id}`)).json()).item.photo.id;
  expect(next).not.toBe(photoId);
  expect(state.posted).toEqual([{ expected: next }, { expected: next, accept: true }]);
  expect(await (await page.request.get(`/api/staff/media/${next}/display`)).body()).toEqual(original);
  await expect(page.locator("#photo-panel [data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(next, 1));
});

for (const failure of ["save conflict", "cleanup unavailable"] as const) test(`replacement ${failure} keeps an original and never cleans a conflicting save`, async ({ page, baseURL }) => {
  const { id, photoId, state } = await itemWithPhoto(page, baseURL!, providerCutout);
  if (failure === "save conflict") await page.route(`**/api/staff/items/${id}/photo`, (route) => route.fulfill({ status: 409, json: { error: "Another person changed this photo." } }));
  else await page.route(`**/api/staff/items/${id}/cutout**`, (route) => { state.posted.push(route.request().postDataJSON()); return route.fulfill({ status: 503, json: { error: "Background removal is unavailable. The original photo is kept." } }); });
  await replacement(page); await page.getByRole("button", { name: "Save & remove background", exact: true }).click();
  if (failure === "cleanup unavailable") await expect(page.locator("#photo-panel").getByRole("alert")).toContainText("original photo is kept");
  await expect(page.locator("#photo-panel [data-save]")).toHaveCount(0);
  const next = (await (await page.request.get(`/api/staff/items/${id}`)).json()).item.photo.id;
  expect(next === photoId).toBe(failure === "save conflict");
  expect(state.posted).toHaveLength(failure === "save conflict" ? 0 : 1);
  await expect(page.locator("#photo-panel [data-tile] img").first()).toHaveAttribute("src", thumbnailSrc(next));
});

test("the cleaned picture opens large over the dark overlay with its edges intact", async ({ page, baseURL }, info) => {
  const { photoId } = await itemWithPhoto(page, baseURL!, providerCutout);
  const panel = page.locator("#photo-panel");
  await panel.getByRole("button", { name: "Remove background" }).click();
  await expect(panel.getByRole("button", { name: "Use original" })).toBeVisible();
  await panel.getByRole("button", { name: /View photo of/ }).click();
  const viewer = page.locator("dialog.viewer");
  await expect(viewer.locator("img")).toHaveAttribute("src", `/api/staff/media/${photoId}/cutout`);
  await expect(viewer.locator("img")).toBeVisible();
  await viewer.screenshot({ path: info.outputPath("cutout-viewer.png") });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
});
