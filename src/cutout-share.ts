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
