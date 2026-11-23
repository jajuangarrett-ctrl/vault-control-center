import { constants } from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { canRequestBridgeSync, makeMailCacheBridgeTransport, parseBridgeStatus, type BridgeStatus } from "./mail-cache-bridge";

import {
  createRemoteMailClient, createRemoteMailRelay, remoteReceipt, type HostState, type RemoteMailStore,
} from "./mail-cache-remote";

const NOW = 1_791_000_000_123;
const now = new Date(NOW).toISOString();
const standard: BridgeStatus = { schema_version: 1, state: "ready", updated_at: now, exports_enabled: true };
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fsPromises.rm(directory, { recursive: true, force: true })));
});

async function fixture(setup = true) {
  const home = await fsPromises.mkdtemp(path.join(await fsPromises.realpath(os.tmpdir()), "vcc-bridge-"));
  directories.push(home);
  const directory = path.join(home, "Library", "Application Support", "Mail Cache Bridge", "Controls");
  const status = path.join(directory, "status.json");
  const request = path.join(directory, "sync-request.json");
  if (setup) await fsPromises.mkdir(directory, { mode: 0o700, recursive: true });
  const connect = (fileSystem = fsPromises) => makeMailCacheBridgeTransport({
    fs: fileSystem, constants, path, home, uid: process.getuid!(), now: () => NOW, randomUUID,
  });
  return { home, directory, status, request, transport: connect(), connect,
    write: (value: unknown) => fsPromises.writeFile(status, JSON.stringify(value), { mode: 0o600 }) };
}

describe("Mail Cache Bridge status contract", () => {
  it("accepts only aggregate data, finite counts, enumerated intervals and valid UUID/UTC dates", () => {
    const status = { ...standard, last_sync_at: "2026-01-02T03:04:05Z", last_request_id: randomUUID(), indexed_count: 0, interval_minutes: 15 };
    expect(parseBridgeStatus(JSON.stringify(status))).toEqual(status);
    for (const patch of [
      { address: "sender@example.invalid" }, { message: "file:///Users/Example/Mail" }, { state: "open attachment" },
      { updated_at: "2026-02-30T02:03:04Z" }, { updated_at: "tomorrow" }, { schema_version: 2 },
      { indexed_count: -1 }, { indexed_count: 9007199254740992 }, { indexed_count: "50" }, { interval_minutes: 42 },
      { last_sync_at: "2090-01-01T00:00:00Z" }, { last_request_id: "anything" }, { exports_enabled: "true" },
    ]) expect(parseBridgeStatus(JSON.stringify({ ...standard, ...patch }))).toBeNull();
    expect(parseBridgeStatus("[]")).toBeNull();
  });

  it("never creates setup folders or requests when the bridge is absent", async () => {
    const f = await fixture(false);
    expect(await f.transport.readStatus()).toEqual({ kind: "not-configured" });
    expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
    expect(await fsPromises.readdir(f.home)).toEqual([]);
  });

  it("reports offline and stale status without dispatching a request", async () => {
    const f = await fixture();
    expect(await f.transport.readStatus()).toEqual({ kind: "offline" });
    await f.write({ ...standard, updated_at: new Date(NOW - 30_001).toISOString() });
    expect(await f.transport.readStatus()).toMatchObject({ kind: "stale" });
    expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
    await f.write({ ...standard, updated_at: new Date(NOW + 10_000).toISOString() });
    expect(await f.transport.readStatus()).toMatchObject({ kind: "stale" });
    expect(await fsPromises.readdir(f.directory)).toEqual(["status.json"]);
  });

  it("requires an explicit true export flag and a fresh state available for sync", async () => {
    const f = await fixture();
    for (const patch of [
      { exports_enabled: false }, { exports_enabled: undefined },
      { state: "paused" }, { state: "syncing" }, { state: "needs_access" }, { state: "no_cache" },
    ]) {
      await f.write({ ...standard, ...patch });
      expect(canRequestBridgeSync(await f.transport.readStatus())).toBe(false);
      expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
    }
    for (const state of ["ready", "completed", "failed", "incomplete"]) {
      await f.write({ ...standard, state });
      expect(canRequestBridgeSync(await f.transport.readStatus())).toBe(true);
    }
  });

  it("reads bounded private regular status only, without following links", async () => {
    const f = await fixture();
    const privateElsewhere = path.join(f.home, "elsewhere.json");
    await fsPromises.writeFile(privateElsewhere, JSON.stringify(standard), { mode: 0o600 });
    await fsPromises.symlink(privateElsewhere, f.status);
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    await fsPromises.unlink(f.status);
    await fsPromises.link(privateElsewhere, f.status);
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    await fsPromises.unlink(f.status);
    await f.write(standard);
    await fsPromises.chmod(f.status, 0o644);
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    await fsPromises.chmod(f.status, 0o600);
    await fsPromises.writeFile(f.status, Buffer.alloc(4097, 32));
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
  });

  it("rejects symlinked ancestors, even if they resolve to an owner-only control folder", async () => {
    const f = await fixture(false);
    const outside = path.join(f.home, "realLibrary");
    await fsPromises.mkdir(path.join(outside, "Application Support", "Mail Cache Bridge", "Controls"),
      { mode: 0o700, recursive: true });
    await fsPromises.symlink(outside, path.join(f.home, "Library"));
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
    expect(await fsPromises.readdir(path.join(outside, "Application Support", "Mail Cache Bridge", "Controls"))).toEqual([]);
  });

  it("fails closed for a shared controls directory", async () => {
    const f = await fixture();
    await f.write(standard);
    await fsPromises.chmod(f.directory, 0o755);
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
    expect(await f.transport.requestSync()).toEqual({ kind: "unavailable" });
  });
});

describe("Mail Cache Bridge sync request", () => {
  it("publishes exactly one private request for overlapping clicks without clobbering", async () => {
    const f = await fixture();
    await f.write(standard);
    const firstStatus = await fsPromises.readFile(f.status);
    const results = await Promise.all([f.transport.requestSync(), f.transport.requestSync()]);
    const successful = results.find((result) => result.kind === "requested");
    if (!successful || successful.kind !== "requested") throw new Error("The fixture did not publish a request.");
    expect(results.map((result) => result.kind).sort()).toEqual(["pending", "requested"]);
    const stats = await fsPromises.lstat(f.request);
    expect({ mode: stats.mode & 0o777, nlink: stats.nlink, uid: stats.uid }).toEqual({
      mode: 0o600, nlink: 1, uid: process.getuid!(),
    });
    expect(JSON.parse(await fsPromises.readFile(f.request, "utf8"))).toEqual({
      schema_version: 1, id: successful.id, requested_at: now,
    });
    expect(await f.transport.readStatus()).toMatchObject({ kind: "current", pending: true });
    expect(await f.transport.requestSync()).toEqual({ kind: "pending" });
    expect(await fsPromises.readFile(f.status)).toEqual(firstStatus);
    expect((await fsPromises.readdir(f.directory)).sort()).toEqual(["status.json", "sync-request.json"]);
  });


  it("does not report success if a verified directory is swapped around publication", async () => {
    const f = await fixture();
    await f.write(standard);
    const moved = path.join(f.home, "previous-controls");
    const switched = f.connect({
      ...fsPromises,
      link: async (temp, request) => {
        await fsPromises.rename(f.directory, moved);
        await fsPromises.symlink(moved, f.directory);
        await fsPromises.link(temp, request);
      },
    });
    expect(await switched.requestSync()).toEqual({ kind: "failed" });
    expect(await f.transport.readStatus()).toEqual({ kind: "invalid" });
  });

  it("does not replace or remove a pending file, even one it cannot trust", async () => {
    const f = await fixture();
    await f.write(standard);
    const neverTouched = path.join(f.home, "sentinel");
    await fsPromises.writeFile(neverTouched, "untouched");
    await fsPromises.symlink(neverTouched, f.request);
    expect(await f.transport.requestSync()).toEqual({ kind: "pending" });
    expect(await fsPromises.readlink(f.request)).toBe(neverTouched);
    expect(await fsPromises.readFile(neverTouched, "utf8")).toBe("untouched");
  });
});


describe("mobile request forwards into the real Mac control-file transport", () => {
  it("writes one private native request and correlates the resulting status", async () => {
    const f = await fixture();
    await f.write(standard);
    const host = randomUUID();
    let journal: HostState = { host, active: null };
    let time = NOW;
    const files = new Map<string, string>();
    const store: RemoteMailStore = {
      async read(path) { return files.get(path) ?? null; },
      async write(path, old, value) {
        if ((files.get(path) ?? null) !== old) throw new Error("Changed note");
        files.set(path, value);
      },
    };
    const phone = createRemoteMailClient(store, () => time, randomUUID);
    const mac = createRemoteMailRelay({ store, transport: f.transport,
      state: () => journal, save: (value) => { journal = value; }, now: () => time });
    await mac.tick();
    const request = await phone.requestSync();
    expect(request).not.toBeNull();
    await mac.tick();
    const onDisk = JSON.parse(await fsPromises.readFile(f.request, "utf8"));
    expect(Object.keys(onDisk).sort()).toEqual(["id", "requested_at", "schema_version"]);
    expect((await fsPromises.stat(f.request)).mode & 0o777).toBe(0o600);
    expect(onDisk.id).not.toBe(request?.id);
    expect(remoteReceipt(await phone.observe())?.phase).toBe("requested");

    // At the native boundary, simulate app consumption with a correlated receipt.
    // No native process, real mail, or actual vault is accessed.
    await fsPromises.unlink(f.request);
    time += 1;
    await f.write({ ...standard, state: "completed", updated_at: new Date(time).toISOString(),
      last_sync_at: new Date(time).toISOString(), last_request_id: onDisk.id, indexed_count: 7111 });
    await mac.tick();
    expect(remoteReceipt(await phone.observe())?.phase).toBe("completed");
    expect([...files.values()].join("\n")).not.toMatch(/7111|last_request_id|indexed_count|exports_enabled/);
    expect(await fsPromises.readdir(f.directory)).toEqual(["status.json"]);
  });
});
