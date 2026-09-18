import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { getLiveReviewFile, type ReviewRow } from "./file-review";
import { renderReviewPath } from "./file-review-path";

function row(path = "Notes/Teaching /Résumé & 筆記 #1.md"): ReviewRow {
  return { id: "test", workflow: "clippings", sourcePath: "History.md", processed: "2026-09-18", original: "Input", recordedPath: path, currentPath: path,
    file: { path } as TFile, state: "Available", label: "Clippings", history: [] };
}
function dom() {
  const listeners = new Map<string, (event: any) => void>();
  const element = { addEventListener: (name: string, handler: (event: any) => void) => listeners.set(name, handler) };
  const createEl = vi.fn(() => element);
  return { parent: { createEl } as unknown as HTMLElement, createEl, listeners };
}
describe("current document path links", () => {
  it("renders the exact path as a focusable link and activates by click or Enter", () => {
    const d = dom(), record = row(), open = vi.fn();
    renderReviewPath(d.parent, record, open);
    expect(d.createEl).toHaveBeenCalledWith("a", expect.objectContaining({ text: record.currentPath, attr: expect.objectContaining({ role: "link", tabindex: "0" }) }));
    const preventDefault = vi.fn();
    d.listeners.get("click")!({ preventDefault });
    d.listeners.get("keydown")!({ key: "Enter", preventDefault });
    d.listeners.get("keydown")!({ key: "Tab", preventDefault });
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenCalledWith(record);
  });
  it("renders missing or relocated targets without a link or keyboard action", () => {
    for (const record of [{ ...row(), file: null }, { ...row(), currentPath: "Old/path.md" }]) {
      const d = dom(); renderReviewPath(d.parent, record, vi.fn());
      expect(d.createEl).toHaveBeenCalledWith("span", expect.objectContaining({ attr: expect.objectContaining({ "aria-disabled": "true" }) }));
      expect(d.listeners.size).toBe(0);
    }
  });
  it("opens only the exact existing file identity, including Unicode, spaces and non-Markdown targets", () => {
    for (const path of ["Notes/Teaching /Résumé & 筆記 #1.md", "Attachments/Graph α.svg"]) {
      const r = row(path);
      const resolve = vi.fn(() => r.file);
      const app = { vault: { getAbstractFileByPath: resolve } } as unknown as App;
      expect(getLiveReviewFile(app, r)).toBe(r.file);
      expect(resolve).toHaveBeenCalledWith(path);
      resolve.mockReturnValue({ path } as TFile);
      expect(getLiveReviewFile(app, r)).toBeNull();
      resolve.mockReturnValue(null);
      expect(getLiveReviewFile(app, r)).toBeNull();
    }
  });
  it("rejects a stale path after a move and opens the refreshed current path", () => {
    const r = row(); const file = r.file!;
    const app = { vault: { getAbstractFileByPath: (p: string) => p === file.path ? file : null } } as unknown as App;
    file.path = "Moved/新しい note.md";
    expect(getLiveReviewFile(app, r)).toBeNull();
    const refreshed = { ...r, currentPath: file.path };
    expect(getLiveReviewFile(app, refreshed)).toBe(file);
    const d = dom(); renderReviewPath(d.parent, refreshed, vi.fn());
    expect(d.createEl).toHaveBeenCalledWith("a", expect.objectContaining({ text: file.path }));
  });
});
