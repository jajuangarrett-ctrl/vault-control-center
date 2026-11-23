// Fixed local control channel shared with the opt-in macOS Mail Cache Bridge app.
// The plugin never starts a process or accesses Mail, a vault export, or the network.
import type { Stats } from "node:fs";

const STATUS_FILE = "status.json";
const REQUEST_FILE = "sync-request.json";
const MAX_STATUS_BYTES = 4096;
export const STATUS_TTL_MS = 30_000;

const BRIDGE_STATES = [
  "paused", "ready", "syncing", "completed", "needs_access", "no_cache", "failed", "incomplete",
] as const;
type BridgeState = typeof BRIDGE_STATES[number];

export interface BridgeStatus {
  schema_version: 1;
  state: BridgeState;
  updated_at: string;
  last_sync_at?: string;
  indexed_count?: number;
  last_request_id?: string;
  interval_minutes?: 0 | 5 | 15 | 60;
  exports_enabled?: boolean;
}

export type BridgeObservation =
  | { kind: "not-configured" | "offline" | "invalid" }
  | { kind: "current" | "stale"; status: BridgeStatus; pending: boolean };

type BridgeRequest =
  | { kind: "requested"; id: string; sentAt: number }
  | { kind: "pending" | "unavailable" | "failed" };

export interface MailCacheBridgeTransport {
  readStatus(): Promise<BridgeObservation>;
  requestSync(): Promise<BridgeRequest>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const STATUS_KEYS = new Set([
  "schema_version", "state", "updated_at", "last_sync_at", "indexed_count",
  "last_request_id", "interval_minutes", "exports_enabled",
]);

function utcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() ===
    (value.length === 20 ? value.slice(0, -1) + ".000Z" : value);
}

export function parseBridgeStatus(raw: string): BridgeStatus | null {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).some((key) => !STATUS_KEYS.has(key)) ||
    input.schema_version !== 1 ||
    typeof input.state !== "string" || !BRIDGE_STATES.includes(input.state as BridgeState) ||
    !utcTimestamp(input.updated_at) ||
    ("last_sync_at" in input && (!utcTimestamp(input.last_sync_at) ||
      Date.parse(input.last_sync_at) > Date.parse(input.updated_at))) ||
    ("indexed_count" in input && (typeof input.indexed_count !== "number" ||
      !Number.isSafeInteger(input.indexed_count) || input.indexed_count < 0)) ||
    ("last_request_id" in input && (typeof input.last_request_id !== "string" || !UUID.test(input.last_request_id))) ||
    ("interval_minutes" in input && ![0, 5, 15, 60].includes(input.interval_minutes as number)) ||
    ("exports_enabled" in input && typeof input.exports_enabled !== "boolean")
  ) return null;
  return input as unknown as BridgeStatus;
}

function isFresh(status: BridgeStatus, now: number): boolean {
  const age = now - Date.parse(status.updated_at);
  return age >= -1_000 && age <= STATUS_TTL_MS;
}

export function canRequestBridgeSync(observation: BridgeObservation): boolean {
  return observation.kind === "current" && !observation.pending &&
    observation.status.exports_enabled === true &&
    ["ready", "completed", "failed", "incomplete"].includes(observation.status.state);
}

interface Runtime {
  fs: typeof import("node:fs/promises");
  constants: typeof import("node:fs").constants;
  path: typeof import("node:path");
  home: string;
  uid: number;
  now: () => number;
  randomUUID: () => string;
}

class UnsafeControlChannel extends Error {}
type DirectoryIdentity = Array<{ path: string; stat: Stats }>;
function code(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}
function sameInode(a: Stats, b: Stats): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.mode === b.mode;
}
function sameFile(a: Stats, b: Stats): boolean {
  return sameInode(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
}
function isPrivateFile(stat: Stats, uid: number): boolean {
  return stat.isFile() && stat.uid === uid && (stat.mode & 0o7777) === 0o600 && stat.nlink === 1;
}

// Lazily load local Node APIs only on a macOS desktop. Electron's Obsidian
// renderer provides require; iOS/Android never reach it.
export function desktopMailCacheBridge(isDesktopMac: boolean): MailCacheBridgeTransport | null {
  if (!isDesktopMac || typeof require !== "function") return null;
  try {
    const os = require("node:os") as typeof import("node:os");
    if (os.platform() !== "darwin") return null;
    // Real OS account details work even when Electron hides process.getuid.
    const account = os.userInfo();
    if (!Number.isSafeInteger(account.uid) || account.uid < 0) return null;
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const crypto = require("node:crypto") as typeof import("node:crypto");
    return makeMailCacheBridgeTransport({
      fs: fs.promises, constants: fs.constants, path, home: account.homedir,
      uid: account.uid, now: Date.now, randomUUID: crypto.randomUUID,
    });
  } catch { return null; }
}

export function makeMailCacheBridgeTransport(runtime: Runtime): MailCacheBridgeTransport {
  const { fs, constants, path, home, uid, now, randomUUID } = runtime;
  const directory = path.join(home, "Library", "Application Support", "Mail Cache Bridge", "Controls");
  const statusPath = path.join(directory, STATUS_FILE);
  const requestPath = path.join(directory, REQUEST_FILE);

  async function checkDirectories(): Promise<DirectoryIdentity> {
    if (!path.isAbsolute(home) || home === path.parse(home).root || path.normalize(home) !== home) {
      throw new UnsafeControlChannel();
    }
    const root = path.parse(directory).root;
    const identities: DirectoryIdentity = [];
    let current = root;
    for (const component of directory.slice(root.length).split(path.sep)) {
      current = path.join(current, component);
      const stat = await fs.lstat(current);
      const inHome = current === home || current.startsWith(home + path.sep);
      if (!stat.isDirectory() || (stat.mode & 0o022) !== 0 || (inHome && stat.uid !== uid) ||
        (!inHome && stat.uid !== 0 && stat.uid !== uid) ||
        (current === directory && (stat.mode & 0o7777) !== 0o700)) {
        throw new UnsafeControlChannel();
      }
      identities.push({ path: current, stat });
    }
    if (await fs.realpath(directory) !== directory) throw new UnsafeControlChannel();
    return identities;
  }

  async function assertSameDirectories(expected: DirectoryIdentity): Promise<void> {
    const current = await checkDirectories();
    if (current.length !== expected.length || current.some((entry, i) =>
      entry.path !== expected[i].path || !sameInode(entry.stat, expected[i].stat))) {
      throw new UnsafeControlChannel();
    }
  }

  async function readStatus(): Promise<BridgeObservation> {
    let observed: DirectoryIdentity;
    try { observed = await checkDirectories(); }
    catch (error) { return { kind: code(error) === "ENOENT" ? "not-configured" : "invalid" }; }
    const check = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(statusPath, check);
      const before = await handle.stat();
      if (!isPrivateFile(before, uid) || before.size < 1 || before.size > MAX_STATUS_BYTES) {
        return { kind: "invalid" };
      }
      const bytes = Buffer.alloc(before.size);
      let used = 0;
      while (used < bytes.length) {
        const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
        if (bytesRead === 0) return { kind: "invalid" };
        used += bytesRead;
      }
      if (!sameFile(before, await handle.stat())) return { kind: "invalid" };
      await assertSameDirectories(observed);
      // The native producer publishes by atomic replacement. A read during
      // replacement can retry on the next poll rather than trusting old state.
      if (!sameFile(before, await fs.lstat(statusPath))) return { kind: "invalid" };
      const status = parseBridgeStatus(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!status) return { kind: "invalid" };
      let pending = false;
      try { await fs.lstat(requestPath); pending = true; }
      catch (error) { if (code(error) !== "ENOENT") return { kind: "invalid" }; }
      return { kind: isFresh(status, now()) ? "current" : "stale", status, pending };
    } catch (error) {
      return { kind: code(error) === "ENOENT" ? "offline" : "invalid" };
    } finally { await handle?.close().catch(() => {}); }
  }

  async function requestSync(): Promise<BridgeRequest> {
    const eligibility = await readStatus();
    if (eligibility.kind === "current" && eligibility.pending) return { kind: "pending" };
    if (eligibility.kind !== "current" || !canRequestBridgeSync(eligibility)) return { kind: "unavailable" };
    let temp: string | undefined, expected: DirectoryIdentity | undefined, tempStat: Stats | undefined;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      expected = await checkDirectories();
      const id = randomUUID().toLowerCase();
      if (!UUID.test(id)) return { kind: "failed" };
      const sentAt = now();
      temp = path.join(directory, ".vcc-sync-" + id + ".tmp");
      handle = await fs.open(temp,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      tempStat = await handle.stat();
      if (!isPrivateFile(tempStat, uid)) return { kind: "failed" };
      await handle.writeFile(JSON.stringify({ schema_version: 1, id, requested_at: new Date(sentAt).toISOString() }) + "\n");
      await handle.sync();
      tempStat = await handle.stat();
      await handle.close();
      handle = undefined;
      await assertSameDirectories(expected);
      if (!sameFile(tempStat, await fs.lstat(temp)) || now() - sentAt >= STATUS_TTL_MS) {
        return { kind: "failed" };
      }
      if (!isFresh(eligibility.status, now())) return { kind: "unavailable" };
      // macOS Node exposes no exclusive rename. Atomic link makes the complete
      // document visible all at once and refuses any existing request.
      try { await fs.link(temp, requestPath); }
      catch (error) { if (code(error) === "EEXIST") return { kind: "pending" }; throw error; }
      // Node filesystem calls are path-based. Do not report success when an
      // ancestor was swapped around the atomic link. Native revalidates the
      // channel before honoring it, independent of this reporting check.
      await assertSameDirectories(expected);
      return { kind: "requested", id, sentAt };
    } catch {
      return { kind: "failed" };
    } finally {
      await handle?.close().catch(() => {});
      if (temp && tempStat && expected) {
        try {
          await assertSameDirectories(expected);
          if (sameInode(tempStat, await fs.lstat(temp))) await fs.unlink(temp);
        } catch {
          // Never delete an existing request, including one the app has already
          // consumed. Only native controls can remove a pending request.
        }
      }
    }
  }

  return { readStatus, requestSync };
}
