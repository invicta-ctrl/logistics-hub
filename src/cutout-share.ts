/*
 * Judging a cleaned picture (Final Pass amendment, FP-E). The browser draws the picture small and passes its pixels here; the Worker
 * cannot afford to decode a PNG (src/item-cutout.ts). A real cutout has a background that is gone (transparent) and a subject that stayed
 * (opaque). A picture with no transparency is the original passed through; one that is almost all transparent has lost the product.
 */

/** Alpha below this counts as removed, above that as kept (the soft edge in between counts as neither). */
const CLEAR = 16;
const SOLID = 240;
export const MIN_REMOVED = 0.03;
export const MIN_KEPT = 0.03;

export type CutoutShares = { removed: number; kept: number };

/** The share of pixels removed and kept, from canvas-style RGBA data (four bytes a pixel, alpha last). */
export function cutoutShares(rgba: ArrayLike<number>): CutoutShares {
  const pixels = Math.floor(rgba.length / 4);
  let clear = 0;
  let solid = 0;
  for (let at = 3; at < pixels * 4; at += 4) {
    const alpha = rgba[at]!;
    if (alpha < CLEAR) clear += 1;
    else if (alpha > SOLID) solid += 1;
  }
  return pixels ? { removed: clear / pixels, kept: solid / pixels } : { removed: 0, kept: 0 };
}

/** Why a cut is not a cutout, in a sentence a person can read, or null when it is one. */
export function cutoutProblem({ removed, kept }: CutoutShares): string | null {
  if (removed < MIN_REMOVED) return "No background was found to remove.";
  if (kept < MIN_KEPT) return "Too little of the item was kept.";
  return null;
}

/** A rectangle in percent of a picture, as the photo crop is stored (src/item-photo.ts PhotoCrop has the same shape). */
export type Rect = { x: number; y: number; width: number; height: number };

/** Alpha above this is part of the subject; the soft edge and thin parts (a cable, a strap) stay inside the box. */
const SUBJECT = 8;
/** Room kept around the subject, as a share of its longer side. */
export const SUBJECT_MARGIN = 0.08;
/** A box smaller than this share of the crop is not a subject (a stray speck); a box larger than the next one needs no trimming. */
const MIN_SUBJECT = 0.005;
const ALREADY_TIGHT = 0.9;

/**
 * Where the subject of a cutout sits inside `rect`, with a margin, in the same percent units, or null when the whole crop should be kept
 * (no clear subject, or it already fills the frame). Display only: the stored cutout is never changed. Reads RGBA from a small drawing of
 * the picture, so it costs one pass over a few thousand pixels and only runs when a cutout is judged or its thumbnail is made.
 */
export function subjectCrop(rgba: ArrayLike<number>, width: number, height: number, rect: Rect): Rect | null {
  if (width < 1 || height < 1 || rgba.length < width * height * 4) return null;
  const x0 = Math.max(0, Math.floor(rect.x / 100 * width));
  const y0 = Math.max(0, Math.floor(rect.y / 100 * height));
  const x1 = Math.min(width, Math.ceil((rect.x + rect.width) / 100 * width));
  const y1 = Math.min(height, Math.ceil((rect.y + rect.height) / 100 * height));
  let left = x1, top = y1, right = -1, bottom = -1;
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) {
    if (rgba[(y * width + x) * 4 + 3]! <= SUBJECT) continue;
    if (x < left) left = x; if (x > right) right = x;
    if (y < top) top = y; if (y > bottom) bottom = y;
  }
  if (right < left || bottom < top) return null;
  const boxW = right - left + 1, boxH = bottom - top + 1;
  const crop = (x1 - x0) * (y1 - y0);
  if (boxW * boxH < crop * MIN_SUBJECT) return null;
  const pad = Math.ceil(Math.max(boxW, boxH) * SUBJECT_MARGIN) + 1;
  const a = Math.max(x0, left - pad), b = Math.max(y0, top - pad), c = Math.min(x1, right + 1 + pad), d = Math.min(y1, bottom + 1 + pad);
  if ((c - a) * (d - b) >= crop * ALREADY_TIGHT) return null;
  return { x: a / width * 100, y: b / height * 100, width: (c - a) / width * 100, height: (d - b) / height * 100 };
}
