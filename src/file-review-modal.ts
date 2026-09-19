import { fileStamp } from "./file-review-identity";
import { App, FuzzySuggestModal, Notice, TFolder } from "obsidian";
import { FileReviewStore, moveReviewedFile, reviewPath, REVIEW_RECORDS_PATH, type LocateSelection, type MoveSelection, type ReviewRow } from "./file-review";

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

/** Each displayed item captures its identity at listing time, before the user's choice. */
export class FileReviewLocateModal extends FuzzySuggestModal<LocateSelection> {
  constructor(app: App, private row: ReviewRow, private store: FileReviewStore, private refreshed: () => void) {
    super(app);
    this.row = { ...row, history: row.history.map(event => ({ ...event })) };
    this.setPlaceholder(`Locate ${row.currentPath ?? row.recordedPath} — choose its current file`);
    this.setInstructions([{ command: "↑↓", purpose: "Choose current file" }, { command: "↵", purpose: "Remember location" }, { command: "esc", purpose: "Cancel" }]);
  }
  getItems(): LocateSelection[] {
    return this.app.vault.getFiles().filter(file => !!reviewPath(file.path) && file.path !== REVIEW_RECORDS_PATH)
      .sort((a, b) => a.path.localeCompare(b.path)).map(file => ({ file, stamp: fileStamp(file) }));
  }
  getItemText(selection: LocateSelection): string { return JSON.parse(selection.stamp)[0]; }
  onChooseItem(selection: LocateSelection): void { void this.locate(selection); }
  private async locate(selection: LocateSelection): Promise<void> {
    try {
      await this.store.locate(this.row, selection);
      new Notice(`File review location saved: ${selection.file.path}`);
    } catch (error) { new Notice(error instanceof Error ? error.message : "The location could not be saved. Refresh and try again.", 8000); }
    this.refreshed();
  }
}
