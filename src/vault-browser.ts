import { TFile, TFolder, type Vault } from "obsidian";
import { isExcludedPath, isSensitivePath, normalizeVaultPath, type DashboardFileItem } from "./data";

export interface VaultFolderListing {
  path: string;
  breadcrumbs: Array<{ path: string; name: string }>;
  folders: Array<{ path: string; name: string }>;
  files: DashboardFileItem[];
}

const folderOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function safePath(path: string): boolean {
  return !isExcludedPath(path) && !isSensitivePath(path);
}

export function vaultFolderParent(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

export function resolveVaultBrowserFolder(vault: Vault, requested: string): TFolder {
  let path = normalizeVaultPath(requested);
  while (path) {
    if (safePath(path)) {
      const target = vault.getFolderByPath(path);
      if (target) return target;
    }
    path = vaultFolderParent(path);
  }
  return vault.getRoot();
}

export function buildVaultFolderListing(
  vault: Vault,
  path: string,
  toDashboardFileItem: (file: TFile) => DashboardFileItem
): VaultFolderListing {
  const folder = resolveVaultBrowserFolder(vault, path);
  const folderPath = folder.isRoot() ? "" : folder.path;
  const children = folder.children.filter((entry) => safePath(entry.path))
    .sort((left, right) => folderOrder.compare(left.name, right.name) || left.path.localeCompare(right.path));
  const breadcrumbs = [{ path: "", name: "Vault root" }];
  for (const segment of folderPath.split("/").filter(Boolean)) {
    const previous = breadcrumbs[breadcrumbs.length - 1].path;
    breadcrumbs.push({ path: previous ? `${previous}/${segment}` : segment, name: segment });
  }
  return {
    path: folderPath,
    breadcrumbs,
    folders: children.filter((entry): entry is TFolder => entry instanceof TFolder).map(({ path, name }) => ({ path, name })),
    files: children.filter((entry): entry is TFile => entry instanceof TFile).map(toDashboardFileItem),
  };
}
