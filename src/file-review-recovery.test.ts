import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { FileReviewStore, REVIEW_RECORDS_PATH, REVIEW_SOURCES, getLiveReviewFile, moveReviewedFile } from "./file-review";
import { IDENTITY_LIMITS, ReviewIdentityIndex, fileStamp } from "./file-review-identity";

const source = REVIEW_SOURCES.find(x => x.id === "formatted-notes-filing")!;
const table = (path: string, extra = "") => `## Filing History\n| Original note | Processed | Filed note |\n|---|---|---|\n| Input.md | 2026-09-18 12:00 PDT | [[${path}]] |\n${extra}`;
function setup(extension = "md") {
  const files = new Map<string, TFile>();
  const contents = new Map<string, string>();
  const add = (path: string, body: string) => {
    const file = { path, name: path.split("/").pop()!, extension: path.split(".").pop()!, stat: { size: new TextEncoder().encode(body).byteLength, ctime: 1, mtime: 1 } } as TFile;
    files.set(path, file); contents.set(path, body); return file;
  };
  const note = add(`Output/Résumé #1.${extension}`, "verified bytes α");
  add(source.path, table(note.path));
  const move = (file: TFile, path: string) => {
    const body = contents.get(file.path)!; files.delete(file.path); contents.delete(file.path);
    file.path = path; files.set(path, file); contents.set(path, body);
  };
  const readBinary = vi.fn(async (file: TFile) => new TextEncoder().encode(contents.get(file.path)!).buffer);
  const modify = vi.fn(async (file: TFile, body: string) => { contents.set(file.path, body); file.stat.size = new TextEncoder().encode(body).byteLength; file.stat.mtime++; });
  const app = { vault: {
    getName: () => "FJG Vault", getFiles: () => [...files.values()], getAbstractFileByPath: (p: string) => files.get(p),
    readBinary, read: async (f: TFile) => contents.get(f.path), cachedRead: async (f: TFile) => contents.get(f.path),
    createFolder: async () => {}, create: async (p: string, c: string) => add(p, c), modify,
    getFolderByPath: () => ({ children: [] }),
  }, fileManager: { renameFile: vi.fn(async (file: TFile, path: string) => move(file, path)) } } as unknown as App;
  return { files, contents, note, add, move, app, readBinary, modify, store: new FileReviewStore(app) };
}

describe("verified recovery and explicit location", () => {
  it.each(["md", "svg"])("recovers an unobserved %s move after reload, persists it, opens and moves the exact file", async extension => {
    const f = setup(extension);
    await f.store.refresh();
    const saved = JSON.parse(f.contents.get(REVIEW_RECORDS_PATH)!);
    expect(saved.records[0].identity.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(saved)).not.toContain("verified bytes");
    f.move(f.note, `New folder /Résumé #1.${extension}`);
    const reloaded = new FileReviewStore(f.app);
    const row = (await reloaded.refresh()).rows[0];
    expect(row.file).toBe(f.note); expect(row.currentPath).toBe(f.note.path);
    expect(row.locationEvidence).toMatch(/SHA-256/);
    expect(getLiveReviewFile(f.app, row)).toBe(f.note);
    expect((await new FileReviewStore(f.app).refresh()).rows[0].currentPath).toBe(f.note.path);
    await moveReviewedFile(f.app, { file: row.file!, path: row.currentPath!, ctime: 1 }, "Target");
    expect(f.app.fileManager.renameFile).toHaveBeenCalledOnce();
  });
  it("refuses duplicate content and never substitutes an identically named file or edited content", async () => {
    const f = setup(); await f.store.refresh();
    f.move(f.note, "Other/Résumé #1.md");
    f.add("Duplicate/Résumé #1.md", "verified bytes α");
    let row = (await new FileReviewStore(f.app).refresh()).rows[0];
    expect(row.file).toBeNull(); expect(row.state).toMatch(/Multiple identical/);
    f.contents.set(f.note.path, "changed content"); f.note.stat.size = 15; f.note.stat.mtime++;
    f.files.delete("Duplicate/Résumé #1.md");
    row = (await new FileReviewStore(f.app).refresh()).rows[0];
    expect(row.file).toBeNull(); expect(row.state).toMatch(/No exact/);
  });
  it("requires explicit Locate for old missing outputs, preserves merged provenance, and cancel writes nothing", async () => {
    const f = setup(); f.move(f.note, "Manual/Found.md");
    const capture = REVIEW_SOURCES.find(s => s.id === "vocci-notes-processing")!;
    f.add(capture.path, "## Processing History\n| Vocci session | Processed | Verbatim Vocci note |\n|---|---|---|\n| Session | 2026-09-17 | [[AI Team/Formatted_Notes/Input.md]] |");
    const row = (await f.store.refresh()).rows[0];
    expect(row.history).toHaveLength(2); expect(row.state).toMatch(/No saved identity/);
    const before = f.contents.get(REVIEW_RECORDS_PATH);
    await f.store.locate(row, null); expect(f.contents.get(REVIEW_RECORDS_PATH)).toBe(before);
    const body = f.contents.get(f.note.path);
    await f.store.locate(row, { file: f.note, stamp: fileStamp(f.note) });
    const located = (await new FileReviewStore(f.app).refresh()).rows[0];
    expect(located.history).toHaveLength(2); expect(located.file).toBe(f.note);
    expect(located.history.every(r => r.locationEvidence === "Explicit Locate file selection")).toBe(true);
    expect(f.contents.get(f.note.path)).toBe(body); expect(f.app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(f.modify.mock.calls.every(([file]) => file.path === REVIEW_RECORDS_PATH)).toBe(true);
  });
  it.each(["replace", "remove", "move", "edit", "history"])("rejects a stale Locate selection after %s", async change => {
    const f = setup(); f.move(f.note, "Manual/Found.md");
    const row = (await f.store.refresh()).rows[0];
    const selection = { file: f.note, stamp: fileStamp(f.note) };
    if (change === "replace") f.add(f.note.path, "replacement");
    if (change === "remove") f.files.delete(f.note.path);
    if (change === "move") f.move(f.note, "Another/Found.md");
    if (change === "edit") { f.note.stat.mtime++; }
    if (change === "history") f.contents.set(source.path, table("Different/Output.md"));
    await expect(f.store.locate(row, selection)).rejects.toThrow(/changed|replaced/);
    expect(JSON.parse(f.contents.get(REVIEW_RECORDS_PATH)!).records.every((r: any) => !r.locationEvidence)).toBe(true);
  });
  it("retains corrections through disappearance/reappearance without transferring them to reused event IDs", async () => {
    const f = setup(); const original = f.note.path; await f.store.refresh();
    f.move(f.note, "Recovered/Note.md"); const store = new FileReviewStore(f.app);
    expect((await store.refresh()).rows[0].file).toBe(f.note);
    f.contents.set(source.path, "## Filing History"); expect((await store.refresh()).rows).toHaveLength(0);
    f.contents.set(source.path, table("New/Output.md")); f.add("New/Output.md", "other output");
    expect((await store.refresh()).rows[0].currentPath).toBe("New/Output.md");
    f.contents.set(source.path, table(original));
    expect((await new FileReviewStore(f.app).refresh()).rows[0].currentPath).toBe("Recovered/Note.md");
  });
  it("handles live folder path updates, but refuses replacement and offline content edits", async () => {
    const f = setup(); await f.store.refresh();
    f.move(f.note, "Folder renamed/Note.md");
    expect((await f.store.refresh()).rows[0].file).toBe(f.note);
    f.add(f.note.path, "replacement bytes");
    expect((await f.store.refresh()).rows[0].file).toBeNull();
    expect((await new FileReviewStore(f.app).refresh()).rows[0].file).toBeNull();
  });
  it("accepts a newer synchronized explicit correction after a local deletion tombstone", async () => {
    const f = setup(); await f.store.refresh();
    f.store.deleted(f.note); f.files.delete(f.note.path); await f.store.refresh();
    const found = f.add("Located/Found.md", "verified bytes α");
    const saved = JSON.parse(f.contents.get(REVIEW_RECORDS_PATH)!);
    Object.assign(saved.records[0], { currentPath: found.path, unavailable: false, locationUpdatedAt: Date.now() + 1000, locationEvidence: "Explicit Locate file selection" });
    f.contents.set(REVIEW_RECORDS_PATH, JSON.stringify(saved));
    expect((await f.store.refresh()).rows[0].file).toBe(found);
  });
  it("hashes only same-size eligible candidates, rejects partial uniqueness, and reuses unchanged digests", async () => {
    const f = setup(); const index = new ReviewIdentityIndex(f.app, path => !path.includes("Archived") && !path.includes("secrets"));
    index.begin(); const baseline = (await index.fingerprint(f.note))!;
    f.move(f.note, "Moved/Note.md");
    f.add("Archived/copy.md", "verified bytes α"); f.add("secrets/copy.md", "verified bytes α");
    for (let i = 0; i < IDENTITY_LIMITS.reads + 3; i++) f.add(`Other/${i}.md`, "x".repeat(baseline.size));
    index.begin(); f.readBinary.mockClear();
    expect((await index.find(baseline)).file).toBeNull();
    expect(f.readBinary.mock.calls.length).toBeLessThanOrEqual(IDENTITY_LIMITS.reads);
    index.begin(); expect((await index.find(baseline)).file).toBe(f.note);
    f.readBinary.mockClear(); index.begin(); expect((await index.find(baseline)).file).toBe(f.note);
    expect(f.readBinary).not.toHaveBeenCalled();
  });
});
