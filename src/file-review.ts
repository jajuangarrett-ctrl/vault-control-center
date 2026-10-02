import type { App, TFile } from "obsidian";
import { isExcludedPath, isSensitivePath } from "./data";
import type { ReviewIdentity } from "./file-review-identity";

export const REVIEW_RECORDS_PATH = "Artifacts/Vault Control Center Native Plugin/File Review Records.json";
export interface ReviewSource { id: string; path: string; section: string; column: string; intake?: string }
export const REVIEW_SOURCES: readonly ReviewSource[] = [
  { id: "vault-folder-processing", path: "Artifacts/Vault Folder Processing Workflow/Vault Folder Processing Dashboard.md", section: "Organization History", column: "Destination" },
  { id: "clippings", path: "Clippings/Clippings Processing Dashboard.md", section: "Complete Processing History", column: "Filed record", intake: "Clippings" },
  { id: "root-inbox", path: "00 Inbox/Inbox Processing Dashboard.md", section: "Complete Processing History", column: "Filed record", intake: "00 Inbox" },
  { id: "mira-email-filing", path: "AI Team/Mira Emails/Processed Emails/Mira Email Processing Dashboard.md", section: "Processed Email History", column: "Filed record", intake: "AI Team/Mira Emails" },
  { id: "iflytek-notes", path: "00 Inbox/Iflytex Notes/Processed/iFLYTEK Notes Processing Dashboard.md", section: "Formatted Note History", column: "Formatted note" },
  { id: "youtube-notes", path: "00 Inbox/YouTube Videos to Process/Processed YT Videos/YouTube Processing Dashboard.md", section: "Processing History", column: "Formatted note" },
  { id: "fjg-capture-transcripts", path: "00 Inbox/FJG Capture Transcripts/Processed/FJG Capture Transcripts Processing Dashboard.md", section: "Formatted Note History", column: "Formatted note" },
  { id: "formatted-notes-filing", path: "AI Team/Formatted_Notes/Formatted Notes Filing Dashboard.md", section: "Filing History", column: "Filed note", intake: "AI Team/Formatted_Notes" },
  { id: "vocci-notes-processing", path: "Artifacts/Vocci Notes Processing Workflow/Vocci Notes Processing Dashboard.md", section: "Processing History", column: "Verbatim Vocci note" },
];
export interface ReviewRecord {
  id: string; workflow: string; processed: string; original: string; recordedPath: string;
  dismissed?: boolean; dismissalUpdatedAt?: number;
  identity?: ReviewIdentity; identityUpdatedAt?: number; locationEvidence?: string;
  sourcePath: string; fromPath?: string; currentPath?: string; unavailable?: boolean; locationUpdatedAt?: number;
}
export interface ReviewRow extends ReviewRecord { label: string; file: TFile | null; state: string; history: ReviewRecord[] }
export interface ReviewCoverage { label: string; path?: string; message: string }
export interface FileReviewSnapshot { rows: ReviewRow[]; dismissedRows: ReviewRow[]; coverage: ReviewCoverage[]; message: string }
export const emptyFileReview = (): FileReviewSnapshot => ({ rows: [], dismissedRows: [], coverage: [], message: "Loading inbox files…" });

/** Exact vault-relative paths only; preserve significant spaces inside folder names. */
export function reviewPath(raw: string, vaultName = "FJG Vault"): string | null {
  let path = raw.trim().replace(/\\\|/g, "|");
  // Historical producers emitted absolute paths on either Mac. Only accept the known vault boundary.
  if (path.startsWith("/")) {
    const marker = `/${vaultName}/`;
    const at = path.indexOf(marker);
    if (at < 0) return null;
    path = path.slice(at + marker.length);
  }
  if (!path || /[\\\x00-\x1f]/.test(path) || /^[a-z]+:/i.test(path) || path.split("/").some(p => !p || p === "." || p === "..") || isExcludedPath(path) || isSensitivePath(path)) return null;
  return path;
}
const cells = (line: string) => line.trim().slice(1, -1).split(/(?<!\\)\|/).map(x => x.trim().replace(/\\\|/g, "|"));
export function parseReviewTable(markdown: string, source: ReviewSource, vaultName?: string): ReviewRecord[] {
  let inSection = false;
  let headers: string[] = [];
  const records: ReviewRecord[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith("## ")) { inSection = line.slice(3).trim() === source.section; headers = []; continue; }
    if (!inSection || !line.trim().startsWith("|") || !line.trim().endsWith("|")) continue;
    const row = cells(line);
    if (!headers.length) { headers = row; continue; }
    const processed = row[headers.indexOf("Processed")];
    const target = row[headers.indexOf(source.column)];
    if (!processed || !/^\d{4}-\d{2}-\d{2}/.test(processed) || !target) continue;
    const link = target.match(/^\[\[(.*?)(?:\|.*?)?\]\]$/)?.[1];
    if (!link) continue;
    const path = reviewPath(/\.[a-z0-9]+$/i.test(link) ? link : `${link}.md`, vaultName);
    if (!path) continue;
    const originalIndex = headers.findIndex(h => /^(Original|Video|Vocci session)/.test(h));
    const original = (row[originalIndex] ?? "Recorded output").replace(/^`|`$/g, "");
    const fromPath = source.intake ? reviewPath(`${source.intake}/${original}`, vaultName) ?? undefined
      : source.id === "vault-folder-processing" ? reviewPath(original, vaultName) ?? undefined : undefined;
    records.push({ id: JSON.stringify([source.id, processed, original]), workflow: source.id, processed, original, recordedPath: path, sourcePath: source.path, fromPath });
  }
  return records;
}

export function resolveReviewPath(record: ReviewRecord, records: ReviewRecord[]): string {
  let path = record.currentPath ?? record.recordedPath;
  const seen = new Set<string>();
  // Follow only explicit, unambiguous filing history, never basename searches.
  while (!seen.has(path)) {
    seen.add(path);
    const destinations = new Set(records.filter(r => r.fromPath === path && r.processed >= record.processed).map(r => r.currentPath ?? r.recordedPath));
    if (destinations.size !== 1) break;
    path = [...destinations][0];
  }
  return path;
}

export const REVIEW_INBOXES = [
  { path: "AI Team/Formatted_Notes", label: "Formatted Notes" },
  { path: "AI Team/Team_Inbox", label: "Team Inbox" },
  { path: "AI Team/owner_inbox", label: "Owner Inbox" },
] as const;

/** Segment boundary, not a prefix or filename match. All descendants are included. */
export function reviewInbox(path: string) {
  return REVIEW_INBOXES.find(root => path.startsWith(`${root.path}/`));
}

/** Include ancestor folder events, since renaming AI Team can move all watched files. */
export function affectsFileReview(path: string): boolean {
  return REVIEW_INBOXES.some(root => path === root.path || path.startsWith(`${root.path}/`) || root.path.startsWith(`${path}/`));
}

export function filterReviewRows(snapshot: FileReviewSnapshot, query: string, folder: string): ReviewRow[] {
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return snapshot.rows.filter(row => (!folder || row.sourcePath === folder) &&
    words.every(word => `${row.currentPath} ${row.label}`.toLocaleLowerCase().includes(word)));
}

/** Membership comes solely from Obsidian's current inventory; no content reads or journal writes. */
export class FileReviewStore {
  snapshot: FileReviewSnapshot = emptyFileReview();
  constructor(private app: App) {}
  refresh(): Promise<FileReviewSnapshot> {
    const seen = new Set<string>();
    const rows: ReviewRow[] = [];
    for (const file of this.app.vault.getFiles()) {
      const root = reviewInbox(file.path);
      if (!root || seen.has(file.path)) continue;
      seen.add(file.path);
      rows.push({ id: file.path, workflow: root.path, sourcePath: root.path,
        recordedPath: file.path, currentPath: file.path, original: file.name,
        processed: "", label: root.label, file, state: "Awaiting filing", history: [] });
    }
    rows.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.currentPath!.localeCompare(b.currentPath!));
    const coverage = REVIEW_INBOXES.map(root => ({ ...root,
      message: this.app.vault.getFolderByPath(root.path)
        ? `${rows.filter(row => row.sourcePath === root.path).length} files, including subfolders.`
        : "Folder is unavailable on this device." }));
    this.snapshot = { rows, dismissedRows: [], coverage,
      message: "Current files in these three inboxes, including every subfolder. Moving outside all three removes a file from review." };
    return Promise.resolve(this.snapshot);
  }
  async moved(_file: TFile, _oldPath: string): Promise<void> { await this.refresh(); }
}
export function isFile(value: unknown): value is TFile { return !!value && typeof value === "object" && "stat" in value && "extension" in value; }

export interface LocateSelection { file: TFile; stamp: string }
export interface MoveSelection { file: TFile; path: string; ctime: number }
const moving = new WeakSet<TFile>();
export async function moveReviewedFile(app: App, selected: MoveSelection, folder: string | null): Promise<string> {
  if (folder === null) return "Move canceled.";
  const { file, path, ctime } = selected;
  if (moving.has(file)) throw new Error("A move is already in progress for this file.");
  if (file.path !== path || file.stat.ctime !== ctime || app.vault.getAbstractFileByPath(path) !== file) throw new Error("This file changed location or was replaced. Refresh File review and select it again.");
  if (folder !== "" && (!reviewPath(folder) || !app.vault.getFolderByPath(folder))) throw new Error("The selected folder no longer exists or is unavailable.");
  if (!reviewPath(path) && !reviewInbox(path)) throw new Error("This file is not available for review.");
  const destination = folder ? `${folder}/${file.name}` : file.name;
  if (destination === path) return "The file is already in that folder.";
  if (app.vault.getAbstractFileByPath(destination)) throw new Error("A file or folder with this name already exists there. Nothing was overwritten.");
  moving.add(file);
  try {
    // FileManager preserves Obsidian's configured link-update behavior and rejects collisions.
    await app.fileManager.renameFile(file, destination);
    return `Moved to ${destination}`;
  } finally { moving.delete(file); }
}

/** Resolve the displayed current path without trimming meaningful folder spaces. */
export function getLiveReviewFile(app: App, row: ReviewRow): TFile | null {
  const path = row.currentPath ?? row.recordedPath;
  const file = row.file;
  return file && file.path === path && (reviewPath(path) === path || !!reviewInbox(path)) &&
    app.vault.getAbstractFileByPath(path) === file ? file : null;
}
