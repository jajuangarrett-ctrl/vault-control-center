import { execFile as nodeExecFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

export const EXECUTOR_SENTINEL_LABEL = "com.fjg.vault-automation-executor";
export const OBSIDIAN_RELOAD_ID = "reload-obsidian";
export const OBSIDIAN_CLI = "/Applications/Obsidian.app/Contents/MacOS/obsidian-cli";
const OBSIDIAN_RELOAD_CODE = 'app.commands.executeCommandById("app:reload")';
export const AUTOMATION_LABELS = Object.freeze({
  "vault-folder-processing": "com.franklingarrett.vault-folder-process",
  clippings: "com.franklingarrett.clippings-inbox-sort",
  "root-inbox": "com.franklingarrett.root-inbox-sort",
  "mira-email-filing": "com.franklingarrett.mira-email-sort",
  "iflytek-notes": "com.franklingarrett.iflytek-notes-process",
  "youtube-notes": "com.franklingarrett.youtube-transcript-note",
  "fjg-capture-transcripts": "com.franklingarrett.fjg-capture-transcripts-process",
  "weekly-learning-review": "com.franklingarrett.codex-weekly-learning-review",
  "formatted-notes-filing": "com.franklingarrett.formatted-notes-file",
  "thought-capture-organizing": "com.franklingarrett.thought-capture-organize",
});

const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const execFilePromise = promisify(nodeExecFile);

export async function buildExecutorHeartbeat(options = {}) {
  const now = options.now ?? new Date();
  const uid = checkedUid(options.uid ?? process.getuid?.());
  const execFile = options.execFile ?? safeExecFile;
  const sentinel = await inspectLaunchdLabel(execFile, uid, EXECUTOR_SENTINEL_LABEL);
  const runnableJobIds = [];
  if (sentinel.loaded) {
    for (const [jobId, label] of Object.entries(AUTOMATION_LABELS)) {
      const target = await inspectLaunchdLabel(execFile, uid, label);
      if (target.loaded && !target.running && !isNearScheduledRun(jobId, now)) runnableJobIds.push(jobId);
    }
  }
  return {
    observedAt: now.toISOString(),
    sentinelLoaded: sentinel.loaded,
    runnableJobIds,
    obsidianReloadAvailable: sentinel.loaded && await isObsidianReloadAvailable(options),
    memory: sentinel.loaded ? await readMemory(options) : null,
  };
}

export async function processAutomationClaim(claim, options = {}) {
  const now = options.now ?? new Date();
  const uid = checkedUid(options.uid ?? process.getuid?.());
  const execFile = options.execFile ?? safeExecFile;
  const request = validateClaim(claim, now);
  const base = {
    requestId: request.requestId,
    jobId: request.jobId,
    occurredAt: now.toISOString(),
  };

  const sentinel = await inspectLaunchdLabel(execFile, uid, EXECUTOR_SENTINEL_LABEL);
  if (!sentinel.loaded) {
    return { ...base, state: "rejected", reasonCode: "sentinel-not-loaded" };
  }

  if (request.jobId === OBSIDIAN_RELOAD_ID) {
    if (!await isObsidianReloadAvailable(options)) {
      return { ...base, state: "rejected", reasonCode: "obsidian-cli-unavailable" };
    }
    try {
      await execFile(OBSIDIAN_CLI, ["eval", `code=${OBSIDIAN_RELOAD_CODE}`], commandOptions(10_000));
      return { ...base, state: "started", reasonCode: "obsidian-reload-accepted" };
    } catch {
      return { ...base, state: "failed", reasonCode: "obsidian-reload-failed" };
    }
  }

  const label = AUTOMATION_LABELS[request.jobId];
  const target = await inspectLaunchdLabel(execFile, uid, label);
  if (!target.loaded) {
    return { ...base, state: "rejected", reasonCode: "target-not-loaded" };
  }
  if (target.running) {
    return { ...base, state: "rejected", reasonCode: "already-running" };
  }
  if (isNearScheduledRun(request.jobId, now)) {
    return { ...base, state: "rejected", reasonCode: "scheduled-window" };
  }

  try {
    await execFile(
      "/bin/launchctl",
      ["kickstart", `gui/${uid}/${label}`],
      commandOptions(10_000)
    );
    return { ...base, state: "started", reasonCode: "launchctl-accepted" };
  } catch {
    return { ...base, state: "failed", reasonCode: "kickstart-failed" };
  }
}

export async function inspectLaunchdLabel(execFile, uid, label) {
  if (!Object.values(AUTOMATION_LABELS).includes(label) && label !== EXECUTOR_SENTINEL_LABEL) {
    return { loaded: false, running: false };
  }
  try {
    const result = await execFile(
      "/bin/launchctl",
      ["print", `gui/${checkedUid(uid)}/${label}`],
      commandOptions(4_000)
    );
    const state = String(result.stdout ?? "").match(/^\s*state\s*=\s*(.+?)\s*$/im)?.[1]?.trim() ?? "";
    return { loaded: true, running: state.toLocaleLowerCase() === "running" };
  } catch {
    return { loaded: false, running: false };
  }
}

function validateClaim(value, now) {
  const expected = ["jobId", "requestId", "requestedAt", "expiresAt"].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed claim");
  const keys = Object.keys(value).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Malformed claim");
  }
  if (!Object.hasOwn(AUTOMATION_LABELS, value.jobId) && value.jobId !== OBSIDIAN_RELOAD_ID) throw new Error("Unknown job");
  if (typeof value.requestId !== "string" || !REQUEST_ID_PATTERN.test(value.requestId)) throw new Error("Invalid request ID");
  const requestedAt = parseIso(value.requestedAt);
  const expiresAt = parseIso(value.expiresAt);
  if (!requestedAt || !expiresAt || expiresAt <= now || expiresAt <= requestedAt) throw new Error("Expired claim");
  return {
    jobId: value.jobId,
    requestId: value.requestId.toLocaleLowerCase(),
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function isObsidianReloadAvailable(options = {}) {
  try {
    await (options.access ?? access)(OBSIDIAN_CLI, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readMemory(options) {
  const osProvider = options.osProvider ?? await import("node:os");
  const totalBytes = osProvider.totalmem();
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) return null;
  let freePercent = null;
  try {
    const execFile = options.execFile ?? safeExecFile;
    const result = await execFile(
      "/usr/bin/memory_pressure",
      ["-Q"],
      { encoding: "utf8", maxBuffer: 64 * 1024, shell: false, timeout: 4_000 }
    );
    const match = String(result.stdout ?? "").match(
      /System-wide\s+memory\s+free\s+percentage\s*:\s*([0-9]+(?:\.[0-9]+)?)\s*%/i
    );
    const parsed = Number(match?.[1]);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) freePercent = roundPercent(parsed);
  } catch {}
  if (freePercent === null) {
    const freeBytes = osProvider.freemem();
    if (!Number.isFinite(freeBytes) || freeBytes < 0 || freeBytes > totalBytes) return null;
    freePercent = roundPercent(Math.min(100, Math.max(0, (freeBytes / totalBytes) * 100)));
  }
  const usedPercent = roundPercent(100 - freePercent);
  return {
    totalBytes: Math.round(totalBytes),
    usedBytes: Math.max(0, Math.round(totalBytes * (usedPercent / 100))),
    freePercent,
    usedPercent,
  };
}

function checkedUid(value) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid current-user UID");
  return value;
}

function parseIso(value) {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.toISOString() === value ? date : null;
}

function roundPercent(value) {
  return Math.round(value * 10) / 10;
}

export function isNearScheduledRun(jobId, now, windowMinutes = 2) {
  if (!Object.hasOwn(AUTOMATION_LABELS, jobId)) return false;
  const minuteOfDay = now.getHours() * 60 + now.getMinutes();
  return [18 * 60 + 10].some((scheduledMinute) =>
    Math.abs(minuteOfDay - scheduledMinute) <= windowMinutes
  );
}

function commandOptions(timeout) {
  return { encoding: "utf8", maxBuffer: 128 * 1024, shell: false, timeout };
}

async function safeExecFile(executable, args, options) {
  return execFilePromise(executable, [...args], options);
}
