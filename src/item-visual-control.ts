import { ITEM_ICONS, type VisualItem, itemIconSvg, resolveItemIcon, searchItemIcons, suggestItemIcon } from "./item-icons";
import { api, failure, html, mount, raw, toast } from "./ui";

type EditableVisual = VisualItem & { id: string; updatedAt: string | null };

/** Item-only choices: the shared place picture panel keeps its own behavior. Choices save without editing stock. */
export function itemVisualControl(host: HTMLElement, current: () => EditableVisual, refresh: () => Promise<void>) {
  let busy = false;
  let picking = false;
  let error = "";
  let query = "";
  const choices = () => {
    const found = searchItemIcons(query);
    const selected = resolveItemIcon(current()).key;
    mount(host.querySelector("[data-icon-choices]")!, html`${found.map((entry) => html`<button type="button" class="icon-choice" data-icon-key="${entry.key}" aria-pressed="${entry.key === selected}" ${busy ? html`disabled` : ""}>${raw(itemIconSvg(entry.key))}<span>${entry.label}</span></button>`)}${found.length ? "" : html`<p class="field__hint">No icons match. Try paper, cleaning, kitchen or box.</p>`}`);
  };
  const render = () => {
    if (busy) return;
    const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
    const searchFocused = focused?.id === "item-icon-search";
    const item = current();
    const selected = resolveItemIcon(item).key;
    const suggestion = suggestItemIcon(item).key;
    const hasPhoto = Boolean(item.photoId);
    const photoActive = hasPhoto && item.visualType !== "SYSTEM_ICON";
    if (photoActive) picking = false;
    mount(host, html`<h3 class="form-section__title">Item picture</h3>
      <div class="photo-actions" role="group" aria-label="Item picture type">
        <button type="button" class="button button--secondary button--sm" data-visual-mode="SYSTEM_ICON" aria-pressed="${!photoActive}">System icon</button>
        <button type="button" class="button button--secondary button--sm" data-visual-mode="PHOTO" aria-pressed="${photoActive}">Real photo</button>
      </div>
      <div ${photoActive ? html`hidden` : ""}>
      <p class="visual-suggestion">${raw(itemIconSvg(selected))}<span>${ITEM_ICONS.find((icon) => icon.key === selected)!.label}${item.iconKey ? " · chosen icon" : " · automatic"}</span></p>
      <div class="photo-actions"><button type="button" class="button button--secondary button--sm" data-choose-icon aria-expanded="${picking}">Choose another icon</button>
        ${item.iconKey || selected !== suggestion ? html`<button type="button" class="button button--ghost button--sm" data-auto-icon>Use suggested icon</button>` : ""}</div>
      <div class="icon-picker" ${picking ? "" : html`hidden`}><label class="field-label" for="item-icon-search">Find a system icon</label>
        <input id="item-icon-search" type="search" value="${query}" placeholder="Paper, cleaning, cable…" autocomplete="off" />
        <div class="icon-choices" data-icon-choices role="group" aria-label="System icons"></div></div></div>
      <p class="form-alert" role="alert" ${error ? "" : html`hidden`}>${error}</p>`);
    if (picking) choices();
    if (searchFocused) host.querySelector<HTMLInputElement>("#item-icon-search")?.focus({ preventScroll: true });
  };
  const save = async (visualType: "SYSTEM_ICON" | "PHOTO", iconKey: string | null) => {
    if (busy) return;
    busy = true;
    error = "";
    const item = current();
    for (const button of host.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
    try {
      await api(`/api/staff/items/${encodeURIComponent(item.id)}/visual`, { method: "PATCH", body: JSON.stringify({ visualType, iconKey, updatedAt: item.updatedAt }) });
      picking = false;
      query = "";
      await refresh();
      toast("Item visual saved.");
    } catch (problem) { error = failure(problem); await refresh(); }
    finally { busy = false; render(); host.querySelector<HTMLButtonElement>(current().photoId && current().visualType !== "SYSTEM_ICON" ? "[data-visual-mode=PHOTO]" : "[data-choose-icon]")?.focus({ preventScroll: true }); }
  };
  host.addEventListener("input", (event) => {
    if ((event.target as HTMLElement).id !== "item-icon-search") return;
    event.stopPropagation();
    query = (event.target as HTMLInputElement).value;
    choices();
  });
  host.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button || busy) return;
    const item = current();
    if (button.hasAttribute("data-choose-icon")) { picking = !picking; render(); host.querySelector<HTMLInputElement>("#item-icon-search")?.focus(); }
    else if (button.hasAttribute("data-auto-icon")) void save("SYSTEM_ICON", null);
    else if (button.dataset.iconKey) void save("SYSTEM_ICON", `tabler:${button.dataset.iconKey}`);
    else if (button.dataset.visualMode === "SYSTEM_ICON") void save("SYSTEM_ICON", item.iconKey ?? null);
    else if (button.dataset.visualMode === "PHOTO") {
      if (item.photoId) void save("PHOTO", item.iconKey ?? null);
      else host.closest(".sheet")?.querySelector<HTMLButtonElement>("#photo-panel [data-pick]")?.click();
    }
  });
  render();
  return { render };
}
