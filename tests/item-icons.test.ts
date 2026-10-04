import assert from "node:assert/strict";
import { test } from "vitest";
import { ITEM_ICONS, itemIconKey, itemIconSvg, resolveItemIcon, resolveItemVisual, searchItemIcons, suggestItemIcon } from "../src/item-icons";

for (const [name, key] of [
  ["Scissors", "scissors"], ["Canon Projector", "device-projector"], ["A4 Bond Paper 80gsm", "files"],
  ["Joy Dishwashing Liquid", "bottle"], ["Dishwashing Sponge", "bucket"], ["Electrical Cable", "plug"],
  ["Extension Cord", "plug"], ["Cleaning Spray", "spray"], ["Scrubbing Brush", "bucket"],
  ["Toothpaste", "dental"], ["Soap Bar", "bottle"], ["Aluminum Foil", "toilet-paper"],
  ["Cling Wrap", "toilet-paper"], ["Fork", "tools-kitchen-2"], ["Chopsticks", "bowl-chopsticks"],
  ["Cook Pot", "soup"], ["Coffee", "coffee"], ["Drinking Glass", "glass"], ["Storage Container", "box"],
  ["Correction Pen", "eraser"], ["Whiteboard Eraser", "eraser"], ["Whiteboard Marker", "pencil"],
  ["33mm Paper Clips (assorted)", "paperclip"], ["Binder Clips (large)", "paperclip"],
  ["Paperclip", "paperclip"], ["Paperclips", "paperclip"],
  ["Squeeze Bottle Paint", "palette"], ["Paper Bowl Lid", "soup"], ["Kopiko Blanca - Twin Pack", "coffee"], ["Water Bottle", "bottle"], ["Placemat", "soup"], ["Raincoat", "jacket"]
]) {
  test(`specific suggestion: ${name}`, () => assert.deepEqual(suggestItemIcon({ name }), { key, source: "specific" }));
}

test("normalizes punctuation, case and accents", () => {
  assert.equal(suggestItemIcon({ name: " A4—BÓND   PAPER! " }).key, "files");
});

test("uses aliases when the current name has no known keyword", () => {
  assert.equal(suggestItemIcon({ name: "Office cutting implement", aliases: "office tool; shears" }).key, "scissors");
  assert.equal(suggestItemIcon({ name: "Office cutting implement", aliases: ["shears", "craft supplies"] }).key, "scissors");
});

test("the current name takes priority over an obsolete alias", () => {
  assert.equal(suggestItemIcon({ name: "Printer", aliases: "camera" }).key, "printer");
});

test("a specific name wins over inaccurate category metadata", () => {
  assert.equal(suggestItemIcon({ name: "Dishwashing Liquid", category: "DECORATIONS" }).key, "bottle");
});

test("uses a category only after name and aliases are exhausted", () => {
  assert.deepEqual(suggestItemIcon({ name: "Unusual implement", category: "CLEANING SUPPLIES & EQUIPMENT" }), { key: "bucket", source: "category" });
});

test("uses type then generic for unknown imported names", () => {
  assert.deepEqual(suggestItemIcon({ name: "Mystery", itemType: "Loanable" }), { key: "box", source: "type" });
  assert.deepEqual(suggestItemIcon({ name: "Mystery", itemType: "Consumable" }), { key: "package", source: "type" });
  assert.deepEqual(suggestItemIcon({ name: "Mystery" }), { key: "package", source: "generic" });
});

test("matches words rather than arbitrary name substrings", () => {
  assert.equal(suggestItemIcon({ name: "Wallpaper" }).source, "generic");
});

test("a valid override beats automatic suggestions and reset restores the suggestion", () => {
  assert.deepEqual(resolveItemIcon({ name: "Paper", iconKey: "tabler:scissors" }), { key: "scissors", source: "override" });
  assert.deepEqual(resolveItemIcon({ name: "Paper", iconKey: null }), { key: "files", source: "specific" });
  assert.equal(suggestItemIcon({ name: "Paper", iconKey: "tabler:scissors" }).key, "files");
});

test("invalid or unsupported overrides cannot produce broken or injected SVG", () => {
  for (const iconKey of ["noun:scissors", "__proto__", "<script>alert(1)</script>", "../../secret", "tabler:missing"]) {
    assert.equal(itemIconKey(iconKey), null);
    assert.equal(resolveItemIcon({ name: "Paper", iconKey }).key, "files");
    assert.equal(itemIconSvg(iconKey), itemIconSvg("package"));
  }
});

test("picker searches cover the requested human vocabulary", () => {
  for (const query of ["paper", "scissors", "cleaning", "cable", "projector", "kitchen", "container", "bottle", "box", "chair", "table", "tool", "electronics"]) {
    assert.ok(searchItemIcons(query).length > 0, query);
  }
  assert.equal(searchItemIcons("no possible match").length, 0);
});

test("icons are locally available static SVGs and are decorative beside the item name", () => {
  for (const icon of ITEM_ICONS) {
    const svg = itemIconSvg(icon.key);
    assert.match(svg, /^<svg/);
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /focusable="false"/);
    assert.doesNotMatch(svg, /<script|<image|<foreignObject|href=|https?:|on[a-z]+=/i);
  }
});

test("suggestions require no persisted metadata and never mutate stock or classification", () => {
  const item = Object.freeze({ name: "Scissors", category: "OTHERS", itemType: "Loanable", onHand: 7, openingQty: 9, needsReview: true });
  assert.equal(resolveItemIcon(item).key, "scissors");
  assert.deepEqual(item, { name: "Scissors", category: "OTHERS", itemType: "Loanable", onHand: 7, openingQty: 9, needsReview: true });
});

test("a selected photo beats an icon override and keeps it as the fallback", () => {
  assert.deepEqual(resolveItemVisual({ name: "Paper", visualType: "PHOTO", photoId: "photo-id", iconKey: "scissors" }), {
    type: "PHOTO", photoId: "photo-id", fallback: { key: "scissors", source: "override" }
  });
});

test("existing V1.2 photos remain preferred without new persisted visual metadata", () => {
  assert.equal(resolveItemVisual({ name: "Paper", photoId: "existing-photo-id" }).type, "PHOTO");
});

test("selecting System Icon beats the stored photo and does not remove it", () => {
  const item = Object.freeze({ name: "Paper", visualType: "SYSTEM_ICON", photoId: "saved-photo", iconKey: "scissors" });
  assert.deepEqual(resolveItemVisual(item), { type: "SYSTEM_ICON", icon: { key: "scissors", source: "override" } });
  assert.equal(item.photoId, "saved-photo");
});

test("an unavailable or failed photograph falls back to a valid icon", () => {
  assert.deepEqual(resolveItemVisual({ name: "Paper", visualType: "PHOTO", photoId: "photo-id", iconKey: "scissors" }, false), {
    type: "SYSTEM_ICON", icon: { key: "scissors", source: "override" }
  });
  assert.deepEqual(resolveItemVisual({ name: "Mystery", visualType: "PHOTO", photoId: "photo-id" }, false), {
    type: "SYSTEM_ICON", icon: { key: "package", source: "generic" }
  });
});

test("a missing photo and an old offline snapshot both resolve without migration", () => {
  assert.deepEqual(resolveItemVisual({ name: "Paper", visualType: "PHOTO" }), { type: "SYSTEM_ICON", icon: { key: "files", source: "specific" } });
  assert.deepEqual(resolveItemVisual({ name: "Paper" }), { type: "SYSTEM_ICON", icon: { key: "files", source: "specific" } });
});
