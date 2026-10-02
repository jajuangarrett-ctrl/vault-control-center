import type { App, TFile } from "obsidian";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileReviewStore, REVIEW_RECORDS_PATH, REVIEW_SOURCES, moveReviewedFile, parseReviewTable, resolveReviewPath, reviewPath, type ReviewRecord } from "./file-review";

afterEach(() => vi.restoreAllMocks());

const source = REVIEW_SOURCES.find(x => x.id === "formatted-notes-filing")!;
const table = (path = "03 Areas/Teaching /Note", original = "Note.md") => `## Filing History\n| Original note | Processed | Filed note | Destination |\n|---|---|---|---|\n| ${original} | 2026-09-18 12:25:00 PDT | [[${path}\\|Note]] | ignored |\n## Pending Queue\n| Should not import | 2026-09-18 | [[Other.md]] | ignored |`;
function fixture() {
  const file = { path: "Source/Note.md", name: "Note.md", extension: "md", stat: { ctime: 1, mtime: 2, size: 7 } } as TFile;
  const files = new Map<string, any>([[file.path, file], ["Target", {path:"Target", children: []}]]);
  const renameFile = vi.fn(async (f: TFile, path: string) => { files.delete(f.path); f.path = path; files.set(path, f); });
  const app = { vault: { getAbstractFileByPath: (p: string) => files.get(p) ?? null, getFolderByPath: (p: string) => files.get(p)?.children ? files.get(p) : null }, fileManager: { renameFile } } as unknown as App;
  return { file, files, renameFile, app, selected: {file, path: file.path, ctime: file.stat.ctime} };
}

describe("recorded processing evidence", () => {
  it("accepts only output columns in the nine exact history sections, preserves spaces and escaped pipes", () => {
    expect(REVIEW_SOURCES).toHaveLength(9);
    const [record] = parseReviewTable(table(undefined, "A\\|B.md"), source);
    expect(record.recordedPath).toBe("03 Areas/Teaching /Note.md");
    expect(record.original).toBe("A|B.md");
    expect(parseReviewTable(table(), source)).toHaveLength(1);
    expect(parseReviewTable(table().replace("## Filing History", "## Pending Queue"), source)).toEqual([]);
  });
  it("converts historical absolute vault paths and rejects unsafe targets", () => {
    expect(parseReviewTable(table("/Users/other/FJG Vault/03 Areas/Note"), source)[0].recordedPath).toBe("03 Areas/Note.md");
    for (const path of ["/etc/file.md", "../Note.md", "Folder/../Note.md", ".obsidian/data.json", "Folder/secrets.md", "https://example.org/note", "Folder//Note.md"]) expect(reviewPath(path)).toBeNull();
  });
  it("follows explicit chains only, refuses ambiguous destinations, and never guesses by filename", () => {
    const output = { id:"capture", workflow:"vocci-notes-processing", processed:"2026-09-18 11:00", recordedPath:"AI Team/Formatted_Notes/Note.md", original:"Session", sourcePath:"History.md" };
    const filed = parseReviewTable(table(),source)[0];
    expect(resolveReviewPath(output,[output,filed])).toBe(filed.recordedPath);
    expect(resolveReviewPath(output,[output])).toBe(output.recordedPath);
    expect(resolveReviewPath(output,[filed,{...filed,recordedPath:"Other/Note.md"}])).toBe(output.recordedPath);
  });
});
describe("selected file moves", () => {
  it("uses FileManager for a single move and treats cancel/same-folder as no-ops", async () => {
    const f=fixture();
    expect(await moveReviewedFile(f.app,f.selected,null)).toMatch(/canceled/);
    f.files.set("Source",{children:[]});
    expect(await moveReviewedFile(f.app,f.selected,"Source")).toMatch(/already/);
    expect(f.renameFile).not.toHaveBeenCalled();
    await moveReviewedFile(f.app,f.selected,"Target");
    expect(f.renameFile).toHaveBeenCalledExactlyOnceWith(f.file,"Target/Note.md");
  });
  it("rejects collisions, missing folders, missing/replaced files and stale selections", async () => {
    const f=fixture();
    f.files.set("Target/Note.md",{path:"Target/Note.md"});
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/already exists/);
    await expect(moveReviewedFile(f.app,f.selected,"Absent")).rejects.toThrow(/folder/);
    f.files.delete(f.selected.path);
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/replaced/);
    f.files.set(f.selected.path,{...f.file});
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/replaced/);
    f.files.set(f.selected.path,f.file); f.file.path="Elsewhere/Note.md";
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/location/);
    expect(f.renameFile).not.toHaveBeenCalled();
  });
  it("propagates API collision/error without falling back to copy/delete, and locks overlapping requests", async () => {
    const f=fixture();
    let release!: () => void;
    f.renameFile.mockImplementationOnce(() => new Promise<void>(resolve => {release=resolve;}));
    const pending=moveReviewedFile(f.app,f.selected,"Target");
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/progress/);
    release(); await pending;
    f.renameFile.mockRejectedValueOnce(new Error("Target exists"));
    await expect(moveReviewedFile(f.app,f.selected,"Target")).rejects.toThrow(/Target exists/);
  });
});
