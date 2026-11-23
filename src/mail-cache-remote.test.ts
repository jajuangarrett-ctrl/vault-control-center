import { describe, expect, it } from "vitest";
import type { BridgeObservation, BridgeStatus, MailCacheBridgeTransport } from "./mail-cache-bridge";
import {
  createRemoteMailClient, createRemoteMailRelay, decodeRemoteRequest, decodeRemoteStatus,
  encodeRemoteWire, parseHostState, remoteReceipt, waitingForRemote,
  REMOTE_REQUEST_LIFETIME, REMOTE_STATUS_LIFETIME, REQUEST_PATH, STATUS_PATH,
  type HostState, type RemoteMailStore,
} from "./mail-cache-remote";

const HOST = "12345678-1234-1234-1234-123456789012";
const SECOND_HOST = "22345678-1234-1234-1234-123456789012";
const PHONE = "32345678-1234-1234-1234-123456789012";
const SECOND_PHONE = "42345678-1234-1234-1234-123456789012";
const NATIVE = "52345678-1234-1234-1234-123456789012";
const SECRET = "julie@example.test very-private subject /users/test/export";

function harness() {
  const files = new Map<string, string>();
  const writes: [string, string][] = [];
  let clock = 1_800_000_000_000;
  let state: HostState | null = null;
  let refuseSave = false;
  let native: BridgeObservation;
  let forwarded = 0;
  let snapBeforeSend: HostState | null = null;
  let behind: (() => void) | null = null;
  const tick = (ms = 1000) => { clock += ms; };
  function status(phase: BridgeStatus["state"], receipt?: string, lastSync?: number): void {
    native = {
      kind: "current", pending: false,
      status: {
        schema_version: 1, state: phase, indexed_count: 127598, interval_minutes: 15, exports_enabled: true,
        updated_at: new Date(clock).toISOString(), last_request_id: receipt,
        last_sync_at: lastSync === undefined ? undefined : new Date(lastSync).toISOString(),
        // Even if a future native transport returns another key, the relay must never publish it.
        ...({ warning: SECRET, export_path: SECRET, account: SECRET, message: SECRET }),
      },
    };
  }
  status("ready");
  const store: RemoteMailStore = {
    read: async (path) => {
      const value = files.get(path) ?? null;
      if (path === REQUEST_PATH && behind) { const f = behind; behind = null; f(); }
      return value;
    },
    write: async (path, previous, next) => {
      if ((files.get(path) ?? null) !== previous) throw new Error("collision");
      writes.push([path, next]);
      files.set(path, next);
    },
  };
  const transport: MailCacheBridgeTransport = {
    readStatus: async () => native,
    requestSync: async () => {
      snapBeforeSend = state;
      forwarded++;
      return { kind: "requested", id: NATIVE, sentAt: clock };
    },
  };
  const opts = {
    store, transport, state: () => state, now: () => clock,
    save: (next: HostState) => {
      if (refuseSave) throw new Error("Local storage is unavailable");
      state = parseHostState(JSON.parse(JSON.stringify(next)));
    },
  };
  const relay = createRemoteMailRelay(opts);
  const client = createRemoteMailClient(store, () => clock, () => PHONE);
  return { files, writes, transport, relay, client, status, tick, opts, store,
    now: () => clock, forwarded: () => forwarded, beforeSend: () => snapBeforeSend,
    enable: (host = HOST) => { state = { host, active: null }; },
    disable: () => { state = null; },
    forbidSave: () => { refuseSave = true; },
    afterRequestRead: (f: () => void) => { behind = f; },
  };
}

describe("mobile Mail Cache Sync", () => {
  it("does nothing before desktop opt-in and refuses mobile sync before a fresh host", async () => {
    const h = harness();
    await h.relay.tick();
    expect(h.writes).toEqual([]);
    expect(await h.client.requestSync()).toBeNull();
    expect(h.forwarded()).toBe(0);
    h.enable();
    await h.relay.tick();
    h.tick(REMOTE_STATUS_LIFETIME);
    expect(await h.client.requestSync()).toBeNull();
  });

  it("runs a phone request through the Mac's native link and only writes strict control metadata", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    const request = await h.client.requestSync();
    expect(request?.id).toBe(PHONE);
    expect(await h.client.requestSync()).toBeNull();
    expect(waitingForRemote(await h.client.observe(), h.now())).toBe(true);
    expect(h.forwarded()).toBe(0);
    await h.relay.tick();
    expect(h.beforeSend()?.active?.phase).toBe("submitting");
    expect(h.forwarded()).toBe(1);
    expect(remoteReceipt(await h.client.observe())?.phase).toBe("requested");

    h.tick();
    // An unrelated desktop result must not complete the phone request.
    h.status("completed", SECOND_PHONE, h.now());
    await h.relay.tick();
    expect(remoteReceipt(await h.client.observe())?.phase).toBe("requested");
    h.tick();
    h.status("syncing", NATIVE);
    await h.relay.tick();
    expect(remoteReceipt(await h.client.observe())?.phase).toBe("syncing");
    h.tick();
    h.status("completed", NATIVE, h.now());
    await h.relay.tick();
    const done = await h.client.observe();
    expect(remoteReceipt(done)?.phase).toBe("completed");
    expect(done.status?.lastSync).toBe(h.now());
    for (const [, text] of h.writes) {
      expect(text).not.toMatch(/julie|subject|export|account|message|127598/);
      expect(decodeRemoteRequest(text) ?? decodeRemoteStatus(text)).not.toBeNull();
    }
  });

  it.each(["failed", "incomplete"] as const)("reports native %s without a false success", async (phase) => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    await h.client.requestSync();
    await h.relay.tick();
    h.tick();
    h.status(phase, NATIVE, h.now());
    await h.relay.tick();
    expect(remoteReceipt(await h.client.observe())?.phase).toBe(phase);
  });

  it("cannot recycle an older successful sync on matching a newly acknowledged request", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    await h.client.requestSync();
    await h.relay.tick();
    h.tick();
    h.status("completed", NATIVE, h.now() - 61_000);
    await h.relay.tick();
    expect(remoteReceipt(await h.client.observe())?.phase).toBe("unconfirmed");
  });

  it("does not re-run a consumed request after restart or report failure as completion on timeout", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    await h.client.requestSync();
    await h.relay.tick();
    h.relay.stop();
    const restarted = createRemoteMailRelay(h.opts);
    h.tick(61_000);
    await restarted.tick();
    expect(remoteReceipt(await h.client.observe())?.phase).toBe("unconfirmed");
    await restarted.tick();
    expect(h.forwarded()).toBe(1);
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: PHONE, time: h.now() }));
    await restarted.tick();
    expect(h.forwarded()).toBe(1);
  });

  it("does not execute stale requests, requests for another host, or requests after failed durable recording", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: PHONE, time: h.now() - REMOTE_REQUEST_LIFETIME }));
    await h.relay.tick();
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: SECOND_HOST, id: PHONE, time: h.now() }));
    await h.relay.tick();
    h.forbidSave();
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: PHONE, time: h.now() }));
    await h.relay.tick();
    expect(h.forwarded()).toBe(0);
  });

  it("does not overwrite a colliding user note or process a malformed or changed request", async () => {
    const h = harness();
    h.enable();
    h.files.set(STATUS_PATH, SECRET);
    await h.relay.tick();
    expect(h.files.get(STATUS_PATH)).toBe(SECRET);
    h.files.delete(STATUS_PATH);
    await h.relay.tick();
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: PHONE, time: h.now() }).replace('"id"', '"extra":"xyz","id"'));
    await h.relay.tick();
    expect(h.forwarded()).toBe(0);
    await expect(h.client.requestSync()).rejects.toThrow();
    h.files.delete(REQUEST_PATH);
    await h.relay.tick();
    await h.client.requestSync();
    h.afterRequestRead(() => {
      h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: SECOND_PHONE, time: h.now() }));
    });
    await h.relay.tick();
    expect(h.forwarded()).toBe(0);
    await h.relay.tick();
    expect(h.forwarded()).toBe(1);
    expect(h.beforeSend()?.active?.request.id).toBe(SECOND_PHONE);
  });

  it("does not call a receipt completed for an intervening request", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    await h.client.requestSync();
    await h.relay.tick();
    h.tick();
    h.files.set(REQUEST_PATH, encodeRemoteWire({ host: HOST, id: SECOND_PHONE, time: h.now() }));
    h.status("completed", NATIVE, h.now());
    await h.relay.tick();
    expect((await h.client.observe()).status?.receipt?.phase).toBe("completed");
    expect(remoteReceipt(await h.client.observe())).toBeNull();
    expect(h.forwarded()).toBe(1);
  });

  it("never triggers or emits a new heartbeat after revocation", async () => {
    const h = harness();
    h.enable();
    await h.relay.tick();
    await h.client.requestSync();
    h.disable();
    await h.relay.revoke(HOST);
    await h.relay.tick();
    expect(h.forwarded()).toBe(0);
    expect(h.writes.length).toBe(3);
    expect((await h.client.observe()).status?.state).toBe("disabled");
    expect(await h.client.requestSync()).toBeNull();
    h.enable(SECOND_HOST);
    await h.relay.tick();
    expect(h.forwarded()).toBe(0);
    expect((await h.client.observe()).status?.host).toBe(SECOND_HOST);
  });
});
