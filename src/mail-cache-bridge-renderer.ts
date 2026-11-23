import { createButton, createIcon } from "./dom";
import {
  canRequestBridgeSync, STATUS_TTL_MS,
  type BridgeObservation, type BridgeStatus, type MailCacheBridgeTransport,
} from "./mail-cache-bridge";

const STATE: Record<BridgeStatus["state"], [label: string, explanation: string, tone: string]> = {
  paused: ["Paused", "Enable exports in Mail Cache Bridge to allow a manual sync.", "attention"],
  ready: ["Ready to sync", "Sync the cached Inbox into your configured local export.", "positive"],
  syncing: ["Syncing Inbox", "Mail Cache Bridge is updating the local export.", "attention"],
  completed: ["Sync complete", "The last Inbox export finished successfully.", "positive"],
  needs_access: ["Mail access needed", "Review Mail Cache Bridge's Full Disk Access on this Mac.", "attention"],
  no_cache: ["No local Mail cache", "Open Apple Mail on this Mac and let its Inbox sync before trying again.", "attention"],
  failed: ["Sync failed", "Open Mail Cache Bridge to see what stopped the sync. You can retry here.", "critical"],
  incomplete: ["Sync incomplete", "Check Mail Cache Bridge for cached messages it could not export.", "attention"],
};

const POLL_MS = 5_000;

function put(el: HTMLElement, value: string): void {
  if (el.textContent !== value) el.textContent = value;
}

export function renderMailCacheBridge(
  parent: HTMLElement,
  transport: MailCacheBridgeTransport | null,
): () => void {
  const panel = parent.createEl("section", { cls: "fjg-vcc-mail-bridge", attr: { "aria-label": "Mail Cache Bridge" } });
  const header = panel.createDiv({ cls: "fjg-vcc-mail-bridge-header" });
  const title = header.createDiv();
  const kicker = title.createDiv({ cls: "fjg-vcc-mail-bridge-kicker" });
  createIcon(kicker, "mail");
  kicker.createSpan({ text: "Local Apple Mail · Inbox" });
  title.createEl("h2", { text: "Mail Cache Bridge" });
  const actions = header.createDiv({ cls: "fjg-vcc-mail-bridge-actions" });

  const state = panel.createDiv({ cls: "fjg-vcc-mail-bridge-state", attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
  const stateLabel = state.createEl("strong");
  const stateHint = state.createEl("p");
  const summary = panel.createEl("dl", { cls: "fjg-vcc-mail-bridge-summary" });
  const metric = (name: string) => {
    const entry = summary.createDiv();
    entry.createEl("dt", { text: name });
    return entry.createEl("dd");
  };
  const lastSync = metric("Last sync");
  const indexed = metric("Indexed messages");
  const schedule = metric("Automatic sync");
  const receipt = panel.createEl("p", { cls: "fjg-vcc-mail-bridge-receipt", attr: { role: "status", "aria-live": "polite" } });
  receipt.hidden = true;
  panel.createEl("p", { cls: "fjg-vcc-mail-bridge-privacy", text: "The desktop control is local. Optional Mobile Mail Cache Sync shares only a refresh request and status, not your email or exported files." });

  let observation: BridgeObservation | undefined;
  let waiting: { id: string; sentAt: number } | undefined;
  let feedback = "";
  let checking = false;
  let submitting = false;
  let disposed = false;

  const sync = createButton(actions, {
    label: "Sync Now",
    className: "fjg-vcc-button is-primary fjg-vcc-mail-bridge-sync",
    icon: "refresh-cw",
    disabled: true,
    onClick: (event) => {
      if (event.isTrusted) void submit();
    },
  });
  const refresh = transport && createButton(actions, {
    label: "Refresh status",
    className: "fjg-vcc-button",
    icon: "radio",
    onClick: () => void poll(),
  });

  function paint(): void {
    if (disposed) return;
    const current = observation?.kind === "current" || observation?.kind === "stale" ? observation : null;
    const status = current?.status;
    let label: string, hint: string, tone: string;
    if (!transport) {
      [label, hint, tone] = ["Available on Mac", "Use this tab in desktop Obsidian on the Mac running Mail Cache Bridge. Sync Now and live status are not available here.", "neutral"];
    } else if (!observation) {
      [label, hint, tone] = ["Checking status", "Looking for Mail Cache Bridge on this Mac.", "neutral"];
    } else if (observation.kind === "not-configured") {
      [label, hint, tone] = ["Not connected", "Open Mail Cache Bridge on this Mac, enable exports, then turn on Allow Vault Control Center.", "attention"];
    } else if (observation.kind === "offline" || observation.kind === "stale") {
      [label, hint, tone] = ["Bridge not responding", "Open Mail Cache Bridge on this Mac and check that Allow Vault Control Center is on.", "attention"];
    } else if (observation.kind === "invalid") {
      [label, hint, tone] = ["Status unavailable", "This Mac's Mail Cache Bridge status could not be verified. Check the app and try Refresh status.", "critical"];
    } else if (status && status.exports_enabled !== true && ["ready", "completed", "paused"].includes(status.state)) {
      [label, hint, tone] = STATE.paused;
    } else {
      [label, hint, tone] = status ? STATE[status.state] : ["Status unavailable", "Check Mail Cache Bridge on this Mac.", "attention"];
    }

    put(stateLabel, label);
    put(stateHint, hint);
    state.dataset.tone = tone;
    summary.hidden = !transport;
    put(lastSync, status?.last_sync_at ? new Date(status.last_sync_at).toLocaleString() : "Not reported");
    put(indexed, status?.indexed_count === undefined ? "Not reported" : status.indexed_count.toLocaleString());
    put(schedule, status?.interval_minutes === 0 ? "Manual only" :
      status?.interval_minutes ? `Every ${status.interval_minutes} min` : "Not reported");
    const detail = submitting ? "Sending sync request…" :
      waiting ? "Sync requested. Waiting for Mail Cache Bridge." :
      current?.pending ? "A sync request is pending in Mail Cache Bridge." :
      feedback;
    receipt.hidden = !detail;
    put(receipt, detail);
    sync.disabled = submitting || Boolean(waiting) || !observation || !canRequestBridgeSync(observation);
    if (refresh) refresh.disabled = checking;
  }

  async function poll(): Promise<void> {
    if (!transport || disposed || checking) return;
    checking = true;
    paint();
    try {
      const value = await transport.readStatus();
      if (disposed) return;
      observation = value;
      if (waiting) {
        if (value.kind === "current" && value.status.last_request_id?.toLowerCase() === waiting.id.toLowerCase()) {
          waiting = undefined;
          feedback = value.status.state === "syncing" ? "Mail Cache Bridge accepted the request." : "";
        } else if (Date.now() - waiting.sentAt > STATUS_TTL_MS) {
          waiting = undefined;
          feedback = "The sync request was not confirmed. Check Mail Cache Bridge on this Mac.";
        }
      }
      if (feedback === "Mail Cache Bridge accepted the request." && value.kind === "current" &&
        value.status.state !== "syncing") feedback = "";
    } catch {
      if (!disposed) observation = { kind: "invalid" };
    } finally {
      checking = false;
      paint();
    }
  }

  async function submit(): Promise<void> {
    if (!transport || disposed || submitting || waiting || !observation || !canRequestBridgeSync(observation)) return;
    submitting = true;
    feedback = "";
    paint();
    try {
      const result = await transport.requestSync();
      if (disposed) return;
      if (result.kind === "requested") waiting = result;
      else if (result.kind === "pending") feedback = "A sync request is already pending.";
      else if (result.kind === "unavailable") feedback = "Mail Cache Bridge is not ready to sync.";
      else feedback = "The sync request could not be sent. Check Mail Cache Bridge on this Mac.";
    } catch {
      feedback = "The sync request could not be sent. Check Mail Cache Bridge on this Mac.";
    } finally {
      submitting = false;
      paint();
      void poll();
    }
  }

  paint();
  const win = parent.ownerDocument.defaultView;
  if (!transport || !win) return () => { disposed = true; };
  void poll();
  const timer = win.setInterval(() => {
    if (panel.isConnected && panel.getClientRects().length) void poll();
  }, POLL_MS);
  return () => { disposed = true; win.clearInterval(timer); };
}
