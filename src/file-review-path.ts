import type { ReviewRow } from "./file-review";

/** Keep all activation in Obsidian rather than resolving a URL or ambiguous wikilink. */
export function renderReviewPath(
  parent: HTMLElement,
  row: ReviewRow,
  open: (row: ReviewRow) => void
): HTMLElement {
  const path = row.currentPath ?? row.recordedPath;
  if (!row.file || row.file.path !== path) {
    return parent.createEl("span", {
      cls: "fjg-vcc-review-path",
      text: path,
      attr: { "aria-disabled": "true", title: "File missing or moved; refresh File review." },
    });
  }
  const link = parent.createEl("a", {
    cls: "fjg-vcc-review-path fjg-vcc-review-path-link",
    text: path,
    attr: { role: "link", tabindex: "0", "aria-label": `Open ${path} in Obsidian`, title: "Open this file in an Obsidian tab" },
  });
  link.addEventListener("click", event => { event.preventDefault(); open(row); });
  link.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); open(row); }
  });
  return link;
}
