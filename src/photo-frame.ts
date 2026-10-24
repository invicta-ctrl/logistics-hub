import { subjectCrop } from "./cutout-share";

/*
 * Photo frames that take the photo's own background (LH-IP02-S03). A picture taken against a plain wall or table is framed in that same
 * colour, so the frame and the picture read as one; a busy picture keeps the neutral frame. A cleaned picture (background removed) is
 * flattened onto the stone colour for its thumbnails (item-photo.ts), so that colour along the edge means a cut-out, which then stands
 * on a pedestal. Browser only: it reads pixels the page already has, and stores and sends nothing.
 */

/** The picture is drawn this small to read its edge: a few hundred pixels, however large it is. */
const SIZE = 24;
/** The largest spread of a colour channel along the edge that still reads as one colour. */
const UNIFORM = 12;
/**
 * The stone a cut-out's thumbnail is flattened onto (item-photo.ts STAGE), how far JPEG compression may move it, and how even that edge is.
 * A photo merely taken against a wall of a similar shade is lit unevenly, so it stays a framed photo rather than standing on a pedestal.
 */
const STAGE = [0xe8, 0xe3, 0xdd] as const;
const STAGE_TOLERANCE = 4;
const STAGE_SPREAD = 3;
let canvas: HTMLCanvasElement | null = null;

export type Backdrop = { colour: string; cutout: boolean };

/** The colour along a picture's edge when it is one colour, and whether it is the cut-out stone; null for a busy, clear or unreadable edge. */
export function backdropOf(image: CanvasImageSource): Backdrop | null {
  try {
    canvas ??= document.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.clearRect(0, 0, SIZE, SIZE);
    context.drawImage(image, 0, 0, SIZE, SIZE);
    const pixels = context.getImageData(0, 0, SIZE, SIZE).data;
    const edge: Array<[number, number, number]> = [];
    for (let at = 0; at < SIZE; at += 1) {
      for (const [x, y] of [[at, 0], [at, SIZE - 1], [0, at], [SIZE - 1, at]] as const) {
        const offset = (y * SIZE + x) * 4;
        // A see-through edge has no colour of its own to match.
        if (pixels[offset + 3]! < 250) return null;
        edge.push([pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!]);
      }
    }
    const mean = [0, 1, 2].map((channel) => edge.reduce((sum, pixel) => sum + pixel[channel]!, 0) / edge.length);
    const spread = Math.max(...[0, 1, 2].map((channel) => Math.sqrt(edge.reduce((sum, pixel) => sum + (pixel[channel]! - mean[channel]!) ** 2, 0) / edge.length)));
    if (spread > UNIFORM) return null;
    const [red, green, blue] = mean.map(Math.round);
    return { colour: `rgb(${red} ${green} ${blue})`, cutout: spread <= STAGE_SPREAD && mean.every((value, channel) => Math.abs(value - STAGE[channel]!) <= STAGE_TOLERANCE) };
  } catch {
    // A picture the browser will not let the page read keeps the neutral frame.
    return null;
  }
}

/** Frames `frame` by the picture now inside it. It runs on every load, so a changed or cleaned picture is framed afresh. */
export function frameByPhoto(image: HTMLImageElement, frame: HTMLElement): void {
  const backdrop = backdropOf(image);
  frame.classList.toggle("photo-matched", Boolean(backdrop));
  frame.classList.toggle("photo-pedestal", Boolean(backdrop?.cutout));
  if (backdrop) frame.style.setProperty("--photo-bg", backdrop.colour);
  else frame.style.removeProperty("--photo-bg");
}

/** Clears what a picture set, when it fails or is taken away. */
export function unframe(frame: HTMLElement): void {
  frame.classList.remove("photo-matched", "photo-pedestal");
  frame.style.removeProperty("--photo-bg");
}

/** How much of the pedestal tile the item may take, in percent of its side: wide items reach the width, tall ones the height. */
const ITEM_WIDTH = 62;
const ITEM_HEIGHT = 60;

/**
 * Stands a transparent cut-out on the pedestal (item-photo.ts draws it): the picture is cropped to its subject, the same subject crop the
 * thumbnails use (cutout-share.ts), and sized to the plinth. It only positions the picture; the stored cut-out is never changed.
 */
export function seatOnPedestal(image: HTMLImageElement): void {
  const box = image.parentElement;
  if (!box || !image.naturalWidth || !image.naturalHeight) return;
  let rect = { x: 0, y: 0, width: 100, height: 100 };
  try {
    const scale = Math.min(1, 160 / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas ??= document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.clearRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);
      rect = subjectCrop(context.getImageData(0, 0, width, height).data, width, height, rect) ?? rect;
    }
  } catch { /* uncropped still stands on the pedestal, only smaller */ }
  const ratio = (rect.width * image.naturalWidth) / (rect.height * image.naturalHeight);
  const width = Math.min(ITEM_WIDTH, ITEM_HEIGHT * ratio);
  for (const [name, value] of [["--item-w", width], ["--item-h", width / ratio], ["--crop-x", rect.x], ["--crop-y", rect.y], ["--crop-w", rect.width], ["--crop-h", rect.height]] as const) {
    box.style.setProperty(name, name.startsWith("--item") ? `${value}%` : String(value));
  }
  box.classList.add("is-seated");
}
