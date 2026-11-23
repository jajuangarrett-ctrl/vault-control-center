import { createButton, createIcon } from "./dom";
import { isCurrentRemoteStatus, remoteReceipt, waitingForRemote, type createRemoteMailClient } from "./mail-cache-remote";

const PHASE_COPY = {
  submitting: "Requested · sending to Mail Cache Bridge",
  requested: "Requested · waiting for Mail Cache Bridge",
  syncing: "Syncing Inbox on the Mac",
  completed: "Sync completed",
  incomplete: "Sync incomplete · check Mail Cache Bridge on the Mac",
  failed: "Sync failed · check Mail Cache Bridge on the Mac",
  unconfirmed: "Sync was not confirmed · check Mail Cache Bridge on the Mac",
};

type Client = ReturnType<typeof createRemoteMailClient>;
type Snapshot = Awaited<ReturnType<Client["observe"]>>;

export function renderMobileMailCacheBridge(parent: HTMLElement, client: Client): () => void {
  const panel = parent.createEl("section", { cls: "fjg-vcc-mail-bridge", attr: { "aria-label": "Mail Cache Bridge" } });
  const header = panel.createDiv({ cls: "fjg-vcc-mail-bridge-header" });
  const title = header.createDiv();
  const kicker = title.createDiv({ cls: "fjg-vcc-mail-bridge-kicker" });
  createIcon(kicker, "mail");
  kicker.createSpan({ text: "Local Apple Mail · Inbox" });
  title.createEl("h2", { text: "Mail Cache Bridge" });
  const actions = header.createDiv({ cls: "fjg-vcc-mail-bridge-actions" });
  const state = panel.createDiv({ cls: "fjg-vcc-mail-bridge-state", attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" } });
  const heading = state.createEl("strong");
  const hint = state.createEl("p");
  const summary = panel.createEl("dl", { cls: "fjg-vcc-mail-bridge-summary" });
  const entry = summary.createDiv();
  entry.createEl("dt", { text: "Last sync reported by the Mac" });
  const lastSync = entry.createEl("dd");
  const receipt = panel.createEl("p", { cls: "fjg-vcc-mail-bridge-receipt", attr: { role: "status", "aria-live": "polite" } });
  panel.createEl("p", { cls: "fjg-vcc-mail-bridge-privacy", text: "Obsidian Sync carries only a refresh request and status. Email and exports stay on the Mac." });

  let disposed = false, submitting = false, checking = false, invalid = false;
  let snapshot: Snapshot | null = null;
  let error = "";
  let attempt = 0;
  const sync = createButton(actions, {
    label: "Sync Now", className: "fjg-vcc-button is-primary fjg-vcc-mail-bridge-sync",
    icon: "refresh-cw", disabled: true, onClick: (event) => { if (event.isTrusted) void submit(); },
  });
  const refresh = createButton(actions, {
    label: "Refresh status", className: "fjg-vcc-button", icon: "radio", onClick: () => void poll(),
  });

  function put(el: HTMLElement, text: string) {
    if (el.textContent !== text) el.textContent = text;
  }

  function paint(): void {
    if (disposed) return;
    const now = Date.now();
    const status = snapshot?.status ?? null;
    const current = isCurrentRemoteStatus(status, now);
    let label: string, copy: string, tone: string;
    if (invalid) [label, copy, tone] = ["Status unavailable", "The synced control notes could not be read. Check the vault on the Mac.", "critical"];
    else if (!snapshot) [label, copy, tone] = ["Checking status", "Looking for the Mac’s last synced status.", "neutral"];
    else if (!status) [label, copy, tone] = ["Mac not connected", "In Vault Control Center settings on the Mac, enable Mobile Mail Cache Sync. Keep Obsidian and Mail Cache Bridge running.", "attention"];
    else if (!current) [label, copy, tone] = ["Mac status is out of date", "Open the same synced vault and Mail Cache Bridge on the Mac, then wait for Obsidian Sync.", "attention"];
    else if (status.state === "ready") [label, copy, tone] = ["Ready to sync", "Request an Inbox refresh on the Mac. Delivery depends on Obsidian Sync.", "positive"];
    else if (status.state === "disabled") [label, copy, tone] = ["Mobile sync is off", "Enable Mobile Mail Cache Sync on the Mac to send requests again.", "attention"];
    else if (status.state === "busy") [label, copy, tone] = ["Sync in progress", "The Mac is processing a request or running a sync.", "attention"];
    else [label, copy, tone] = ["Bridge unavailable", "On the Mac, check Mobile Mail Cache Sync, open Mail Cache Bridge, and make sure exports and Allow Vault Control Center are on.", "attention"];
    put(heading, label);
    put(hint, copy);
    state.dataset.tone = tone;
    const time = status?.lastSync;
    put(lastSync, time ? new Date(time).toLocaleString() : "Not reported");
    const match = snapshot && remoteReceipt(snapshot);
    const waiting = !!snapshot && waitingForRemote(snapshot, now);
    const sameHost = !!snapshot?.request && snapshot.request.host === status?.host;
    const detail = submitting ? "Sending sync request…" : error ||
      (sameHost && match && (waiting || ["completed", "failed", "incomplete", "unconfirmed"].includes(match.phase)) ? PHASE_COPY[match.phase] :
        sameHost && waiting ? "Requested · waiting for the Mac to receive it" :
        sameHost ? "The Mac did not confirm this request. It may have expired before delivery." : "");
    receipt.hidden = !detail;
    put(receipt, detail);
    sync.disabled = submitting || invalid || waiting || !current || status.state !== "ready";
    refresh.disabled = checking;
  }

  async function poll(): Promise<void> {
    if (disposed || checking) return;
    checking = true;
    const before = attempt;
    paint();
    try {
      const next = await client.observe();
      if (!submitting && before === attempt) { snapshot = next; invalid = false; }
    } catch {
      if (!submitting && before === attempt) invalid = true;
    } finally {
      checking = false;
      paint();
    }
  }

  async function submit(): Promise<void> {
    if (disposed || sync.disabled) return;
    submitting = true;
    attempt++;
    error = "";
    paint();
    try {
      const request = await client.requestSync();
      if (!request) error = "No request sent. The Mac isn’t ready or there’s already a request pending.";
      else if (snapshot) snapshot = { ...snapshot, request };
    } catch {
      error = "The request could not be saved. Check Obsidian Sync and try again.";
    } finally {
      submitting = false;
      paint();
      void poll();
    }
  }

  paint();
  const win = parent.ownerDocument.defaultView;
  void poll();
  if (!win) return () => { disposed = true; };
  const timer = win.setInterval(() => {
    if (panel.isConnected && panel.getClientRects().length) void poll();
  }, 4_000);
  return () => { disposed = true; win.clearInterval(timer); };
}
