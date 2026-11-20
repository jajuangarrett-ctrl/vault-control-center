import { describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
  TFile: class {
    name = this.path.split("/").at(-1) ?? "";
    constructor(readonly path: string) {}
  },
  TFolder: class {
    name = this.path.split("/").at(-1) ?? "";
    constructor(readonly path: string, readonly children: unknown[]) {}
    isRoot() { return this.path === "/"; }
  },
}));
import { TFile, TFolder, type Vault } from "obsidian";
import { buildVaultFolderListing, resolveVaultBrowserFolder } from "./vault-browser";
import type { DashboardFileItem } from "./data";

const folder = (path: string, children: unknown[] = []) => new (TFolder as any)(path, children) as TFolder;
const file = (path: string) => new (TFile as any)(path) as TFile;
const toItem = ({ path, name }: TFile) => ({ path, name } as DashboardFileItem);

describe("All Files folder listing", () => {
  it("includes empty, normal root folders, natural ordering and file formats beyond summaries", () => {
    const nested = folder("Artifacts/Project 2", [file("Artifacts/Project 2/Asset.zip")]);
    const artifacts = folder("Artifacts", [nested]);
    const inbox = folder("00 Inbox");
    const root = folder("/", [
      folder("Folder 11"), artifacts, folder("Folder 2"), inbox, folder("tmp"),
      folder(".obsidian"), folder("Passwords"), folder("Users"), folder("copilot"),
      file("Root archive.zip"), file("Root note.md"), file("api_keys.txt"),
    ]);
    const directories = new Map([inbox, artifacts, nested].map((item) => [item.path, item]));
    const vault = { getRoot: () => root, getFolderByPath: (path: string) => directories.get(path) } as Vault;
    const snapshot = buildVaultFolderListing(vault, "", toItem);
    expect(snapshot.breadcrumbs).toEqual([{ name: "Vault root", path: "" }]);
    expect(snapshot.folders.map(({ name }) => name)).toEqual(["00 Inbox", "Artifacts", "Folder 2", "Folder 11", "tmp"]);
    expect(snapshot.files.map(({ name }) => name)).toEqual(["Root archive.zip", "Root note.md"]);
    const child = buildVaultFolderListing(vault, nested.path, toItem);
    expect(child.breadcrumbs.map(({ name }) => name)).toEqual(["Vault root", "Artifacts", "Project 2"]);
    expect(child.files.map(({ name }) => name)).toEqual(["Asset.zip"]);
    expect(buildVaultFolderListing(vault, inbox.path, toItem).files).toEqual([]);
  });

  it("recovers to an existing ancestor and never opens an excluded path", () => {
    const root = folder("/");
    const artifacts = folder("Artifacts");
    const secret = folder("Artifacts/Credentials");
    const directories = new Map([artifacts, secret].map((item) => [item.path, item]));
    const vault = { getRoot: () => root, getFolderByPath: (path: string) => directories.get(path) } as Vault;
    expect(resolveVaultBrowserFolder(vault, "Artifacts/Removed/Child")).toBe(artifacts);
    expect(resolveVaultBrowserFolder(vault, secret.path)).toBe(artifacts);
    expect(resolveVaultBrowserFolder(vault, "No longer exists")).toBe(root);
  });
});
