import type { App, TFile } from "obsidian";

export type AutomationGroup = "routine-vault" | "services-sync" | "external-cloud";
export type AutomationManualPolicy =
  | "routine"
  | "status-only"
  | "service"
  | "high-impact"
  | "disabled"
  | "external";

export interface AutomationDefinition {
  id: string;
  label: string;
  description: string;
  group: AutomationGroup;
  schedule: string;
  manualPolicy: AutomationManualPolicy;
  launchdLabel?: string;
  statusPath?: string;
  statusKind?: "weekly-review";
  expectedState?: "configured" | "disabled" | "missing" | "external";
}

/**
 * This is the complete command allowlist. A vault file can report status, but
 * it can never add a command or change a launchd label at runtime.
 */
export const FJG_AUTOMATION_ALLOWLIST: readonly AutomationDefinition[] = [
  {
    id: "clippings",
    label: "Clippings inbox",
    description: "Files new clippings into their approved vault destinations.",
    group: "routine-vault",
    schedule: "Daily at 08:00, 12:00, and 18:00",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.clippings-inbox-sort",
    statusPath: "Clippings/Clippings Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "root-inbox",
    label: "Root inbox",
    description: "Sorts eligible files waiting at the root of 00 Inbox.",
    group: "routine-vault",
    schedule: "Daily at 08:10, 12:10, and 18:10",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.root-inbox-sort",
    statusPath: "00 Inbox/Inbox Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "mira-email-filing",
    label: "Mira email filing",
    description: "Files ordinary saved Mira emails; its exact launchd label is not confirmed.",
    group: "routine-vault",
    schedule: "Daily at 08:20, 12:20, and 18:20",
    manualPolicy: "status-only",
    statusPath: "AI Team/Mira Emails/Processed Emails/Mira Email Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "iflytek-notes",
    label: "iFLYTEK notes",
    description: "Formats and files new iFLYTEK transcript sources.",
    group: "routine-vault",
    schedule: "Daily at 08:30, 12:30, and 18:30",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.iflytek-notes-process",
    statusPath: "00 Inbox/Iflytex Notes/Processed/iFLYTEK Notes Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "youtube-notes",
    label: "YouTube transcript notes",
    description: "Creates source-backed notes for queued YouTube videos.",
    group: "routine-vault",
    schedule: "Daily at 08:40, 12:40, and 18:40",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.youtube-transcript-note",
    statusPath:
      "00 Inbox/YouTube Videos to Process/Processed YT Videos/YouTube Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "fjg-capture-transcripts",
    label: "FJG capture transcripts",
    description: "Formats and files transcripts received from FJG Capture.",
    group: "routine-vault",
    schedule: "Daily at 08:50, 12:50, and 18:50",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.fjg-capture-transcripts-process",
    statusPath:
      "00 Inbox/FJG Capture Transcripts/Processed/FJG Capture Transcripts Processing Status.md",
    expectedState: "configured",
  },
  {
    id: "weekly-learning-review",
    label: "Weekly Codex learning review",
    description: "Produces Franklin's bounded weekly candidate-learning review.",
    group: "routine-vault",
    schedule: "Friday at 16:00",
    manualPolicy: "routine",
    launchdLabel: "com.franklingarrett.codex-weekly-learning-review",
    statusKind: "weekly-review",
    expectedState: "configured",
  },
  {
    id: "agent-mission-control",
    label: "Agent Mission Control runner",
    description: "Keeps the local mission queue runner available as a background service.",
    group: "services-sync",
    schedule: "Continuous service",
    manualPolicy: "service",
    launchdLabel: "com.fjg.agent-mission-control.runner",
    expectedState: "configured",
  },
  {
    id: "auto-commit-codex-repos",
    label: "Codex repository auto-commit",
    description: "Commits local source changes; manual execution is intentionally blocked here.",
    group: "services-sync",
    schedule: "Every hour",
    manualPolicy: "high-impact",
    launchdLabel: "com.franklin.auto-commit-codex-repos",
    expectedState: "configured",
  },
  {
    id: "auto-pull-plugin-repos",
    label: "Plugin repository auto-pull",
    description: "Legacy minute-based plugin repository sync, currently disabled.",
    group: "services-sync",
    schedule: "Every minute (disabled)",
    manualPolicy: "disabled",
    launchdLabel: "com.franklin.auto-pull-plugin-repos",
    expectedState: "disabled",
  },
  {
    id: "auto-pull-ios-repos",
    label: "iOS repository auto-pull",
    description: "Legacy minute-based iOS repository sync, currently disabled.",
    group: "services-sync",
    schedule: "Every minute (disabled)",
    manualPolicy: "disabled",
    launchdLabel: "com.franklin.auto-pull-ios-repos",
    expectedState: "disabled",
  },
  {
    id: "mira-local-sync",
    label: "Mira local sync",
    description: "Legacy Mira email source synchronization; shown for status only.",
    group: "services-sync",
    schedule: "Background sync",
    manualPolicy: "status-only",
    launchdLabel: "com.fjg.mira-email-local-sync",
    expectedState: "configured",
  },
  {
    id: "outlook-exporter",
    label: "Outlook local exporter",
    description: "Expected Outlook export service; its local launch agent is currently missing.",
    group: "services-sync",
    schedule: "Not installed",
    manualPolicy: "status-only",
    expectedState: "missing",
  },
  {
    id: "gmail-capture",
    label: "Gmail capture",
    description: "Google Apps Script capture trigger managed in the Google cloud.",
    group: "external-cloud",
    schedule: "Every minute",
    manualPolicy: "external",
    expectedState: "external",
  },
  {
    id: "netlify-retention-cleanup",
    label: "Netlify retention cleanup",
    description: "Cloud-side retention cleanup managed by its Netlify project.",
    group: "external-cloud",
    schedule: "Netlify scheduled function",
    manualPolicy: "external",
    expectedState: "external",
  },
] as const;

export interface AutomationCommandOptions {
  encoding: "utf8";
  maxBuffer: number;
  shell: false;
  timeout: number;
}

export interface AutomationCommandResult {
  stdout: string;
  stderr: string;
}

export type AutomationExecFile = (
  executable: string,
  args: readonly string[],
  options: AutomationCommandOptions
) => Promise<AutomationCommandResult>;

export interface AutomationPlatformOptions {
  /** True only for Obsidian desktop on macOS. */
  isDesktopMac: boolean;
  uid?: number;
  now?: Date;
  execFile?: AutomationExecFile;
}

export type AutomationLaunchdAvailability = "loaded" | "not-loaded" | "not-checked";
export type AutomationItemAvailability =
  | "ready"
  | "remote-ready"
  | "remote-unavailable"
  | "remote"
  | "not-loaded"
  | "status-only"
  | "service"
  | "high-impact"
  | "disabled"
  | "external"
  | "missing";
export type AutomationHealthTone = "positive" | "attention" | "critical" | "neutral";

export interface ParsedAutomationStatus {
  result: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AutomationItemSnapshot extends AutomationDefinition {
  resolvedStatusPath: string | null;
  statusReadState: "available" | "missing" | "error" | "not-configured";
  statusMessage: string;
  lastResult: string | null;
  lastStartedAt: string | null;
  lastCompletedAt: string | null;
  launchdAvailability: AutomationLaunchdAvailability;
  loaded: boolean | null;
  running: boolean | null;
  launchdState: string | null;
  lastExitCode: number | null;
  healthTone: AutomationHealthTone;
  healthMessage: string;
  availability: AutomationItemAvailability;
  canRun: boolean;
  runTarget: "local" | "remote" | null;
  runState: "ready" | "running" | "unavailable";
  runMessage: string;
}

export interface AutomationSnapshot {
  status: "ready";
  checkedAt: string;
  isDesktopMac: boolean;
  isExecutor: boolean;
  executorState: "executor" | "non-executor" | "unsupported";
  uid: number | null;
  message: string;
  items: AutomationItemSnapshot[];
}

export interface AutomationRunContext {
  snapshot: AutomationSnapshot;
  execFile?: AutomationExecFile;
  uid?: number;
}

export interface AutomationRunResult {
  id: string;
  status: "started" | "rejected" | "error";
  message: string;
}

interface StatusReadResult extends ParsedAutomationStatus {
  resolvedStatusPath: string | null;
  state: AutomationItemSnapshot["statusReadState"];
  message: string;
}

interface LaunchdReadResult {
  availability: AutomationLaunchdAvailability;
  loaded: boolean | null;
  running: boolean | null;
  state: string | null;
  lastExitCode: number | null;
}

const LAUNCHCTL_EXECUTABLE = "/bin/launchctl";
const LAUNCHCTL_PRINT_OPTIONS: AutomationCommandOptions = {
  encoding: "utf8",
  maxBuffer: 128 * 1024,
  shell: false,
  timeout: 4_000,
};
const LAUNCHCTL_KICKSTART_OPTIONS: AutomationCommandOptions = {
  encoding: "utf8",
  maxBuffer: 128 * 1024,
  shell: false,
  timeout: 10_000,
};
const WEEKLY_REVIEW_PATTERN =
  /^AI Team\/owner_inbox\/(\d{4}-\d{2}-\d{2})_Review_Weekly-Codex-Learning\.md$/;
const IN_FLIGHT_AUTOMATIONS = new Set<string>();

export function parseAutomationStatusMarkdown(markdown: string): ParsedAutomationStatus {
  const fields = new Map<string, string>();
  for (const line of markdown.split(/\r?\n/)) {
    const boldField = line.match(/^\s*[-*]\s+\*\*([^*:\n]+):\*\*\s*(.*?)\s*$/);
    const plainField = line.match(/^\s*[-*]\s+([^:\n]+):\s*(.*?)\s*$/);
    const match = boldField ?? plainField;
    if (!match) {
      continue;
    }
    const key = match[1].trim().toLocaleLowerCase();
    const value = boundedText(match[2]);
    if (value && !fields.has(key)) {
      fields.set(key, value);
    }
  }

  return {
    result: fields.get("result") ?? null,
    startedAt: fields.get("started") ?? null,
    completedAt: fields.get("completed") ?? null,
  };
}

export function parseLaunchctlPrint(output: string): Pick<
  LaunchdReadResult,
  "running" | "state" | "lastExitCode"
> {
  const stateMatch = output.match(/^\s*state\s*=\s*(.+?)\s*$/im);
  const exitMatch = output.match(/^\s*last exit code\s*=\s*(-?\d+)\s*$/im);
  const state = stateMatch ? boundedText(stateMatch[1], 80) : null;
  return {
    state,
    running: state?.toLocaleLowerCase() === "running",
    lastExitCode: exitMatch ? Number(exitMatch[1]) : null,
  };
}

/** Build a fail-open dashboard model. Status reads and launchd checks are isolated per item. */
export async function buildAutomationSnapshot(
  app: App,
  platformOptions: AutomationPlatformOptions
): Promise<AutomationSnapshot> {
  const checkedAt = (platformOptions.now ?? new Date()).toISOString();
  const uid = platformOptions.isDesktopMac ? resolveUid(platformOptions.uid) : null;
  const statusResults = await Promise.all(
    FJG_AUTOMATION_ALLOWLIST.map((definition) => readStatus(app, definition))
  );

  const launchdResults = new Map<string, LaunchdReadResult>();
  if (platformOptions.isDesktopMac && uid !== null) {
    try {
      const runner = platformOptions.execFile ?? (await loadAutomationRunner());
      const launchdDefinitions = FJG_AUTOMATION_ALLOWLIST.filter(
        (definition): definition is AutomationDefinition & { launchdLabel: string } =>
          Boolean(definition.launchdLabel)
      );
      await Promise.all(
        launchdDefinitions.map(async (definition) => {
          launchdResults.set(
            definition.launchdLabel,
            await readLaunchdJob(runner, uid, definition.launchdLabel)
          );
        })
      );
    } catch {
      // A missing Node bridge must not hide synchronized status information.
    }
  }

  const isExecutor = FJG_AUTOMATION_ALLOWLIST.some(
    (definition) =>
      definition.manualPolicy === "routine" &&
      Boolean(definition.launchdLabel) &&
      launchdResults.get(definition.launchdLabel as string)?.loaded === true
  );
  const executorState: AutomationSnapshot["executorState"] = !platformOptions.isDesktopMac
    ? "unsupported"
    : isExecutor
      ? "executor"
      : "non-executor";

  const items = FJG_AUTOMATION_ALLOWLIST.map((definition, index) => {
    const status = statusResults[index];
    const launchd = definition.launchdLabel
      ? launchdResults.get(definition.launchdLabel) ?? notCheckedLaunchd()
      : notCheckedLaunchd();
    return buildItemSnapshot(definition, status, launchd, executorState);
  });

  return {
    status: "ready",
    checkedAt,
    isDesktopMac: platformOptions.isDesktopMac,
    isExecutor,
    executorState,
    uid,
    message: executorMessage(executorState),
    items,
  };
}

/**
 * Start only a known, loaded routine launchd job on the proven executor Mac.
 * `kickstart` intentionally omits `-k`, so a running process is never killed.
 */
export async function runAutomation(
  id: string,
  context: AutomationRunContext
): Promise<AutomationRunResult> {
  const definition = FJG_AUTOMATION_ALLOWLIST.find((entry) => entry.id === id);
  if (!definition) {
    return rejected(id, "This automation is not in the Vault Control Center allowlist.");
  }
  if (definition.manualPolicy !== "routine" || !definition.launchdLabel) {
    return rejected(id, manualPolicyMessage(definition));
  }
  if (!context.snapshot.isExecutor || context.snapshot.executorState !== "executor") {
    return rejected(id, "Run now is available only on the Mac that owns the automation jobs.");
  }

  const item = context.snapshot.items.find((entry) => entry.id === id);
  if (!item || item.loaded !== true || item.launchdAvailability !== "loaded") {
    return rejected(id, "This automation's launchd job is not loaded on this Mac.");
  }
  if (IN_FLIGHT_AUTOMATIONS.has(id)) {
    return rejected(id, "This automation is already being started.");
  }

  const uid = resolveUid(context.uid ?? context.snapshot.uid ?? undefined);
  if (uid === null) {
    return rejected(id, "The current macOS user could not be identified safely.");
  }

  IN_FLIGHT_AUTOMATIONS.add(id);
  try {
    const runner = context.execFile ?? (await loadAutomationRunner());
    await runner(
      LAUNCHCTL_EXECUTABLE,
      ["kickstart", `gui/${uid}/${definition.launchdLabel}`],
      LAUNCHCTL_KICKSTART_OPTIONS
    );
    return {
      id,
      status: "started",
      message: `${definition.label} was asked to run. Refresh shortly for its latest status.`,
    };
  } catch {
    return {
      id,
      status: "error",
      message: `${definition.label} could not be started by launchd.`,
    };
  } finally {
    IN_FLIGHT_AUTOMATIONS.delete(id);
  }
}

export function isAutomationRunning(id: string): boolean {
  return IN_FLIGHT_AUTOMATIONS.has(id);
}

function buildItemSnapshot(
  definition: AutomationDefinition,
  status: StatusReadResult,
  launchd: LaunchdReadResult,
  executorState: AutomationSnapshot["executorState"]
): AutomationItemSnapshot {
  const availability = itemAvailability(definition, launchd, executorState);
  const health = automationHealth(definition, launchd);
  const inFlight = isAutomationRunning(definition.id);
  const canRun = availability === "ready" && !inFlight;
  return {
    ...definition,
    resolvedStatusPath: status.resolvedStatusPath,
    statusReadState: status.state,
    statusMessage: status.message,
    lastResult: status.result,
    lastStartedAt: status.startedAt,
    lastCompletedAt: status.completedAt,
    launchdAvailability: launchd.availability,
    loaded: launchd.loaded,
    running: launchd.running,
    launchdState: launchd.state,
    lastExitCode: launchd.lastExitCode,
    healthTone: health.tone,
    healthMessage: health.message,
    availability,
    canRun,
    runTarget: canRun ? "local" : null,
    runState: inFlight ? "running" : canRun ? "ready" : "unavailable",
    runMessage: inFlight
      ? "Start request in progress."
      : canRun
        ? "Ready to run on this Mac."
        : availabilityMessage(availability),
  };
}

function automationHealth(
  definition: AutomationDefinition,
  launchd: LaunchdReadResult
): { tone: AutomationHealthTone; message: string } {
  if (!definition.launchdLabel) {
    if (definition.expectedState === "missing") {
      return {
        tone: "critical",
        message: "The expected local service is not installed.",
      };
    }
    if (definition.expectedState === "external") {
      return {
        tone: "neutral",
        message: "Managed externally; local launchd health does not apply.",
      };
    }
    return {
      tone: "neutral",
      message: "No verified launchd label; synchronized workflow status only.",
    };
  }

  if (launchd.availability === "not-checked") {
    return {
      tone: "neutral",
      message: "Local launchd health was not checked on this device.",
    };
  }

  if (launchd.loaded !== true) {
    if (definition.expectedState === "disabled") {
      return {
        tone: "neutral",
        message: "Not loaded, consistent with its disabled configuration.",
      };
    }
    if (definition.manualPolicy === "service") {
      return {
        tone: "critical",
        message: "The expected continuous launchd service is not loaded.",
      };
    }
    return {
      tone: "attention",
      message: "The expected launchd job is not loaded on this Mac.",
    };
  }

  if (definition.expectedState === "disabled") {
    return {
      tone: "attention",
      message: "Unexpectedly loaded even though this automation is marked disabled.",
    };
  }

  if (launchd.lastExitCode !== null && launchd.lastExitCode !== 0) {
    return {
      tone: "attention",
      message: launchd.running
        ? `Running now; the previous launchd exit code was ${launchd.lastExitCode}.`
        : `Loaded; launchd reports previous exit code ${launchd.lastExitCode}.`,
    };
  }

  if (launchd.running) {
    return {
      tone: "positive",
      message: "Running now under launchd.",
    };
  }

  if (definition.manualPolicy === "service") {
    return {
      tone: "attention",
      message: `Loaded, but launchd reports ${launchd.state ?? "not running"}.`,
    };
  }

  return {
    tone: "positive",
    message: launchd.state
      ? `Loaded; launchd reports ${launchd.state}.`
      : "Loaded and available to launchd.",
  };
}

function itemAvailability(
  definition: AutomationDefinition,
  launchd: LaunchdReadResult,
  executorState: AutomationSnapshot["executorState"]
): AutomationItemAvailability {
  if (definition.expectedState === "missing") {
    return "missing";
  }
  switch (definition.manualPolicy) {
    case "external":
      return "external";
    case "disabled":
      return "disabled";
    case "high-impact":
      return "high-impact";
    case "service":
      return "service";
    case "status-only":
      return "status-only";
    case "routine":
      if (executorState !== "executor") {
        return "remote";
      }
      return launchd.loaded ? "ready" : "not-loaded";
  }
}

async function readStatus(
  app: App,
  definition: AutomationDefinition
): Promise<StatusReadResult> {
  try {
    if (definition.statusKind === "weekly-review") {
      return await readWeeklyReviewStatus(app);
    }
    if (!definition.statusPath) {
      return {
        ...emptyParsedStatus(),
        resolvedStatusPath: null,
        state: "not-configured",
        message: "No synchronized status note is configured.",
      };
    }

    const target = app.vault.getAbstractFileByPath(definition.statusPath);
    if (!isVaultFile(target)) {
      return {
        ...emptyParsedStatus(),
        resolvedStatusPath: definition.statusPath,
        state: "missing",
        message: "The synchronized status note has not arrived yet.",
      };
    }
    const markdown = await app.vault.cachedRead(target);
    return {
      ...parseAutomationStatusMarkdown(markdown),
      resolvedStatusPath: definition.statusPath,
      state: "available",
      message: "Latest synchronized status loaded.",
    };
  } catch {
    return {
      ...emptyParsedStatus(),
      resolvedStatusPath: definition.statusPath ?? null,
      state: "error",
      message: "This status note could not be read.",
    };
  }
}

async function readWeeklyReviewStatus(app: App): Promise<StatusReadResult> {
  const files = app.vault
    .getMarkdownFiles()
    .map((file) => ({ file, match: file.path.match(WEEKLY_REVIEW_PATTERN) }))
    .filter(
      (entry): entry is { file: TFile; match: RegExpMatchArray } => entry.match !== null
    )
    .sort((left, right) => right.match[1].localeCompare(left.match[1]));

  const latest = files[0];
  if (!latest) {
    return {
      ...emptyParsedStatus(),
      resolvedStatusPath: null,
      state: "missing",
      message: "No synchronized weekly review has been found yet.",
    };
  }

  const markdown = await app.vault.cachedRead(latest.file);
  const parsed = parseAutomationStatusMarkdown(markdown);
  const frontmatterStatus = markdown.match(/^status:\s*(.+?)\s*$/im)?.[1];
  return {
    result: parsed.result ?? (frontmatterStatus ? humanizeStatus(frontmatterStatus) : "Review ready"),
    startedAt: parsed.startedAt,
    completedAt: parsed.completedAt ?? latest.match[1],
    resolvedStatusPath: latest.file.path,
    state: "available",
    message: "Latest synchronized weekly review found.",
  };
}

async function readLaunchdJob(
  runner: AutomationExecFile,
  uid: number,
  label: string
): Promise<LaunchdReadResult> {
  try {
    const result = await runner(
      LAUNCHCTL_EXECUTABLE,
      ["print", `gui/${uid}/${label}`],
      LAUNCHCTL_PRINT_OPTIONS
    );
    const parsed = parseLaunchctlPrint(result.stdout);
    return {
      availability: "loaded",
      loaded: true,
      ...parsed,
    };
  } catch {
    return {
      availability: "not-loaded",
      loaded: false,
      running: false,
      state: null,
      lastExitCode: null,
    };
  }
}

function notCheckedLaunchd(): LaunchdReadResult {
  return {
    availability: "not-checked",
    loaded: null,
    running: null,
    state: null,
    lastExitCode: null,
  };
}

function resolveUid(value?: number): number | null {
  if (Number.isSafeInteger(value) && (value as number) >= 0) {
    return value as number;
  }
  try {
    if (typeof process !== "undefined" && typeof process.getuid === "function") {
      const uid = process.getuid();
      return Number.isSafeInteger(uid) && uid >= 0 ? uid : null;
    }
  } catch {
    // Restricted Electron contexts may not expose process.getuid.
  }
  return null;
}

function emptyParsedStatus(): ParsedAutomationStatus {
  return { result: null, startedAt: null, completedAt: null };
}

function isVaultFile(value: unknown): value is TFile {
  return Boolean(
    value &&
      typeof value === "object" &&
      "path" in value &&
      typeof (value as { path?: unknown }).path === "string"
  );
}

function executorMessage(state: AutomationSnapshot["executorState"]): string {
  switch (state) {
    case "executor":
      return "This Mac owns the loaded routine automation jobs.";
    case "non-executor":
      return "Synchronized results are visible here; run controls are available on the executor Mac.";
    case "unsupported":
      return "Synchronized results are visible here; launchd controls require desktop macOS.";
  }
}

function availabilityMessage(availability: AutomationItemAvailability): string {
  switch (availability) {
    case "ready":
      return "Ready to run on this Mac.";
    case "remote-ready":
      return "Ready to run on the always-on Mac.";
    case "remote-unavailable":
      return "The remote executor is unavailable or this job is not ready.";
    case "remote":
      return "Run now is available only on the executor Mac.";
    case "not-loaded":
      return "The expected launchd job is not loaded.";
    case "status-only":
      return "Status only; no verified manual command is available.";
    case "service":
      return "Continuous service; manual kickstart is not offered here.";
    case "high-impact":
      return "Manual execution is blocked because this job can commit source changes.";
    case "disabled":
      return "This legacy automation is disabled.";
    case "external":
      return "This automation is managed by an external cloud service.";
    case "missing":
      return "The expected local service is not installed.";
  }
}

function manualPolicyMessage(definition: AutomationDefinition): string {
  switch (definition.manualPolicy) {
    case "status-only":
      return "This entry is status-only because no verified manual command is available.";
    case "service":
      return "Continuous services cannot be manually kicked from this dashboard.";
    case "high-impact":
      return "This high-impact job is intentionally blocked from manual execution.";
    case "disabled":
      return "This automation is disabled.";
    case "external":
      return "This automation is controlled by an external cloud service.";
    case "routine":
      return "This routine automation has no verified launchd label.";
  }
}

function rejected(id: string, message: string): AutomationRunResult {
  return { id, status: "rejected", message };
}

function humanizeStatus(value: string): string {
  const normalized = boundedText(value.replace(/^['"]|['"]$/g, ""), 120);
  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toLocaleUpperCase() + part.slice(1) : part
    )
    .join(" ");
}

function boundedText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
    : normalized;
}

async function loadAutomationRunner(): Promise<AutomationExecFile> {
  const childProcess = await import("node:child_process");
  return (executable, args, options) =>
    new Promise<AutomationCommandResult>((resolve, reject) => {
      childProcess.execFile(
        executable,
        [...args],
        options,
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ stdout, stderr });
        }
      );
    });
}
