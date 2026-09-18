import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { FileReviewStore, REVIEW_RECORDS_PATH, REVIEW_SOURCES, moveReviewedFile, parseReviewTable, resolveReviewPath, reviewPath, type ReviewRecord } from "./file-review";

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

describe("review persistence and duplicate provenance", () => {
  it("deduplicates shared outputs, retains new results, follows observed renames, and flags unavailable paths", async () => {
    const docs = new Map<string,string>([[source.path,table()]]);
    const files = new Map<string,any>();
    const makeFile=(path:string) => ({path,name:path.split("/").pop(),extension:path.split(".").pop(),stat:{ctime:1,mtime:1,size:1}} as TFile);
    const note=makeFile("03 Areas/Teaching /Note.md"); files.set(note.path,note);
    for(const path of docs.keys()) files.set(path,makeFile(path));
    const capture=REVIEW_SOURCES.find(x=>x.id==="vocci-notes-processing")!;
    docs.set(capture.path,"## Processing History\n| Vocci session | Processed | Verbatim Vocci note |\n|---|---|---|\n| Session | 2026-09-18 11:00 | [[AI Team/Formatted_Notes/Note.md]] |");
    files.set(capture.path,makeFile(capture.path));
    const app={vault:{getName:()=>"FJG Vault",getAbstractFileByPath:(p:string)=>files.get(p),cachedRead:async(f:TFile)=>docs.get(f.path),read:async(f:TFile)=>docs.get(f.path),getMarkdownFiles:()=>[],createFolder:async()=>{},create:async(p:string,c:string)=>{docs.set(p,c);files.set(p,makeFile(p));},modify:async(f:TFile,c:string)=>docs.set(f.path,c)}} as unknown as App;
    const store=new FileReviewStore(app);
    let snapshot=await store.refresh();
    expect(snapshot.rows).toHaveLength(1); expect(snapshot.rows[0].history).toHaveLength(2);
    expect(snapshot.rows[0].file).toBe(note);
    const old=note.path; files.delete(old); note.path="Elsewhere/Note.md";files.set(note.path,note);
    store.renamed(note,old);snapshot=await store.refresh();
    expect(snapshot.rows[0].currentPath).toBe(note.path);
    const reloaded=new FileReviewStore(app);snapshot=await reloaded.refresh();
    expect(snapshot.rows[0].currentPath).toBe(note.path);
    files.delete(note.path);snapshot=await reloaded.refresh();
    expect(snapshot.rows[0].file).toBeNull();
    reloaded.deleted(note);
    await reloaded.refresh();
    files.set(note.path, makeFile(note.path));
    expect((await new FileReviewStore(app).refresh()).rows[0].file).toBeNull();
    const saved = JSON.parse(docs.get(REVIEW_RECORDS_PATH)!);
    expect(saved.records).toHaveLength(2);
    for (const record of saved.records) { record.currentPath="Remote/Note.md"; record.locationUpdatedAt=Date.now()+1000; }
    docs.set(REVIEW_RECORDS_PATH, JSON.stringify(saved));
    expect((await reloaded.refresh()).rows[0].currentPath).toBe("Remote/Note.md");
    docs.set(REVIEW_RECORDS_PATH, "{broken");
    expect((await reloaded.refresh()).message).toMatch(/unreadable/);
    expect(docs.get(REVIEW_RECORDS_PATH)).toBe("{broken");
  });
});
