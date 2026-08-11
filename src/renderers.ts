import { Notice, setIcon } from "obsidian";
import type {
  AiFolderKey,
  DashboardBookmark,
  DashboardData,
  DashboardFileCategory,
  DashboardFileItem,
  DashboardFolderRoot,
  DashboardProgram,
} from "./data";
import {
  createButton,
  createEmptyState,
  createIcon,
  createPanel,
  formatRelativeTime,
  initialsFor,
  matchesQuery,
} from "./dom";
import {
  buildProgramFolderView,
  programFolderMatchesNavigationQuery,
  programMatchesNavigationQuery,
  searchProgramFiles,
} from "./program-navigation";
import {
  filterHtmlGalleryItems,
  MIN_USABLE_HTML_THUMBNAIL_BYTES,
  type HtmlGallerySnapshot,
} from "./html-gallery";
import type {
  AutomationGroup,
  AutomationItemSnapshot,
  AutomationSnapshot,
} from "./automations";
import { VISIBLE_AUTOMATION_GROUPS } from "./automations";
import type { SystemMemorySnapshot } from "./system-memory";
import type { TaskboardSnapshot } from "./taskboard";
import {
  DEFAULT_SETTINGS,
  type ClipboardTemplateId,
  type DashboardRoute,
  type DashboardSettings,
  type DashboardTheme,
} from "./types";

export type RecentFilter = "all" | DashboardFileCategory;
export type BookmarkFilter = "all" | DashboardBookmark["type"];

export interface DashboardRenderState {
  query: string;
  selectedAreaPath: string;
  selectedAreaFolderPath: string;
  selectedProgramPath: string;
  selectedProgramFolderPath: string;
  selectedAiQueue: AiFolderKey;
  recentFilter: RecentFilter;
  bookmarkFilter: BookmarkFilter;
}

export interface DashboardRenderContext {
  data: DashboardData;
  taskboard: TaskboardSnapshot;
  htmlGallery: HtmlGallerySnapshot;
  htmlThumbnailsGenerating: boolean;
  automations: AutomationSnapshot;
  memory: SystemMemorySnapshot;
  automationStartingIds: ReadonlySet<string>;
  automationRequestMessages: ReadonlyMap<string, string>;
  operationsRefreshing: boolean;
  settings: DashboardSettings;
  state: DashboardRenderState;
  activePreviewPath: string;
  folderRailId: string;
  folderRailCollapsed: boolean;
  setFolderRailCollapsed: (collapsed: boolean) => void;
  clearSearch: () => void;
  navigate: (route: DashboardRoute) => void;
  openFile: (path: string) => void;
  openHtml: (path: string) => void;
  resourceUrl: (path: string) => string;
  refreshHtmlThumbnails: () => void;
  refreshOperations: () => void;
  runAutomation: (id: string) => void;
  openBookmark: (bookmark: DashboardBookmark) => void;
  openExternal: (url: string) => void;
  capture: (commandId: string, label: string) => void;
  selectArea: (path: string) => void;
  selectAreaFolder: (path: string) => void;
  selectProgram: (path: string) => void;
  selectProgramFolder: (path: string) => void;
  selectAiQueue: (key: AiFolderKey) => void;
  setRecentFilter: (filter: RecentFilter) => void;
  setBookmarkFilter: (filter: BookmarkFilter) => void;
  copyTemplate: (id: ClipboardTemplateId) => void;
  updateTemplate: (id: ClipboardTemplateId, value: string) => void;
  resetTemplate: (id: ClipboardTemplateId) => void;
  setTheme: (theme: DashboardTheme) => void;
  setShellTheme: (enabled: boolean) => void;
  openNativeSettings: () => void;
}

interface ProgramActivityGroup {
  label: string;
  icon: string;
  tone: "positive" | "attention" | "planning";
  programs: DashboardProgram[];
}

const AI_QUEUE_ORDER: AiFolderKey[] = [
  "emailQueue",
  "formattedNotes",
  "ownerInbox",
  "teamInbox",
];

export function renderRoute(
  route: DashboardRoute,
  parent: HTMLElement,
  context: DashboardRenderContext
): void {
  parent.empty();
  const view = parent.createDiv({ cls: "fjg-vcc-route-view", attr: { "data-route": route } });

  switch (route) {
    case "home":
      renderHome(view, context);
      break;
    case "areas":
      renderAreas(view, context);
      break;
    case "programs":
      renderPrograms(view, context);
      break;
    case "html":
      renderHtmlGallery(view, context);
      break;
    case "ai-team":
      renderAiTeam(view, context);
      break;
    case "automations":
      renderAutomations(view, context);
      break;
    case "recent":
      renderRecent(view, context);
      break;
    case "bookmarks":
      renderBookmarks(view, context);
      break;
    case "people":
      renderPeople(view, context);
      break;
    case "clipboard":
      renderClipboard(view, context);
      break;
    case "settings":
      renderSettings(view, context);
      break;
  }
}

function renderHtmlGallery(parent: HTMLElement, context: DashboardRenderContext): void {
  const items = filterHtmlGalleryItems(
    context.htmlGallery.items,
    context.state.query
  );
  const toolbar = parent.createDiv({ cls: "fjg-vcc-html-toolbar" });
  const copy = toolbar.createDiv({ cls: "fjg-vcc-html-toolbar-copy" });
  copy.createEl("h2", {
    text: `${items.length} HTML artifact${items.length === 1 ? "" : "s"}`,
  });
  copy.createEl("p", {
    text:
      "Clickable previews for finished HTML dashboards and tools across the configured vault folders.",
  });
  createButton(toolbar, {
    label: context.htmlThumbnailsGenerating
      ? "Updating previews…"
      : "Update previews",
    icon: context.htmlThumbnailsGenerating ? "loader-circle" : "images",
    className: "fjg-vcc-button is-primary",
    disabled: context.htmlThumbnailsGenerating,
    onClick: context.refreshHtmlThumbnails,
  });

  if (!items.length) {
    createEmptyState(
      parent,
      context.state.query ? "No HTML artifacts match" : "No HTML artifacts found",
      context.state.query
        ? "Try another search or clear the current query."
        : "Check the HTML gallery roots in plugin settings, then refresh.",
      "panels-top-left"
    );
    return;
  }

  const grid = parent.createDiv({
    cls: "fjg-vcc-html-grid",
    attr: { "aria-label": "HTML artifact gallery" },
  });
  for (const item of items) {
    const card = grid.createEl("button", {
      cls: "fjg-vcc-html-card",
      attr: {
        type: "button",
        "aria-label": `Open ${item.title} in Obsidian`,
        "data-file-path": item.path,
      },
    });
    const thumbnail = card.createDiv({ cls: "fjg-vcc-html-thumbnail" });
    const hasUsableThumbnail =
      item.thumbnailFile && item.thumbnailFile.stat.size >= MIN_USABLE_HTML_THUMBNAIL_BYTES;
    if (hasUsableThumbnail) {
      const placeholder = thumbnail.createDiv({
        cls: "fjg-vcc-html-thumbnail-placeholder",
        attr: { hidden: "" },
      });
      createIcon(placeholder, "panels-top-left");
      placeholder.createSpan({ text: "Preview unavailable" });
      const image = thumbnail.createEl("img", {
        attr: {
          src: context.resourceUrl(item.thumbnailPath),
          alt: `Preview of ${item.title}`,
          loading: "lazy",
        },
      });
      image.addEventListener("error", () => {
        image.remove();
        placeholder.removeAttribute("hidden");
      });
    } else {
      const placeholder = thumbnail.createDiv({
        cls: "fjg-vcc-html-thumbnail-placeholder",
      });
      createIcon(placeholder, "panels-top-left");
      placeholder.createSpan({ text: item.title });
      placeholder.createEl("small", { text: "Local preview needs refresh" });
    }
    const cardCopy = card.createDiv({ cls: "fjg-vcc-html-card-copy" });
    cardCopy.createSpan({ cls: "fjg-vcc-html-card-title", text: item.title });
    cardCopy.createEl("p", {
      cls: "fjg-vcc-html-card-description",
      text: item.description || "Interactive HTML artifact",
    });
    const meta = cardCopy.createDiv({ cls: "fjg-vcc-html-card-meta" });
    meta.createSpan({ text: `${item.category} · ${item.folder}` });
    meta.createSpan({ text: formatRelativeTime(item.modifiedAt) });
    card.addEventListener("click", () => context.openHtml(item.path));
  }
}

function renderAutomations(parent: HTMLElement, context: DashboardRenderContext): void {
  const toolbar = parent.createDiv({ cls: "fjg-vcc-operations-toolbar" });
  const copy = toolbar.createDiv({ cls: "fjg-vcc-operations-toolbar-copy" });
  copy.createEl("h2", { text: "Automation control center" });
  copy.createEl("p", {
    text:
      "See synchronized results on any device. Run controls unlock only on the Mac that owns the loaded vault-processing jobs.",
  });
  createButton(toolbar, {
    label: context.operationsRefreshing ? "Refreshing…" : "Refresh status",
    icon: "refresh-cw",
    className: "fjg-vcc-button",
    disabled: context.operationsRefreshing,
    onClick: context.refreshOperations,
  });

  const hostNote = parent.createDiv({ cls: "fjg-vcc-automation-host-note" });
  createIcon(
    hostNote,
    context.automations.isExecutor ? "server-cog" : "monitor-dot"
  );
  hostNote.createSpan({ text: context.automations.message });

  renderMemoryCard(parent, context);

  const groupLabels: Record<(typeof VISIBLE_AUTOMATION_GROUPS)[number], string> = {
    "routine-vault": "Scheduled vault processors",
    "external-cloud": "External and cloud automations",
  };
  const groups: Array<{ id: AutomationGroup; label: string }> =
    VISIBLE_AUTOMATION_GROUPS.map((id) => ({ id, label: groupLabels[id] }));
  for (const group of groups) {
    const visible = context.automations.items.filter(
      (item) =>
        item.group === group.id &&
        matchesQuery(
          context.state.query,
          item.label,
          item.description,
          item.schedule,
          item.lastResult ?? "",
          item.runMessage
        )
    );
    if (!visible.length && context.state.query) continue;
    const panel = createPanel(parent, `${group.label} · ${visible.length}`, {
      className: "fjg-vcc-automation-section",
    });
    if (!visible.length) {
      createEmptyState(
        panel.body,
        "No automations match",
        "Clear search to restore this automation group.",
        "workflow"
      );
      continue;
    }
    const grid = panel.body.createDiv({ cls: "fjg-vcc-automation-grid" });
    for (const item of visible) renderAutomationCard(grid, item, context);
  }
}

function renderMemoryCard(parent: HTMLElement, context: DashboardRenderContext): void {
  const memory = context.memory;
  const tone = memory.status === "ready" ? memory.tone : "attention";
  const card = parent.createEl("section", {
    cls: "fjg-vcc-memory-card",
    attr: { "data-tone": tone, "aria-label": "Always-on Mac RAM usage" },
  });
  const copy = card.createDiv({ cls: "fjg-vcc-memory-copy" });
  copy.createSpan({ cls: "fjg-vcc-memory-kicker", text: "Always-on Mac RAM" });
  const value = copy.createDiv({ cls: "fjg-vcc-memory-value" });
  if (memory.status === "ready") {
    value.createEl("strong", { text: `${formatNumber(memory.usedPercent)}%` });
    value.createSpan({ text: "in use" });
    copy.createDiv({
      cls: "fjg-vcc-memory-detail",
      text: `${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} · ${formatNumber(memory.freePercent)}% available`,
    });
  } else {
    value.createEl("strong", { text: "Unavailable" });
    copy.createDiv({ cls: "fjg-vcc-memory-detail", text: memory.message });
  }

  const meter = card.createDiv({ cls: "fjg-vcc-memory-meter" });
  const track = meter.createDiv({
    cls: "fjg-vcc-memory-track",
    attr: {
      role: "progressbar",
      "aria-label": "RAM in use",
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      "aria-valuenow": String(memory.status === "ready" ? memory.usedPercent : 0),
    },
  });
  const fill = track.createSpan({ cls: "fjg-vcc-memory-fill" });
  fill.style.width = `${memory.status === "ready" ? memory.usedPercent : 0}%`;
  meter.createDiv({
    cls: "fjg-vcc-memory-detail",
    text: memory.checkedAt
      ? `Checked ${formatRelativeTime(Date.parse(memory.checkedAt))}`
      : "Waiting for the first status check",
  });
  createButton(meter, {
    label: context.operationsRefreshing ? "Refreshing…" : "Refresh RAM",
    icon: "refresh-cw",
    className: "fjg-vcc-button",
    disabled: context.operationsRefreshing,
    onClick: context.refreshOperations,
  });
}

function renderAutomationCard(
  parent: HTMLElement,
  item: AutomationItemSnapshot,
  context: DashboardRenderContext
): void {
  const starting = context.automationStartingIds.has(item.id);
  const state = starting
    ? "running"
    : item.statusReadState === "error" || item.healthTone === "critical"
      ? "error"
      : "idle";
  const card = parent.createEl("article", {
    cls: "fjg-vcc-automation-card",
    attr: { "data-state": state },
  });
  const header = card.createDiv({ cls: "fjg-vcc-automation-card-header" });
  header.createSpan({ cls: "fjg-vcc-automation-card-title", text: item.label });
  header.createSpan({ cls: "fjg-vcc-badge", text: item.schedule });
  card.createEl("p", { text: item.description });
  card.createEl("p", {
    text: item.lastResult
      ? `${item.lastResult}${item.lastCompletedAt ? ` · ${item.lastCompletedAt}` : ""}`
      : item.statusMessage,
  });
  const footer = card.createDiv({ cls: "fjg-vcc-automation-card-footer" });
  const statusTone = starting ? "attention" : automationStatusTone(item);
  footer.createSpan({
    cls: "fjg-vcc-automation-status",
    text: starting ? "Starting with launchd…" : item.healthMessage,
    attr: { "data-tone": statusTone },
  });
  const requestMessage = context.automationRequestMessages.get(item.id);
  if (requestMessage) {
    card.createDiv({
      cls: "fjg-vcc-automation-request-result",
      text: requestMessage,
    });
  }
  const actions = footer.createDiv({ cls: "fjg-vcc-form-actions" });
  if (item.resolvedStatusPath) {
    createButton(actions, {
      label: "View",
      icon: "file-clock",
      className: "fjg-vcc-button",
      ariaLabel: `View the latest status for ${item.label}`,
      title: "View latest status",
      onClick: () => context.openFile(item.resolvedStatusPath ?? ""),
    });
  }
  createButton(actions, {
    label: starting ? "Starting…" : "Run now",
    icon: starting ? "loader-circle" : "play",
    className: "fjg-vcc-button is-primary",
    disabled: starting || !item.canRun,
    ariaLabel: item.canRun
      ? `Run ${item.label} now`
      : `${item.label}: ${item.runMessage}`,
    title: item.canRun ? "Run now" : item.runMessage,
    onClick: () => context.runAutomation(item.id),
  });
}

function automationStatusTone(
  item: AutomationItemSnapshot
): "positive" | "attention" | "critical" | "neutral" {
  return item.healthTone;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown";
  const gib = bytes / 1_073_741_824;
  if (gib >= 1) return `${gib.toFixed(gib >= 10 ? 1 : 2)} GB`;
  const mib = bytes / 1_048_576;
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function renderHome(parent: HTMLElement, context: DashboardRenderContext): void {
  renderCaptureActions(parent, context);
  renderSignals(parent, context);

  const workGrid = parent.createDiv({ cls: "fjg-vcc-work-grid" });
  renderCurrentWork(workGrid, context);

  const latest = createPanel(
    workGrid,
    context.data.recentMode === "viewed" ? "Recently viewed" : "Latest files",
    {
      actionLabel: "View all",
      actionIcon: "arrow-right",
      onAction: () => context.navigate("recent"),
    }
  );
  renderRecentFileList(
    latest.body,
    filteredFiles(context.data.recent, context.state.query).slice(0, 9),
    context
  );

  const people = createPanel(workGrid, "People radar", {
    actionLabel: "Preview contact list",
    actionIcon: "contact-round",
    onAction: () => context.openFile(context.settings.contactListPath),
  });
  renderPeopleRows(
    people.body,
    filteredFiles(context.data.people.files, context.state.query).slice(0, 9),
    context
  );

  renderTaskManagement(parent, context);
}

function renderCaptureActions(parent: HTMLElement, context: DashboardRenderContext): void {
  const actions = [
    { label: "Thought", icon: "square-pen", command: "thought-capture:capture" },
    { label: "Email", icon: "mail", command: "email-capture:capture" },
    { label: "Agenda item", icon: "list", command: "agenda-capture:capture" },
    {
      label: "Program update",
      icon: "megaphone",
      command: "program-update-capture:capture",
    },
  ];
  const grid = parent.createDiv({ cls: "fjg-vcc-capture-grid", attr: { "aria-label": "Capture" } });

  for (const action of actions) {
    const button = grid.createEl("button", {
      cls: "fjg-vcc-capture-action",
      attr: { type: "button", "aria-label": `Capture ${action.label}` },
    });
    createIcon(button, action.icon);
    button.createSpan({ cls: "fjg-vcc-capture-label", text: action.label });
    button.createSpan({ cls: "fjg-vcc-capture-open", text: "Open" });
    button.addEventListener("click", () => context.capture(action.command, action.label));
  }
}

function renderSignals(parent: HTMLElement, context: DashboardRenderContext): void {
  const { metrics } = context.data;
  const taskCount = context.taskboard.status === "ready" ? context.taskboard.openCount : metrics.openTasks;
  const signals: Array<{
    label: string;
    value: number;
    icon: string;
    route: DashboardRoute;
    attention?: boolean;
  }> = [
    { label: "Programs", value: metrics.programs, icon: "folder", route: "programs" },
    {
      label: "AI queues",
      value: metrics.aiQueues,
      icon: "bot",
      route: "ai-team",
      attention: metrics.aiQueues > 0,
    },
    { label: "Agenda files", value: metrics.agenda, icon: "notebook-tabs", route: "people" },
    {
      label: "Open tasks",
      value: taskCount,
      icon: "circle-check-big",
      route: "home",
      attention: taskCount > 0,
    },
  ];
  const strip = parent.createDiv({ cls: "fjg-vcc-signal-strip", attr: { "aria-label": "Vault signals" } });

  for (const signal of signals) {
    const button = strip.createEl("button", {
      cls: "fjg-vcc-signal",
      attr: { type: "button", "aria-label": `${signal.label}: ${signal.value}` },
    });
    createIcon(button, signal.icon);
    const copy = button.createSpan({ cls: "fjg-vcc-signal-copy" });
    copy.createSpan({ cls: "fjg-vcc-signal-label", text: signal.label });
    const value = copy.createSpan({ cls: "fjg-vcc-signal-value", text: String(signal.value) });
    if (signal.attention) value.createSpan({ cls: "fjg-vcc-attention-dot", attr: { "aria-hidden": "true" } });
    button.addEventListener("click", () => context.navigate(signal.route));
  }
}

function renderCurrentWork(parent: HTMLElement, context: DashboardRenderContext): void {
  const panel = createPanel(parent, "Current work", {
    actionLabel: "All programs",
    actionIcon: "arrow-right",
    onAction: () => context.navigate("programs"),
    className: "fjg-vcc-current-work",
  });
  const matching = context.data.programs.filter((program) =>
    matchesQuery(context.state.query, program.name, program.path)
  );
  const groups = groupProgramsByActivity(matching);

  if (!matching.length) {
    createEmptyState(panel.body, "No programs match", "Clear search or check the Programs folder setting.", "folder-search");
    return;
  }

  for (const group of groups) {
    if (!group.programs.length) continue;
    const status = group.tone === "attention" ? "warning" : group.tone;
    const groupEl = panel.body.createDiv({ cls: "fjg-vcc-group", attr: { "data-status": status } });
    const header = groupEl.createEl("button", {
      cls: "fjg-vcc-group-header",
      attr: { type: "button", "aria-expanded": "true" },
    });
    createIcon(header, group.icon);
    header.createSpan({ text: group.label });
    header.createSpan({ cls: "fjg-vcc-group-count", text: String(group.programs.length) });
    const body = groupEl.createDiv({ cls: "fjg-vcc-group-body" });
    header.addEventListener("click", () => {
      const collapsed = groupEl.classList.toggle("is-collapsed");
      header.setAttribute("aria-expanded", String(!collapsed));
    });

    for (const program of group.programs.slice(0, 6)) {
      const timestamp = programModifiedAt(program);
      const activity = activityScore(timestamp);
      const row = body.createEl("button", {
        cls: "fjg-vcc-progress-row",
        attr: { type: "button", "aria-label": `Open ${program.name}`, "data-status": status },
      });
      row.createSpan({ cls: "fjg-vcc-progress-name", text: program.name });
      const track = row.createSpan({ cls: "fjg-vcc-progress-track", attr: { "aria-hidden": "true" } });
      const bar = track.createSpan({ cls: "fjg-vcc-progress-bar" });
      bar.style.width = `${activity}%`;
      row.createSpan({ cls: "fjg-vcc-progress-value", text: timestamp ? formatRelativeTime(timestamp) : "No files" });
      row.createSpan({ cls: "fjg-vcc-progress-count", text: String(program.count) });
      row.addEventListener("click", () => {
        context.selectProgram(program.path);
        context.navigate("programs");
      });
    }
  }
}

function renderTaskManagement(parent: HTMLElement, context: DashboardRenderContext): void {
  const remote = context.taskboard;
  const open = remote.openCount;
  const total = remote.totalCount;
  const panel = createPanel(parent, "Task management", {
    actionLabel: "Task Manager",
    actionIcon: "list-checks",
    onAction: () => context.capture("fjg-task-manager:open-dashboard", "FJG Task Manager"),
    className: "fjg-vcc-task-panel",
  });
  const summary = panel.body.createDiv({ cls: "fjg-vcc-task-summary" });
  summary.createEl("strong", { text: `${open} open` });
  summary.createSpan({ text: ` of ${total} total tasks` });
  summary.createSpan({
    cls: "fjg-vcc-badge",
    text: "Obsidian task workspaces",
  });
  const visible = remote.items
    .filter((task) => matchesQuery(context.state.query, task.title, task.project, task.assignee))
    .slice(0, 8);
  const list = panel.body.createDiv({ cls: "fjg-vcc-row-list" });
  for (const task of visible) {
    const row = list.createEl("button", { cls: "fjg-vcc-row", attr: { type: "button", "data-tone": "task" } });
    createIcon(row, "circle-dot", "fjg-vcc-row-icon");
    const main = row.createDiv({ cls: "fjg-vcc-row-main" });
    main.createSpan({ cls: "fjg-vcc-row-title", text: task.title });
    main.createSpan({ cls: "fjg-vcc-row-meta", text: ["Do First", task.project, task.assignee].filter(Boolean).join(" · ") });
    row.createSpan({ cls: "fjg-vcc-row-end", text: task.dueDate || "No due date" });
    row.addEventListener("click", () => context.openFile(task.vaultPath));
  }
}

interface FolderCollectionOptions {
  roots: DashboardFolderRoot[];
  selectedRootPath: string;
  selectedFolderPath: string;
  title: string;
  article: "a" | "an";
  singular: string;
  sourceName: string;
  listCount?: number;
  selectRoot: (path: string) => void;
  selectFolder: (path: string) => void;
}

function renderAreas(parent: HTMLElement, context: DashboardRenderContext): void {
  renderFolderCollection(parent, context, {
    roots: [context.data.areasRoot, ...context.data.areas],
    selectedRootPath: context.state.selectedAreaPath,
    selectedFolderPath: context.state.selectedAreaFolderPath,
    title: "Areas",
    article: "an",
    singular: "area",
    sourceName: "Areas",
    listCount: context.data.areas.length,
    selectRoot: context.selectArea,
    selectFolder: context.selectAreaFolder,
  });
}

function renderPrograms(parent: HTMLElement, context: DashboardRenderContext): void {
  renderFolderCollection(parent, context, {
    roots: context.data.programs,
    selectedRootPath: context.state.selectedProgramPath,
    selectedFolderPath: context.state.selectedProgramFolderPath,
    title: "Programs",
    article: "a",
    singular: "program",
    sourceName: "Programs",
    selectRoot: context.selectProgram,
    selectFolder: context.selectProgramFolder,
  });
}

function renderFolderCollection(
  parent: HTMLElement,
  context: DashboardRenderContext,
  options: FolderCollectionOptions
): void {
  const query = context.state.query.trim();
  if (query) {
    renderFolderCollectionSearch(parent, context, options, query);
    return;
  }

  const matches = options.roots.filter((root) =>
    programMatchesNavigationQuery(root, context.state.query)
  );
  const selected =
    matches.find((root) => root.path === options.selectedRootPath) ?? matches[0];
  const layout = parent.createDiv({ cls: "fjg-vcc-page-layout fjg-vcc-program-layout" });
  const listPanel = createPanel(layout, `${options.title} · ${options.listCount ?? matches.length}`, {
    className: "fjg-vcc-folder-rail",
  });
  listPanel.body.id = context.folderRailId;
  let railCollapsed = context.folderRailCollapsed;
  let railToggle: HTMLButtonElement;
  const syncRailToggle = (): void => {
    const label = `${railCollapsed ? "Show" : "Hide"} ${options.title.toLocaleLowerCase()} list`;
    railToggle.setAttribute("aria-label", label);
    railToggle.setAttribute("aria-expanded", String(!railCollapsed));
    railToggle.setAttribute("title", label);
    const icon = railToggle.querySelector<HTMLElement>(".fjg-vcc-icon");
    if (icon) setIcon(icon, railCollapsed ? "panel-left-open" : "panel-left-close");
    const labels = railToggle.querySelectorAll<HTMLSpanElement>("span");
    const textLabel = labels.item(labels.length - 1);
    if (textLabel) textLabel.textContent = label;
  };
  railToggle = createButton(listPanel.header, {
    label: `${railCollapsed ? "Show" : "Hide"} ${options.title.toLocaleLowerCase()} list`,
    icon: railCollapsed ? "panel-left-open" : "panel-left-close",
    className: "fjg-vcc-text-action fjg-vcc-folder-rail-toggle",
    onClick: () => {
      railCollapsed = !railCollapsed;
      context.setFolderRailCollapsed(railCollapsed);
      syncRailToggle();
    },
  });
  railToggle.setAttribute("aria-controls", context.folderRailId);
  syncRailToggle();

  if (!matches.length) {
    createEmptyState(
      listPanel.body,
      `No ${options.title.toLowerCase()} match`,
      `Clear search or verify the ${options.sourceName} folder.`,
      "folder-search"
    );
  } else {
    const list = listPanel.body.createDiv({ cls: "fjg-vcc-select-list" });
    for (const root of matches) {
      const row = list.createEl("button", {
        cls: `fjg-vcc-row fjg-vcc-select-row${root.path === selected?.path ? " is-selected" : ""}`,
        attr: { type: "button", "aria-pressed": String(root.path === selected?.path) },
      });
      createIcon(row, "folder", "fjg-vcc-row-icon");
      const main = row.createDiv({ cls: "fjg-vcc-row-main" });
      main.createSpan({ cls: "fjg-vcc-row-title", text: root.name });
      main.createSpan({ cls: "fjg-vcc-row-meta", text: `${root.count} files` });
      row.createSpan({ cls: "fjg-vcc-row-end", text: formatRelativeTime(programModifiedAt(root)) });
      row.addEventListener("click", () => options.selectRoot(root.path));
    }
  }

  const folderView = selected
    ? buildProgramFolderView(
        selected,
        options.selectedFolderPath || selected.path
      )
    : null;
  const detail = createPanel(layout, selected?.name ?? `${options.title} detail`, {
    actionLabel: folderView?.latestFile ? "Preview latest" : undefined,
    actionIcon: "file-up",
    onAction: folderView?.latestFile
      ? () => context.openFile(folderView.latestFile?.path ?? "")
      : undefined,
  });
  if (!selected || !folderView) {
    createEmptyState(
      detail.body,
      `Choose ${options.article} ${options.singular}`,
      `Select ${options.article} ${options.singular} to inspect its files.`,
      "folder-open"
    );
    return;
  }

  const summary = detail.body.createDiv({ cls: "fjg-vcc-detail-summary" });
  summary.createEl("strong", {
    text: `${folderView.count} file${folderView.count === 1 ? "" : "s"}`,
  });
  summary.createSpan({
    text:
      folderView.path === selected.path
        ? `Latest activity ${formatRelativeTime(folderView.latestModifiedAt)}`
        : `${selected.count} in ${selected.name} · Latest activity ${formatRelativeTime(folderView.latestModifiedAt)}`,
  });

  const browser = detail.body.createDiv({ cls: "fjg-vcc-program-browser" });
  const toolbar = browser.createDiv({ cls: "fjg-vcc-folder-toolbar" });
  if (folderView.parentPath) {
    createButton(toolbar, {
      label: "Up",
      icon: "arrow-up",
      className: "fjg-vcc-folder-up",
      ariaLabel: `Go up from ${folderView.name}`,
      onClick: () => options.selectFolder(folderView.parentPath ?? selected.path),
    });
  }
  const breadcrumbs = toolbar.createEl("nav", {
    cls: "fjg-vcc-folder-breadcrumbs",
    attr: { "aria-label": `${options.title} folder path` },
  });
  for (const [index, breadcrumb] of folderView.breadcrumbs.entries()) {
    if (index > 0) {
      breadcrumbs.createSpan({
        cls: "fjg-vcc-folder-separator",
        text: "/",
        attr: { "aria-hidden": "true" },
      });
    }
    const isCurrent = breadcrumb.path === folderView.path;
    if (isCurrent) {
      breadcrumbs.createSpan({
        cls: "fjg-vcc-folder-current",
        text: breadcrumb.name,
        attr: { "aria-current": "page" },
      });
    } else {
      createButton(breadcrumbs, {
        label: breadcrumb.name,
        className: "fjg-vcc-folder-crumb",
        onClick: () => options.selectFolder(breadcrumb.path),
      });
    }
  }

  browser.createEl("h3", {
    cls: "fjg-vcc-folder-heading",
    text: folderView.name,
    attr: { tabindex: "-1" },
  });

  const visibleFolders = folderView.folders.filter((folder) =>
    programFolderMatchesNavigationQuery(selected, folder, context.state.query)
  );
  const visibleFiles = folderView.files.filter((file) =>
    fileMatches(file, context.state.query)
  );

  if (visibleFolders.length) {
    browser.createDiv({ cls: "fjg-vcc-section-label", text: "Folders" });
    const folderList = browser.createDiv({
      cls: "fjg-vcc-folder-list",
      attr: { "aria-label": `Folders in ${folderView.name}` },
    });
    for (const folder of visibleFolders) {
      const button = folderList.createEl("button", {
        cls: "fjg-vcc-folder-chip",
        attr: {
          type: "button",
          "aria-label": `Open folder ${folder.name}, ${folder.count} file${folder.count === 1 ? "" : "s"}`,
        },
      });
      createIcon(button, "folder-closed");
      button.createSpan({ cls: "fjg-vcc-folder-name", text: folder.name });
      button.createSpan({ cls: "fjg-vcc-folder-count", text: String(folder.count) });
      button.addEventListener("click", () => options.selectFolder(folder.path));
    }
  }

  if (visibleFiles.length) {
    browser.createDiv({ cls: "fjg-vcc-section-label fjg-vcc-files-label", text: "Files in this folder" });
    renderFileList(browser, visibleFiles, context);
  } else if (!visibleFolders.length) {
    createEmptyState(
      browser,
      context.state.query ? "No items match" : "This folder is empty",
      context.state.query
        ? "Clear search or go up to another folder."
        : "Go up to choose another folder.",
      "folder-search"
    );
  } else {
    browser.createEl("p", {
      cls: "fjg-vcc-program-folder-note",
      text: "Choose a folder to keep drilling down.",
    });
  }
}

function renderFolderCollectionSearch(
  parent: HTMLElement,
  context: DashboardRenderContext,
  options: FolderCollectionOptions,
  query: string
): void {
  const results = searchProgramFiles(options.roots, query);
  const layout = parent.createDiv({
    cls: "fjg-vcc-page-layout fjg-vcc-folder-search-layout",
    attr: { "data-layout": "wide-list" },
  });
  const detail = createPanel(
    layout,
    `${options.title} search · ${results.length}`,
    {
      actionLabel: "Clear search",
      actionIcon: "x",
      onAction: context.clearSearch,
      className: "fjg-vcc-folder-search-panel",
    }
  );
  const summary = detail.body.createDiv({
    cls: "fjg-vcc-detail-summary fjg-vcc-folder-search-summary",
    attr: { role: "status", "aria-live": "polite", "aria-atomic": "true" },
  });
  summary.createEl("strong", {
    text: `${results.length} matching file${results.length === 1 ? "" : "s"}`,
  });
  summary.createSpan({
    text: `Across ${options.title} · File names and folder paths matching “${query}”`,
  });

  const resultsRegion = detail.body.createEl("section", {
    cls: "fjg-vcc-folder-search-results",
    attr: { "aria-label": `${options.title} file search results` },
  });
  if (!results.length) {
    createEmptyState(
      resultsRegion,
      `No files match “${query}”`,
      `Try another file or folder name, or clear search to browse ${options.title}.`,
      "file-search"
    );
    return;
  }

  resultsRegion.createDiv({
    cls: "fjg-vcc-section-label fjg-vcc-files-label",
    text: "All matching files",
  });
  renderFileList(resultsRegion, results, context);
}

function renderAiTeam(parent: HTMLElement, context: DashboardRenderContext): void {
  const cards = parent.createDiv({ cls: "fjg-vcc-queue-grid" });
  for (const key of AI_QUEUE_ORDER) {
    const queue = context.data.aiQueues[key];
    const button = cards.createEl("button", {
      cls: `fjg-vcc-queue-card${context.state.selectedAiQueue === key ? " is-selected" : ""}`,
      attr: { type: "button", "aria-pressed": String(context.state.selectedAiQueue === key) },
    });
    createIcon(button, queueIcon(key));
    const copy = button.createSpan({ cls: "fjg-vcc-signal-copy" });
    copy.createSpan({ cls: "fjg-vcc-signal-label", text: queue.label });
    copy.createSpan({ cls: "fjg-vcc-signal-value", text: String(queue.count) });
    button.addEventListener("click", () => context.selectAiQueue(key));
  }

  const queue = context.data.aiQueues[context.state.selectedAiQueue];
  const panel = createPanel(parent, queue.label);
  panel.header.createSpan({
    cls: "fjg-vcc-badge",
    text: `${queue.count} ${queue.scope === "direct" ? "direct " : ""}files`,
  });
  if (queue.scope === "direct") {
    panel.body.createEl("p", {
      cls: "fjg-vcc-panel-note",
      text: "Direct supported files are counted as active inbox items; nested folders are not included.",
    });
  }
  renderFileList(panel.body, queue.files.filter((file) => fileMatches(file, context.state.query)), context);
}

function renderRecent(parent: HTMLElement, context: DashboardRenderContext): void {
  const filters: Array<{ id: RecentFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "programs", label: "Programs" },
    { id: "ai", label: "AI Team" },
    { id: "people", label: "People" },
    { id: "tasks", label: "Tasks" },
    { id: "areas", label: "Areas" },
    { id: "vault", label: "Vault" },
  ];
  renderFilterBar(parent, filters, context.state.recentFilter, context.setRecentFilter);
  const files = context.data.recent.filter(
    (file) =>
      (context.state.recentFilter === "all" || file.category === context.state.recentFilter) &&
      fileMatches(file, context.state.query)
  );
  const panel = createPanel(
    parent,
    `${context.data.recentMode === "viewed" ? "Recently viewed" : "Recent files"} · ${files.length}`
  );
  renderRecentFileList(panel.body, files, context);
}

function renderBookmarks(parent: HTMLElement, context: DashboardRenderContext): void {
  const filters: Array<{ id: BookmarkFilter; label: string }> = [
    { id: "all", label: "All" },
    { id: "file", label: "Files" },
    { id: "folder", label: "Folders" },
    { id: "url", label: "Links" },
  ];
  renderFilterBar(parent, filters, context.state.bookmarkFilter, context.setBookmarkFilter);
  const bookmarks = context.data.bookmarks.filter(
    (bookmark) =>
      (context.state.bookmarkFilter === "all" || bookmark.type === context.state.bookmarkFilter) &&
      matchesQuery(context.state.query, bookmark.label, bookmark.displayTarget, bookmark.group)
  );
  const panel = createPanel(parent, `Visible bookmarks · ${bookmarks.length}`);
  if (!bookmarks.length) {
    createEmptyState(panel.body, "No bookmarks match", "Sensitive bookmarks stay hidden automatically.", "bookmark-x");
  }
  for (const bookmark of bookmarks) {
    const previewsFile = bookmark.type !== "url";
    const row = panel.body.createEl("button", {
      cls: `fjg-vcc-row${bookmark.type === "file" && context.activePreviewPath === bookmark.target ? " is-selected" : ""}`,
      attr: {
        type: "button",
        "aria-label": `${previewsFile ? "Preview" : "Open"} ${bookmark.label}`,
        ...(bookmark.type === "file"
          ? {
              "aria-current": context.activePreviewPath === bookmark.target ? "true" : "false",
              "data-file-path": bookmark.target,
            }
          : {}),
      },
    });
    createIcon(row, bookmark.type === "url" ? "external-link" : bookmark.type, "fjg-vcc-row-icon");
    const main = row.createDiv({ cls: "fjg-vcc-row-main" });
    main.createSpan({ cls: "fjg-vcc-row-title", text: bookmark.label });
    main.createSpan({ cls: "fjg-vcc-row-path", text: bookmark.group || bookmark.displayTarget });
    row.createSpan({ cls: "fjg-vcc-row-end", text: bookmark.type });
    row.addEventListener("click", () => context.openBookmark(bookmark));
  }
  if (context.data.metrics.hiddenBookmarks > 0) {
    panel.panel.createDiv({
      cls: "fjg-vcc-panel-footer",
      text: `${context.data.metrics.hiddenBookmarks} sensitive or internal bookmark${context.data.metrics.hiddenBookmarks === 1 ? "" : "s"} hidden.`,
    });
  }
}

function renderPeople(parent: HTMLElement, context: DashboardRenderContext): void {
  const toolbar = parent.createDiv({ cls: "fjg-vcc-toolbar" });
  toolbar.createEl("p", {
    text: `${context.data.people.count} agenda files ready for one-to-one and team follow-up.`,
  });
  createButton(toolbar, {
    label: "Preview contact list",
    icon: "contact-round",
    className: "fjg-vcc-button",
    onClick: () => context.openFile(context.settings.contactListPath),
  });
  const panel = createPanel(parent, "Agenda radar");
  const files = context.data.people.files.filter((file) => fileMatches(file, context.state.query));
  renderPeopleRows(panel.body, files, context);
}

function renderClipboard(parent: HTMLElement, context: DashboardRenderContext): void {
  const definitions: Array<{ id: ClipboardTemplateId; label: string; description: string }> = [
    { id: "meetingFollowUp", label: "Meeting follow-up", description: "Decisions, owners, and next steps." },
    { id: "programUpdate", label: "Program update", description: "Progress, risks, and milestones." },
    { id: "emailHandoff", label: "Email handoff", description: "Context, ask, deadline, and signature." },
  ];
  parent.createEl("p", {
    cls: "fjg-vcc-route-intro",
    text: "Edit reusable text in place. Templates remain in this plugin's local preferences.",
  });
  const layout = parent.createDiv({ cls: "fjg-vcc-template-layout" });

  for (const definition of definitions) {
    const panel = createPanel(layout, definition.label);
    panel.body.createEl("p", { cls: "fjg-vcc-panel-note", text: definition.description });
    const textarea = panel.body.createEl("textarea", {
      cls: "fjg-vcc-editor",
      attr: { "aria-label": `${definition.label} template`, rows: "12" },
    });
    textarea.value = context.settings.clipboardTemplates[definition.id];
    textarea.addEventListener("input", () => context.updateTemplate(definition.id, textarea.value));
    const actions = panel.body.createDiv({ cls: "fjg-vcc-form-actions" });
    createButton(actions, {
      label: "Copy",
      icon: "copy",
      className: "fjg-vcc-button is-primary",
      onClick: () => context.copyTemplate(definition.id),
    });
    createButton(actions, {
      label: "Reset",
      icon: "rotate-ccw",
      className: "fjg-vcc-button",
      onClick: () => context.resetTemplate(definition.id),
    });
  }
}

function renderSettings(parent: HTMLElement, context: DashboardRenderContext): void {
  const appearance = parent.createEl("section", { cls: "fjg-vcc-settings-section" });
  appearance.createEl("h2", { text: "Appearance" });
  appearance.createEl("p", { text: "The dashboard structure stays fixed while theme tokens change." });
  const themeOptions = appearance.createDiv({ cls: "fjg-vcc-theme-options" });
  for (const theme of ["dark", "light"] as const) {
    const button = themeOptions.createEl("button", {
      cls: `fjg-vcc-theme-option${context.settings.theme === theme ? " is-selected" : ""}`,
      attr: { type: "button", "aria-pressed": String(context.settings.theme === theme) },
    });
    button.createSpan({ cls: "fjg-vcc-theme-swatch", attr: { "data-theme": theme, "aria-hidden": "true" } });
    button.createSpan({ text: theme === "dark" ? "Throwback dark" : "Throwback light" });
    button.addEventListener("click", () => context.setTheme(theme));
  }
  const shellLabel = appearance.createEl("label", { cls: "fjg-vcc-toggle-row" });
  const shellToggle = shellLabel.createEl("input", { attr: { type: "checkbox" } });
  shellToggle.checked = context.settings.applyShellTheme;
  shellLabel.createSpan({ text: "Coordinate Obsidian shell colors" });
  shellToggle.addEventListener("change", () => context.setShellTheme(shellToggle.checked));

  const sources = parent.createEl("section", { cls: "fjg-vcc-settings-section" });
  const sourcesHeader = sources.createDiv({ cls: "fjg-vcc-panel-header" });
  sourcesHeader.createEl("h2", { text: "Live sources" });
  createButton(sourcesHeader, {
    label: "Open plugin settings",
    icon: "sliders-horizontal",
    className: "fjg-vcc-button",
    onClick: context.openNativeSettings,
  });
  const sourceList = sources.createDiv({ cls: "fjg-vcc-source-list" });
  renderSourceRow(sourceList, "Areas", context.data.sources.areasFolder.path, context.data.sources.areasFolder.status);
  renderSourceRow(sourceList, "Programs", context.data.sources.programsFolder.path, context.data.sources.programsFolder.status);
  renderSourceRow(sourceList, "People", context.data.sources.peopleFolder.path, context.data.sources.peopleFolder.status);
  for (const key of AI_QUEUE_ORDER) {
    const source = context.data.sources.aiFolders[key];
    renderSourceRow(sourceList, context.data.aiQueues[key].label, source.path, source.status);
  }
  renderSourceRow(sourceList, "Bookmarks", context.data.sources.bookmarks.path, context.data.sources.bookmarks.status);
  renderSourceRow(sourceList, "Tasks", context.data.sources.tasksFile.path, context.data.sources.tasksFile.status);

  const privacy = parent.createEl("section", { cls: "fjg-vcc-settings-section" });
  privacy.createEl("h2", { text: "Privacy boundary" });
  privacy.createEl("p", {
    text: "Indexes are derived in memory. Sensitive and archived paths are excluded before rendering. Only a capped list of safe preview paths is kept in Obsidian workspace state so Recent stays accurate; no vault content or snapshot is written to plugin data.",
  });
}

function renderFileList(
  parent: HTMLElement,
  files: DashboardFileItem[],
  context: DashboardRenderContext
): void {
  if (!files.length) {
    createEmptyState(parent, "No files match", "Clear search or verify this source in Settings.", "file-search");
    return;
  }
  const list = parent.createDiv({ cls: "fjg-vcc-row-list" });
  for (const file of files) renderFileRow(list, file, context);
}

function renderRecentFileList(
  parent: HTMLElement,
  files: DashboardFileItem[],
  context: DashboardRenderContext
): void {
  if (!files.length) {
    createEmptyState(
      parent,
      context.data.recentMode === "viewed"
        ? "No recently viewed files match"
        : "No files match",
      "Clear search or open a file in Obsidian.",
      "file-search"
    );
    return;
  }
  const list = parent.createDiv({ cls: "fjg-vcc-row-list" });
  for (const file of files) {
    renderFileRow(
      list,
      file,
      context,
      context.data.recentMode === "viewed" ? "Viewed" : undefined
    );
  }
}

function renderFileRow(
  parent: HTMLElement,
  file: DashboardFileItem,
  context: DashboardRenderContext,
  endText?: string
): void {
  const row = parent.createEl("button", {
    cls: `fjg-vcc-row${context.activePreviewPath === file.path ? " is-selected" : ""}`,
    attr: {
      type: "button",
      "aria-label": `Preview ${file.title}, in ${file.path}`,
      "aria-current": context.activePreviewPath === file.path ? "true" : "false",
      "data-file-path": file.path,
    },
  });
  createIcon(row, iconForExtension(file.extension), "fjg-vcc-row-icon");
  const main = row.createDiv({ cls: "fjg-vcc-row-main" });
  main.createSpan({ cls: "fjg-vcc-row-title", text: file.title });
  main.createSpan({ cls: "fjg-vcc-row-path", text: file.path });
  row.createSpan({
    cls: "fjg-vcc-row-end",
    text: endText ?? formatRelativeTime(file.modifiedAt),
  });
  row.addEventListener("click", () => context.openFile(file.path));
}

function renderPeopleRows(
  parent: HTMLElement,
  files: DashboardFileItem[],
  context: DashboardRenderContext
): void {
  if (!files.length) {
    createEmptyState(parent, "No agenda files match", "Clear search or verify the People folder.", "users-round");
    return;
  }
  const list = parent.createDiv({ cls: "fjg-vcc-row-list" });
  for (const file of files) {
    const row = list.createEl("button", {
      cls: `fjg-vcc-row${context.activePreviewPath === file.path ? " is-selected" : ""}`,
      attr: {
        type: "button",
        "aria-label": `Preview agenda for ${file.title}`,
        "aria-current": context.activePreviewPath === file.path ? "true" : "false",
        "data-file-path": file.path,
      },
    });
    row.createSpan({ cls: "fjg-vcc-avatar", text: initialsFor(file.title) });
    const main = row.createDiv({ cls: "fjg-vcc-row-main" });
    main.createSpan({ cls: "fjg-vcc-row-title", text: file.title });
    main.createSpan({ cls: "fjg-vcc-row-meta", text: "Agenda file" });
    row.createSpan({ cls: "fjg-vcc-row-end", text: formatRelativeTime(file.modifiedAt) });
    row.addEventListener("click", () => context.openFile(file.path));
  }
}

function renderFilterBar<T extends string>(
  parent: HTMLElement,
  filters: Array<{ id: T; label: string }>,
  current: T,
  onChange: (filter: T) => void
): void {
  const bar = parent.createDiv({ cls: "fjg-vcc-filter-bar", attr: { "aria-label": "Filters" } });
  for (const filter of filters) {
    const button = bar.createEl("button", {
      cls: `fjg-vcc-filter-chip${filter.id === current ? " is-selected" : ""}`,
      text: filter.label,
      attr: { type: "button", "aria-pressed": String(filter.id === current) },
    });
    button.addEventListener("click", () => onChange(filter.id));
  }
}

function renderSourceRow(parent: HTMLElement, label: string, path: string, status: string): void {
  const row = parent.createDiv({ cls: "fjg-vcc-row fjg-vcc-source-row" });
  createIcon(row, status === "available" ? "circle-check" : "circle-alert", "fjg-vcc-row-icon");
  const main = row.createDiv({ cls: "fjg-vcc-row-main" });
  main.createSpan({ cls: "fjg-vcc-row-title", text: label });
  main.createSpan({ cls: "fjg-vcc-row-path", text: path || "Not configured" });
  row.createSpan({ cls: `fjg-vcc-status is-${status}`, text: status });
}

function filteredFiles(files: DashboardFileItem[], query: string): DashboardFileItem[] {
  return files.filter((file) => fileMatches(file, query));
}

function fileMatches(file: DashboardFileItem, query: string): boolean {
  return matchesQuery(query, file.title, file.path, file.extension, file.category);
}

function programModifiedAt(program: DashboardFolderRoot): number {
  return program.files.reduce((latest, file) => Math.max(latest, file.modifiedAt), 0);
}

function groupProgramsByActivity(programs: DashboardProgram[]): ProgramActivityGroup[] {
  const groups: ProgramActivityGroup[] = [
    { label: "Active this week", icon: "chevron-down", tone: "positive", programs: [] },
    { label: "Needs a look", icon: "chevron-down", tone: "attention", programs: [] },
    { label: "Planning", icon: "chevron-down", tone: "planning", programs: [] },
  ];
  const now = Date.now();
  for (const program of programs) {
    const timestamp = programModifiedAt(program);
    const ageDays = timestamp ? (now - timestamp) / 86_400_000 : Number.POSITIVE_INFINITY;
    if (ageDays <= 7) groups[0].programs.push(program);
    else if (ageDays <= 45) groups[1].programs.push(program);
    else groups[2].programs.push(program);
  }
  for (const group of groups) {
    group.programs.sort((left, right) => programModifiedAt(right) - programModifiedAt(left));
  }
  return groups;
}

function activityScore(timestamp: number): number {
  if (!timestamp) return 8;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return Math.max(8, Math.round(100 - Math.min(92, ageDays * 2)));
}

function iconForExtension(extension: string): string {
  const icons: Record<string, string> = {
    md: "file-text",
    pdf: "file-type-2",
    html: "code-2",
    json: "braces",
    canvas: "layout-dashboard",
    csv: "table-2",
    xlsx: "sheet",
    xls: "sheet",
    docx: "file-type",
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    bmp: "image",
    svg: "image",
    mp3: "audio-lines",
    wav: "audio-lines",
    m4a: "audio-lines",
    ogg: "audio-lines",
    oga: "audio-lines",
    flac: "audio-lines",
    aac: "audio-lines",
    opus: "audio-lines",
    mp4: "video",
    m4v: "video",
    webm: "video",
    mov: "video",
    ogv: "video",
    mkv: "video",
  };
  return icons[extension] ?? "file";
}

function queueIcon(key: AiFolderKey): string {
  return {
    emailQueue: "mail-check",
    formattedNotes: "notebook-text",
    ownerInbox: "inbox",
    teamInbox: "users",
  }[key];
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice("Copied to clipboard.");
  } catch {
    new Notice("Clipboard access was not available.");
  }
}

export function resetTemplateValue(id: ClipboardTemplateId): string {
  return DEFAULT_SETTINGS.clipboardTemplates[id];
}
