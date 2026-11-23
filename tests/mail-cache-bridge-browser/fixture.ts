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
let dispose = renderRoute("automations", display, null, location.search.includes("mobile") ? null : transport);
Object.assign(window, { fixture: {
  setStatus, reads: () => reads, requests: () => requests,
  navigateAway() { dispose?.(); dispose = undefined; renderRoute("home", display, null); },
} });
