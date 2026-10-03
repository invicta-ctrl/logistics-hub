import { reducedMotion } from "./ui";

/*
 * The USC ID card in 3D (Earl, 2026-10-03: "like Pokémon cards"). The card in the viewer tilts toward the pointer or finger
 * under a glare and a holographic sheen, presses in when held, turns over on a spring, and flies out of its tile when opened
 * and back into it when closed; the tiles tilt under the mouse. The springs and the tilt range follow pokemon-cards-css
 * (Simon Goellner). Reading comes first: the card rests flat and unlit, lies still while zoomed, and nothing moves at all
 * for someone who prefers reduced motion. Values reach the page as CSS custom properties and Web Animations, which the
 * Content-Security-Policy (no inline style attributes) allows.
 */

type Feel = { stiffness: number; damping: number };
/** Following the pointer, and the slower, looser return to rest (pokemon-cards-css's interaction and snap-back springs). */
const FOLLOW: Feel = { stiffness: 0.066, damping: 0.25 };
const SETTLE: Feel = { stiffness: 0.01, damping: 0.06 };
/** Turning over: quick, with one small overshoot. */
const TURN: Feel = { stiffness: 0.05, damping: 0.24 };
/** The glare's sweep across the card when it lands. */
const SWEEP: Feel = { stiffness: 0.012, damping: 0.1 };
/** Flying out of the tile (a little overshoot, so it lands) and back into it (no overshoot). */
const LAUNCH: Feel = { stiffness: 0.012, damping: 0.17 };
const RETURN: Feel = { stiffness: 0.08, damping: 0.5 };
/** The tilt at the card's edge, in degrees (pokemon-cards-css divides the offset in percent by 3.5). */
const TILT = 50 / 3.5;

/** One value on a spring, stepped per 60 Hz frame like Svelte's spring store. */
class Spring {
  value: number;
  target: number;
  private previous: number;
  constructor(value: number, private feel: Feel, private precision = 0.01) {
    this.value = this.previous = this.target = value;
  }
  to(target: number, feel: Feel = this.feel): void { this.target = target; this.feel = feel; }
  jump(value: number): void { this.value = this.previous = this.target = value; }
  /** Moves `dt` frames on; false once it is at rest on its target. */
  step(dt: number): boolean {
    const delta = this.target - this.value;
    const velocity = (this.value - this.previous) / dt;
    const move = (velocity + this.feel.stiffness * delta - this.feel.damping * velocity) * dt;
    this.previous = this.value;
    if (Math.abs(move) < this.precision && Math.abs(delta) < this.precision) { this.value = this.previous = this.target; return false; }
    this.value += move;
    return true;
  }
}

export type CardMotion = {
  /** The pointer is at (x, y) across the card (0–1 each): the card leans toward it under a glare. */
  point(x: number, y: number): void;
  /** Pressed in while a finger or button is down on it. */
  press(down: boolean): void;
  /** Let go: back to flat and unlit, loosely. */
  rest(): void;
  /** Flat and unlit at once (zoomed in, or about to fly back). */
  still(): void;
  /** Turns the card to `degrees` about its vertical axis (a multiple of 180: a face up), on a spring unless `animate` is false. */
  turn(degrees: number, animate: boolean): void;
  /** A single glare passing over the card, as when a real card catches the light. */
  sweep(): void;
  /** Stops the frame loop for good (the viewer closed). */
  stop(): void;
};

/** Drives `card` through --tilt-x, --tilt-y, --turn, --press, --glare-x, --glare-y, --glare and --holo-x, --holo-y (src/styles.css). */
export function cardMotion(card: HTMLElement): CardMotion {
  const tiltX = new Spring(0, FOLLOW), tiltY = new Spring(0, FOLLOW), turn = new Spring(0, TURN, 0.05), press = new Spring(1, FOLLOW, 0.0005);
  const glareX = new Spring(50, FOLLOW), glareY = new Spring(50, FOLLOW), glare = new Spring(0, FOLLOW, 0.002);
  const springs = [tiltX, tiltY, turn, press, glareX, glareY, glare];
  let frame = 0, last = 0, stopped = false;
  const timers: number[] = [];
  const clearTimers = () => { timers.splice(0).forEach((timer) => window.clearTimeout(timer)); };

  const paint = () => {
    const set = (name: string, value: string) => card.style.setProperty(name, value);
    set("--tilt-x", `${tiltX.value.toFixed(2)}deg`);
    set("--tilt-y", `${tiltY.value.toFixed(2)}deg`);
    set("--turn", `${turn.value.toFixed(2)}deg`);
    set("--press", press.value.toFixed(4));
    set("--glare-x", `${glareX.value.toFixed(2)}%`);
    set("--glare-y", `${glareY.value.toFixed(2)}%`);
    set("--glare", Math.max(0, Math.min(1, glare.value)).toFixed(3));
    // The foil moves less than the light and the other way, so its colours slide across the card (pokemon-cards-css: 37–63%, 33–67%).
    set("--holo-x", `${(63 - glareX.value * 0.26).toFixed(2)}%`);
    set("--holo-y", `${(67 - glareY.value * 0.34).toFixed(2)}%`);
  };
  const tick = (now: number) => {
    // Frames in 60 Hz units, capped so a tab that was in the background does not throw the springs.
    const dt = last ? Math.min(2, (now - last) / (1000 / 60)) : 1;
    last = now;
    let moving = false;
    for (const spring of springs) moving = spring.step(dt) || moving;
    paint();
    frame = moving && !stopped ? window.requestAnimationFrame(tick) : 0;
    if (!frame) last = 0;
  };
  const run = () => { if (!frame && !stopped) frame = window.requestAnimationFrame(tick); };

  return {
    point(x, y) {
      if (reducedMotion()) return;
      clearTimers();
      const [cx, cy] = [Math.max(0, Math.min(1, x)) * 100 - 50, Math.max(0, Math.min(1, y)) * 100 - 50];
      tiltX.to(cy / 3.5, FOLLOW);
      tiltY.to(-cx / 3.5, FOLLOW);
      glareX.to(cx + 50, FOLLOW);
      glareY.to(cy + 50, FOLLOW);
      glare.to(1, FOLLOW);
      run();
    },
    press(down) {
      if (reducedMotion()) return;
      press.to(down ? 0.97 : 1, FOLLOW);
      run();
    },
    rest() {
      clearTimers();
      for (const spring of [tiltX, tiltY]) spring.to(0, SETTLE);
      glareX.to(50, SETTLE);
      glareY.to(50, SETTLE);
      glare.to(0, FOLLOW);
      press.to(1, FOLLOW);
      run();
    },
    still() {
      clearTimers();
      for (const spring of [tiltX, tiltY, glare]) spring.jump(0);
      press.jump(1);
      paint();
    },
    turn(degrees, animate) {
      if (animate && !reducedMotion()) { turn.to(degrees); run(); } else { turn.jump(degrees); paint(); }
    },
    sweep() {
      if (reducedMotion()) return;
      clearTimers();
      glareX.jump(12);
      glareY.jump(8);
      glareX.to(88, SWEEP);
      glareY.to(92, SWEEP);
      glare.to(0.75, FOLLOW);
      timers.push(window.setTimeout(() => { glare.to(0, SETTLE); run(); }, 650));
      run();
    },
    stop() {
      stopped = true;
      clearTimers();
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    }
  };
}

/* ---------- Flying between the tile and the viewer ---------- */

/** A spring's way from 0 to 1, one value per 60 Hz frame, for Web Animation keyframes; it ends once its steps are below `precision`. */
function springPath(feel: Feel, precision = 0.0005): number[] {
  const spring = new Spring(0, feel, precision);
  spring.to(1);
  const path = [0];
  while (spring.step(1) && path.length < 80) path.push(spring.value);
  path.push(1);
  return path;
}

type Box = { left: number; top: number; width: number; height: number };
/** Where `from` lies relative to `to`, as a translation of centres and a uniform scale. */
const offset = (from: Box, to: Box) => ({ x: from.left + from.width / 2 - (to.left + to.width / 2), y: from.top + from.height / 2 - (to.top + to.height / 2), scale: from.width / to.width });
/** When the flight in is 95% of the way: the card reads as landed, so the viewer takes input and the light sweeps over it. */
export const LANDED_MS = (springPath(LAUNCH).findIndex((p) => p >= 0.95) * 1000) / 60;
/** True when a box is at least partly on screen, so flying to or from it reads as a movement. */
export const onScreen = (box: Box | null): box is Box => Boolean(box && box.width > 0 && box.top + box.height > 0 && box.left + box.width > 0 && box.top < window.innerHeight && box.left < window.innerWidth);

/**
 * Flies `element` from the box `from` (the tile) into the place it is laid out, turning `spin` degrees around its vertical
 * axis (once by default; one and a half turns land it on its other face) and lifting toward the viewer on the way, then
 * settles with a small overshoot. Without a tile on screen it grows from the middle.
 */
export function flyIn(element: HTMLElement, from: Box | null, spin = -360): Animation {
  const at = offset(onScreen(from) ? from : centred(element, 0.55), element.getBoundingClientRect());
  const path = springPath(LAUNCH);
  return element.animate(path.map((p) => {
    const arc = Math.sin(Math.PI * Math.min(1, p));
    return { transform: `translate3d(${(at.x * (1 - p)).toFixed(1)}px, ${(at.y * (1 - p)).toFixed(1)}px, ${(180 * arc).toFixed(1)}px) rotateX(${(-8 * arc).toFixed(2)}deg) rotateY(${(spin * (1 - p)).toFixed(2)}deg) scale(${(at.scale + (1 - at.scale) * p).toFixed(4)})` };
  }), { duration: ((path.length - 1) * 1000) / 60, easing: "linear" });
}

/**
 * Flies `element` back into the box `to` (the tile it belongs to), turning `spin` degrees on the way (half a turn lands it on
 * its other face, the one the tile shows); without a tile on screen it shrinks away in the middle.
 */
export function flyOut(element: HTMLElement, to: Box | null, spin = 0): Animation {
  const target = onScreen(to);
  const at = offset(target ? to : centred(element, 0.85), element.getBoundingClientRect());
  const path = springPath(RETURN, 0.003);
  return element.animate(path.map((p) => {
    const arc = Math.sin(Math.PI * Math.min(1, p));
    return { transform: `translate3d(${(at.x * p).toFixed(1)}px, ${(at.y * p).toFixed(1)}px, ${(90 * arc).toFixed(1)}px) rotateX(${(6 * arc).toFixed(2)}deg) rotateY(${(spin * p).toFixed(2)}deg) scale(${(1 + (at.scale - 1) * p).toFixed(4)})`, opacity: target ? 1 : 1 - p };
  }), { duration: ((path.length - 1) * 1000) / 60, easing: "linear", fill: "forwards" });
}

/** The faces' shadow: from a tile's (lying on the page) to the card's own as it flies in, and back as it flies out. */
export function liftShadow(faces: Iterable<HTMLElement>, out: boolean, duration: number): Animation[] {
  const flat = "0 1px 2px rgb(0 0 0 / 6%)";
  return [...faces].map((face) => {
    const lifted = getComputedStyle(face).boxShadow;
    return face.animate([{ boxShadow: out ? lifted : flat }, { boxShadow: out ? flat : lifted }], { duration, easing: "ease-out", fill: out ? "forwards" : "none" });
  });
}

/** The element's own box, scaled about its centre. */
function centred(element: HTMLElement, scale: number): Box {
  const box = element.getBoundingClientRect();
  return { left: box.left + (box.width * (1 - scale)) / 2, top: box.top + (box.height * (1 - scale)) / 2, width: box.width * scale, height: box.height * scale };
}

/* ---------- Tiles ---------- */

/**
 * A tile leans toward the mouse with a glare (--tile-x, --tile-y, --tile-gx, --tile-gy, --tile-glare) and presses in when held.
 * Touch only presses: a finger on a tile is about to open it.
 */
export function tiltTile(tile: HTMLElement): void {
  let box: DOMRect | null = null;
  const set = (name: string, value: string) => tile.style.setProperty(name, value);
  const reset = () => {
    tile.classList.remove("is-tilting");
    for (const name of ["--tile-x", "--tile-y"]) set(name, "0deg");
    set("--tile-glare", "0");
    set("--tile-press", "1");
    box = null;
  };
  tile.addEventListener("pointerenter", (event) => {
    // Measured before it leans, so the lean never moves the point it follows.
    if (event.pointerType === "mouse") box = tile.getBoundingClientRect();
  });
  tile.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse" || reducedMotion()) return;
    box ??= tile.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    const y = Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    tile.classList.add("is-tilting");
    set("--tile-x", `${((y - 0.5) * 2 * TILT * 0.6).toFixed(2)}deg`);
    set("--tile-y", `${((0.5 - x) * 2 * TILT * 0.6).toFixed(2)}deg`);
    set("--tile-gx", `${(x * 100).toFixed(1)}%`);
    set("--tile-gy", `${(y * 100).toFixed(1)}%`);
    set("--tile-glare", "1");
  });
  tile.addEventListener("pointerdown", () => { if (!reducedMotion()) set("--tile-press", "0.96"); });
  for (const type of ["pointerup", "pointercancel"] as const) tile.addEventListener(type, () => set("--tile-press", "1"));
  tile.addEventListener("pointerleave", reset);
  // Opened: the tile settles flat behind the viewer, so the card later flies back into a level slot.
  tile.addEventListener("click", reset);
}
