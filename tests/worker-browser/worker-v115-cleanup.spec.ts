import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { type Page, expect, test } from "@playwright/test";

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

type Setup = { id: string; photoId: string; state: { cleaned: boolean; posted: unknown[]; deletes: number } };

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
  const state = { cleaned: false, posted: [] as unknown[], deletes: 0 };
  await page.route(new RegExp(`/api/staff/items/${id}(/photo)?$`), async (route) => {
    if (route.request().method() === "DELETE") return route.fallback();
    const real = await route.fetch();
    const body = await real.json();
    const { photo } = body.item ?? body;
    if (!photo) return route.fulfill({ response: real, json: body });
    const marked = { ...photo, cleanable: true, cutout: state.cleaned };
    await route.fulfill({ response: real, json: body.item ? { ...body, item: { ...body.item, photo: marked } } : { photo: marked } });
  });
  await page.route(`**/api/staff/items/${id}/cutout**`, async (route) => {
    if (route.request().method() === "POST") {
      const sent = route.request().postDataJSON() as { accept?: boolean };
      state.posted.push(sent);
      // A new cut waits as pending; only the browser's accept makes it the item's picture.
      if (sent.accept) state.cleaned = true;
      await route.fulfill({ json: sent.accept ? { cutout: true } : { pending: true } });
    }
    else { state.deletes += 1; state.cleaned = false; await route.fulfill({ json: { cutout: false } }); }
  });
  await page.route(/\/api\/staff\/media\/[^/]+\/(cutout|pending)$/, (route) => route.fulfill({ body: cutoutBody, contentType: "image/png" }));
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
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", `/api/staff/media/${photoId}/thumb`);
  return { id, photoId, state };
}

test("picture cleanup: remove the background, see the cleaned picture, go back to the original", async ({ page, baseURL }) => {
  const { photoId, state } = await itemWithPhoto(page, baseURL!, providerCutout);
  const panel = page.locator("#photo-panel");
  await panel.getByRole("button", { name: "Remove background" }).click();
  await expect(panel.getByRole("button", { name: "Use original" })).toBeVisible();
  expect(state.posted).toEqual([{ expected: photoId }, { expected: photoId, accept: true }]);
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", `/api/staff/media/${photoId}/cutout`);
  await expect(page.getByText("The original photo is kept.")).toBeVisible();
  // Focus lands on the button that now undoes it.
  await expect(panel.getByRole("button", { name: "Use original" })).toBeFocused();

  await panel.getByRole("button", { name: "Use original" }).click();
  await expect(panel.getByRole("button", { name: "Remove background" })).toBeVisible();
  expect(state.deletes).toBe(1);
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", `/api/staff/media/${photoId}/thumb`);
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
  await expect(panel.locator("[data-tile] img").first()).toHaveAttribute("src", `/api/staff/media/${photoId}/thumb`);
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
