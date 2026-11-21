import { createButton, createControlButton, createEmptyState, createIcon, formatRelativeTime } from "./dom";
import type { CatalogPage, CatalogSnapshot } from "./html-viewer-catalog";

const PAGE_SIZE = 30;
const THUMBNAIL_CONCURRENCY = 3;

export interface HtmlCatalogControls {
  catalog: CatalogSnapshot;
  query: string;
  mobile: boolean;
  page: number;
  generating: boolean;
  onPage(page: number): void;
  refresh(): void;
  generate(): void;
  open(path: string): void;
  thumbnail(path: string): Promise<string | null>;
}

const CATALOG_MESSAGES = {
  loading: ["Loading HTML Viewer catalog…", "Waiting for the HTML Viewer plugin."],
  unavailable: ["HTML Viewer is not active", "Enable HTML Viewer in Obsidian’s Community plugins, then refresh this tab."],
  incompatible: ["HTML Viewer needs an update", "Update the HTML Viewer plugin to a version with catalog support, then refresh."],
  error: ["Could not load the HTML Viewer catalog", "Try refreshing the catalog. Vault Control Center will not substitute a separate vault-wide list."],
};

export function renderHtmlCatalog(parent: HTMLElement, controls: HtmlCatalogControls): (() => void) | undefined {
  const { catalog } = controls;
  const toolbar = parent.createDiv({ cls: "fjg-vcc-html-toolbar" });
  const copy = toolbar.createDiv({ cls: "fjg-vcc-html-toolbar-copy" });
  copy.createEl("h2", { text: "HTML Viewer catalog", attr: { tabindex: "-1" } });
  copy.createEl("p", { text: "Uses HTML Viewer’s HTML pages and exclusions." });
  const toolbarActions = toolbar.createDiv({ cls: "fjg-vcc-html-toolbar-actions" });
  createButton(toolbarActions, {
    label: "Refresh catalog", icon: "refresh-cw", className: "fjg-vcc-button",
    disabled: catalog.status === "loading", onClick: controls.refresh,
  });
  // Retain the existing explicit desktop operation, subject to its separately
  // configured trusted home-page list. Loading or searching this tab never invokes it.
  if (!controls.mobile && catalog.status === "ready") createButton(toolbarActions, {
    label: controls.generating ? "Updating previews…" : "Update previews",
    title: "Regenerate previews for configured HTML home pages on this Mac.",
    icon: controls.generating ? "loader-circle" : "images",
    className: "fjg-vcc-button",
    disabled: controls.generating,
    onClick: controls.generate,
  });

  if (catalog.status !== "ready") {
    const [title, message] = CATALOG_MESSAGES[catalog.status];
    createEmptyState(parent, title, message, "panels-top-left");
    return;
  }

  if (catalog.missing || catalog.capped) parent.createEl("p", {
    cls: "fjg-vcc-html-catalog-status",
    text: [
      catalog.missing ? `${catalog.missing} catalog page${catalog.missing === 1 ? " is" : "s are"} not available on this device.` : "",
      catalog.capped ? "Only the first 10,000 catalog entries are shown." : "",
    ].filter(Boolean).join(" "),
  });
  const terms = controls.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const items = catalog.items.filter((item) => {
    const label = `${item.title}\n${item.path}`.toLocaleLowerCase();
    return terms.every((term) => label.includes(term));
  });
  if (!items.length) {
    createEmptyState(parent, terms.length ? "No HTML pages match" : "No pages in this catalog",
      terms.length ? "Try another search." : "Check the HTML Viewer chooser and its exclusions.", "panels-top-left");
    return;
  }

  const endPage = Math.floor((items.length - 1) / PAGE_SIZE);
  const page = Math.max(0, Math.min(endPage, controls.page));
  const start = page * PAGE_SIZE;
  const grid = parent.createDiv({
    cls: `fjg-vcc-html-grid${controls.mobile ? " is-compact" : ""}`,
    attr: { "aria-label": "HTML Viewer pages" },
  });
  const thumbnails = lazyCatalogThumbnails(grid, controls.thumbnail);
  for (const item of items.slice(start, start + PAGE_SIZE)) renderCard(grid, item, controls, thumbnails.observe);

  const pager = parent.createDiv({ cls: "fjg-vcc-html-pager" });
  if (endPage) createButton(pager, {
    label: "Previous", icon: "chevron-left", className: "fjg-vcc-button",
    disabled: page === 0, onClick: () => controls.onPage(page - 1),
  });
  pager.createSpan({ text: `${start + 1}–${Math.min(start + PAGE_SIZE, items.length)} of ${items.length} pages` });
  if (endPage) createButton(pager, {
    label: "Next", icon: "chevron-right", className: "fjg-vcc-button",
    disabled: page === endPage, onClick: () => controls.onPage(page + 1),
  });
  return thumbnails.dispose;
}

function renderCard(
  grid: HTMLElement, item: CatalogPage, controls: HtmlCatalogControls,
  observe: (host: HTMLElement, path: string, fallback: HTMLElement) => void,
): void {
  const card = createControlButton(grid, {
    cls: "fjg-vcc-html-card",
    attr: { type: "button", "aria-label": `Open ${item.title} in Obsidian`, "data-file-path": item.path },
  });
  const thumbnail = card.createDiv({ cls: "fjg-vcc-html-thumbnail", attr: { "aria-hidden": "true" } });
  const fallback = thumbnail.createDiv({ cls: "fjg-vcc-html-thumbnail-placeholder" });
  createIcon(fallback, "panels-top-left");
  fallback.createSpan({ text: "HTML" });
  fallback.createEl("small", { text: "No saved preview" });
  observe(thumbnail, item.path, fallback);

  const copy = card.createDiv({ cls: "fjg-vcc-html-card-copy" });
  copy.createSpan({ cls: "fjg-vcc-html-card-title", text: item.title });
  const meta = copy.createDiv({ cls: "fjg-vcc-html-card-meta" });
  meta.createSpan({ text: item.path });
  if (item.modifiedAt > 0) meta.createSpan({ text: formatRelativeTime(item.modifiedAt) });
  card.addEventListener("click", () => controls.open(item.path));
}

function lazyCatalogThumbnails(parent: HTMLElement, read: HtmlCatalogControls["thumbnail"]) {
  type Thumbnail = { host: HTMLElement; path: string; fallback: HTMLElement };
  const pending: Thumbnail[] = [];
  const observed = new Map<Element, Thumbnail>();
  const IO = (parent.ownerDocument.defaultView as (Window & { IntersectionObserver?: typeof IntersectionObserver }) | null)?.IntersectionObserver;
  let disposed = false;
  let active = 0;
  let fallbackBudget = 6;
  const pump = () => {
    while (!disposed && active < THUMBNAIL_CONCURRENCY && pending.length) {
      const next = pending.shift()!;
      if (!next.host.isConnected) continue;
      active++;
      void Promise.resolve().then(() => disposed ? null : read(next.path)).then((url) => {
        if (disposed || !next.host.isConnected || !url?.startsWith("data:image/png;base64,")) return;
        const image = next.host.createEl("img", { attr: { alt: "", decoding: "async", loading: "lazy" } });
        image.addEventListener("load", () => { next.fallback.hidden = true; }, { once: true });
        image.addEventListener("error", () => image.remove(), { once: true });
        image.src = url;
      }).catch(() => { /* Keep the file-type placeholder. */ }).finally(() => { active--; pump(); });
    }
  };
  const observer = IO ? new IO((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const matching = observed.get(entry.target);
      if (!matching) continue;
      observed.delete(entry.target);
      observer?.unobserve(entry.target);
      pending.push(matching);
    }
    pump();
  }, { rootMargin: "64px 0px" }) : undefined;

  return {
    observe(host: HTMLElement, path: string, fallback: HTMLElement) {
      if (observer) {
        observed.set(host, { host, path, fallback });
        observer.observe(host);
      } else if (fallbackBudget-- > 0) {
        pending.push({ host, path, fallback });
        pump();
      }
    },
    dispose() {
      disposed = true;
      observer?.disconnect();
      pending.length = 0;
      observed.clear();
    },
  };
}
