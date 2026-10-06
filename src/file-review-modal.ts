import { App, FuzzySuggestModal, Notice, TFolder } from "obsidian";
import { FileReviewStore, moveReviewedFile, reviewPath, type MoveSelection, type ReviewRow } from "./file-review";

export class FileReviewFolderModal extends FuzzySuggestModal<TFolder> {
  private selected: MoveSelection;
  private choosing = false;
  private finished = false;
  constructor(app: App, row: ReviewRow | MoveSelection, private store: FileReviewStore, private refreshed: () => void | Promise<void>, private settled: () => void = () => {}) {
    super(app);
    this.selected = "ctime" in row ? row : { file: row.file!, path: row.currentPath ?? row.recordedPath, ctime: row.file!.stat.ctime };
    this.setPlaceholder(`Move ${this.selected.file.name} — search destination folders`);
    this.setInstructions([{ command: "↑↓", purpose: "Choose folder" }, { command: "↵", purpose: "Move file" }, { command: "esc", purpose: "Cancel" }]);
  }
  getItems(): TFolder[] {
    return [this.app.vault.getRoot(), ...this.app.vault.getAllFolders().filter(f => f.path !== "/" && !!reviewPath(f.path))].sort((a,b) => a.path.localeCompare(b.path));
  }
  getItemText(folder: TFolder): string { return folder.isRoot() ? "(vault root)" : folder.path; }
  onChooseItem(folder: TFolder): void {
    if (this.choosing || this.finished) return;
    this.choosing = true;
    void this.move(folder);
  }
  onClose(): void {
    super.onClose();
    // Obsidian closes the picker around selection; allow onChooseItem to run first.
    queueMicrotask(() => { if (!this.choosing) this.finish(); });
  }
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.settled();
  }
  private async move(folder: TFolder): Promise<void> {
    try {
      const result = await moveReviewedFile(this.app, this.selected, folder.isRoot() ? "" : folder.path);
      new Notice(result);
      await this.store.moved(this.selected.file, this.selected.path);
    } catch (error) { new Notice(error instanceof Error ? error.message : "The file could not be moved. Refresh and try again.", 8000); }
    try { await this.refreshed(); }
    catch { new Notice("The file view could not refresh. Use Refresh files to rescan."); }
    finally { this.finish(); }
  }
}
