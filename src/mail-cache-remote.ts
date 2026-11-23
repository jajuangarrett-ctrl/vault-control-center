// This protocol carries only fixed control metadata through a trusted private vault.
// Never add source mail, export locations, account identifiers, counts, or native errors.
import { canRequestBridgeSync, type BridgeObservation, type MailCacheBridgeTransport } from "./mail-cache-bridge";

export const REQUEST_PATH = "Vault Control Center - Mail Sync Request.md";
export const STATUS_PATH = "Vault Control Center - Mail Sync Status.md";
export const REMOTE_REQUEST_LIFETIME = 5 * 60_000;
export const REMOTE_STATUS_LIFETIME = 10 * 60_000;
const HEARTBEAT_MS = 4 * 60_000;
const REQUEST_SPACING = 60_000;
const WAIT_FOR_NATIVE = 60_000;
const MAX_NATIVE_RUN = 20 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const MAX_REMOTE_WIRE_BYTES = 1024;
const PREFIX = "<!-- Vault Control Center Mail Cache Bridge v1\n";
const SUFFIX = "\n-->\n";
const PHASES = ["submitting", "requested", "syncing", "completed", "incomplete", "failed", "unconfirmed"] as const;
type Phase = typeof PHASES[number];

interface Request {
  host: string;
  id: string;
  time: number;
}

interface Receipt {
  id: string;
  phase: Phase;
}

interface Status {
  host: string;
  time: number;
  state: "ready" | "busy" | "unavailable" | "disabled";
  lastSync: number | null;
  receipt: Receipt | null;
}

type Snapshot = { status: Status | null; request: Request | null };

interface Active {
  request: Request;
  accepted: number;
  nativeId: string | null;
  phase: Phase;
}

export interface HostState {
  host: string;
  active: Active | null;
}

export interface RemoteMailStore {
  read(path: string): Promise<string | null>;
  // Compare-and-swap prevents replacing a pre-existing note or an intervening request.
  write(path: string, previous: string | null, next: string): Promise<void>;
}

export function isRemoteMailPath(path: string): boolean {
  return path === REQUEST_PATH || path === STATUS_PATH;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
function isTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value < 8_640_000_000_000_000;
}
function isPhase(value: unknown): value is Phase {
  return typeof value === "string" && PHASES.includes(value as Phase);
}
function terminal(phase: Phase): boolean {
  return ["completed", "incomplete", "failed", "unconfirmed"].includes(phase);
}

function requestFrom(value: unknown): Request | null {
  if (!isPlainRecord(value) || !isId(value.host) || !isId(value.id) || !isTime(value.time)) return null;
  return { host: value.host, id: value.id, time: value.time };
}
function receiptFrom(value: unknown): Receipt | null {
  if (!isPlainRecord(value) || !isId(value.id) || !isPhase(value.phase)) return null;
  return { id: value.id, phase: value.phase };
}
function statusFrom(value: unknown): Status | null {
  if (!isPlainRecord(value) || !isId(value.host) || !isTime(value.time) ||
    (value.state !== "ready" && value.state !== "busy" && value.state !== "unavailable" && value.state !== "disabled") ||
    (value.lastSync !== null && (!isTime(value.lastSync) || value.lastSync > value.time))) return null;
  const receipt = receiptFrom(value.receipt);
  if (value.receipt !== null && !receipt) return null;
  return { host: value.host, time: value.time, state: value.state, lastSync: value.lastSync, receipt };
}

export function encodeRemoteWire(value: Request | Status): string {
  return PREFIX + JSON.stringify(value) + SUFFIX;
}

function decode<T extends Request | Status>(text: string | null, validator: (raw: unknown) => T | null): T | null {
  if (text === null || text.length > MAX_REMOTE_WIRE_BYTES || !text.startsWith(PREFIX) || !text.endsWith(SUFFIX)) return null;
  try {
    const parsed = validator(JSON.parse(text.slice(PREFIX.length, -SUFFIX.length)));
    // A round trip rejects extra fields, repeated keys, arbitrary text, and malformed structures.
    return parsed && encodeRemoteWire(parsed) === text ? parsed : null;
  } catch { return null; }
}
export const decodeRemoteRequest = (raw: string | null) => decode(raw, requestFrom);
export const decodeRemoteStatus = (raw: string | null) => decode(raw, statusFrom);

function fresh(time: number, now: number, lifetime: number): boolean {
  return time <= now + FUTURE_SKEW_MS && now - time < lifetime;
}
export function isCurrentRemoteStatus(status: Status | null, now = Date.now()): status is Status {
  return status !== null && fresh(status.time, now, REMOTE_STATUS_LIFETIME);
}
export function remoteReceipt(snapshot: Snapshot): Receipt | null {
  const { status, request } = snapshot;
  if (status?.receipt?.id === request?.id && status?.host === request?.host) return status?.receipt ?? null;
  return null;
}
export function waitingForRemote(snapshot: Snapshot, now: number): boolean {
  const { status, request } = snapshot;
  if (!request || request.host !== status?.host) return false;
  const receipt = remoteReceipt(snapshot);
  if (receipt) return !terminal(receipt.phase) && fresh(request.time, now, MAX_NATIVE_RUN + REMOTE_REQUEST_LIFETIME);
  return fresh(request.time, now, REMOTE_REQUEST_LIFETIME);
}

export function parseHostState(input: unknown): HostState | null {
  if (!isPlainRecord(input) || !isId(input.host)) return null;
  if (input.active === null) return { host: input.host, active: null };
  const active = input.active;
  if (!isPlainRecord(active) || !isTime(active.accepted) ||
    (active.nativeId !== null && !isId(active.nativeId)) || !isPhase(active.phase)) return null;
  const request = requestFrom(active.request);
  if (!request || request.host !== input.host) return null;
  return { host: input.host, active: { request, accepted: active.accepted, nativeId: active.nativeId, phase: active.phase } };
}

export function createRemoteMailClient(store: RemoteMailStore, now = Date.now,
  id = () => globalThis.crypto.randomUUID().toLowerCase()) {
  async function observe(): Promise<Snapshot> {
    const [status, request] = await Promise.all([store.read(STATUS_PATH), store.read(REQUEST_PATH)]);
    // A collision should fail closed, not silently look like an empty queue.
    if ((status !== null && !decodeRemoteStatus(status)) || (request !== null && !decodeRemoteRequest(request))) throw new Error("Invalid control note");
    return { status: decodeRemoteStatus(status), request: decodeRemoteRequest(request) };
  }
  async function requestSync(): Promise<Request | null> {
    const previous = await store.read(REQUEST_PATH);
    const request = decodeRemoteRequest(previous);
    if (previous !== null && !request) throw new Error("Invalid request note");
    const status = decodeRemoteStatus(await store.read(STATUS_PATH));
    const time = now();
    if (!isCurrentRemoteStatus(status, time) || status.state !== "ready" ||
      waitingForRemote({ status, request }, time)) return null;
    const requestId = id();
    if (!isId(requestId)) throw new Error("No secure request identifier");
    const next = { host: status.host, id: requestId, time };
    await store.write(REQUEST_PATH, previous, encodeRemoteWire(next));
    return next;
  }
  return { observe, requestSync };
}

interface RelayOptions {
  store: RemoteMailStore;
  transport: MailCacheBridgeTransport;
  state: () => HostState | null;
  save: (state: HostState) => void;
  now?: () => number;
}

export function createRemoteMailRelay({ store, transport, state, save, now = Date.now }: RelayOptions) {
  let working = false;
  let stopped = false;
  async function tick(): Promise<void> {
    const initial = state();
    if (working || stopped || !initial) return;
    working = true;
    const stillActive = () => !stopped && state()?.host === initial.host;
    try {
      const time = now();
      let active = initial.active;
      const observation = await transport.readStatus();
      // A valid status note is a prerequisite to execution. Do not use a colliding
      // note or treat a manually replaced status as permission to execute.
      const oldStatusText = await store.read(STATUS_PATH);
      const oldStatus = decodeRemoteStatus(oldStatusText);
      if ((oldStatusText !== null && !oldStatus) || !stillActive()) return;
      // Never implicitly take over a second actively publishing host.
      if (oldStatus && oldStatus.host !== initial.host && oldStatus.state !== "disabled" && isCurrentRemoteStatus(oldStatus, time)) return;
      if (active && !terminal(active.phase)) {
        const phase = nextPhase(active, observation, time);
        if (phase !== active.phase) {
          active = { ...active, phase };
          save({ host: initial.host, active });
        }
      }
      const availability = canRequestBridgeSync(observation) ? "ready" :
        observation.kind === "current" && (observation.pending || observation.status.state === "syncing")
          ? "busy" : "unavailable";
      const requestText = await store.read(REQUEST_PATH);
      const request = decodeRemoteRequest(requestText);
      if (!stillActive()) return;
      const mark = (value: Active | null) => save({ host: initial.host, active: value });
      if (availability === "ready" && request && request.host === initial.host &&
        fresh(request.time, time, REMOTE_REQUEST_LIFETIME) &&
        (!active || (terminal(active.phase) && request.id !== active.request.id &&
          request.time > active.request.time && time - active.accepted >= REQUEST_SPACING))) {
        // Recheck the exact slot just before committing. Local persistence happens
        // before forwarding; a crash cannot replay a previously accepted command.
        if (requestText !== await store.read(REQUEST_PATH) || !stillActive()) return;
        active = { request, accepted: time, nativeId: null, phase: "submitting" };
        mark(active);
        let result: Awaited<ReturnType<MailCacheBridgeTransport["requestSync"]>> | null = null;
        try { result = await transport.requestSync(); } catch { /* completion remains unconfirmed */ }
        if (!stillActive()) return;
        active = result?.kind === "requested" && isId(result.id)
          ? { ...active, nativeId: result.id, phase: "requested" }
          : { ...active, phase: result ? "failed" : "unconfirmed" };
        mark(active);
      }
      const receipt = active ? { id: active.request.id, phase: active.phase } : null;
      const rawLast = observation.kind === "current" || observation.kind === "stale" ?
        observation.status.last_sync_at : undefined;
      const lastSync = rawLast ? Date.parse(rawLast) : oldStatus?.host === initial.host ? oldStatus.lastSync : null;
      const next: Status = {
        host: initial.host,
        time,
        state: requestText !== null && !request ? "unavailable" :
          active && !terminal(active.phase) ? "busy" : availability,
        lastSync: isTime(lastSync) && lastSync <= time ? lastSync : null,
        receipt,
      };
      if (!stillActive()) return;
      if (!oldStatus || time < oldStatus.time || time - oldStatus.time >= HEARTBEAT_MS ||
        encodeRemoteWire({ ...next, time: oldStatus.time }) !== oldStatusText) {
        await store.write(STATUS_PATH, oldStatusText, encodeRemoteWire(next));
      }
    } catch { /* unavailable local or vault storage; never bypass validation */ }
    finally { working = false; }
  }
  async function revoke(host: string): Promise<void> {
    try {
      const existing = await store.read(STATUS_PATH);
      const status = decodeRemoteStatus(existing);
      const time = now();
      if (stopped || state() || status?.host !== host) return;
      const receipt = status.receipt && !terminal(status.receipt.phase) ?
        { ...status.receipt, phase: "unconfirmed" as const } : status.receipt;
      await store.write(STATUS_PATH, existing, encodeRemoteWire({
        ...status, time, lastSync: status.lastSync !== null && status.lastSync <= time ? status.lastSync : null,
        state: "disabled", receipt,
      }));
    } catch { /* if vault writes are unavailable, the old heartbeat expires */ }
  }
  return { tick, revoke, stop: () => { stopped = true; } };
}

function nextPhase(active: Active, observation: BridgeObservation, now: number): Phase {
  if (active.phase === "submitting") return "unconfirmed";
  if (observation.kind === "current" && active.nativeId &&
    observation.status.last_request_id?.toLowerCase() === active.nativeId &&
    Date.parse(observation.status.updated_at) >= active.accepted) {
    const phase = observation.status.state;
    if (phase === "syncing") return now - active.accepted >= MAX_NATIVE_RUN ? "unconfirmed" : "syncing";
    if (phase === "failed" || phase === "needs_access" || phase === "no_cache") return "failed";
    if (phase === "completed" || phase === "incomplete") {
      const lastSync = Date.parse(observation.status.last_sync_at ?? "");
      return lastSync >= active.accepted ? phase : "unconfirmed";
    }
    return "unconfirmed";
  }
  return now - active.accepted >= (active.phase === "syncing" ? MAX_NATIVE_RUN : WAIT_FOR_NATIVE)
    ? "unconfirmed" : active.phase;
}
