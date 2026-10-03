import { DEPARTMENTS, type DepartmentCode } from "./directory-policy";
import { ISSUE_KINDS, type IssueKind, type Pair, type Preflight, preflight } from "./staff-import";
import { ApiError, type Html, api, dataUrl, failure, formatDateTime, html, icon, jpegOf, mount, plural, reducedMotion, setMessage, toast } from "./ui";

/*
 * Official USC ID scans in the browser (Administration → Staff Directory): fetching them for one visit, the flip-and-zoom
 * viewer, turning a scan into what the Worker stores, the owner's add/replace panel, and the archive import with its preflight.
 */

export type Side = "front" | "back";
export type Card = { mediaId: string; front: { width: number; height: number }; back: { width: number; height: number }; sourceFront: string | null; sourceBack: string | null; createdAt: string; createdBy: string | null };
type Who = { id: string; name: string; department: string };

/* ---------- Scans, for this visit only ---------- */

/**
 * A scan is fetched once per visit and kept in memory as a data: URL (the CSP allows data: images, not blob:), so the tile and
 * the viewer share it and flipping is instant. It is never written to a cache or to disk (the Worker answers no-store), and the
 * whole map is dropped when the profile is left.
 */
const scans = new Map<string, Promise<string>>();
export function scan(personId: string, mediaId: string, side: Side): Promise<string> {
  const key = `${personId}/${mediaId}/${side}`;
  let entry = scans.get(key);
  if (!entry) {
    entry = fetch(`/api/staff/admin/directory/${personId}/id/${side}`, { credentials: "same-origin", cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new ApiError(response.status, response.status === 429 ? "Too many ID scans opened in a short time. Please wait a few minutes." : "This scan could not be opened.");
      return dataUrl(await response.blob());
    });
    entry.catch(() => scans.delete(key));
    scans.set(key, entry);
  }
  return entry;
}
export const forgetScans = (): void => scans.clear();

/* ---------- Viewer ---------- */

const MAX_ZOOM = 4;

/**
 * The card large, over everything: Front and Back flip in place (a short 3D turn; instant under reduced motion), and the
 * scan zooms up to 4× with the wheel, a pinch, a double-click or + and −, and pans by dragging or with the arrow keys. A modal
 * dialog gives Escape, a focus trap and an inert page; Back closes it (it holds a history entry); focus returns to its opener.
 */
export async function openIdViewer(person: Who, card: Card, side: Side): Promise<void> {
  if (document.querySelector("dialog.id-viewer")) return;
  const opener = document.activeElement as HTMLElement | null;
  const department = DEPARTMENTS[person.department as DepartmentCode] ?? person.department;
  const dialog = document.createElement("dialog");
  dialog.className = "id-viewer";
  dialog.setAttribute("aria-label", `USC ID of ${person.name}`);
  const face = (which: Side) => html`<img class="id-card__face id-card__face--${which}" data-face="${which}" alt="${which === "front" ? "Front" : "Back"} of ${person.name}'s USC ID" draggable="false" />`;
  mount(dialog, html`<header class="id-viewer__bar">
      <p class="id-viewer__title"><strong>${person.name}</strong><span>${department} · USC ID</span></p>
      <div class="id-viewer__sides" role="group" aria-label="Side of the card">
        <button type="button" data-side="front">Front</button><button type="button" data-side="back">Back</button>
      </div>
      <div class="id-viewer__zoom" role="group" aria-label="Zoom">
        <button type="button" class="icon-button" data-zoom="out" aria-label="Zoom out"><span aria-hidden="true">−</span></button>
        <output class="id-viewer__level" aria-live="polite">100%</output>
        <button type="button" class="icon-button" data-zoom="in" aria-label="Zoom in">${icon("plus")}</button>
        <button type="button" class="button button--sm id-viewer__fit" data-zoom="fit">Fit</button>
      </div>
      <button class="icon-button id-viewer__close" type="button" data-close aria-label="Close ID">${icon("close")}</button>
    </header>
    <div class="id-viewer__stage" data-stage><div class="id-viewer__pan" data-pan><div class="id-card" data-card>${face("front")}${face("back")}</div></div></div>
    <p class="id-viewer__hint">F and B turn the card · + and − zoom · drag or arrow keys move · Esc closes. Opening a USC ID is recorded in Activity.</p>`);
  document.body.append(dialog);
  const stage = dialog.querySelector<HTMLElement>("[data-stage]")!;
  const pan = dialog.querySelector<HTMLElement>("[data-pan]")!;
  const cardBox = dialog.querySelector<HTMLElement>("[data-card]")!;
  const level = dialog.querySelector("output")!;
  const faces = { front: dialog.querySelector<HTMLImageElement>('[data-face="front"]')!, back: dialog.querySelector<HTMLImageElement>('[data-face="back"]')! };
  let current: Side = side;
  let view = { scale: 1, x: 0, y: 0 };

  const clamp = () => {
    const box = cardBox.getBoundingClientRect();
    const [width, height] = [box.width / view.scale, box.height / view.scale];
    const limit = (size: number, viewport: number) => Math.max(0, (size * view.scale - viewport) / 2 + size * 0.05);
    view.x = Math.max(-limit(width, stage.clientWidth), Math.min(limit(width, stage.clientWidth), view.x));
    view.y = Math.max(-limit(height, stage.clientHeight), Math.min(limit(height, stage.clientHeight), view.y));
  };
  const apply = (animate = false) => {
    if (view.scale <= 1) view = { scale: 1, x: 0, y: 0 };
    else clamp();
    pan.classList.toggle("is-animating", animate && !reducedMotion());
    pan.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    level.textContent = `${Math.round(view.scale * 100)}%`;
    stage.classList.toggle("is-zoomed", view.scale > 1);
  };
  /** Zooms to `scale`, keeping the point under (cx, cy) (stage coordinates from its centre) where it is. */
  const zoomTo = (scale: number, cx = 0, cy = 0, animate = true) => {
    const next = Math.max(1, Math.min(MAX_ZOOM, scale));
    view = { scale: next, x: cx - (cx - view.x) * (next / view.scale), y: cy - (cy - view.y) * (next / view.scale) };
    apply(animate);
  };
  const fromCentre = (event: { clientX: number; clientY: number }) => {
    const box = stage.getBoundingClientRect();
    return [event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2] as const;
  };

  const showSide = (next: Side) => {
    current = next;
    const dims = card[next];
    cardBox.style.setProperty("--ratio", String(dims.width / dims.height));
    cardBox.dataset.side = next;
    faces.front.setAttribute("aria-hidden", String(next !== "front"));
    faces.back.setAttribute("aria-hidden", String(next !== "back"));
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("[data-side]")];
    const focused = buttons.includes(document.activeElement as HTMLButtonElement);
    buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.side === next)));
    // Turning the card by key keeps the focus on the side now shown, so the ring never points at the other one.
    if (focused) buttons.find((button) => button.dataset.side === next)!.focus();
    view = { scale: 1, x: 0, y: 0 };
    apply(true);
  };

  for (const which of ["front", "back"] as const) {
    // The side asked for first, so it is on screen as soon as possible; the other is ready before the first turn.
    void scan(person.id, card.mediaId, which).then((url) => { faces[which].src = url; }, (error: unknown) => { if (which === side) toast(failure(error), "error"); });
  }
  showSide(side);
  await Promise.race([scan(person.id, card.mediaId, side).then(() => faces[side].decode()).catch(() => undefined), new Promise((resolve) => window.setTimeout(resolve, 600))]);

  let entryGone = false;
  const onBack = () => { entryGone = true; if (dialog.open) dialog.close(); };
  dialog.addEventListener("close", () => {
    window.removeEventListener("popstate", onBack);
    dialog.remove();
    if (!entryGone && window.history.state?.viewer) window.history.back();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  });
  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-close]")) dialog.close();
    const sideButton = target.closest<HTMLButtonElement>("[data-side]");
    if (sideButton) showSide(sideButton.dataset.side as Side);
    const zoom = target.closest<HTMLButtonElement>("[data-zoom]")?.dataset.zoom;
    if (zoom === "in") zoomTo(view.scale * 1.5);
    if (zoom === "out") zoomTo(view.scale / 1.5);
    if (zoom === "fit") zoomTo(1);
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.target instanceof HTMLButtonElement && (event.key === "Enter" || event.key === " ")) return;
    const step = 60;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (event.key === "f" || event.key === "F") showSide("front");
    else if (event.key === "b" || event.key === "B") showSide("back");
    else if (event.key === "+" || event.key === "=") zoomTo(view.scale * 1.5);
    else if (event.key === "-") zoomTo(view.scale / 1.5);
    else if (event.key === "0") zoomTo(1);
    else if (moves[event.key] && view.scale > 1) { view.x += moves[event.key]![0]; view.y += moves[event.key]![1]; apply(true); }
    else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && view.scale === 1) showSide(current === "front" ? "back" : "front");
    else return;
    event.preventDefault();
  });
  stage.addEventListener("wheel", (event) => {
    event.preventDefault();
    const [cx, cy] = fromCentre(event);
    zoomTo(view.scale * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015)), cx, cy, false);
  }, { passive: false });
  stage.addEventListener("dblclick", (event) => { const [cx, cy] = fromCentre(event); zoomTo(view.scale > 1 ? 1 : 2.5, cx, cy); });
  // One finger or the mouse drags a zoomed card; two fingers pinch.
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; scale: number } | null = null;
  const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  stage.addEventListener("pointerdown", (event) => {
    stage.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) pinch = { distance: distance(), scale: view.scale };
  });
  stage.addEventListener("pointermove", (event) => {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const [cx, cy] = fromCentre({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      zoomTo(pinch.scale * distance() / pinch.distance, cx, cy, false);
    } else if (view.scale > 1) {
      view.x += event.clientX - last.x;
      view.y += event.clientY - last.y;
      apply();
    }
  });
  const release = (event: PointerEvent) => { pointers.delete(event.pointerId); if (pointers.size < 2) pinch = null; };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);

  window.history.pushState({ viewer: true }, "");
  window.addEventListener("popstate", onBack);
  dialog.showModal();
  dialog.querySelector<HTMLButtonElement>(`[data-side="${side}"]`)!.focus();
}

/* ---------- Preparing a scan ---------- */

const SCAN_EDGE = 2000;
/** The Worker refuses a scan over 1.5 MB, so a detailed one is re-encoded harder before it is sent. */
const SCAN_QUALITIES = [0.88, 0.8, 0.7, 0.6];

/**
 * A scan as the Worker stores it: decoded (rotation applied to the pixels), at most 2000 px on its long side, re-encoded as JPEG
 * on a canvas, so no metadata of the original file travels. The original never leaves the device.
 */
export async function prepareScan(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error(`${file.name} could not be read as an image.`); }
  try {
    let blob = await jpegOf(bitmap, SCAN_EDGE, SCAN_QUALITIES[0]!);
    for (const quality of SCAN_QUALITIES.slice(1)) if (blob.size > 1_400_000) blob = await jpegOf(bitmap, SCAN_EDGE, quality);
    const scale = Math.min(1, SCAN_EDGE / Math.max(bitmap.width, bitmap.height));
    return { blob, width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) };
  } finally { bitmap.close(); }
}

/* ---------- Owner: add or replace one person's scans ---------- */

/**
 * Two pickers (front, back) with previews; nothing is sent until Save. `expected` is the card the owner is looking at
 * (null for none), so a change someone else made meanwhile is never overwritten.
 */
export function cardForm(host: HTMLElement, person: Who, expected: string | null, onSaved: () => Promise<void>, onCancel: () => void): void {
  const chosen: Partial<Record<Side, { file: File; preview: string }>> = {};
  const pick = (which: Side) => html`<div class="scan-pick">
      <label class="scan-pick__tile" for="pick-${which}">${chosen[which] ? html`<img src="${chosen[which]!.preview}" alt="Chosen ${which} scan" />` : html`${icon("camera")}<span>Choose the ${which}</span>`}</label>
      <input class="visually-hidden" id="pick-${which}" type="file" accept="image/png,image/jpeg,image/webp" data-pick="${which}" />
      <p class="field__hint">${chosen[which]?.file.name ?? `${which === "front" ? "Front" : "Back"} of the card`}</p></div>`;
  const draw = (busy = false) => mount(host, html`<form class="form scan-form" novalidate>
      <p class="field__hint">${expected ? "The new scans replace the current ones for good." : "Add both sides of the official USC ID."} PNG, JPEG or WebP; it is re-encoded on this device before upload.</p>
      <div class="scan-picks">${pick("front")}${pick("back")}</div>
      <div class="form-alert" role="alert" hidden data-alert></div>
      <div class="form-actions form-actions--start"><button class="button button--primary" type="submit" ${busy || !chosen.front || !chosen.back ? "disabled" : ""}>${busy ? "Saving…" : "Save scans"}</button>
      <button class="button button--ghost" type="button" data-cancel ${busy ? "disabled" : ""}>Cancel</button></div></form>`);
  draw();
  host.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    const which = input.dataset.pick as Side | undefined;
    const file = input.files?.[0];
    if (!which || !file) return;
    chosen[which] = { file, preview: await dataUrl(file) };
    draw();
    host.querySelector<HTMLElement>(`label[for="pick-${which}"]`)?.focus();
  });
  host.addEventListener("click", (event) => { if ((event.target as HTMLElement).closest("[data-cancel]")) onCancel(); });
  host.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!chosen.front || !chosen.back) return;
    draw(true);
    try {
      const form = new FormData();
      for (const which of ["front", "back"] as const) {
        form.set(which, (await prepareScan(chosen[which]!.file)).blob, `${which}.jpg`);
        form.set(which === "front" ? "sourceFront" : "sourceBack", chosen[which]!.file.name);
      }
      form.set("expected", expected ?? "");
      await api(`/api/staff/admin/directory/${person.id}/id`, { method: "PUT", body: form });
      toast(expected ? "ID scans replaced." : "ID scans added.");
      await onSaved();
    } catch (error) {
      draw();
      setMessage(host.querySelector<HTMLElement>("[data-alert]")!, failure(error));
    }
  });
}

/* ---------- Owner: import an archive ---------- */

type Existing = Map<string, { hasId: boolean }>;
type Outcome = { pair: Pair; status: "waiting" | "working" | "imported" | "exists" | "failed"; message?: string };

const hashOf = async (file: File) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const departmentName = (code: string) => DEPARTMENTS[code as DepartmentCode] ?? code;

/**
 * The import, in the sheet `host`: choose the downloaded Official IDs folder (or files) → a preflight that reads only names and
 * hashes on this device → the owner reviews it → only the complete, unambiguous pairs not already in the directory are sent,
 * one at a time. Everything else stays on the device, listed for a person to sort out.
 */
export function importArchive(host: HTMLElement, existing: Existing, done: () => Promise<void>): void {
  let files = new Map<string, File>();
  let report: Preflight | null = null;
  let outcomes: Outcome[] = [];
  let running = false;

  const choose = () => mount(host, html`<div class="import">
      <p>Download the <strong>Official IDs</strong> folder from Google Drive and unzip it, then choose that folder here. You can also choose scan files directly.</p>
      <ul class="import__rules">
        <li>Scans are paired by name, department code and side (<span class="mono">Name_Front_DoL.png</span>, <span class="mono">Name_Back_DoL.png</span>); never by surname alone.</li>
        <li>Files in <span class="mono">OFFICERS</span> keep the department in their name, with officer status beside it.</li>
        <li>Nothing is uploaded until you have reviewed the check and pressed Import. Scans that need a person to look at them are left out.</li>
      </ul>
      <div class="form-actions form-actions--start">
        <label class="button button--primary" for="import-folder">${icon("stack")}Choose folder</label>
        <label class="button button--secondary" for="import-files">Choose files</label>
      </div>
      <input class="visually-hidden" id="import-folder" type="file" webkitdirectory multiple data-files />
      <input class="visually-hidden" id="import-files" type="file" multiple accept="image/png,image/jpeg,image/webp" data-files />
      <p class="import__status" role="status" data-status></p>
    </div>`);

  const ready = () => (report?.pairs ?? []).filter((pair) => !existing.get(pair.key)?.hasId);
  const already = () => (report?.pairs ?? []).filter((pair) => existing.get(pair.key)?.hasId);

  const issueList = (kind: IssueKind) => {
    const issues = report!.issues.filter((issue) => issue.kind === kind);
    if (!issues.length) return "";
    return html`<details class="import__issues" open><summary><strong>${ISSUE_KINDS[kind]}</strong> <span class="chip__count">${issues.length}</span></summary>
      <ul>${issues.map((issue) => html`<li><p>${issue.detail}</p><p class="mono muted">${issue.files.join(" · ")}</p></li>`)}</ul></details>`;
  };
  const pairRows = (pairs: Pair[]) => html`<ul class="import__pairs">${pairs.map((pair) => html`<li><span class="dept-dot dept-${pair.department}" aria-hidden="true"></span>
      <span><strong>${pair.identity}</strong><span class="muted"> · ${departmentName(pair.department)}</span></span>${pair.officer ? html`<span class="tag tag--gold">Officer</span>` : ""}</li>`)}</ul>`;

  const review = () => {
    const issues = report!.issues.length;
    const count = ready().length;
    mount(host, html`<div class="import">
      <dl class="stat-strip stat-strip--import">
        <div class="stat"><dt>Files</dt><dd><span class="stat__value">${report!.files}</span></dd></div>
        <div class="stat"><dt>Ready</dt><dd><span class="stat__value">${count}</span><span class="stat__note">complete pairs</span></dd></div>
        <div class="stat ${issues ? "stat--warn" : ""}"><dt>Need review</dt><dd><span class="stat__value">${issues}</span><span class="stat__note">left out</span></dd></div>
        <div class="stat"><dt>Already here</dt><dd><span class="stat__value">${already().length}</span><span class="stat__note">skipped</span></dd></div>
      </dl>
      ${issues ? html`<section aria-labelledby="needs-review"><h3 class="section-label" id="needs-review">Needs a person before it can be imported</h3>
        <p class="field__hint">Fix these in a copy of the folder (for example rename <span class="mono">Cruz_Front_DoL.png</span> to <span class="mono">Cruz_J_Front_DoL.png</span>) and import again; they are never guessed.</p>
        ${(Object.keys(ISSUE_KINDS) as IssueKind[]).map(issueList)}</section>` : html`<p class="callout callout--review">${icon("check")}<span>The check is clean: every scan forms a complete Front/Back pair.</span></p>`}
      ${count ? html`<section aria-labelledby="ready-title"><h3 class="section-label" id="ready-title">Ready to import (${count})</h3>${pairRows(ready())}</section>` : ""}
      ${already().length ? html`<details class="import__issues"><summary><strong>Already in the directory</strong> <span class="chip__count">${already().length}</span></summary>${pairRows(already())}</details>` : ""}
      ${report!.ignored.length ? html`<p class="field__hint">${plural(report!.ignored.length, "system file")} skipped (such as .DS_Store or desktop.ini).</p>` : ""}
      <div class="form-actions form-actions--start">
        <button type="button" class="button button--primary" data-run ${count ? "" : "disabled"}>${count ? `Import ${plural(count, "pair")}` : "Nothing to import"}</button>
        <button type="button" class="button button--ghost" data-again>Choose another folder</button>
      </div></div>`);
  };

  const progress = () => {
    const finished = outcomes.filter((entry) => entry.status !== "waiting" && entry.status !== "working").length;
    const failed = outcomes.filter((entry) => entry.status === "failed");
    const label: Record<Outcome["status"], string> = { waiting: "Waiting", working: "Uploading…", imported: "Imported", exists: "Already there", failed: "Failed" };
    const tone: Record<Outcome["status"], string> = { waiting: "", working: "tag--pending", imported: "tag--ok", exists: "", failed: "tag--bad" };
    mount(host, html`<div class="import">
      <div class="import__progress"><label for="import-progress">${running ? `Importing ${finished + 1} of ${outcomes.length}…` : `Finished: ${plural(outcomes.filter((entry) => entry.status === "imported").length, "pair")} imported${failed.length ? `, ${failed.length} failed` : ""}.`}</label>
        <progress id="import-progress" max="${outcomes.length}" value="${finished}"></progress></div>
      <ul class="import__pairs">${outcomes.map((entry) => html`<li><span class="dept-dot dept-${entry.pair.department}" aria-hidden="true"></span>
        <span><strong>${entry.pair.identity}</strong><span class="muted"> · ${entry.pair.department}</span>${entry.message ? html`<span class="cell-sub">${entry.message}</span>` : ""}</span><span class="tag ${tone[entry.status]}">${label[entry.status]}</span></li>`)}</ul>
      ${running ? "" : html`<p class="field__hint">Scans that needed review were not sent. Every import is recorded in Activity under Staff Directory.</p>
        <div class="form-actions form-actions--start">${failed.length ? html`<button type="button" class="button button--secondary" data-retry>Retry failed</button>` : ""}<button type="button" class="button button--primary" data-close>Done</button></div>`}</div>`);
  };

  async function run(entries: Outcome[]): Promise<void> {
    running = true;
    for (const entry of entries) {
      entry.status = "working";
      entry.message = undefined;
      progress();
      try {
        const form = new FormData();
        form.set("identity", entry.pair.identity);
        form.set("department", entry.pair.department);
        form.set("officer", entry.pair.officer ? "1" : "0");
        for (const which of ["front", "back"] as const) {
          const source = entry.pair[which];
          form.set(which, (await prepareScan(files.get(source.path)!)).blob, `${which}.jpg`);
          form.set(which === "front" ? "sourceFront" : "sourceBack", source.path);
        }
        const result = await api<{ status: "imported" | "exists" }>("/api/staff/admin/directory/import", { method: "POST", body: form });
        entry.status = result.status;
      } catch (error) {
        entry.status = "failed";
        entry.message = failure(error);
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) break;
      }
    }
    running = false;
    progress();
    await done();
  }

  host.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.hasAttribute("data-files") || !input.files?.length) return;
    const chosen = [...input.files];
    const status = host.querySelector<HTMLElement>("[data-status]")!;
    files = new Map();
    const listed = [];
    // Hashes let identical copies (a department folder and OFFICERS) count once; they are computed here and never sent.
    for (const [index, file] of chosen.entries()) {
      status.textContent = `Checking ${index + 1} of ${chosen.length}…`;
      const path = file.webkitRelativePath || file.name;
      files.set(path, file);
      listed.push({ path, size: file.size, hash: file.size <= 25 * 1024 * 1024 ? await hashOf(file) : undefined });
    }
    report = preflight(listed);
    review();
    host.querySelector<HTMLElement>("[data-run]:not([disabled])")?.focus();
  });
  host.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-again]")) choose();
    if (target.closest("[data-run]") && !running) {
      outcomes = ready().map((pair) => ({ pair, status: "waiting" }));
      void run(outcomes);
    }
    if (target.closest("[data-retry]") && !running) void run(outcomes.filter((entry) => entry.status === "failed"));
  });
  choose();
}

/** "Imported 3 Oct 2026 by Alex Reyes from Name_Front_DEM.png and Name_Back_DEM.png." */
export function cardSource(card: Card): Html {
  const sources = [card.sourceFront, card.sourceBack].filter(Boolean).map((source) => source!.split("/").at(-1));
  return html`Added ${formatDateTime(card.createdAt)}${card.createdBy ? ` by ${card.createdBy}` : ""}${sources.length ? html` from <span class="mono">${sources.join(" and ")}</span>` : ""}.`;
}
