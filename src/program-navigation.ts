import {
  isExcludedPath,
  isSensitivePath,
  normalizeVaultPath,
  pathIsWithin,
  type DashboardFileItem,
  type DashboardProgram,
} from "./data";

export interface ProgramFolderBreadcrumb {
  name: string;
  path: string;
}

export interface ProgramFolderSummary {
  name: string;
  path: string;
  count: number;
  latestModifiedAt: number;
}

export interface ProgramFolderView {
  rootPath: string;
  path: string;
  name: string;
  parentPath: string | null;
  breadcrumbs: ProgramFolderBreadcrumb[];
  folders: ProgramFolderSummary[];
  files: DashboardFileItem[];
  count: number;
  latestModifiedAt: number;
  latestFile: DashboardFileItem | null;
}

export function programMatchesNavigationQuery(
  program: DashboardProgram,
  query: string
): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return true;
  if (valuesMatch(normalizedQuery, program.name, program.path, program.count)) {
    return true;
  }
  const rootPath = normalizeVaultPath(program.path);
  return (
    safeProgramFiles(program, rootPath).some((file) =>
      fileMatchesQuery(file, normalizedQuery)
    ) ||
    safeProgramFolders(program, rootPath).some((path) =>
      valuesMatch(normalizedQuery, lastPathSegment(path), path)
    )
  );
}

export function programFolderMatchesNavigationQuery(
  program: DashboardProgram,
  folder: ProgramFolderSummary,
  query: string
): boolean {
  const normalizedQuery = normalizeQuery(query);
  if (!normalizedQuery) return true;
  if (valuesMatch(normalizedQuery, folder.name, folder.path, folder.count)) {
    return true;
  }
  const rootPath = normalizeVaultPath(program.path);
  return (
    safeProgramFiles(program, rootPath).some(
      (file) =>
        pathIsWithin(file.path, folder.path) &&
        fileMatchesQuery(file, normalizedQuery)
    ) ||
    safeProgramFolders(program, rootPath).some(
      (path) =>
        pathIsWithin(path, folder.path) &&
        valuesMatch(normalizedQuery, lastPathSegment(path), path)
    )
  );
}

/**
 * Resolves a persisted or requested folder to the nearest folder that still
 * exists inside the selected program. Unknown and cross-program paths always
 * fall back to the program root.
 */
export function resolveProgramFolderPath(
  program: DashboardProgram,
  candidatePath: string
): string {
  const rootPath = normalizeVaultPath(program.path);
  const safeFiles = safeProgramFiles(program, rootPath);
  const safeFolders = safeProgramFolders(program, rootPath);
  let currentPath = normalizeVaultPath(candidatePath) || rootPath;

  if (!pathIsWithin(currentPath, rootPath)) return rootPath;

  while (currentPath !== rootPath) {
    if (
      safeFolders.some(
        (folderPath) =>
          folderPath === currentPath ||
          folderPath.startsWith(`${currentPath}/`)
      ) ||
      safeFiles.some((file) => file.path.startsWith(`${currentPath}/`))
    ) {
      return currentPath;
    }
    const parentPath = parentFolderPath(currentPath);
    if (!parentPath || !pathIsWithin(parentPath, rootPath)) return rootPath;
    currentPath = parentPath;
  }

  return rootPath;
}

/** Builds the immediate folder/file view for one level of a program tree. */
export function buildProgramFolderView(
  program: DashboardProgram,
  candidatePath: string
): ProgramFolderView {
  const rootPath = normalizeVaultPath(program.path);
  const path = resolveProgramFolderPath(program, candidatePath);
  const safeFiles = safeProgramFiles(program, rootPath);
  const safeFolders = safeProgramFolders(program, rootPath);
  const descendantFiles = sortFiles(
    safeFiles.filter((file) => file.path.startsWith(`${path}/`))
  );
  const files = descendantFiles.filter((file) => parentFolderPath(file.path) === path);
  const folderMap = new Map<string, ProgramFolderSummary>();

  for (const file of descendantFiles) {
    const relativePath = file.path.slice(path.length + 1);
    const slashIndex = relativePath.indexOf("/");
    if (slashIndex < 1) continue;

    const name = relativePath.slice(0, slashIndex);
    const childPath = `${path}/${name}`;
    const existing = folderMap.get(childPath);
    folderMap.set(childPath, {
      name,
      path: childPath,
      count: (existing?.count ?? 0) + 1,
      latestModifiedAt: Math.max(existing?.latestModifiedAt ?? 0, file.modifiedAt),
    });
  }

  for (const folderPath of safeFolders) {
    if (folderPath === path || !pathIsWithin(folderPath, path)) continue;
    const relativePath = folderPath.slice(path.length + 1);
    const name = relativePath.split("/")[0] ?? "";
    if (!name) continue;
    const childPath = `${path}/${name}`;
    if (!folderMap.has(childPath)) {
      folderMap.set(childPath, {
        name,
        path: childPath,
        count: 0,
        latestModifiedAt: 0,
      });
    }
  }

  const folders = [...folderMap.values()].sort(
    (left, right) => right.count - left.count || left.name.localeCompare(right.name)
  );
  const latestFile = descendantFiles[0] ?? null;

  return {
    rootPath,
    path,
    name: path === rootPath ? program.name : lastPathSegment(path),
    parentPath: path === rootPath ? null : parentFolderPath(path),
    breadcrumbs: folderBreadcrumbs(program, rootPath, path),
    folders,
    files,
    count: descendantFiles.length,
    latestModifiedAt: latestFile?.modifiedAt ?? 0,
    latestFile,
  };
}

function safeProgramFiles(
  program: DashboardProgram,
  rootPath: string
): DashboardFileItem[] {
  return program.files
    .map((file) => ({ ...file, path: normalizeVaultPath(file.path) }))
    .filter(
      (file) =>
        file.path !== rootPath &&
        pathIsWithin(file.path, rootPath) &&
        !isExcludedPath(file.path) &&
        !isSensitivePath(file.path)
    );
}

function safeProgramFolders(
  program: DashboardProgram,
  rootPath: string
): string[] {
  return [...new Set(program.folderPaths ?? [])]
    .map(normalizeVaultPath)
    .filter(
      (path) =>
        path !== rootPath &&
        pathIsWithin(path, rootPath) &&
        !isExcludedPath(path) &&
        !isSensitivePath(path)
    );
}

function folderBreadcrumbs(
  program: DashboardProgram,
  rootPath: string,
  currentPath: string
): ProgramFolderBreadcrumb[] {
  const breadcrumbs: ProgramFolderBreadcrumb[] = [
    { name: program.name || lastPathSegment(rootPath), path: rootPath },
  ];
  const relativePath = currentPath.slice(rootPath.length).replace(/^\/+/, "");
  if (!relativePath) return breadcrumbs;

  let path = rootPath;
  for (const name of relativePath.split("/").filter(Boolean)) {
    path = `${path}/${name}`;
    breadcrumbs.push({ name, path });
  }
  return breadcrumbs;
}

function parentFolderPath(path: string): string | null {
  const normalizedPath = normalizeVaultPath(path);
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex > 0 ? normalizedPath.slice(0, slashIndex) : null;
}

function lastPathSegment(path: string): string {
  const normalizedPath = normalizeVaultPath(path);
  return normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1);
}

function sortFiles(files: DashboardFileItem[]): DashboardFileItem[] {
  return [...files].sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path)
  );
}

function fileMatchesQuery(
  file: DashboardFileItem,
  normalizedQuery: string
): boolean {
  return valuesMatch(
    normalizedQuery,
    file.title,
    file.path,
    file.extension,
    file.category
  );
}

function valuesMatch(
  normalizedQuery: string,
  ...values: Array<string | number>
): boolean {
  return values.some((value) =>
    String(value).toLocaleLowerCase().includes(normalizedQuery)
  );
}

function normalizeQuery(query: string): string {
  return String(query ?? "").trim().toLocaleLowerCase();
}
