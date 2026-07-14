import type { App, TFile } from "obsidian";

export const AI_FOLDER_KEYS = [
  "emailQueue",
  "formattedNotes",
  "ownerInbox",
  "teamInbox",
] as const;

export type AiFolderKey = (typeof AI_FOLDER_KEYS)[number];

export interface DashboardDataSettings {
  programsFolder: string;
  peopleFolder: string;
  aiFolders: Record<AiFolderKey, string>;
  recentRoots: string[];
  tasksFilePath: string;
}

export interface DashboardDataLimits {
  queueFiles: number;
  peopleFiles: number;
  recentFiles: number;
}

export interface DashboardDataBuildOptions {
  limits?: Partial<DashboardDataLimits>;
  now?: Date;
  bookmarksPath?: string;
}

export type DashboardFileCategory =
  | "programs"
  | "ai"
  | "people"
  | "tasks"
  | "areas"
  | "vault";

export interface DashboardFileItem {
  title: string;
  name: string;
  path: string;
  extension: string;
  modifiedAt: number;
  createdAt: number;
  size: number;
  category: DashboardFileCategory;
}

export interface DashboardProgram {
  name: string;
  path: string;
  count: number;
  files: DashboardFileItem[];
}

export interface DashboardAiQueue {
  key: AiFolderKey;
  label: string;
  path: string;
  count: number;
  files: DashboardFileItem[];
}

export interface DashboardPeopleData {
  path: string;
  count: number;
  files: DashboardFileItem[];
}

export type DashboardBookmarkType = "file" | "folder" | "url";

export interface DashboardBookmark {
  type: DashboardBookmarkType;
  label: string;
  target: string;
  displayTarget: string;
  group: string;
}

export interface ParsedBookmarks {
  visible: DashboardBookmark[];
  hiddenCount: number;
}

export interface DashboardTaskCounts {
  path: string;
  open: number;
  completed: number;
  total: number;
}

export type DashboardSourceStatus =
  | "available"
  | "missing"
  | "excluded"
  | "invalid"
  | "unreadable";

export interface DashboardSourceState {
  path: string;
  status: DashboardSourceStatus;
}

export interface DashboardDataSources {
  programsFolder: DashboardSourceState;
  peopleFolder: DashboardSourceState;
  aiFolders: Record<AiFolderKey, DashboardSourceState>;
  bookmarks: DashboardSourceState;
  tasksFile: DashboardSourceState;
}

export interface DashboardMetrics {
  programs: number;
  aiQueues: number;
  agenda: number;
  bookmarks: number;
  hiddenBookmarks: number;
  openTasks: number;
  totalTasks: number;
}

export interface DashboardData {
  generatedAt: string;
  metrics: DashboardMetrics;
  programs: DashboardProgram[];
  aiQueues: Record<AiFolderKey, DashboardAiQueue>;
  people: DashboardPeopleData;
  recent: DashboardFileItem[];
  bookmarks: DashboardBookmark[];
  tasks: DashboardTaskCounts;
  sources: DashboardDataSources;
}

export const DEFAULT_DASHBOARD_DATA_SETTINGS: DashboardDataSettings = {
  programsFolder: "Programs",
  peopleFolder: "People/Agenda",
  aiFolders: {
    emailQueue: "Operations/Email Queue",
    formattedNotes: "Operations/Formatted Notes",
    ownerInbox: "Operations/Owner Inbox",
    teamInbox: "Operations/Team Inbox",
  },
  recentRoots: [
    "Inbox",
    "Daily Notes",
    "Programs",
    "Areas",
    "Resources",
    "People",
    "Projects",
    "Tasks",
    "Operations",
  ],
  tasksFilePath: "Tasks/Tasks.md",
};

export const DEFAULT_DASHBOARD_DATA_LIMITS: DashboardDataLimits = {
  queueFiles: 12,
  peopleFiles: 18,
  recentFiles: 30,
};

const ALLOWED_EXTENSIONS = new Set([
  "md",
  "canvas",
  "html",
  "pdf",
  "docx",
  "xlsx",
  "xls",
  "csv",
  "txt",
]);

const EXCLUDED_PATH_SEGMENTS = new Set(
  [
    ".git",
    ".obsidian",
    ".claude",
    ".claudian",
    ".codex",
    ".agents",
    ".netlify",
    "+",
    "copilot",
    "netlify",
    "outputs",
    "users",
    "_codex_task_logs",
    "archived",
  ].map((segment) => segment.toLocaleLowerCase())
);

const AI_QUEUE_LABELS: Record<AiFolderKey, string> = {
  emailQueue: "Email queue",
  formattedNotes: "Formatted notes",
  ownerInbox: "Owner inbox",
  teamInbox: "Team inbox",
};

interface FileContext {
  settings: DashboardDataSettings;
  aiPaths: string[];
}

interface BookmarkRecord {
  type?: unknown;
  title?: unknown;
  path?: unknown;
  url?: unknown;
  items?: unknown;
}

export function normalizeVaultPath(value: string): string {
  const normalizedSegments: string[] = [];
  const rawSegments = String(value ?? "")
    .replace(/\\/g, "/")
    .split("/");

  for (const rawSegment of rawSegments) {
    const segment = rawSegment.trim();
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      normalizedSegments.pop();
      continue;
    }
    normalizedSegments.push(segment);
  }

  return normalizedSegments.join("/");
}

export function pathIsWithin(path: string, root: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedRoot = normalizeVaultPath(root);
  return Boolean(
    normalizedRoot &&
      (normalizedPath === normalizedRoot ||
        normalizedPath.startsWith(`${normalizedRoot}/`))
  );
}

export function isSensitivePath(path: string): boolean {
  const normalized = decodePathForInspection(path);
  return /(^|[\/\s._-])(?:passwords?|api[\s._-]*keys?|secrets?|credentials?|tokens?|private[\s._-]*keys?)(?=$|[\/\s._-])/i.test(
    normalized
  );
}

export function isExcludedPath(path: string): boolean {
  const segments = normalizeVaultPath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLocaleLowerCase());

  return segments.some(
    (segment) =>
      segment.startsWith(".") || EXCLUDED_PATH_SEGMENTS.has(segment)
  );
}

export function normalizeFileTitle(name: string): string {
  const withoutExtension = String(name ?? "").replace(/\.[^.]+$/, "");
  return withoutExtension
    .replace(/\s+[0-9a-fA-F]{32}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function countMarkdownTasks(markdown: string): Omit<DashboardTaskCounts, "path"> {
  let open = 0;
  let completed = 0;
  let fenceMarker = "";
  let fenceLength = 0;

  for (const line of String(markdown ?? "").split(/\r?\n/)) {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1][0];
      if (!fenceMarker) {
        fenceMarker = marker;
        fenceLength = fence[1].length;
      } else if (marker === fenceMarker && fence[1].length >= fenceLength) {
        fenceMarker = "";
        fenceLength = 0;
      }
      continue;
    }

    if (fenceMarker) continue;

    const task = line.match(
      /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\](?:\s+|$)/
    );
    if (!task) continue;
    if (task[1].toLocaleLowerCase() === "x") completed += 1;
    else open += 1;
  }

  return { open, completed, total: open + completed };
}

export function parseBookmarks(input: unknown): ParsedBookmarks {
  const rootItems = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.items)
      ? input.items
      : [];
  const visible: DashboardBookmark[] = [];
  let hiddenCount = 0;

  const visit = (items: unknown[], inheritedGroup: string): void => {
    for (const candidate of items) {
      if (!isRecord(candidate)) continue;
      const item = candidate as BookmarkRecord;
      const type = stringValue(item.type);

      if (type === "group") {
        const group = stringValue(item.title) || inheritedGroup;
        if (Array.isArray(item.items)) visit(item.items, group);
        continue;
      }

      if (type !== "file" && type !== "folder" && type !== "url") continue;
      const target = stringValue(type === "url" ? item.url : item.path);
      if (!target) continue;
      const safeUrl = type === "url" ? inspectExternalUrl(target) : null;
      if (type === "url" && !safeUrl) {
        hiddenCount += 1;
        continue;
      }
      const displayTarget = safeUrl?.displayTarget ?? target;
      const label = stringValue(item.title) || labelFromTarget(displayTarget);
      const excluded =
        isSensitivePath(`${inheritedGroup}/${label}/${target}`) ||
        (type !== "url" && isExcludedPath(target));

      if (excluded) {
        hiddenCount += 1;
        continue;
      }

      visible.push({ type, label, target, displayTarget, group: inheritedGroup });
    }
  };

  visit(rootItems, "");
  return { visible, hiddenCount };
}

export async function buildDashboardData(
  app: App,
  settings: DashboardDataSettings,
  options: DashboardDataBuildOptions = {}
): Promise<DashboardData> {
  const normalizedSettings = normalizeSettings(settings);
  const limits = normalizeLimits(options.limits);
  const bookmarksPath = normalizeVaultPath(
    options.bookmarksPath ?? `${app.vault.configDir}/bookmarks.json`
  );
  const now = options.now ?? new Date();
  const context: FileContext = {
    settings: normalizedSettings,
    aiPaths: AI_FOLDER_KEYS.map((key) => normalizedSettings.aiFolders[key]),
  };

  const vaultFiles = safeVaultFiles(app)
    .filter((file) => isVisibleFile(file.path, file.extension))
    .map((file) => ({ raw: file, item: toDashboardFile(file, context) }));

  const programMap = new Map<string, DashboardFileItem[]>();
  for (const { item } of vaultFiles) {
    const programName = firstChildSegment(item.path, normalizedSettings.programsFolder);
    if (!programName) continue;
    const programFiles = programMap.get(programName) ?? [];
    programFiles.push(item);
    programMap.set(programName, programFiles);
  }

  const programs = [...programMap.entries()]
    .map(([name, files]): DashboardProgram => {
      const sorted = sortFiles(files);
      return {
        name,
        path: `${normalizedSettings.programsFolder}/${name}`,
        count: sorted.length,
        files: sorted,
      };
    })
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  const aiQueues = Object.fromEntries(
    AI_FOLDER_KEYS.map((key) => {
      const path = normalizedSettings.aiFolders[key];
      const files = sortFiles(
        vaultFiles
          .filter(({ item }) => pathIsWithin(item.path, path))
          .map(({ item }) => item)
      );
      const queue: DashboardAiQueue = {
        key,
        label: AI_QUEUE_LABELS[key],
        path,
        count: files.length,
        files: files.slice(0, limits.queueFiles),
      };
      return [key, queue];
    })
  ) as Record<AiFolderKey, DashboardAiQueue>;

  const peopleFiles = sortFiles(
    vaultFiles
      .filter(({ item }) =>
        pathIsWithin(item.path, normalizedSettings.peopleFolder)
      )
      .map(({ item }) => item)
  );
  const people: DashboardPeopleData = {
    path: normalizedSettings.peopleFolder,
    count: peopleFiles.length,
    files: peopleFiles.slice(0, limits.peopleFiles),
  };

  const recent = sortFiles(
    vaultFiles
      .filter(({ item }) =>
        normalizedSettings.recentRoots.some((root) =>
          pathIsWithin(item.path, root)
        )
      )
      .map(({ item }) => item)
  ).slice(0, limits.recentFiles);

  const taskFile = vaultFiles.find(
    ({ item }) => item.path === normalizedSettings.tasksFilePath
  )?.raw;

  const [bookmarksResult, tasksResult, programsSource, peopleSource, ...aiSources] =
    await Promise.all([
      readBookmarks(app, bookmarksPath),
      readTasks(app, normalizedSettings.tasksFilePath, taskFile),
      inspectSource(app, normalizedSettings.programsFolder),
      inspectSource(app, normalizedSettings.peopleFolder),
      ...AI_FOLDER_KEYS.map((key) =>
        inspectSource(app, normalizedSettings.aiFolders[key])
      ),
    ]);

  const aiSourceMap = Object.fromEntries(
    AI_FOLDER_KEYS.map((key, index) => [key, aiSources[index]])
  ) as Record<AiFolderKey, DashboardSourceState>;
  const aiQueueCount = AI_FOLDER_KEYS.reduce(
    (sum, key) => sum + aiQueues[key].count,
    0
  );

  return {
    generatedAt: validDate(now).toISOString(),
    metrics: {
      programs: programs.length,
      aiQueues: aiQueueCount,
      agenda: people.count,
      bookmarks: bookmarksResult.bookmarks.visible.length,
      hiddenBookmarks: bookmarksResult.bookmarks.hiddenCount,
      openTasks: tasksResult.tasks.open,
      totalTasks: tasksResult.tasks.total,
    },
    programs,
    aiQueues,
    people,
    recent,
    bookmarks: bookmarksResult.bookmarks.visible,
    tasks: tasksResult.tasks,
    sources: {
      programsFolder: programsSource,
      peopleFolder: peopleSource,
      aiFolders: aiSourceMap,
      bookmarks: bookmarksResult.source,
      tasksFile: tasksResult.source,
    },
  };
}

function normalizeSettings(settings: DashboardDataSettings): DashboardDataSettings {
  return {
    programsFolder: normalizeVaultPath(settings.programsFolder),
    peopleFolder: normalizeVaultPath(settings.peopleFolder),
    aiFolders: Object.fromEntries(
      AI_FOLDER_KEYS.map((key) => [
        key,
        normalizeVaultPath(settings.aiFolders?.[key] ?? ""),
      ])
    ) as Record<AiFolderKey, string>,
    recentRoots: [...new Set((settings.recentRoots ?? []).map(normalizeVaultPath))].filter(
      Boolean
    ),
    tasksFilePath: normalizeVaultPath(settings.tasksFilePath),
  };
}

function normalizeLimits(
  limits: Partial<DashboardDataLimits> | undefined
): DashboardDataLimits {
  return {
    queueFiles: positiveLimit(limits?.queueFiles, DEFAULT_DASHBOARD_DATA_LIMITS.queueFiles),
    peopleFiles: positiveLimit(limits?.peopleFiles, DEFAULT_DASHBOARD_DATA_LIMITS.peopleFiles),
    recentFiles: positiveLimit(limits?.recentFiles, DEFAULT_DASHBOARD_DATA_LIMITS.recentFiles),
  };
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && Number(value) >= 0
    ? Math.floor(Number(value))
    : fallback;
}

function safeVaultFiles(app: App): TFile[] {
  try {
    return app.vault.getFiles();
  } catch {
    return [];
  }
}

function isVisibleFile(path: string, extension: string): boolean {
  return (
    ALLOWED_EXTENSIONS.has(String(extension ?? "").toLocaleLowerCase()) &&
    !isExcludedPath(path) &&
    !isSensitivePath(path)
  );
}

function toDashboardFile(file: TFile, context: FileContext): DashboardFileItem {
  const name = String(file.name ?? lastPathSegment(file.path));
  const extension = String(file.extension ?? extensionFromName(name)).toLocaleLowerCase();
  return {
    title: normalizeFileTitle(name),
    name,
    path: normalizeVaultPath(file.path),
    extension,
    modifiedAt: finiteNumber(file.stat?.mtime),
    createdAt: finiteNumber(file.stat?.ctime),
    size: finiteNumber(file.stat?.size),
    category: categoryForPath(file.path, context),
  };
}

function categoryForPath(path: string, context: FileContext): DashboardFileCategory {
  if (pathIsWithin(path, context.settings.programsFolder)) return "programs";
  if (context.aiPaths.some((root) => pathIsWithin(path, root))) return "ai";
  if (pathIsWithin(path, context.settings.peopleFolder)) return "people";
  if (normalizeVaultPath(path) === context.settings.tasksFilePath) return "tasks";
  if (/^(?:\d+\s+)?areas(?:\/|$)/i.test(normalizeVaultPath(path))) return "areas";
  return "vault";
}

function firstChildSegment(path: string, root: string): string {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedRoot = normalizeVaultPath(root);
  if (!normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) return "";
  const relativePath = normalizedPath.slice(normalizedRoot.length + 1);
  const slashIndex = relativePath.indexOf("/");
  return slashIndex > 0 ? relativePath.slice(0, slashIndex) : "";
}

function sortFiles(files: DashboardFileItem[]): DashboardFileItem[] {
  return [...files].sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt || left.path.localeCompare(right.path)
  );
}

async function inspectSource(
  app: App,
  path: string,
  allowExcluded = false
): Promise<DashboardSourceState> {
  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath) return { path: normalizedPath, status: "missing" };
  if (
    !allowExcluded &&
    (isSensitivePath(normalizedPath) || isExcludedPath(normalizedPath))
  ) {
    return { path: normalizedPath, status: "excluded" };
  }

  try {
    const exists = await app.vault.adapter.exists(normalizedPath);
    return { path: normalizedPath, status: exists ? "available" : "missing" };
  } catch {
    return { path: normalizedPath, status: "unreadable" };
  }
}

async function readBookmarks(
  app: App,
  path: string
): Promise<{ bookmarks: ParsedBookmarks; source: DashboardSourceState }> {
  // The bookmarks source is the one deliberate read from Obsidian's hidden
  // configuration folder. Individual bookmark targets are still filtered.
  const source = await inspectSource(app, path, true);
  if (source.status !== "available") {
    return { bookmarks: { visible: [], hiddenCount: 0 }, source };
  }

  try {
    const text = await app.vault.adapter.read(path);
    const parsed = JSON.parse(text) as unknown;
    return { bookmarks: parseBookmarks(parsed), source };
  } catch {
    return {
      bookmarks: { visible: [], hiddenCount: 0 },
      source: { path, status: "invalid" },
    };
  }
}

async function readTasks(
  app: App,
  path: string,
  file: TFile | undefined
): Promise<{ tasks: DashboardTaskCounts; source: DashboardSourceState }> {
  const empty: DashboardTaskCounts = { path, open: 0, completed: 0, total: 0 };
  const source = await inspectSource(app, path);
  if (source.status !== "available") return { tasks: empty, source };

  try {
    const text = file
      ? await app.vault.cachedRead(file)
      : await app.vault.adapter.read(path);
    return { tasks: { path, ...countMarkdownTasks(text) }, source };
  } catch {
    return {
      tasks: empty,
      source: { path, status: "unreadable" },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function labelFromTarget(target: string): string {
  const withoutTrailingSlash = target.replace(/\/+$/, "");
  return lastPathSegment(withoutTrailingSlash) || target;
}

function inspectExternalUrl(target: string): { displayTarget: string } | null {
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password) return null;
    for (const key of parsed.searchParams.keys()) {
      if (/^(?:api[-_.]?key|auth|credential|password|secret|signature|token)$/i.test(key)) {
        return null;
      }
    }
    return { displayTarget: parsed.origin };
  } catch {
    return null;
  }
}

function lastPathSegment(path: string): string {
  const segments = String(path ?? "").split("/").filter(Boolean);
  return segments.length ? segments[segments.length - 1] : "";
}

function extensionFromName(name: string): string {
  const match = String(name ?? "").match(/\.([^.]+)$/);
  return match?.[1] ?? "";
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function validDate(value: Date): Date {
  return Number.isNaN(value.getTime()) ? new Date(0) : value;
}

function decodePathForInspection(path: string): string {
  const normalized = normalizeVaultPath(String(path ?? "").replace(/\+/g, " "));
  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}
