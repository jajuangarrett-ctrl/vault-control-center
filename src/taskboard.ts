import { App, requestUrl } from "obsidian";

export interface TaskboardItem {
  id: string;
  title: string;
  bucket: string;
  project: string;
  assignee: string;
  dueDate: string;
  updatedAt: string;
}

export interface TaskboardSnapshot {
  status: "disabled" | "unconfigured" | "ready" | "error";
  totalCount: number;
  openCount: number;
  buckets: Record<string, number>;
  items: TaskboardItem[];
  updatedAt: string;
  sourceUrl: string;
  error: string;
}

export interface TaskboardSettings {
  reuseTaskCaptureConnection: boolean;
  enableRemoteTaskboard: boolean;
  taskboardUrl: string;
  taskboardSecretId: string;
}

interface RawTask {
  id?: unknown;
  title?: unknown;
  bucket?: unknown;
  status?: unknown;
  project?: unknown;
  projects?: unknown;
  assignee?: unknown;
  contexts?: unknown;
  dueDate?: unknown;
  due?: unknown;
  updatedAt?: unknown;
  dateModified?: unknown;
  createdAt?: unknown;
  dateCreated?: unknown;
  done?: unknown;
  completed?: unknown;
}

interface TaskCaptureConnection {
  sourceUrl: string;
  password: string;
}

type AppWithPlugins = App & {
  plugins?: {
    getPlugin?: (id: string) => unknown;
  };
};

interface TaskCapturePluginShape {
  settings?: {
    taskboardApiUrl?: unknown;
    dashboardPassword?: unknown;
  };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(value: unknown): string {
  return Array.isArray(value) ? asString(value[0]) : "";
}

function bucketFor(task: RawTask): string {
  return asString(task.bucket) || asString(task.status) || "Inbox";
}

function isOpen(task: RawTask): boolean {
  const bucket = bucketFor(task).toLocaleLowerCase();
  return !task.done && !task.completed && bucket !== "completed" && bucket !== "cancelled";
}

function timestampFor(task: RawTask): number {
  const candidate =
    asString(task.updatedAt) ||
    asString(task.dateModified) ||
    asString(task.createdAt) ||
    asString(task.dateCreated) ||
    asString(task.dueDate);
  const timestamp = new Date(candidate).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function cleanCredential(value: string): string {
  const clean = value.trim().replace(/^[\"'`]+|[\"'`]+$/g, "").trim();
  return clean.length >= 1 && clean.length <= 512 && !/\s/.test(clean) ? clean : "";
}

export function normalizeTaskboardUrl(value: string): string | null {
  try {
    const parsed = new URL(value.trim());
    const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocalhost)) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function emptySnapshot(
  status: TaskboardSnapshot["status"],
  sourceUrl: string,
  error = ""
): TaskboardSnapshot {
  return {
    status,
    totalCount: 0,
    openCount: 0,
    buckets: {},
    items: [],
    updatedAt: "",
    sourceUrl,
    error,
  };
}

export async function fetchTaskboardSnapshot(
  app: App,
  settings: TaskboardSettings
): Promise<TaskboardSnapshot> {
  let sourceUrl = "";
  let password = "";

  if (settings.enableRemoteTaskboard) {
    const configuredUrl = normalizeTaskboardUrl(settings.taskboardUrl);
    const secretId = settings.taskboardSecretId.trim();
    if (!configuredUrl || !secretId) {
      return emptySnapshot("unconfigured", "", "Remote taskboard settings are incomplete or invalid.");
    }
    sourceUrl = configuredUrl;
    password = cleanCredential(app.secretStorage.getSecret(secretId) ?? "");
    if (!password) {
      return emptySnapshot("unconfigured", sourceUrl, "The selected Obsidian secret is empty or unavailable.");
    }
  } else if (settings.reuseTaskCaptureConnection) {
    const taskCapture = taskCaptureConnection(app);
    if (!taskCapture) {
      return emptySnapshot("unconfigured", "", "Task Capture has no valid HTTPS taskboard connection.");
    }
    sourceUrl = taskCapture.sourceUrl;
    password = taskCapture.password;
  } else {
    return emptySnapshot("disabled", "");
  }

  let lastError = "The taskboard did not accept the configured credential.";
  try {
      const response = await requestUrl({
        url: `${sourceUrl}/api/tasks`,
        method: "GET",
        headers: { "X-Dashboard-Password": password },
        throw: false,
      });

      if (response.status < 200 || response.status >= 300) {
        lastError = `Taskboard request returned HTTP ${response.status}.`;
        return emptySnapshot("error", sourceUrl, lastError);
      }

      const payload = response.json as { tasks?: unknown; updatedAt?: unknown } | null;
      if (!payload || !Array.isArray(payload.tasks)) {
        lastError = "Taskboard returned an invalid response.";
        return emptySnapshot("error", sourceUrl, lastError);
      }
      const rawTasks = payload.tasks as RawTask[];
      const openTasks = rawTasks.filter(isOpen);
      const buckets: Record<string, number> = {};
      for (const task of openTasks) {
        const bucket = bucketFor(task);
        buckets[bucket] = (buckets[bucket] ?? 0) + 1;
      }

      return {
        status: "ready",
        totalCount: rawTasks.length,
        openCount: openTasks.length,
        buckets,
        items: openTasks
          .sort((left, right) => timestampFor(right) - timestampFor(left))
          .slice(0, 24)
          .map((task) => ({
            id: asString(task.id),
            title: asString(task.title) || "Untitled task",
            bucket: bucketFor(task),
            project: asString(task.project) || firstString(task.projects),
            assignee: asString(task.assignee) || firstString(task.contexts),
            dueDate: asString(task.dueDate) || asString(task.due),
            updatedAt: asString(task.updatedAt) || asString(task.dateModified),
          })),
        updatedAt: asString(payload.updatedAt),
        sourceUrl,
        error: "",
      };
  } catch {
    lastError = "Taskboard request failed.";
  }

  return emptySnapshot("error", sourceUrl, lastError);
}

function taskCaptureConnection(app: App): TaskCaptureConnection | null {
  try {
    const plugin = (app as AppWithPlugins).plugins?.getPlugin?.("task-capture") as
      | TaskCapturePluginShape
      | undefined;
    const sourceUrl = normalizeTaskboardUrl(asString(plugin?.settings?.taskboardApiUrl));
    const password = cleanCredential(asString(plugin?.settings?.dashboardPassword));
    return sourceUrl && password ? { sourceUrl, password } : null;
  } catch {
    return null;
  }
}
