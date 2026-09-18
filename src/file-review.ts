import type { App, TFile } from "obsidian";
import { FJG_AUTOMATION_ALLOWLIST } from "./automations";
import { isExcludedPath, isSensitivePath } from "./data";

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
  sourcePath: string; fromPath?: string; currentPath?: string; unavailable?: boolean; locationUpdatedAt?: number;
}
export interface ReviewRow extends ReviewRecord { label: string; file: TFile | null; state: string; history: ReviewRecord[] }
export interface ReviewCoverage { label: string; path?: string; message: string }
export interface FileReviewSnapshot { rows: ReviewRow[]; coverage: ReviewCoverage[]; message: string }
export const emptyFileReview = (): FileReviewSnapshot => ({ rows: [], coverage: [], message: "Loading recorded outputs…" });
const labelFor = (id: string) => FJG_AUTOMATION_ALLOWLIST.find(x => x.id === id)?.label ?? id;

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

export class FileReviewStore {
  snapshot: FileReviewSnapshot = emptyFileReview();
  private records = new Map<string, ReviewRecord>();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private bindings = new Map<string, TFile>();
  private unavailable = new Set<string>();
  constructor(private app: App) {}
  refresh(): Promise<FileReviewSnapshot> {
    const work = this.queue.then(() => this.load());
    this.queue = work.catch(() => undefined);
    return work;
  }
  private async load(): Promise<FileReviewSnapshot> {
    const coverage: ReviewCoverage[] = [];
    let persistenceError = "";
    this.loaded = false;
    {
      const saved = this.app.vault.getAbstractFileByPath(REVIEW_RECORDS_PATH);
      if (saved && isFile(saved)) {
        try {
          const data = JSON.parse(await this.app.vault.read(saved));
          if (data.version !== 1 || !Array.isArray(data.records)) throw new Error();
          for (const r of data.records) {
            if (validRecord(r)) {
              const local = this.records.get(r.id);
              const stored = { ...r, recordedPath: reviewPath(r.recordedPath)!, currentPath: r.currentPath ? reviewPath(r.currentPath)! : undefined };
              this.records.set(r.id, local && (local.locationUpdatedAt ?? 0) >= (stored.locationUpdatedAt ?? 0) ? local : stored);
            }
          }
          this.loaded = true;
        } catch { persistenceError = "Saved review history is unreadable; new history will not overwrite it."; }
      } else this.loaded = true;
    }
    // The journal preserves corrections/history, but never grants display membership.
    // Rebuild membership from the nine current dashboard tables on every refresh.
    const activeRecords = new Map<string, ReviewRecord>();
    await Promise.all(REVIEW_SOURCES.map(async source => {
      const file = this.app.vault.getAbstractFileByPath(source.path);
      const status = { label: labelFor(source.id), path: source.path, message: "History source unavailable on this device." };
      coverage.push(status);
      if (!isFile(file)) return;
      try {
        const md = await this.app.vault.cachedRead(file);
        const records = parseReviewTable(md, source, this.app.vault.getName());
        for (const record of records) {
          const old = this.records.get(record.id);
          const sameOutput = old?.recordedPath === record.recordedPath || old?.currentPath === record.recordedPath;
          const current = sameOutput && old?.locationUpdatedAt ? {
            ...record, currentPath: old?.currentPath, unavailable: old?.unavailable,
            locationUpdatedAt: old?.locationUpdatedAt,
          } : record;
          activeRecords.set(record.id, current);
          // Preserve a prior correction if a producer reused this event ID for a
          // different output. It must not relocate the newly listed file.
          if (!old?.locationUpdatedAt || sameOutput) this.records.set(record.id, current);
        }
        status.message = `${records.length} current processed-output entries · ${source.section} → ${source.column}.`;
        if (!records.length && !md.includes(`## ${source.section}`)) status.message = "History format not recognized; no files inferred.";
      } catch { status.message = "History source could not be read."; }
    }));
    for (const id of this.bindings.keys()) if (!activeRecords.has(id)) this.bindings.delete(id);
    const records = [...activeRecords.values()].sort((a, b) => b.processed.localeCompare(a.processed));
    const events = records.filter(record => reviewPath(resolveReviewPath(record, records))).map(record => {
      const path = resolveReviewPath(record, records);
      const found = this.app.vault.getAbstractFileByPath(path);
      const prior = this.bindings.get(record.id);
      let file = isFile(found) ? found : null;
      if (record.unavailable || this.unavailable.has(record.id) || (prior && prior !== found && prior.path === path)) file = null;
      if (file) this.bindings.set(record.id, file);
      return { ...record, currentPath: path, label: labelFor(record.workflow), file, history: [record], state: file ? "Available" : "Missing or moved — refresh history; no filename guessing" };
    });
    const grouped = new Map<string, ReviewRow>();
    for (const row of events) {
      const key = row.currentPath ?? row.recordedPath;
      const existing = grouped.get(key);
      if (existing) {
        existing.history.push(...row.history);
        existing.label = [...new Set(existing.history.map(r => labelFor(r.workflow)))].join(" · ");
      } else grouped.set(key, row);
    }
    const rows = [...grouped.values()];
    if (this.loaded) {
      try { await this.persist(); } catch { persistenceError = "Review history could not be saved. Current results are still available."; }
    }
    this.snapshot = { rows, coverage: coverage.sort((a,b) => a.label.localeCompare(b.label)), message: persistenceError || "Only processed outputs currently listed in the nine dashboard tables are included. Saved history never adds rows; verified move corrections only update listed files’ locations." };
    return this.snapshot;
  }
  renamed(file: TFile, _oldPath: string): void {
    if (!reviewPath(file.path)) { this.deleted(file); return; }
    for (const r of this.records.values()) {
      if (this.bindings.get(r.id) === file && (r.currentPath ?? r.recordedPath) !== file.path) {
        r.currentPath = file.path;
        r.locationUpdatedAt = Date.now();
      }
    }
  }
  deleted(file: TFile): void {
    for (const [id, bound] of this.bindings) if (bound === file) {
      this.unavailable.add(id);
      const record = this.records.get(id);
      if (record) { record.unavailable = true; record.locationUpdatedAt = Date.now(); }
    }
  }
  async moved(file: TFile, oldPath: string): Promise<void> {
    for (const row of this.snapshot.rows) if (row.file === file || row.currentPath === oldPath) {
      for (const event of row.history) {
        const record = this.records.get(event.id);
        if (record) { record.currentPath = file.path; record.locationUpdatedAt = Date.now(); }
      }
    }
    await this.refresh();
  }
  private async persist(): Promise<void> {
    const content = JSON.stringify({ version: 1, records: [...this.records.values()] }, null, 2) + "\n";
    const file = this.app.vault.getAbstractFileByPath(REVIEW_RECORDS_PATH);
    if (isFile(file)) {
      if (await this.app.vault.read(file) !== content) await this.app.vault.modify(file, content);
    } else {
      const folder = REVIEW_RECORDS_PATH.slice(0, REVIEW_RECORDS_PATH.lastIndexOf("/"));
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      await this.app.vault.create(REVIEW_RECORDS_PATH, content);
    }
  }
}
function validRecord(r: any): r is ReviewRecord {
  return r && [r.id,r.workflow,r.processed,r.original,r.sourcePath,r.recordedPath].every(x => typeof x === "string") &&
    REVIEW_SOURCES.some(x => x.id === r.workflow && x.path === r.sourcePath) &&
    Boolean(reviewPath(r.recordedPath)) && Boolean(reviewPath(r.sourcePath)) &&
    (r.locationUpdatedAt === undefined || (typeof r.locationUpdatedAt === "number" && Number.isFinite(r.locationUpdatedAt))) &&
    (!r.currentPath || (typeof r.currentPath === "string" && Boolean(reviewPath(r.currentPath)))) &&
    (!r.fromPath || (typeof r.fromPath === "string" && Boolean(reviewPath(r.fromPath))));
}
export function isFile(value: unknown): value is TFile { return !!value && typeof value === "object" && "stat" in value && "extension" in value; }

export interface MoveSelection { file: TFile; path: string; ctime: number }
const moving = new WeakSet<TFile>();
export async function moveReviewedFile(app: App, selected: MoveSelection, folder: string | null): Promise<string> {
  if (folder === null) return "Move canceled.";
  const { file, path, ctime } = selected;
  if (moving.has(file)) throw new Error("A move is already in progress for this file.");
  if (file.path !== path || file.stat.ctime !== ctime || app.vault.getAbstractFileByPath(path) !== file) throw new Error("This file changed location or was replaced. Refresh File review and select it again.");
  if (folder !== "" && (!reviewPath(folder) || !app.vault.getFolderByPath(folder))) throw new Error("The selected folder no longer exists or is unavailable.");
  if (!reviewPath(path)) throw new Error("This file is not available for review.");
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
