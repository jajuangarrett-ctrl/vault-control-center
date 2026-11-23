import { createRemoteMailClient, createRemoteMailRelay, REQUEST_PATH, STATUS_PATH, type HostState, type RemoteMailStore } from "../../src/mail-cache-remote";
import { renderRoute } from "../../src/renderers";
import type { BridgeObservation, BridgeStatus, MailCacheBridgeTransport } from "../../src/mail-cache-bridge";

const id = "9a4e5830-cf6f-4a32-a8b3-99f49d4145a9";
const display = document.querySelector<HTMLElement>("#fixture")!;
let reads = 0;
let requests = 0;
let observation: BridgeObservation;
const setStatus = (state: BridgeStatus["state"], stale = false, acknowledge = false) => {
  observation = {
    kind: stale ? "stale" : "current", pending: false,
    status: {
      schema_version: 1, state, updated_at: new Date().toISOString(),
      last_sync_at: "2026-01-01T12:34:00.000Z", indexed_count: 27, interval_minutes: 15, exports_enabled: true,
      ...(acknowledge ? { last_request_id: id } : {}),
    },
  };
};
setStatus("ready");
const transport: MailCacheBridgeTransport = {
  async readStatus() { reads += 1; return observation; },
  async requestSync() {
    requests += 1;
    return { kind: "requested", id, sentAt: Date.now() };
  },
};
const host = "7b38d21f-7f14-4c70-94aa-41a147404b67";
let hostState: HostState = { host, active: null };
let now = Date.now();
const createStore = () => {
  const files = new Map<string, string>();
  const store: RemoteMailStore = {
    async read(path) { return files.get(path) ?? null; },
    async write(path, previous, next) {
      if ((files.get(path) ?? null) !== previous) throw Error("collision");
      files.set(path, next);
    },
  };
  return { files, store };
};
const mac = createStore(), phone = createStore();
const mobile = location.search.includes("mobile");
const client = mobile ? createRemoteMailClient(phone.store) : null;
const relay = createRemoteMailRelay({ store: mac.store, transport, now: () => now,
  state: () => hostState, save: (value) => { hostState = value; } });
let dispose = renderRoute("automations", display, null, mobile ? null : transport, client);
Object.assign(window, { fixture: {
  setStatus, reads: () => reads, requests: () => requests,
  mobileRequest: () => phone.files.has(REQUEST_PATH),
  async connectMobile() {
    await relay.tick();
    phone.files.set(STATUS_PATH, mac.files.get(STATUS_PATH)!);
  },
  async syncToMac() {
    mac.files.set(REQUEST_PATH, phone.files.get(REQUEST_PATH)!);
    await this.connectMobile();
  },
  async reportRemote(state: BridgeStatus["state"]) {
    now = Date.now();
    setStatus(state, false, true);
    if (observation.kind === "current") observation.status.last_sync_at = new Date(now).toISOString();
    await this.connectMobile();
  },
  navigateAway() { dispose?.(); dispose = undefined; renderRoute("home", display, null); },
} });
