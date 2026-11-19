import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { FileReviewStore, REVIEW_FOLDERS, REVIEW_INBOXES, REVIEW_RECORDS_PATH, affectsFileReview, filterReviewRows, getLiveReviewFile, moveReviewedFile } from "./file-review";

function fixture() {
  const files = new Map<string, TFile>();
  const folders = new Set<string>(REVIEW_FOLDERS.map(root => root.path));
  folders.add("Filed");
  const add = (path: string) => {
    const file = { path, name: path.split("/").pop()!, extension: path.split(".").pop()!, stat: { size: 12, ctime: 1, mtime: 1 } } as TFile;
    files.set(path, file); return file;
  };
  const move = (file: TFile, path: string) => { files.delete(file.path); file.path = path; files.set(path, file); };
  const vault = {
    getFiles: () => [...files.values()], getAbstractFileByPath: (path: string) => files.get(path),
    getFolderByPath: (path: string) => folders.has(path) ? { path } : null,
    read: vi.fn(), cachedRead: vi.fn(), readBinary: vi.fn(), modify: vi.fn(), create: vi.fn(),
  };
  const app = { vault, fileManager: { renameFile: vi.fn(async (file: TFile, path: string) => move(file, path)) } } as unknown as App;
  return { files, folders, add, move, vault, app, store: new FileReviewStore(app) };
}

describe("live inbox membership", () => {
  it("includes all three exact roots, arbitrary file formats and every nested folder without a history requirement or exclusions", async () => {
    const f = fixture();
    for (const root of REVIEW_INBOXES) {
      f.add(`${root.path}/Note.md`); f.add(`${root.path}/Nested/Deep/Attachment.xyz`);
      f.add(`${root.path}/Archived/Report.pdf`); f.add(`${root.path}/Credentials review.md`);
      f.add(`${root.path}Extra/Outside.md`);
    }
    f.add("Filed/Historical.md"); f.add(REVIEW_RECORDS_PATH);
    const snapshot = await f.store.refresh();
    expect(snapshot.rows).toHaveLength(12);
    expect(new Set(snapshot.rows.map(row => row.currentPath)).size).toBe(12);
    expect(snapshot.coverage.map(root => root.message)).toEqual([...Array(3).fill("4 files, including subfolders."), ...Array(2).fill("0 files, including subfolders.")]);
    for (const row of snapshot.rows) expect(getLiveReviewFile(f.app, row)).toBe(row.file);
    expect(f.vault.read).not.toHaveBeenCalled(); expect(f.vault.readBinary).not.toHaveBeenCalled();
    expect(f.vault.modify).not.toHaveBeenCalled(); expect(f.vault.create).not.toHaveBeenCalled();
  });
  it("adds Inbox and Wiki to the folder filter, including nested files without expanding private-path exceptions", async () => {
    const f = fixture();
    f.add("AI Team/owner_inbox/Existing.md");
    f.add("00 Inbox/Intake.md");
    f.add("00 Inbox/Unsorted/Nested/Intake.pdf");
    f.add("Wiki/Overview.md");
    f.add("Wiki/Guides/Deep/Welcome.md");
    f.add("Wiki/Guides/Credentials.md");
    f.add("Wiki/.private/Hidden.md");
    f.add("Wiki/../Outside.md");
    f.add("Wiki Archive/Outside.md");
    f.add("00 Inbox Old/Outside.md");

    const snapshot = await f.store.refresh();
    expect(snapshot.coverage.map(root => root.label)).toEqual(["Formatted Notes", "Team Inbox", "Owner Inbox", "00 Inbox", "Wiki"]);
    expect(filterReviewRows(snapshot, "", "")).toHaveLength(5);
    expect(filterReviewRows(snapshot, "", "00 Inbox").map(row => row.currentPath)).toEqual([
      "00 Inbox/Intake.md", "00 Inbox/Unsorted/Nested/Intake.pdf",
    ]);
    expect(filterReviewRows(snapshot, "Guides Deep", "Wiki").map(row => row.currentPath)).toEqual([
      "Wiki/Guides/Deep/Welcome.md",
    ]);
    expect(affectsFileReview("00 Inbox")).toBe(true);
    expect(affectsFileReview("Wiki/Guides/Deep")).toBe(true);
    expect(affectsFileReview("Wiki Archive")).toBe(false);
    expect(affectsFileReview("00 Inbox Old")).toBe(false);
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.vault.modify).not.toHaveBeenCalled();
  });
  it("refreshes a manual Inbox-to-Wiki move and refuses to archive or replace collided notes in the new roots", async () => {
    const f = fixture();
    f.folders.add("Wiki/Guides");
    const source = f.add("00 Inbox/Note.md");
    const path = source.path;
    await moveReviewedFile(f.app, { file: source, path, ctime: 1 }, "Wiki/Guides");
    await f.store.moved(source, path);
    expect(filterReviewRows(f.store.snapshot, "", "00 Inbox")).toEqual([]);
    expect(filterReviewRows(f.store.snapshot, "", "Wiki").map(row => row.currentPath)).toEqual(["Wiki/Guides/Note.md"]);

    f.add("Filed/Note.md");
    const original = f.add("AI Team/owner_inbox/Note.md");
    for (const [file, destination] of [[source, "Filed"], [original, "Wiki/Guides"]] as const) {
      await expect(moveReviewedFile(f.app, { file, path: file.path, ctime: 1 }, destination)).rejects.toThrow(/already exists/);
    }
    expect(source.path).toBe("Wiki/Guides/Note.md");
    expect(original.path).toBe("AI Team/owner_inbox/Note.md");
    expect(f.vault.read).not.toHaveBeenCalled();
    expect(f.app.fileManager.renameFile).toHaveBeenCalledTimes(1);
  });
  it("responds to external create, delete, replacement and moves within, between and outside watched roots; reload uses current membership", async () => {
    const f = fixture(), first = REVIEW_INBOXES[0].path, second = REVIEW_INBOXES[1].path;
    expect((await f.store.refresh()).rows).toEqual([]);
    const file = f.add(`${first}/New.md`);
    const stale = (await f.store.refresh()).rows[0];
    f.move(file, `${first}/Nested/New.md`);
    expect(getLiveReviewFile(f.app, stale)).toBeNull();
    expect((await f.store.refresh()).rows.map(row => row.currentPath)).toEqual([file.path]);
    f.move(file, `${second}/New.md`);
    expect((await f.store.refresh()).rows[0].label).toBe("Team Inbox");
    f.move(file, "Filed/New.md");
    expect((await f.store.refresh()).rows).toEqual([]);
    f.move(file, `${first}/New.md`);
    expect((await new FileReviewStore(f.app).refresh()).rows[0].file).toBe(file);
    f.files.delete(file.path);
    expect((await f.store.refresh()).rows).toEqual([]);
    const replacement = f.add(file.path);
    expect((await f.store.refresh()).rows[0].file).toBe(replacement);
    expect(getLiveReviewFile(f.app, stale)).toBeNull();
  });
  it("reflects folder renames and removals, reports a missing root and never follows its files outside watched roots", async () => {
    expect(affectsFileReview("AI Team")).toBe(true);
    expect(affectsFileReview("AI Team/owner_inbox")).toBe(true);
    expect(affectsFileReview("Filed/Note.md")).toBe(false);
    expect(affectsFileReview("AI Team/owner_inboxExtra")).toBe(false);
    const f = fixture(), root = REVIEW_INBOXES[2].path;
    const a = f.add(`${root}/Nested/A.md`), b = f.add(`${root}/Nested/B.md`);
    await f.store.refresh();
    f.move(a, `${root}/Renamed/A.md`); f.move(b, `${root}/Renamed/B.md`);
    expect((await f.store.refresh()).rows.map(row => row.currentPath)).toEqual([a.path, b.path]);
    f.move(a, "Filed/Nested/A.md"); f.move(b, "Filed/Nested/B.md"); f.folders.delete(root);
    const snapshot = await f.store.refresh();
    expect(snapshot.rows).toEqual([]); expect(snapshot.coverage[2].message).toMatch(/unavailable/);
  });
  it("filters by current inbox and path, with accurate empty results and no historical workflow filters", async () => {
    const f = fixture(); f.add(`${REVIEW_INBOXES[0].path}/Résumé α.md`); f.add(`${REVIEW_INBOXES[1].path}/Nested/Other.pdf`);
    const snapshot = await f.store.refresh();
    expect(filterReviewRows(snapshot, "résumé α", "")).toHaveLength(1);
    expect(filterReviewRows(snapshot, "Nested", REVIEW_INBOXES[1].path)).toHaveLength(1);
    expect(filterReviewRows(snapshot, "Other", REVIEW_INBOXES[0].path)).toEqual([]);
  });
  it("dashboard Move refresh removes a filed file immediately while a move between inboxes stays represented once", async () => {
    const f = fixture(), root = REVIEW_INBOXES[0].path;
    const file = f.add(`${root}/Move.md`);
    await f.store.refresh();
    let oldPath = file.path;
    await moveReviewedFile(f.app, { file, path: oldPath, ctime: 1 }, REVIEW_INBOXES[2].path);
    await f.store.moved(file, oldPath);
    expect(f.store.snapshot.rows).toHaveLength(1); expect(f.store.snapshot.rows[0].label).toBe("Owner Inbox");
    oldPath = file.path;
    await moveReviewedFile(f.app, { file, path: oldPath, ctime: 1 }, "Filed");
    await f.store.moved(file, oldPath);
    expect(f.store.snapshot.rows).toEqual([]);
    expect(f.app.fileManager.renameFile).toHaveBeenCalledTimes(2);
    expect(f.vault.modify).not.toHaveBeenCalled();
  });
});
