import { requestUrl, type App } from "obsidian";
import {
  FJG_AUTOMATION_ALLOWLIST,
  type AutomationRunResult,
  type AutomationSnapshot,
} from "./automations";
import { getMemoryHealthTone, type SystemMemorySnapshot } from "./system-memory";
import type { DashboardSettings } from "./types";

export type RemoteAutomationConnectionState =
  | "disabled"
  | "unconfigured"
  | "ready"
  | "unreachable"
  | "authentication-failed";

export interface RemoteAutomationSnapshot {
  state: RemoteAutomationConnectionState;
  checkedAt: string;
  reachable: boolean;
  observedAt: string | null;
  runnableJobIds: string[];
  message: string;
  memory: SystemMemorySnapshot;
}

export interface RemoteAutomationRequestResult extends AutomationRunResult {
  requestId?: string;
  brokerState?: "queued" | "claimed" | "started" | "rejected" | "expired" | "failed";
}

type RemoteRequest = (options: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  throw: false;
}) => Promise<{ status: number; json: unknown }>;

export function emptyRemoteAutomationSnapshot(
  state: RemoteAutomationConnectionState = "disabled",
  message = "Remote automation controls are disabled."
): RemoteAutomationSnapshot {
  return {
    state,
    checkedAt: new Date().toISOString(),
    reachable: false,
    observedAt: null,
    runnableJobIds: [],
    message,
    memory: unavailableMemory(message),
  };
}

export async function fetchRemoteAutomationSnapshot(
  app: App,
  settings: DashboardSettings,
  request: RemoteRequest = defaultRequest
): Promise<RemoteAutomationSnapshot> {
  const connection = resolveConnection(app, settings);
  if (!connection.ready) return emptyRemoteAutomationSnapshot(connection.state, connection.message);
  try {
    const response = await request({
      url: `${connection.baseUrl}/api/vault-automation/health`,
      method: "GET",
      headers: { Authorization: `Bearer ${connection.secret}`, "Cache-Control": "no-store" },
      throw: false,
    });
    if (response.status === 401) {
      return emptyRemoteAutomationSnapshot("authentication-failed", "The automation broker credential was not accepted.");
    }
    if (response.status < 200 || response.status >= 300) {
      return emptyRemoteAutomationSnapshot("unreachable", "The remote automation broker is unavailable.");
    }
    return parseHealth(response.json);
  } catch {
    return emptyRemoteAutomationSnapshot("unreachable", "The remote automation broker is unavailable.");
  }
}

export function applyRemoteAutomationAvailability(
  snapshot: AutomationSnapshot,
  remote: RemoteAutomationSnapshot
): AutomationSnapshot {
  if (snapshot.isExecutor) return snapshot;
  const runnable = new Set(remote.runnableJobIds);
  return {
    ...snapshot,
    message: remote.reachable
      ? "The always-on Mac is reachable through the authenticated automation broker."
      : remote.message,
    items: snapshot.items.map((item) => {
      if (item.manualPolicy !== "routine" || !item.launchdLabel) return item;
      const canRun = remote.reachable && runnable.has(item.id);
      return {
        ...item,
        availability: canRun ? "remote-ready" : "remote-unavailable",
        canRun,
        runTarget: canRun ? "remote" : null,
        runState: canRun ? "ready" : "unavailable",
        runMessage: canRun
          ? "Ready to run on the always-on Mac."
          : remote.reachable
            ? "The remote job is unloaded or already running."
            : remote.message,
        healthTone: canRun ? "positive" : "attention",
        healthMessage: canRun
          ? "Remote executor is ready."
          : remote.reachable
            ? "Remote executor reports this job unavailable."
            : remote.message,
      };
    }),
  };
}

export async function submitRemoteAutomation(
  app: App,
  settings: DashboardSettings,
  id: string,
  request: RemoteRequest = defaultRequest,
  now = new Date()
): Promise<RemoteAutomationRequestResult> {
  const definition = FJG_AUTOMATION_ALLOWLIST.find((entry) => entry.id === id);
  if (!definition || definition.manualPolicy !== "routine" || !definition.launchdLabel) {
    return { id, status: "rejected", message: "This automation is not approved for remote execution." };
  }
  const connection = resolveConnection(app, settings);
  if (!connection.ready) return { id, status: "rejected", message: connection.message };
  const requestId = crypto.randomUUID();
  const payload = {
    jobId: id,
    requestId,
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 90_000).toISOString(),
  };
  try {
    const response = await request({
      url: `${connection.baseUrl}/api/vault-automation/requests`,
      method: "POST",
      headers: { Authorization: `Bearer ${connection.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      throw: false,
    });
    if (response.status === 202 && isRequestState(response.json, requestId, id)) {
      return {
        id,
        status: "queued",
        brokerState: "queued",
        requestId,
        message: `${definition.label} was securely queued on the always-on Mac.`,
      };
    }
    if (response.status === 401) {
      return { id, status: "rejected", message: "The automation broker credential was not accepted." };
    }
    const code = safeErrorCode(response.json);
    return {
      id,
      status: "rejected",
      message: code === "already-in-flight"
        ? `${definition.label} already has an active remote request.`
        : `${definition.label} was rejected by the automation broker.`,
    };
  } catch {
    return { id, status: "error", message: "The remote automation broker is unavailable." };
  }
}

function resolveConnection(app: App, settings: DashboardSettings):
  | { ready: true; baseUrl: string; secret: string }
  | { ready: false; state: RemoteAutomationConnectionState; message: string } {
  if (!settings.remoteAutomationEnabled) {
    return { ready: false, state: "disabled", message: "Remote automation controls are disabled." };
  }
  const baseUrl = normalizeBrokerUrl(settings.remoteAutomationUrl);
  const secretId = settings.remoteAutomationSecretId.trim();
  const secret = secretId ? (app.secretStorage.getSecret(secretId) ?? "").trim() : "";
  if (!baseUrl || !secret || !/^[A-Za-z0-9_-]{43,256}$/.test(secret)) {
    return { ready: false, state: "unconfigured", message: "Remote automation settings are incomplete." };
  }
  return { ready: true, baseUrl, secret };
}

function normalizeBrokerUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
    if (url.pathname !== "/" && url.pathname !== "") return "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function parseHealth(value: unknown): RemoteAutomationSnapshot {
  if (!value || typeof value !== "object") return emptyRemoteAutomationSnapshot("unreachable", "The broker returned an invalid health response.");
  const payload = value as Record<string, unknown>;
  const executor = payload.executor as Record<string, unknown> | null;
  const reachable = executor?.reachable === true && executor?.sentinelLoaded === true;
  const runnableJobIds = Array.isArray(executor?.runnableJobIds)
    ? executor.runnableJobIds.filter((id): id is string => typeof id === "string" && isRoutineId(id))
    : [];
  const checkedAt = validIso(payload.checkedAt) ?? new Date().toISOString();
  const observedAt = validIso(executor?.observedAt) ?? null;
  const memory = reachable ? parseRemoteMemory(payload.memory, observedAt ?? checkedAt) : null;
  return {
    state: reachable ? "ready" : "unreachable",
    checkedAt,
    reachable,
    observedAt,
    runnableJobIds: reachable ? [...new Set(runnableJobIds)] : [],
    message: reachable
      ? "The always-on Mac is reachable."
      : "The broker is online, but the executor sentinel is unavailable.",
    memory: memory ?? unavailableMemory("Remote RAM status is unavailable.", checkedAt),
  };
}

function parseRemoteMemory(value: unknown, checkedAt: string): SystemMemorySnapshot | null {
  if (!value || typeof value !== "object") return null;
  const memory = value as Record<string, unknown>;
  const totalBytes = boundedNumber(memory.totalBytes, 1, Number.MAX_SAFE_INTEGER);
  const usedBytes = boundedNumber(memory.usedBytes, 0, Number.MAX_SAFE_INTEGER);
  const freePercent = boundedNumber(memory.freePercent, 0, 100);
  const usedPercent = boundedNumber(memory.usedPercent, 0, 100);
  if (totalBytes === null || usedBytes === null || freePercent === null || usedPercent === null) return null;
  return {
    status: "ready",
    checkedAt,
    source: "remote-executor",
    message: `${usedPercent}% of memory is in use on the always-on Mac.`,
    totalBytes,
    availableBytes: Math.max(0, totalBytes - usedBytes),
    usedBytes,
    freePercent,
    usedPercent,
    tone: getMemoryHealthTone(usedPercent),
  };
}

function unavailableMemory(message: string, checkedAt = new Date().toISOString()): SystemMemorySnapshot {
  return { status: "unavailable", checkedAt, reason: "remote-unavailable", message };
}

function isRoutineId(id: string): boolean {
  return FJG_AUTOMATION_ALLOWLIST.some((entry) => entry.id === id && entry.manualPolicy === "routine");
}

function isRequestState(value: unknown, requestId: string, jobId: string): boolean {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return payload.requestId === requestId && payload.jobId === jobId && payload.state === "queued";
}

function safeErrorCode(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const code = (value as Record<string, unknown>).error;
  return typeof code === "string" && /^[a-z-]{1,48}$/.test(code) ? code : "";
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? value : null;
}

function boundedNumber(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

async function defaultRequest(options: Parameters<RemoteRequest>[0]): Promise<{ status: number; json: unknown }> {
  const response = await requestUrl(options);
  return { status: response.status, json: response.json };
}
