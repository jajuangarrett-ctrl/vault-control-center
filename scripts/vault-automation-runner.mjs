#!/usr/bin/env node
import { execFile as nodeExecFile } from "node:child_process";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildExecutorHeartbeat,
  processAutomationClaim,
} from "./vault-automation-runner-core.mjs";

const execFile = promisify(nodeExecFile);
const runtimeDir = path.join(os.homedir(), "Library", "Application Support", "FJG Vault Automation");
const configPath = path.join(runtimeDir, "config.json");
const statePath = path.join(runtimeDir, "processed-requests.json");
const logDir = path.join(os.homedir(), "Library", "Logs", "FJG Vault Automation");
const logPath = path.join(logDir, "runner.log");
const keychainService = "com.fjg.vault-automation-runner";
const keychainAccount = "executor";
const idlePollMs = 60_000;
const activePollMs = 15_000;
const maxBackoffMs = 5 * 60_000;
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

await ensurePrivateRuntime();
const config = await readConfig();
const token = await readExecutorToken();
let delayMs = idlePollMs;

while (!stopping) {
  try {
    const heartbeat = await buildExecutorHeartbeat();
    const response = await api(config.baseUrl, token, "/api/vault-automation/runner/poll", heartbeat);
    if (response.request) {
      const journal = await readJournal();
      let event = journal[response.request.requestId];
      if (event) event = { ...event, occurredAt: new Date().toISOString() };
      if (!event) {
        try {
          event = await processAutomationClaim(response.request);
        } catch {
          event = {
            requestId: response.request.requestId,
            jobId: response.request.jobId,
            occurredAt: new Date().toISOString(),
            state: "failed",
            reasonCode: "malformed-claim",
          };
        }
        journal[response.request.requestId] = event;
        await writeJournal(journal);
      }
      await api(config.baseUrl, token, "/api/vault-automation/runner/events", event);
      await log(`request ${response.request.requestId} ${event.state} ${event.reasonCode}`);
      delayMs = activePollMs;
    } else {
      delayMs = idlePollMs;
    }
  } catch (error) {
    await log(`poll failed: ${safeError(error)}`);
    delayMs = Math.min(maxBackoffMs, Math.max(idlePollMs, delayMs * 2));
  }
  if (!stopping) await wait(delayMs);
}

async function api(baseUrl, token, route, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

async function readConfig() {
  const value = JSON.parse(await readFile(configPath, "utf8"));
  if (!value || typeof value.baseUrl !== "string") throw new Error("Runner config is missing");
  const url = new URL(value.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Runner broker URL is invalid");
  }
  return { baseUrl: url.toString().replace(/\/$/, "") };
}

async function readExecutorToken() {
  const result = await execFile(
    "/usr/bin/security",
    ["find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w"],
    { encoding: "utf8", maxBuffer: 16 * 1024, timeout: 5_000, shell: false }
  );
  const token = result.stdout.trim();
  if (!/^[A-Za-z0-9_-]{43,256}$/.test(token)) throw new Error("Executor credential is unavailable");
  return token;
}

async function readJournal() {
  try {
    const value = JSON.parse(await readFile(statePath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

async function writeJournal(journal) {
  const entries = Object.entries(journal)
    .filter(([, value]) => Date.now() - Date.parse(value.occurredAt ?? "") < 7 * 24 * 60 * 60_000)
    .slice(-500);
  await writeFile(statePath, `${JSON.stringify(Object.fromEntries(entries), null, 2)}\n`, { mode: 0o600 });
  await chmod(statePath, 0o600);
}

async function ensurePrivateRuntime() {
  await mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  await mkdir(logDir, { recursive: true, mode: 0o700 });
  await chmod(runtimeDir, 0o700);
  await chmod(logDir, 0o700);
  await writeFile(logPath, "", { flag: "a", mode: 0o600 });
  await chmod(logPath, 0o600);
}

async function log(message) {
  await rotateLogIfNeeded();
  const line = `${new Date().toISOString()} ${message.replace(/[\r\n]+/g, " ").slice(0, 400)}\n`;
  await writeFile(logPath, line, { flag: "a", mode: 0o600 });
  await chmod(logPath, 0o600);
}

async function rotateLogIfNeeded() {
  try {
    if ((await stat(logPath)).size < 1_000_000) return;
    for (let index = 4; index >= 1; index -= 1) {
      try {
        await rename(`${logPath}.${index}`, `${logPath}.${index + 1}`);
      } catch {}
    }
    await rename(logPath, `${logPath}.1`);
  } catch {}
}

function safeError(error) {
  if (error?.name === "AbortError") return "network timeout";
  const message = String(error?.message ?? "unknown error");
  return message.replace(/Bearer\s+[A-Za-z0-9_-]+/gi, "Bearer [redacted]").slice(0, 200);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
