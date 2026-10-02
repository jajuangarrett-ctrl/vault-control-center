import { App, FuzzySuggestModal, Notice, TFolder } from "obsidian";
import { FileReviewStore, moveReviewedFile, reviewPath, type MoveSelection, type ReviewRow } from "./file-review";

export class FileReviewFolderModal extends FuzzySuggestModal<TFolder> {
  private selected: MoveSelection;
  constructor(app: App, row: ReviewRow, private store: FileReviewStore, private refreshed: () => void) {
    super(app);
    this.selected = { file: row.file!, path: row.currentPath ?? row.recordedPath, ctime: row.file!.stat.ctime };
    this.setPlaceholder(`Move ${row.file!.name} — search destination folders`);
    this.setInstructions([{ command: "↑↓", purpose: "Choose folder" }, { command: "↵", purpose: "Move file" }, { command: "esc", purpose: "Cancel" }]);
  }
  getItems(): TFolder[] {
    return [this.app.vault.getRoot(), ...this.app.vault.getAllFolders().filter(f => f.path !== "/" && !!reviewPath(f.path))].sort((a,b) => a.path.localeCompare(b.path));
  }
  getItemText(folder: TFolder): string { return folder.isRoot() ? "(vault root)" : folder.path; }
  onChooseItem(folder: TFolder): void { void this.move(folder); }
  private async move(folder: TFolder): Promise<void> {
    try {
      const result = await moveReviewedFile(this.app, this.selected, folder.isRoot() ? "" : folder.path);
      new Notice(result);
      await this.store.moved(this.selected.file, this.selected.path);
    } catch (error) { new Notice(error instanceof Error ? error.message : "The file could not be moved. Refresh and try again.", 8000); }
    this.refreshed();
  }
}
