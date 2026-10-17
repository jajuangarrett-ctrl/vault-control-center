import type { App, TFile } from "obsidian";

export const DUPLICATE_ARCHIVE = "Artifacts/Vault Control Center Native Plugin/Archived Duplicates";

/** Ignore only a single scalar, top-level location property. Preserve all other bytes. */
export function comparableNote(text: string): string {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return text;
  const lines = match[1].split(/\r?\n/);
  const locations = lines.map((line, i) => /^location:/.test(line) ? i : -1).filter(i => i >= 0);
  if (locations.length !== 1) return text;
  const i = locations[0];
  // Do not ignore block scalars, folded values or indented continuation content.
  if (/^location:\s*[>|]/.test(lines[i]) || (lines[i + 1] && /^\s/.test(lines[i + 1]))) return text;
  return text.replace(/^location:[^\r\n]*\r?\n/m, "");
}

export async function archiveMatchingInboxNote(app: App, file: TFile, existing: TFile, sourcePath: string): Promise<string> {
  const destination = existing.path;
  const sourceText = await app.vault.read(file);
  const destinationText = await app.vault.read(existing);
  if (comparableNote(sourceText) !== comparableNote(destinationText)) {
    throw new Error("A note with this name already exists, but its content differs. Nothing was moved or overwritten.");
  }
  const base = `${DUPLICATE_ARCHIVE}/${sourcePath}`;
  const folder = base.slice(0, base.lastIndexOf("/"));
  let current = "";
  for (const part of folder.split("/")) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try { await app.vault.createFolder(current); }
      catch (error) { if (!app.vault.getFolderByPath(current)) throw error; }
    }
    if (!app.vault.getFolderByPath(current)) throw new Error("The duplicate archive path is occupied by a file.");
  }
  let archive = base;
  let suffix = 2;
  while (app.vault.getAbstractFileByPath(archive)) archive = base.replace(/\.md$/i, ` (${suffix++}).md`);
  // Recheck after reads/folder creation so changed notes are never treated as duplicates.
  if (file.path !== sourcePath || existing.path !== destination ||
      app.vault.getAbstractFileByPath(sourcePath) !== file || app.vault.getAbstractFileByPath(destination) !== existing ||
      await app.vault.read(file) !== sourceText || await app.vault.read(existing) !== destinationText) {
    throw new Error("A note changed during comparison. Nothing was archived; try again.");
  }
  await app.fileManager.renameFile(file, archive);
  if (file.path !== archive || app.vault.getAbstractFileByPath(archive) !== file || app.vault.getAbstractFileByPath(sourcePath) === file) {
    throw new Error("The duplicate archive move could not be verified. Refresh File Review.");
  }
  return `Already filed at ${destination}. Matching inbox copy archived to ${archive}.`;
}
