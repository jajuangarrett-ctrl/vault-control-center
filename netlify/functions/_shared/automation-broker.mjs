export const APPROVED_AUTOMATION_IDS = Object.freeze([
  "clippings",
  "root-inbox",
  "iflytek-notes",
  "youtube-notes",
  "fjg-capture-transcripts",
  "weekly-learning-review",
]);

// This is deliberately separate from the routine processor allowlist. It is a
// single fixed application command, not a way to run arbitrary software.
export const OBSIDIAN_RELOAD_ID = "reload-obsidian";
const APPROVED_REQUEST_IDS = Object.freeze([...APPROVED_AUTOMATION_IDS, OBSIDIAN_RELOAD_ID]);

export const REQUEST_STATES = Object.freeze([
  "queued",
  "claimed",
  "started",
  "rejected",
  "expired",
  "failed",
]);

const TERMINAL_STATES = new Set(["started", "rejected", "expired", "failed"]);
const EVENT_STATES = new Set(["started", "rejected", "failed"]);
const REASON_CODES = new Set([
  "launchctl-accepted",
  "sentinel-not-loaded",
  "target-not-loaded",
  "already-running",
  "scheduled-window",
  "kickstart-failed",
  "runner-error",
  "malformed-claim",
  "obsidian-reload-accepted",
  "obsidian-cli-unavailable",
  "obsidian-reload-failed",
]);
const REQUEST_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REQUEST_MAX_AGE_MS = 30_000;
const REQUEST_MAX_FUTURE_SKEW_MS = 10_000;
const REQUEST_MIN_TTL_MS = 15_000;
const REQUEST_MAX_TTL_MS = 120_000;
const CLAIM_LEASE_MS = 5 * 60_000;
const EXECUTOR_FRESHNESS_MS = 150_000;

export class BrokerError extends Error {
  constructor(code, status, message) {
    super(message);
    this.name = "BrokerError";
    this.code = code;
    this.status = status;
  }
}

export function createAutomationBroker(store, options = {}) {
  const now = options.now ?? (() => new Date());

  return {
    submitRequest: (payload) => submitRequest(store, payload, now),
    pollExecutor: (payload) => pollExecutor(store, payload, now),
    recordEvent: (payload) => recordEvent(store, payload, now),
    getHealth: () => getHealth(store, now),
    getRequestStatus: (requestId) => getRequestStatus(store, requestId),
    cleanup: () => cleanup(store, now),
  };
}

export async function enforceRateLimit(store, scope, limit, at = new Date()) {
  const bucket = at.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const key = `rate/${boundedKey(scope, 48)}/${bucket}`;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!current) {
      const created = await store.setJSON(
        key,
        { count: 1, expiresAt: new Date(at.getTime() + 2 * 60_000).toISOString() },
        { onlyIfNew: true }
      );
      if (created.modified) return;
      continue;
    }
    const count = positiveInteger(current.data?.count, 0);
    if (count >= limit) {
      throw new BrokerError("rate-limited", 429, "Too many requests. Try again shortly.");
    }
    const updated = await store.setJSON(
      key,
      { ...current.data, count: count + 1 },
      { onlyIfMatch: current.etag }
    );
    if (updated.modified) return;
  }
  throw new BrokerError("rate-limited", 429, "Too many concurrent requests.");
}

async function submitRequest(store, payload, now) {
  const request = validateAutomationRequest(payload, now());
  const key = requestKey(request.requestId);
  const at = now().toISOString();
  const record = {
    ...request,
    state: "queued",
    createdAt: at,
    updatedAt: at,
    reasonCode: null,
    claimedAt: null,
    claimExpiresAt: null,
  };
  const created = await store.setJSON(key, record, { onlyIfNew: true });
  if (!created.modified) {
    throw new BrokerError("duplicate-request", 409, "This request ID has already been used.");
  }

  const locked = await acquireJobLock(store, request.jobId, request.requestId, request.expiresAt, now());
  if (!locked) {
    await store.setJSON(
      key,
      { ...record, state: "rejected", updatedAt: now().toISOString(), reasonCode: "already-running" },
      { onlyIfMatch: created.etag }
    );
    throw new BrokerError("already-in-flight", 409, "This automation already has an active request.");
  }
  return publicRequest(record);
}

async function pollExecutor(store, payload, now) {
  const heartbeat = validateHeartbeat(payload, now());
  await store.setJSON("executor/status", heartbeat);
  if (!heartbeat.sentinelLoaded) return { executorAccepted: false, request: null };

  const listing = await store.list({ prefix: "requests/" });
  const records = [];
  for (const blob of listing.blobs) {
    const entry = await store.getWithMetadata(blob.key, { type: "json", consistency: "strong" });
    if (entry?.data) records.push({ key: blob.key, ...entry });
  }
  records.sort((left, right) => String(left.data.requestedAt).localeCompare(String(right.data.requestedAt)));

  for (const entry of records) {
    const record = entry.data;
    if (!APPROVED_REQUEST_IDS.includes(record.jobId)) continue;
    if (TERMINAL_STATES.has(record.state)) continue;
    if (Date.parse(record.expiresAt) <= now().getTime()) {
      const expired = await store.setJSON(
        entry.key,
        { ...record, state: "expired", updatedAt: now().toISOString(), reasonCode: null },
        { onlyIfMatch: entry.etag }
      );
      if (expired.modified) await releaseJobLock(store, record.jobId, record.requestId);
      continue;
    }
    const staleClaim = record.state === "claimed" && Date.parse(record.claimExpiresAt ?? "") <= now().getTime();
    if (record.state !== "queued" && !staleClaim) continue;
    const locked = await acquireJobLock(store, record.jobId, record.requestId, record.expiresAt, now());
    if (!locked) continue;
    const claimedAt = now().toISOString();
    const claimed = {
      ...record,
      state: "claimed",
      claimedAt,
      claimExpiresAt: new Date(now().getTime() + CLAIM_LEASE_MS).toISOString(),
      updatedAt: claimedAt,
      reasonCode: null,
    };
    const update = await store.setJSON(entry.key, claimed, { onlyIfMatch: entry.etag });
    if (update.modified) {
      return { executorAccepted: true, request: publicClaim(claimed) };
    }
  }
  return { executorAccepted: true, request: null };
}

async function recordEvent(store, payload, now) {
  const event = validateRunnerEvent(payload, now());
  const key = requestKey(event.requestId);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!current?.data || current.data.jobId !== event.jobId) {
      throw new BrokerError("unknown-request", 404, "The request was not found.");
    }
    if (TERMINAL_STATES.has(current.data.state)) {
      await releaseJobLock(store, event.jobId, event.requestId);
      return publicRequest(current.data);
    }
    if (current.data.state !== "claimed") {
      throw new BrokerError("invalid-transition", 409, "The request is not currently claimed.");
    }
    const updatedRecord = {
      ...current.data,
      state: event.state,
      updatedAt: event.occurredAt,
      reasonCode: event.reasonCode,
    };
    const updated = await store.setJSON(key, updatedRecord, { onlyIfMatch: current.etag });
    if (!updated.modified) continue;
    await releaseJobLock(store, event.jobId, event.requestId);
    return publicRequest(updatedRecord);
  }
  throw new BrokerError("claim-conflict", 409, "The request changed while it was being updated.");
}

async function getHealth(store, now) {
  const current = await store.getWithMetadata("executor/status", { type: "json", consistency: "strong" });
  const heartbeat = current?.data;
  const observedAt = parseDate(heartbeat?.observedAt);
  const reachable = Boolean(
    observedAt &&
    now().getTime() - observedAt.getTime() <= EXECUTOR_FRESHNESS_MS &&
    heartbeat?.sentinelLoaded === true
  );
  const runnableJobIds = reachable
    ? approvedSubset(heartbeat?.runnableJobIds)
    : [];
  return {
    status: "ok",
    checkedAt: now().toISOString(),
    executor: {
      reachable,
      observedAt: observedAt?.toISOString() ?? null,
      sentinelLoaded: reachable,
      runnableJobIds,
      obsidianReloadAvailable: reachable && heartbeat?.obsidianReloadAvailable === true,
    },
    memory: reachable ? sanitizeMemory(heartbeat?.memory, observedAt?.toISOString() ?? now().toISOString()) : null,
  };
}

async function getRequestStatus(store, requestId) {
  validateRequestId(requestId);
  const current = await store.getWithMetadata(requestKey(requestId), { type: "json", consistency: "strong" });
  if (!current?.data) throw new BrokerError("unknown-request", 404, "The request was not found.");
  return publicRequest(current.data);
}

async function cleanup(store, now) {
  const cutoff = now().getTime() - 48 * 60 * 60_000;
  let removed = 0;
  for (const prefix of ["requests/", "rate/"]) {
    const listing = await store.list({ prefix });
    for (const blob of listing.blobs.slice(0, 1000)) {
      const entry = await store.getWithMetadata(blob.key, { type: "json", consistency: "strong" });
      const timestamp = Date.parse(entry?.data?.updatedAt ?? entry?.data?.expiresAt ?? "");
      if (Number.isFinite(timestamp) && timestamp < cutoff) {
        await store.delete(blob.key);
        removed += 1;
      }
    }
  }
  return { removed };
}

function validateAutomationRequest(payload, current) {
  exactObject(payload, ["jobId", "requestId", "requestedAt", "expiresAt"]);
  if (!APPROVED_REQUEST_IDS.includes(payload.jobId)) {
    throw new BrokerError("unknown-job", 400, "Unknown automation ID.");
  }
  validateRequestId(payload.requestId);
  const requestedAt = requiredDate(payload.requestedAt, "requestedAt");
  const expiresAt = requiredDate(payload.expiresAt, "expiresAt");
  const age = current.getTime() - requestedAt.getTime();
  const ttl = expiresAt.getTime() - requestedAt.getTime();
  if (age > REQUEST_MAX_AGE_MS || age < -REQUEST_MAX_FUTURE_SKEW_MS) {
    throw new BrokerError("invalid-request-time", 400, "The request timestamp is outside the allowed window.");
  }
  if (ttl < REQUEST_MIN_TTL_MS || ttl > REQUEST_MAX_TTL_MS || expiresAt <= current) {
    throw new BrokerError("expired-request", 400, "The request expiration is invalid or has passed.");
  }
  return {
    jobId: payload.jobId,
    requestId: payload.requestId.toLocaleLowerCase(),
    requestedAt: requestedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function validateHeartbeat(payload, current) {
  exactObject(payload, ["observedAt", "sentinelLoaded", "runnableJobIds", "memory"], ["obsidianReloadAvailable"]);
  const observedAt = requiredDate(payload.observedAt, "observedAt");
  if (Math.abs(current.getTime() - observedAt.getTime()) > 60_000) {
    throw new BrokerError("invalid-heartbeat-time", 400, "The executor timestamp is outside the allowed window.");
  }
  if (typeof payload.sentinelLoaded !== "boolean") {
    throw new BrokerError("invalid-heartbeat", 400, "The executor status is malformed.");
  }
  return {
    observedAt: observedAt.toISOString(),
    sentinelLoaded: payload.sentinelLoaded,
    runnableJobIds: payload.sentinelLoaded ? approvedSubset(payload.runnableJobIds) : [],
    obsidianReloadAvailable: payload.sentinelLoaded && payload.obsidianReloadAvailable === true,
    memory: payload.sentinelLoaded ? sanitizeMemory(payload.memory, observedAt.toISOString()) : null,
  };
}

function validateRunnerEvent(payload, current) {
  exactObject(payload, ["requestId", "jobId", "state", "occurredAt", "reasonCode"]);
  validateRequestId(payload.requestId);
  if (!APPROVED_REQUEST_IDS.includes(payload.jobId)) {
    throw new BrokerError("unknown-job", 400, "Unknown automation ID.");
  }
  if (!EVENT_STATES.has(payload.state) || !REASON_CODES.has(payload.reasonCode)) {
    throw new BrokerError("invalid-event", 400, "The runner event is malformed.");
  }
  const expectedStartedReason = payload.jobId === OBSIDIAN_RELOAD_ID
    ? "obsidian-reload-accepted"
    : "launchctl-accepted";
  if (payload.state === "started" && payload.reasonCode !== expectedStartedReason) {
    throw new BrokerError("invalid-event", 400, "The runner event is malformed.");
  }
  if (payload.state !== "started" && ["launchctl-accepted", "obsidian-reload-accepted"].includes(payload.reasonCode)) {
    throw new BrokerError("invalid-event", 400, "The runner event is malformed.");
  }
  const occurredAt = requiredDate(payload.occurredAt, "occurredAt");
  if (Math.abs(current.getTime() - occurredAt.getTime()) > 5 * 60_000) {
    throw new BrokerError("invalid-event-time", 400, "The runner event timestamp is outside the allowed window.");
  }
  return {
    requestId: payload.requestId.toLocaleLowerCase(),
    jobId: payload.jobId,
    state: payload.state,
    occurredAt: occurredAt.toISOString(),
    reasonCode: payload.reasonCode,
  };
}

async function acquireJobLock(store, jobId, requestId, expiresAt, current) {
  const key = `locks/${jobId}`;
  const lock = {
    requestId,
    expiresAt: new Date(Math.max(Date.parse(expiresAt), current.getTime() + CLAIM_LEASE_MS)).toISOString(),
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
    if (!existing) {
      const created = await store.setJSON(key, lock, { onlyIfNew: true });
      if (created.modified) return true;
      continue;
    }
    if (existing.data?.requestId === requestId) return true;
    if (Date.parse(existing.data?.expiresAt ?? "") > current.getTime()) return false;
    const replaced = await store.setJSON(key, lock, { onlyIfMatch: existing.etag });
    if (replaced.modified) return true;
  }
  return false;
}

async function releaseJobLock(store, jobId, requestId) {
  const key = `locks/${jobId}`;
  const current = await store.getWithMetadata(key, { type: "json", consistency: "strong" });
  if (current?.data?.requestId === requestId) {
    await store.setJSON(
      key,
      { requestId, expiresAt: new Date(0).toISOString() },
      { onlyIfMatch: current.etag }
    );
  }
}

function publicClaim(record) {
  return {
    jobId: record.jobId,
    requestId: record.requestId,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
  };
}

function publicRequest(record) {
  return {
    jobId: record.jobId,
    requestId: record.requestId,
    requestedAt: record.requestedAt,
    expiresAt: record.expiresAt,
    state: REQUEST_STATES.includes(record.state) ? record.state : "failed",
    updatedAt: record.updatedAt,
    reasonCode: REASON_CODES.has(record.reasonCode) ? record.reasonCode : null,
  };
}

function sanitizeMemory(value, checkedAt) {
  if (!value || typeof value !== "object") return null;
  const totalBytes = finiteNumber(value.totalBytes, 0, Number.MAX_SAFE_INTEGER);
  const usedBytes = finiteNumber(value.usedBytes, 0, Number.MAX_SAFE_INTEGER);
  const freePercent = finiteNumber(value.freePercent, 0, 100);
  const usedPercent = finiteNumber(value.usedPercent, 0, 100);
  if (totalBytes === null || usedBytes === null || freePercent === null || usedPercent === null) return null;
  return { totalBytes, usedBytes, freePercent, usedPercent, checkedAt };
}

function approvedSubset(value) {
  if (!Array.isArray(value) || value.length > APPROVED_AUTOMATION_IDS.length) return [];
  return [...new Set(value.filter((id) => APPROVED_AUTOMATION_IDS.includes(id)))];
}

function exactObject(value, keys, optionalKeys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BrokerError("malformed-request", 400, "The request body is malformed.");
  }
  const actual = Object.keys(value).sort();
  const required = [...keys].sort();
  const allowed = new Set([...required, ...optionalKeys]);
  if (actual.length < required.length || required.some((key) => !actual.includes(key)) || actual.some((key) => !allowed.has(key))) {
    throw new BrokerError("malformed-request", 400, "The request contains unsupported fields.");
  }
}

function validateRequestId(value) {
  if (typeof value !== "string" || !REQUEST_ID_PATTERN.test(value)) {
    throw new BrokerError("invalid-request-id", 400, "The request ID is invalid.");
  }
}

function requiredDate(value, field) {
  if (typeof value !== "string" || value.length > 40) {
    throw new BrokerError("invalid-date", 400, `${field} is invalid.`);
  }
  const parsed = parseDate(value);
  if (!parsed || parsed.toISOString() !== value) {
    throw new BrokerError("invalid-date", 400, `${field} is invalid.`);
  }
  return parsed;
}

function parseDate(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function finiteNumber(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? value
    : null;
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function boundedKey(value, maxLength) {
  return String(value).replace(/[^a-z0-9_-]/gi, "-").slice(0, maxLength);
}

function requestKey(requestId) {
  return `requests/${requestId.toLocaleLowerCase()}`;
}
