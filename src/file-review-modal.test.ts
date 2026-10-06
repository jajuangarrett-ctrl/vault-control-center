import { describe, expect, it, vi } from "vitest";
import type { App, TFile, TFolder } from "obsidian";
import type { FileReviewStore } from "./file-review";

vi.mock("obsidian", () => ({
  FuzzySuggestModal: class {
    constructor(public app: App) {}
    setPlaceholder() {} setInstructions() {} onClose() {}
  },
  Notice: vi.fn(),
}));
import { FileReviewFolderModal } from "./file-review-modal";

function fixture() {
  const file = { name: "Disposable.md", path: "Source/Disposable.md", stat: { ctime: 1 } } as TFile;
  const folder = { path: "Target", isRoot: () => false } as TFolder;
  const files = new Map<string, unknown>([[file.path, file], [folder.path, folder]]);
  const renameFile = vi.fn(async (_file: TFile, path: string) => {
    files.delete(file.path); file.path = path; files.set(path, file);
  });
  const app = { vault: { getAbstractFileByPath: (p: string) => files.get(p), getFolderByPath: (p: string) => p === "Target" ? folder : null }, fileManager: { renameFile } } as unknown as App;
  const store = { moved: vi.fn(async () => {}) } as unknown as FileReviewStore;
  const refresh = vi.fn(async () => {}), settle = vi.fn();
  const modal = new FileReviewFolderModal(app, { file, path: file.path, ctime: 1 }, store, refresh, settle);
  return { file, folder, files, renameFile, store, refresh, settle, modal };
}

describe("item destination picker lifecycle", () => {
  it("cancels without moving and releases the item button once", async () => {
    const f = fixture(); f.modal.onClose(); f.modal.onClose();
    await vi.waitFor(() => expect(f.settle).toHaveBeenCalledOnce());
    expect(f.renameFile).not.toHaveBeenCalled();
    expect(f.refresh).not.toHaveBeenCalled();
  });
  it("moves only the selected item, suppresses repeated selection, and waits for refresh", async () => {
    const f = fixture(); let finish!: () => void;
    f.refresh.mockImplementation(() => new Promise<void>(r => { finish = r; }));
    f.modal.onChooseItem(f.folder); f.modal.onChooseItem(f.folder); f.modal.onClose();
    await vi.waitFor(() => expect(f.refresh).toHaveBeenCalledOnce());
    expect(f.renameFile).toHaveBeenCalledExactlyOnceWith(f.file, "Target/Disposable.md");
    expect(f.store.moved).toHaveBeenCalledExactlyOnceWith(f.file, "Source/Disposable.md");
    expect(f.settle).not.toHaveBeenCalled();
    finish(); await vi.waitFor(() => expect(f.settle).toHaveBeenCalledOnce());
  });
  it("handles close-before-selection ordering without releasing an ongoing move", async () => {
    const f = fixture(); let finish!: () => void;
    f.renameFile.mockImplementation(() => new Promise<void>(r => { finish = r; }));
    f.modal.onClose(); f.modal.onChooseItem(f.folder);
    await Promise.resolve(); expect(f.settle).not.toHaveBeenCalled();
    finish(); await vi.waitFor(() => expect(f.settle).toHaveBeenCalledOnce());
  });
  it("refuses collisions and stale/deleted items, then refreshes and releases the button", async () => {
    for (const state of ["collision", "deleted", "moved"]) {
      const f = fixture();
      if (state === "collision") f.files.set("Target/Disposable.md", {});
      if (state === "deleted") f.files.delete(f.file.path);
      if (state === "moved") f.file.path = "Elsewhere/Disposable.md";
      f.modal.onChooseItem(f.folder);
      await vi.waitFor(() => expect(f.settle).toHaveBeenCalledOnce());
      expect(f.renameFile).not.toHaveBeenCalled(); expect(f.refresh).toHaveBeenCalledOnce();
    }
  });
  it("releases the button even if view refresh fails", async () => {
    const f = fixture(); f.refresh.mockRejectedValue(new Error("unmounted"));
    f.modal.onChooseItem(f.folder);
    await vi.waitFor(() => expect(f.settle).toHaveBeenCalledOnce());
    expect(f.renameFile).toHaveBeenCalledOnce();
  });
});
