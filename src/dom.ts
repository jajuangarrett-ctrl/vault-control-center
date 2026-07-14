import { setIcon } from "obsidian";

export interface ButtonOptions {
  label: string;
  icon?: string;
  className?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  onClick: (event: MouseEvent) => void;
}

export function createIcon(parent: HTMLElement, name: string, className = "fjg-vcc-icon"): HTMLElement {
  const icon = parent.createSpan({ cls: className, attr: { "aria-hidden": "true" } });
  setIcon(icon, name);
  return icon;
}

export function createButton(parent: HTMLElement, options: ButtonOptions): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: options.className,
    attr: {
      type: "button",
      "aria-label": options.ariaLabel ?? options.label,
      ...(options.title ? { title: options.title } : {}),
    },
  });
  if (options.icon) createIcon(button, options.icon);
  button.createSpan({ text: options.label });
  button.disabled = options.disabled ?? false;
  button.addEventListener("click", options.onClick);
  return button;
}

export function createPanel(
  parent: HTMLElement,
  title: string,
  options: { actionLabel?: string; actionIcon?: string; onAction?: () => void; className?: string } = {}
): { panel: HTMLElement; header: HTMLElement; body: HTMLElement } {
  const panel = parent.createEl("section", {
    cls: ["fjg-vcc-panel", options.className].filter(Boolean).join(" "),
  });
  const header = panel.createDiv({ cls: "fjg-vcc-panel-header" });
  header.createEl("h2", { text: title });
  if (options.actionLabel && options.onAction) {
    createButton(header, {
      label: options.actionLabel,
      icon: options.actionIcon,
      className: "fjg-vcc-text-action",
      onClick: () => options.onAction?.(),
    });
  }
  const body = panel.createDiv({ cls: "fjg-vcc-panel-body" });
  return { panel, header, body };
}

export function createEmptyState(
  parent: HTMLElement,
  title: string,
  description: string,
  icon = "inbox"
): HTMLElement {
  const state = parent.createDiv({ cls: "fjg-vcc-empty" });
  createIcon(state, icon, "fjg-vcc-empty-icon");
  state.createEl("strong", { text: title });
  state.createEl("p", { text: description });
  return state;
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return "Unknown";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(
    new Date(timestamp)
  );
}

export function titleFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

export function matchesQuery(query: string, ...values: Array<string | number | undefined>): boolean {
  const clean = query.trim().toLocaleLowerCase();
  if (!clean) return true;
  return values.some((value) => String(value ?? "").toLocaleLowerCase().includes(clean));
}

export function initialsFor(name: string): string {
  const parts = name
    .replace(/\.[^.]+$/, "")
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

