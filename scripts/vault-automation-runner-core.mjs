import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";

export const EXECUTOR_SENTINEL_LABEL = "com.fjg.vault-automation-executor";
export const AUTOMATION_LABELS = Object.freeze({
  clippings: "com.franklingarrett.clippings-inbox-sort",
  "root-inbox": "com.franklingarrett.root-inbox-sort",
  "iflytek-notes": "com.franklingarrett.iflytek-notes-process",
  "youtube-notes": "com.franklingarrett.youtube-transcript-note",
  "fjg-capture-transcripts": "com.franklingarrett.fjg-capture-transcripts-process",
  "weekly-learning-review": "com.franklingarrett.codex-weekly-learning-review",
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
      if (target.loaded && !target.running) runnableJobIds.push(jobId);
    }
  }
  return {
    observedAt: now.toISOString(),
    sentinelLoaded: sentinel.loaded,
    runnableJobIds,
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

  const label = AUTOMATION_LABELS[request.jobId];
  const target = await inspectLaunchdLabel(execFile, uid, label);
  if (!target.loaded) {
    return { ...base, state: "rejected", reasonCode: "target-not-loaded" };
  }
  if (target.running) {
    return { ...base, state: "rejected", reasonCode: "already-running" };
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
  if (!Object.hasOwn(AUTOMATION_LABELS, value.jobId)) throw new Error("Unknown job");
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

async function readMemory(options) {
  const osProvider = options.osProvider ?? await import("node:os");
  const totalBytes = osProvider.totalmem();
  const freeBytes = osProvider.freemem();
  if (!Number.isFinite(totalBytes) || totalBytes <= 0 || !Number.isFinite(freeBytes)) return null;
  const freePercent = roundPercent(Math.min(100, Math.max(0, (freeBytes / totalBytes) * 100)));
  const usedPercent = roundPercent(100 - freePercent);
  return {
    totalBytes: Math.round(totalBytes),
    usedBytes: Math.max(0, Math.round(totalBytes - freeBytes)),
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

function commandOptions(timeout) {
  return { encoding: "utf8", maxBuffer: 128 * 1024, shell: false, timeout };
}

async function safeExecFile(executable, args, options) {
  return execFilePromise(executable, [...args], options);
}
