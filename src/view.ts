import {
  Component,
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  TFolder,
  Vault,
  normalizePath,
  parseLinktext,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import {
  buildDashboardData,
  isExcludedPath,
  isSensitivePath,
  normalizeFileTitle,
  normalizeVaultPath,
  pathIsWithin,
  type AiFolderKey,
  type DashboardBookmark,
  type DashboardData,
  type DashboardFileCategory,
  type DashboardFileItem,
} from "./data";
import { createButton, createIcon } from "./dom";
import type VaultControlCenterPlugin from "./plugin";
import { resolveProgramFolderPath } from "./program-navigation";
import {
  PREVIEW_TEXT_SIZE_LIMIT,
  classifyPreviewKind,
  mergePreviewHistory,
  parseInternalLinkTarget,
  type PreviewKind,
} from "./preview";
import {
  copyText,
  renderRoute,
  resetTemplateValue,
  type BookmarkFilter,
  type DashboardRenderContext,
  type DashboardRenderState,
  type RecentFilter,
} from "./renderers";
import { fetchTaskboardSnapshot, type TaskboardSnapshot } from "./taskboard";
import { oppositeTheme } from "./theme";
import {
  DASHBOARD_VIEW_TYPE,
  ROUTES,
  ROUTE_DEFINITIONS,
  type ClipboardTemplateId,
  type DashboardRoute,
  type DashboardTheme,
} from "./types";

interface PersistedViewState {
  route?: unknown;
  selectedAreaPath?: unknown;
  selectedAreaFolderPath?: unknown;
  selectedProgramPath?: unknown;
  selectedProgramFolderPath?: unknown;
  selectedAiQueue?: unknown;
  recentFilter?: unknown;
  bookmarkFilter?: unknown;
  folderRailCollapsed?: unknown;
  previewPath?: unknown;
  previewHistory?: unknown;
}

type AppWithSettings = {
  setting?: {
    open?: () => void;
    openTabById?: (id: string) => void;
  };
};

const AI_QUEUE_KEYS: AiFolderKey[] = ["emailQueue", "formattedNotes", "ownerInbox", "teamInbox"];
const RECENT_FILTERS: RecentFilter[] = ["all", "programs", "ai", "people", "tasks", "areas", "vault"];
const BOOKMARK_FILTERS: BookmarkFilter[] = ["all", "file", "folder", "url"];
const TASKBOARD_CACHE_TTL_MS = 5 * 60 * 1000;
let dashboardViewSequence = 0;

interface PreviewOpenOptions {
  focus?: boolean;
  recordHistory?: boolean;
}

interface PreviewCloseOptions {
  restoreFocus?: boolean;
}

export class VaultControlCenterView extends ItemView {
  navigation = false;
  private route: DashboardRoute = "home";
  private data: DashboardData | null = null;
  private taskboard: TaskboardSnapshot = {
    status: "disabled",
    totalCount: 0,
    openCount: 0,
    buckets: {},
    items: [],
    updatedAt: "",
    sourceUrl: "",
    error: "",
  };
  private renderState: DashboardRenderState = {
    query: "",
    selectedAreaPath: "",
    selectedAreaFolderPath: "",
    selectedProgramPath: "",
    selectedProgramFolderPath: "",
    selectedAiQueue: "emailQueue",
    recentFilter: "all",
    bookmarkFilter: "all",
  };
  private rootEl: HTMLElement | null = null;
  private routeTabsEl: HTMLElement | null = null;
  private contentFrameEl: HTMLElement | null = null;
  private contentRegionEl: HTMLElement | null = null;
  private previewPaneEl: HTMLElement | null = null;
  private mobileDockEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private activePreviewFile: TFile | null = null;
  private pendingPreviewPath = "";
  private previewReturnFocusEl: HTMLElement | null = null;
  private previewComponent: Component | null = null;
  private previewBrowserCollapsed = false;
  private folderRailCollapsed = false;
  private previewRequestId = 0;
  private previewHistory: string[] = [];
  private previewResizeObserver: ResizeObserver | null = null;
  private templateSaveTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private taskboardFetchedAt = 0;
  private taskboardSettingsKey = "";
  private readonly browserRegionId = `fjg-vcc-browser-${++dashboardViewSequence}`;
  private readonly folderRailId = `fjg-vcc-folder-rail-${dashboardViewSequence}`;

  constructor(leaf: WorkspaceLeaf, readonly plugin: VaultControlCenterPlugin) {
    super(leaf);
  }

  getViewType(): string {
    return DASHBOARD_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Vault Control Center";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("fjg-vcc-host");
    this.renderShell();
    const ownerDocument = this.contentEl.ownerDocument;
    this.registerDomEvent(ownerDocument, "keydown", (event: KeyboardEvent) => this.handleKeyboard(event));
    if (this.pendingPreviewPath) {
      void this.openPreview(this.pendingPreviewPath, { focus: false, recordHistory: false });
    }
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.templateSaveTimer !== null) {
      window.clearTimeout(this.templateSaveTimer);
      this.templateSaveTimer = null;
      await this.plugin.saveSettings();
    }
    this.previewRequestId += 1;
    this.disposePreviewComponent();
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    this.contentEl.empty();
    this.rootEl = null;
    this.contentFrameEl = null;
    this.contentRegionEl = null;
    this.previewPaneEl = null;
    this.routeTabsEl = null;
    this.mobileDockEl = null;
    this.searchInputEl = null;
    this.previewReturnFocusEl = null;
    this.activePreviewFile = null;
    this.previewBrowserCollapsed = false;
    this.folderRailCollapsed = false;
  }

  getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      route: this.route,
      selectedAreaPath: this.renderState.selectedAreaPath,
      selectedAreaFolderPath: this.renderState.selectedAreaFolderPath,
      selectedProgramPath: this.renderState.selectedProgramPath,
      selectedProgramFolderPath: this.renderState.selectedProgramFolderPath,
      selectedAiQueue: this.renderState.selectedAiQueue,
      recentFilter: this.renderState.recentFilter,
      bookmarkFilter: this.renderState.bookmarkFilter,
      folderRailCollapsed: this.folderRailCollapsed,
      previewPath: this.activePreviewFile?.path || this.pendingPreviewPath,
      previewHistory: this.previewHistory,
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const saved = (state && typeof state === "object" ? state : {}) as PersistedViewState;
    if (typeof saved.route === "string" && ROUTES.includes(saved.route as DashboardRoute)) {
      this.route = saved.route as DashboardRoute;
    }
    if (typeof saved.selectedAreaPath === "string") {
      this.renderState.selectedAreaPath = saved.selectedAreaPath;
    }
    if (typeof saved.selectedAreaFolderPath === "string") {
      this.renderState.selectedAreaFolderPath = saved.selectedAreaFolderPath;
    }
    if (typeof saved.selectedProgramPath === "string") {
      this.renderState.selectedProgramPath = saved.selectedProgramPath;
    }
    if (typeof saved.selectedProgramFolderPath === "string") {
      this.renderState.selectedProgramFolderPath = saved.selectedProgramFolderPath;
    }
    const savedAiQueue = saved.selectedAiQueue;
    if (typeof savedAiQueue === "string" && AI_QUEUE_KEYS.includes(savedAiQueue as AiFolderKey)) {
      this.renderState.selectedAiQueue = savedAiQueue as AiFolderKey;
    }
    if (typeof saved.recentFilter === "string" && RECENT_FILTERS.includes(saved.recentFilter as RecentFilter)) {
      this.renderState.recentFilter = saved.recentFilter as RecentFilter;
    }
    if (typeof saved.bookmarkFilter === "string" && BOOKMARK_FILTERS.includes(saved.bookmarkFilter as BookmarkFilter)) {
      this.renderState.bookmarkFilter = saved.bookmarkFilter as BookmarkFilter;
    }
    if (typeof saved.folderRailCollapsed === "boolean") {
      this.folderRailCollapsed = saved.folderRailCollapsed;
    }
    const savedPreviewPath = typeof saved.previewPath === "string"
      ? normalizeVaultPath(saved.previewPath)
      : "";
    this.pendingPreviewPath =
      savedPreviewPath &&
      !isExcludedPath(savedPreviewPath) &&
      !isSensitivePath(savedPreviewPath)
        ? savedPreviewPath
        : "";
    if (Array.isArray(saved.previewHistory)) {
      this.previewHistory = saved.previewHistory
        .filter((path): path is string => typeof path === "string")
        .reduceRight(
          (history, path) => mergePreviewHistory(
            history,
            path,
            (candidate) =>
              !isExcludedPath(candidate) &&
              !isSensitivePath(candidate) &&
              this.app.vault.getAbstractFileByPath(normalizePath(candidate)) instanceof TFile
          ),
          [] as string[]
        );
    }

    if (this.rootEl) {
      this.canonicalizeAreaSelection();
      this.canonicalizeProgramSelection();
      this.renderRouteTabs();
      this.renderContent();
      this.renderMobileDock();
      if (this.pendingPreviewPath) {
        void this.openPreview(this.pendingPreviewPath, { focus: false, recordHistory: false });
      } else if (this.activePreviewFile) {
        this.closePreview({ restoreFocus: false });
      }
    }
  }

  async refresh(forceRemote = false): Promise<void> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.performRefresh(forceRemote);
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async performRefresh(forceRemote: boolean): Promise<void> {
    this.rootEl?.setAttribute("data-refreshing", "true");
    if (!this.data) this.renderLoading();
    try {
      const taskboardSettingsKey = JSON.stringify({
        reuseTaskCaptureConnection: this.plugin.settings.reuseTaskCaptureConnection,
        enableRemoteTaskboard: this.plugin.settings.enableRemoteTaskboard,
        taskboardUrl: this.plugin.settings.taskboardUrl,
        taskboardSecretId: this.plugin.settings.taskboardSecretId,
      });
      const shouldRefreshTaskboard =
        forceRemote ||
        !this.taskboardFetchedAt ||
        this.taskboardSettingsKey !== taskboardSettingsKey ||
        Date.now() - this.taskboardFetchedAt >= TASKBOARD_CACHE_TTL_MS;
      const [data, taskboard] = await Promise.all([
        buildDashboardData(this.app, this.plugin.settings, {
          recentFilePaths: this.previewHistory,
        }),
        shouldRefreshTaskboard
          ? fetchTaskboardSnapshot(this.app, this.plugin.settings)
          : Promise.resolve(this.taskboard),
      ]);
      this.data = data;
      this.taskboard = taskboard;
      if (shouldRefreshTaskboard) {
        this.taskboardFetchedAt = Date.now();
        this.taskboardSettingsKey = taskboardSettingsKey;
      }
      this.canonicalizeAreaSelection();
      this.canonicalizeProgramSelection();
      this.renderContent();
      if (this.activePreviewFile || this.pendingPreviewPath) {
        void this.restoreActivePreview();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard refresh failed.";
      new Notice(message);
      this.renderFailure(message);
    } finally {
      this.rootEl?.removeAttribute("data-refreshing");
    }
  }

  private renderShell(): void {
    const previousFocus = this.contentEl.ownerDocument.activeElement === this.searchInputEl;
    this.previewRequestId += 1;
    this.disposePreviewComponent();
    this.previewResizeObserver?.disconnect();
    this.previewResizeObserver = null;
    this.contentEl.empty();
    this.rootEl = this.contentEl.createDiv({
      cls: "fjg-vcc",
      attr: {
        "data-theme": this.plugin.settings.theme,
        ...(this.previewBrowserCollapsed ? { "data-browser-collapsed": "true" } : {}),
      },
    });
    this.syncFolderRailAttribute();
    const header = this.rootEl.createEl("header", { cls: "fjg-vcc-header" });
    const titleGroup = header.createDiv({ cls: "fjg-vcc-title-group" });
    titleGroup.createEl("h1", { cls: "fjg-vcc-title", text: "Vault Control Center" });
    titleGroup.createEl("p", { cls: "fjg-vcc-subtitle", text: "Live vault operations" });

    const actions = header.createDiv({ cls: "fjg-vcc-header-actions" });
    const search = actions.createDiv({
      cls: "fjg-vcc-search",
      attr: { role: "search" },
    });
    createIcon(search, "search");
    this.searchInputEl = search.createEl("input", {
      attr: {
        type: "search",
        placeholder: "Search this tab",
        "aria-label": "Search the current dashboard tab",
        "aria-controls": this.browserRegionId,
      },
    });
    this.searchInputEl.value = this.renderState.query;
    this.searchInputEl.addEventListener("input", () => {
      this.renderState.query = this.searchInputEl?.value ?? "";
      this.renderContent();
    });

    createButton(actions, {
      label: "Refresh",
      icon: "refresh-cw",
      className: "fjg-vcc-button fjg-vcc-refresh-button",
      onClick: () => void this.refresh(true).then(() => new Notice("Vault Control Center refreshed.")),
    });
    createButton(actions, {
      label: this.plugin.settings.theme === "dark" ? "Light mode" : "Dark mode",
      icon: this.plugin.settings.theme === "dark" ? "sun" : "moon",
      className: "fjg-vcc-theme-toggle",
      onClick: () => void this.setTheme(oppositeTheme(this.plugin.settings.theme)),
    });

    this.routeTabsEl = this.rootEl.createDiv({
      cls: "fjg-vcc-route-tabs",
      attr: { role: "tablist", "aria-label": "Dashboard views" },
    });
    this.renderRouteTabs();
    this.contentFrameEl = this.rootEl.createDiv({ cls: "fjg-vcc-content-frame" });
    this.contentRegionEl = this.contentFrameEl.createEl("main", {
      cls: "fjg-vcc-content",
      attr: { id: this.browserRegionId, "aria-label": "Dashboard content" },
    });
    this.previewPaneEl = this.contentFrameEl.createEl("aside", {
      cls: "fjg-vcc-preview-pane",
      attr: {
        role: "region",
        "aria-label": "File preview",
        "aria-hidden": "true",
      },
    });
    this.previewPaneEl.hidden = true;
    this.mobileDockEl = this.rootEl.createEl("nav", {
      cls: "fjg-vcc-mobile-dock",
      attr: { "aria-label": "Mobile dashboard navigation" },
    });
    this.renderMobileDock();
    this.renderContent();

    if (typeof ResizeObserver !== "undefined") {
      this.previewResizeObserver = new ResizeObserver(() => this.updatePreviewLayoutMode());
      this.previewResizeObserver.observe(this.rootEl);
    }
    if (this.activePreviewFile || this.pendingPreviewPath) {
      void this.restoreActivePreview();
    }

    if (previousFocus) window.setTimeout(() => this.searchInputEl?.focus(), 0);
  }

  private renderRouteTabs(): void {
    if (!this.routeTabsEl) return;
    this.routeTabsEl.empty();
    for (const route of ROUTE_DEFINITIONS) {
      const button = this.routeTabsEl.createEl("button", {
        cls: `fjg-vcc-route-tab${this.route === route.id ? " is-active" : ""}`,
        text: route.label,
        attr: {
          type: "button",
          role: "tab",
          "aria-selected": String(this.route === route.id),
          tabindex: "0",
        },
      });
      button.addEventListener("click", () => this.navigate(route.id));
    }
  }

  private renderMobileDock(): void {
    if (!this.mobileDockEl) return;
    this.mobileDockEl.empty();
    const items: Array<{
      label: string;
      icon: string;
      active: boolean;
      action: () => void;
    }> = [
      { label: "Home", icon: "home", active: this.route === "home", action: () => this.navigate("home") },
      {
        label: "Areas",
        icon: "folders",
        active: this.route === "areas",
        action: () => this.navigate("areas"),
      },
      {
        label: "Programs",
        icon: "folder",
        active: this.route === "programs",
        action: () => this.navigate("programs"),
      },
      {
        label: "Capture",
        icon: "square-plus",
        active: false,
        action: () => {
          this.navigate("home");
          window.setTimeout(
            () => this.rootEl?.querySelector<HTMLElement>(".fjg-vcc-capture-grid")?.scrollIntoView({ block: "start" }),
            0
          );
        },
      },
      {
        label: "Recent",
        icon: "clock-3",
        active: this.route === "recent",
        action: () => this.navigate("recent"),
      },
      {
        label: "More",
        icon: "ellipsis",
        active: ["bookmarks", "people", "clipboard", "settings", "ai-team"].includes(this.route),
        action: () => this.navigate("settings"),
      },
    ];

    for (const item of items) {
      const button = this.mobileDockEl.createEl("button", {
        cls: `fjg-vcc-mobile-dock-item${item.active ? " is-active" : ""}`,
        attr: { type: "button", "aria-current": item.active ? "page" : "false" },
      });
      createIcon(button, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener("click", item.action);
    }
  }

  private renderContent(): void {
    if (!this.contentRegionEl) return;
    if (!this.data) {
      this.renderLoading();
      return;
    }
    this.syncFolderRailAttribute();
    renderRoute(this.route, this.contentRegionEl, this.renderContext());
    this.syncPreviewSelection();
  }

  private canonicalizeProgramSelection(): void {
    if (!this.data) return;
    const selectedProgram =
      this.data.programs.find(
        (program) => program.path === this.renderState.selectedProgramPath
      ) ?? this.data.programs[0];
    this.renderState.selectedProgramPath = selectedProgram?.path ?? "";
    this.renderState.selectedProgramFolderPath = selectedProgram
      ? resolveProgramFolderPath(
          selectedProgram,
          this.renderState.selectedProgramFolderPath || selectedProgram.path
        )
      : "";
  }

  private canonicalizeAreaSelection(): void {
    if (!this.data) return;
    const roots = [this.data.areasRoot, ...this.data.areas];
    const selectedArea =
      roots.find((area) => area.path === this.renderState.selectedAreaPath) ??
      this.data.areasRoot;
    this.renderState.selectedAreaPath = selectedArea.path;
    this.renderState.selectedAreaFolderPath = resolveProgramFolderPath(
      selectedArea,
      this.renderState.selectedAreaFolderPath || selectedArea.path
    );
  }

  private renderContext(): DashboardRenderContext {
    if (!this.data) throw new Error("Dashboard data is not ready.");
    return {
      data: this.data,
      taskboard: this.taskboard,
      settings: this.plugin.settings,
      state: this.renderState,
      activePreviewPath: this.activePreviewFile?.path ?? this.pendingPreviewPath,
      folderRailId: this.folderRailId,
      folderRailCollapsed: this.folderRailCollapsed,
      setFolderRailCollapsed: (collapsed) => {
        this.folderRailCollapsed = collapsed;
        this.syncFolderRailAttribute();
      },
      clearSearch: () => {
        this.renderState.query = "";
        if (this.searchInputEl) this.searchInputEl.value = "";
        this.renderContent();
        this.searchInputEl?.focus({ preventScroll: true });
      },
      navigate: (route) => this.navigate(route),
      openFile: (path) => void this.openPreview(path),
      openBookmark: (bookmark) => void this.openBookmark(bookmark),
      openExternal: (url) => this.openExternal(url),
      capture: (commandId, label) => this.plugin.executeCapture(commandId, label),
      selectArea: (path) => {
        const area = [this.data?.areasRoot, ...(this.data?.areas ?? [])].find(
          (candidate) => candidate?.path === path
        );
        if (!area) return;
        this.renderState.selectedAreaPath = area.path;
        this.renderState.selectedAreaFolderPath = area.path;
        this.renderContent();
        this.focusFolderHeading();
      },
      selectAreaFolder: (path) => {
        const areaRoots = this.data
          ? [...this.data.areas, this.data.areasRoot]
          : [];
        const area = areaRoots
          .sort((left, right) => right.path.length - left.path.length)
          .find((candidate) => pathIsWithin(path, candidate.path));
        if (!area) return;
        this.renderState.selectedAreaPath = area.path;
        this.renderState.selectedAreaFolderPath = resolveProgramFolderPath(area, path);
        this.renderContent();
        this.focusFolderHeading();
      },
      selectProgram: (path) => {
        this.renderState.selectedProgramPath = path;
        this.renderState.selectedProgramFolderPath = path;
        this.renderContent();
        this.focusFolderHeading();
      },
      selectProgramFolder: (path) => {
        const program = this.data?.programs.find((candidate) =>
          pathIsWithin(path, candidate.path)
        );
        if (!program) return;
        this.renderState.selectedProgramPath = program.path;
        this.renderState.selectedProgramFolderPath = resolveProgramFolderPath(
          program,
          path
        );
        this.renderContent();
        this.focusFolderHeading();
      },
      selectAiQueue: (key) => {
        this.renderState.selectedAiQueue = key;
        this.renderContent();
      },
      setRecentFilter: (filter) => {
        this.renderState.recentFilter = filter;
        this.renderContent();
      },
      setBookmarkFilter: (filter) => {
        this.renderState.bookmarkFilter = filter;
        this.renderContent();
      },
      copyTemplate: (id) => void copyText(this.plugin.settings.clipboardTemplates[id]),
      updateTemplate: (id, value) => this.updateTemplate(id, value),
      resetTemplate: (id) => void this.resetTemplate(id),
      setTheme: (theme) => void this.setTheme(theme),
      setShellTheme: (enabled) => void this.setShellTheme(enabled),
      openNativeSettings: () => this.openNativeSettings(),
    };
  }

  private navigate(route: DashboardRoute): void {
    if (this.route === route) return;
    this.closePreview({ restoreFocus: false });
    this.route = route;
    this.renderRouteTabs();
    this.renderMobileDock();
    this.renderContent();
    this.contentRegionEl?.scrollTo({ top: 0 });
  }

  private syncFolderRailAttribute(): void {
    const activeRoute = this.route === "areas" || this.route === "programs";
    const folderBrowserVisible = !this.renderState.query.trim();
    if (activeRoute && folderBrowserVisible && this.folderRailCollapsed) {
      this.rootEl?.setAttribute("data-folder-rail-collapsed", "true");
    } else {
      this.rootEl?.removeAttribute("data-folder-rail-collapsed");
    }
  }

  private focusFolderHeading(): void {
    window.setTimeout(() => {
      this.contentRegionEl
        ?.querySelector<HTMLElement>(".fjg-vcc-folder-heading")
        ?.focus({ preventScroll: true });
    }, 0);
  }

  private renderLoading(): void {
    if (!this.contentRegionEl) return;
    this.contentRegionEl.empty();
    const state = this.contentRegionEl.createDiv({ cls: "fjg-vcc-loading", attr: { role: "status" } });
    createIcon(state, "loader-circle");
    state.createEl("strong", { text: "Indexing live vault data" });
    state.createEl("p", { text: "Areas, programs, queues, files, bookmarks, people, and tasks are being refreshed." });
  }

  private renderFailure(message: string): void {
    if (!this.contentRegionEl) return;
    this.contentRegionEl.empty();
    const state = this.contentRegionEl.createDiv({ cls: "fjg-vcc-empty", attr: { role: "alert" } });
    createIcon(state, "triangle-alert", "fjg-vcc-empty-icon");
    state.createEl("strong", { text: "Dashboard refresh failed" });
    state.createEl("p", { text: message });
    createButton(state, {
      label: "Try again",
      icon: "refresh-cw",
      className: "fjg-vcc-button is-primary",
      onClick: () => void this.refresh(true),
    });
  }

  private handleKeyboard(event: KeyboardEvent): void {
    if (!this.rootEl || !this.rootEl.isConnected) return;
    if (this.app.workspace.getActiveViewOfType(VaultControlCenterView) !== this) return;
    const target = event.target as HTMLElement | null;
    const isEditing = target?.matches("input, textarea, select, [contenteditable='true']") ?? false;
    if (event.key === "Escape" && (this.activePreviewFile || this.pendingPreviewPath)) {
      event.preventDefault();
      this.closePreview();
      return;
    }
    if (event.key === "/" && !isEditing) {
      event.preventDefault();
      this.searchInputEl?.focus();
    }
  }

  private async openPreview(
    path: string,
    options: PreviewOpenOptions = {}
  ): Promise<void> {
    const normalizedPath = normalizeVaultPath(path);
    if (
      !normalizedPath ||
      isExcludedPath(normalizedPath) ||
      isSensitivePath(normalizedPath)
    ) {
      new Notice("That file is not available from the dashboard.");
      return;
    }

    const target = this.app.vault.getAbstractFileByPath(normalizePath(normalizedPath));
    if (!(target instanceof TFile)) {
      new Notice("That file is no longer available.");
      return;
    }

    const activeElement = this.contentEl.ownerDocument.activeElement;
    const ownerHTMLElement = this.contentEl.ownerDocument.defaultView?.HTMLElement;
    if (
      options.focus !== false &&
      ownerHTMLElement &&
      activeElement instanceof ownerHTMLElement &&
      this.contentRegionEl?.contains(activeElement)
    ) {
      this.previewReturnFocusEl = activeElement;
    }

    this.activePreviewFile = target;
    this.pendingPreviewPath = target.path;
    if (options.recordHistory !== false) this.recordPreviewHistory(target);
    this.syncPreviewSelection();
    await this.renderPreview(target, options.focus !== false);
  }

  private async restoreActivePreview(): Promise<void> {
    const path = normalizeVaultPath(
      this.activePreviewFile?.path || this.pendingPreviewPath
    );
    if (!path) return;
    if (isExcludedPath(path) || isSensitivePath(path)) {
      this.closePreview({ restoreFocus: false });
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(target instanceof TFile)) {
      this.activePreviewFile = null;
      this.pendingPreviewPath = path;
      this.renderMissingPreview(path);
      return;
    }
    this.activePreviewFile = target;
    this.pendingPreviewPath = target.path;
    await this.renderPreview(target, false);
  }

  private async renderPreview(file: TFile, focus: boolean): Promise<void> {
    const pane = this.previewPaneEl;
    if (!pane) return;

    const requestId = ++this.previewRequestId;
    this.disposePreviewComponent();
    pane.empty();
    pane.hidden = false;
    pane.setAttribute("aria-hidden", "false");
    this.rootEl?.setAttribute("data-preview-open", "true");

    const header = pane.createEl("header", { cls: "fjg-vcc-preview-header" });
    createButton(header, {
      label: "Back",
      icon: "arrow-left",
      className: "fjg-vcc-preview-back",
      ariaLabel: "Close preview and return to the dashboard",
      title: "Back",
      onClick: () => this.closePreview(),
    });
    const headingGroup = header.createDiv({ cls: "fjg-vcc-preview-heading" });
    headingGroup.createSpan({
      cls: "fjg-vcc-preview-kicker",
      text: `${file.extension.toLocaleUpperCase() || "FILE"} preview`,
    });
    const headingId = `fjg-vcc-preview-title-${requestId}`;
    const heading = headingGroup.createEl("h2", {
      cls: "fjg-vcc-preview-title",
      text: normalizeFileTitle(file.name) || file.name,
      attr: { id: headingId, tabindex: "-1" },
    });
    pane.setAttribute("aria-labelledby", headingId);
    pane.removeAttribute("aria-label");

    const actions = header.createDiv({ cls: "fjg-vcc-preview-actions" });
    createButton(actions, {
      label: "Open in tab",
      icon: "external-link",
      className: "fjg-vcc-button fjg-vcc-preview-open-tab",
      title: "Open in tab",
      onClick: () => void this.plugin.openVaultFileInTab(file.path),
    });
    this.createPreviewBrowserToggle(actions);
    const pathBar = pane.createDiv({ cls: "fjg-vcc-preview-pathbar" });
    pathBar.createSpan({ cls: "fjg-vcc-preview-path", text: file.path });
    pathBar.createSpan({
      cls: "fjg-vcc-preview-size",
      text: formatFileSize(file.stat.size),
    });
    const body = pane.createDiv({
      cls: "fjg-vcc-preview-body",
      attr: { tabindex: "0" },
    });
    const loading = body.createDiv({
      cls: "fjg-vcc-preview-loading",
      attr: { role: "status" },
    });
    createIcon(loading, "loader-circle");
    loading.createSpan({ text: "Preparing preview…" });

    this.updatePreviewLayoutMode();
    const session = this.addChild(new Component());
    this.previewComponent = session;

    try {
      const kind = classifyPreviewKind(file.extension);
      if (
        (kind === "markdown" || kind === "text") &&
        file.stat.size > PREVIEW_TEXT_SIZE_LIMIT
      ) {
        body.empty();
        this.renderPreviewFallback(
          body,
          "Preview limited for this file",
          `This ${formatFileSize(file.stat.size)} file is too large to render safely inside the dashboard.`
        );
      } else {
        await this.renderPreviewContent(kind, file, body, session, requestId);
      }
    } catch (error) {
      if (!this.isCurrentPreviewRequest(requestId, file.path)) return;
      body.empty();
      const message = error instanceof Error ? error.message : "The file could not be rendered.";
      this.renderPreviewFallback(body, "Preview unavailable", message, true);
    }

    if (!this.isCurrentPreviewRequest(requestId, file.path)) return;
    this.updatePreviewLayoutMode();
    if (focus) {
      this.contentEl.ownerDocument.defaultView?.setTimeout(
        () => heading.focus({ preventScroll: true }),
        0
      );
    }
  }

  private createPreviewBrowserToggle(parent: HTMLElement): void {
    const label = this.previewBrowserCollapsed ? "Show files" : "Hide files";
    let button: HTMLButtonElement;
    button = createButton(parent, {
      label,
      icon: "panel-left",
      className: "fjg-vcc-button fjg-vcc-preview-browser-toggle",
      ariaLabel: `${label} while previewing this file`,
      title: label,
      onClick: () => {
        this.previewBrowserCollapsed = !this.previewBrowserCollapsed;
        this.updatePreviewLayoutMode();
        const nextLabel = this.previewBrowserCollapsed ? "Show files" : "Hide files";
        button.setAttribute("aria-label", `${nextLabel} while previewing this file`);
        button.setAttribute("title", nextLabel);
        button.setAttribute("aria-expanded", String(!this.previewBrowserCollapsed));
        const labels = button.querySelectorAll<HTMLSpanElement>("span");
        const textLabel = labels.item(labels.length - 1);
        if (textLabel) textLabel.textContent = nextLabel;
      },
    });
    button.setAttribute("aria-expanded", String(!this.previewBrowserCollapsed));
    button.setAttribute("aria-controls", this.browserRegionId);
  }

  private async renderPreviewContent(
    kind: PreviewKind,
    file: TFile,
    body: HTMLElement,
    session: Component,
    requestId: number
  ): Promise<void> {
    switch (kind) {
      case "markdown": {
        const markdown = await this.app.vault.cachedRead(file);
        if (!this.isCurrentPreviewRequest(requestId, file.path)) return;
        body.empty();
        body.addClass("markdown-rendered", "fjg-vcc-preview-markdown");
        session.registerDomEvent(body, "click", (event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest<HTMLAnchorElement>("a.internal-link");
          if (!anchor) return;
          const linkTarget = parseInternalLinkTarget(
            anchor.getAttribute("href"),
            anchor.getAttribute("data-href")
          );
          if (!linkTarget) return;
          const { path } = parseLinktext(linkTarget);
          const destination = this.app.metadataCache.getFirstLinkpathDest(path, file.path);
          event.preventDefault();
          event.stopPropagation();
          if (destination) void this.openPreview(destination.path);
          else new Notice("That linked file is no longer available.");
        }, { capture: true });
        await MarkdownRenderer.render(this.app, markdown, body, file.path, session);
        return;
      }
      case "text": {
        const text = await this.app.vault.cachedRead(file);
        if (!this.isCurrentPreviewRequest(requestId, file.path)) return;
        body.empty();
        const source = body.createEl("pre", { cls: "fjg-vcc-preview-source" });
        source.createEl("code", { text });
        return;
      }
      case "image": {
        body.empty();
        const figure = body.createEl("figure", { cls: "fjg-vcc-preview-media" });
        const image = figure.createEl("img", {
          attr: {
            src: this.app.vault.getResourcePath(file),
            alt: normalizeFileTitle(file.name) || file.name,
            loading: "eager",
          },
        });
        session.registerDomEvent(image, "error", () => {
          figure.empty();
          this.renderPreviewFallback(
            figure,
            "Image preview unavailable",
            "Use Open in tab to view this image with Obsidian's native viewer.",
            true
          );
        });
        figure.createEl("figcaption", { text: file.name });
        return;
      }
      case "audio":
      case "video": {
        body.empty();
        const media = body.createEl(kind, {
          cls: "fjg-vcc-preview-av",
          attr: {
            src: this.app.vault.getResourcePath(file),
            controls: "",
            preload: "metadata",
            ...(kind === "video" ? { playsinline: "" } : {}),
          },
        });
        session.register(() => {
          media.pause();
          media.removeAttribute("src");
          media.load();
        });
        return;
      }
      case "pdf": {
        body.empty();
        body.addClass("fjg-vcc-preview-pdf");
        const frame = body.createEl("iframe", {
          cls: "fjg-vcc-preview-pdf-frame",
          attr: {
            src: this.app.vault.getResourcePath(file),
            title: `PDF preview of ${normalizeFileTitle(file.name) || file.name}`,
            loading: "eager",
          },
        });
        session.register(() => frame.setAttribute("src", "about:blank"));
        return;
      }
      case "native-fallback": {
        body.empty();
        if (file.extension.toLocaleLowerCase() === "canvas") {
          await this.renderCanvasSummary(file, body, requestId);
          return;
        }
        this.renderPreviewFallback(
          body,
          "Native preview required",
          `${file.extension.toLocaleUpperCase() || "This file type"} does not have a safe embedded renderer. The dashboard stayed open; use Open in tab when you need Obsidian's native viewer.`
        );
      }
    }
  }

  private async renderCanvasSummary(
    file: TFile,
    body: HTMLElement,
    requestId: number
  ): Promise<void> {
    if (file.stat.size > PREVIEW_TEXT_SIZE_LIMIT) {
      this.renderPreviewFallback(
        body,
        "Canvas summary unavailable",
        "This canvas is too large to summarize safely inside the dashboard."
      );
      return;
    }
    const raw = await this.app.vault.cachedRead(file);
    if (!this.isCurrentPreviewRequest(requestId, file.path)) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The canvas data is not in a readable format.");
    }
    const record = parsed as { nodes?: unknown; edges?: unknown };
    const nodes = Array.isArray(record.nodes) ? record.nodes : [];
    const edges = Array.isArray(record.edges) ? record.edges : [];
    body.empty();
    const summary = body.createDiv({ cls: "fjg-vcc-canvas-summary" });
    summary.createEl("h3", { text: "Canvas overview" });
    const stats = summary.createDiv({ cls: "fjg-vcc-canvas-stats" });
    stats.createSpan({ text: `${nodes.length} node${nodes.length === 1 ? "" : "s"}` });
    stats.createSpan({ text: `${edges.length} connection${edges.length === 1 ? "" : "s"}` });
    const textNodes = nodes
      .filter((node): node is { text: string } =>
        Boolean(node) &&
        typeof node === "object" &&
        typeof (node as { text?: unknown }).text === "string"
      )
      .map((node) => node.text.trim())
      .filter(Boolean)
      .slice(0, 24);
    if (textNodes.length) {
      const list = summary.createEl("ul");
      for (const text of textNodes) {
        list.createEl("li", { text: text.length > 240 ? `${text.slice(0, 237)}…` : text });
      }
    } else {
      summary.createEl("p", {
        text: "This canvas contains visual or linked nodes without inline text. Open it in a tab for the full board.",
      });
    }
  }

  private renderPreviewFallback(
    parent: HTMLElement,
    title: string,
    description: string,
    error = false
  ): void {
    const state = parent.createDiv({
      cls: "fjg-vcc-preview-fallback",
      attr: { role: error ? "alert" : "status" },
    });
    createIcon(state, error ? "triangle-alert" : "file-question");
    state.createEl("strong", { text: title });
    state.createEl("p", { text: description });
  }

  private renderMissingPreview(path: string): void {
    const pane = this.previewPaneEl;
    if (!pane) return;
    this.previewRequestId += 1;
    this.disposePreviewComponent();
    pane.empty();
    pane.hidden = false;
    pane.setAttribute("aria-hidden", "false");
    pane.removeAttribute("aria-labelledby");
    pane.setAttribute("aria-label", "Unavailable file preview");
    this.rootEl?.setAttribute("data-preview-open", "true");
    const header = pane.createEl("header", { cls: "fjg-vcc-preview-header" });
    createButton(header, {
      label: "Back",
      icon: "arrow-left",
      className: "fjg-vcc-preview-back",
      onClick: () => this.closePreview(),
    });
    const heading = header.createDiv({ cls: "fjg-vcc-preview-heading" });
    heading.createSpan({ cls: "fjg-vcc-preview-kicker", text: "Preview unavailable" });
    const pathParts = path.split("/");
    heading.createEl("h2", {
      cls: "fjg-vcc-preview-title",
      text: pathParts[pathParts.length - 1] || "File",
    });
    const body = pane.createDiv({ cls: "fjg-vcc-preview-body" });
    this.renderPreviewFallback(
      body,
      "File moved or deleted",
      "Refresh the dashboard or choose another file. No other tab was opened.",
      true
    );
    this.updatePreviewLayoutMode();
    this.syncPreviewSelection();
  }

  private closePreview(options: PreviewCloseOptions = {}): void {
    const activePath = this.activePreviewFile?.path || this.pendingPreviewPath;
    const returnFocus = this.previewReturnFocusEl;
    this.previewRequestId += 1;
    this.disposePreviewComponent();
    this.activePreviewFile = null;
    this.pendingPreviewPath = "";
    this.previewReturnFocusEl = null;
    this.previewBrowserCollapsed = false;
    if (this.previewPaneEl) {
      this.previewPaneEl.empty();
      this.previewPaneEl.hidden = true;
      this.previewPaneEl.setAttribute("aria-hidden", "true");
      this.previewPaneEl.removeAttribute("aria-labelledby");
      this.previewPaneEl.setAttribute("aria-label", "File preview");
    }
    this.rootEl?.removeAttribute("data-preview-open");
    this.rootEl?.removeAttribute("data-browser-collapsed");
    this.updatePreviewLayoutMode();
    this.syncPreviewSelection();

    if (options.restoreFocus === false) return;
    const fallback = Array.from(
      this.contentRegionEl?.querySelectorAll<HTMLElement>("[data-file-path]") ?? []
    )
      .find((element) => element.dataset.filePath === activePath);
    this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    }, 0);
  }

  private disposePreviewComponent(): void {
    if (!this.previewComponent) return;
    try {
      this.removeChild(this.previewComponent);
    } catch {
      this.previewComponent.unload();
    }
    this.previewComponent = null;
  }

  private updatePreviewLayoutMode(): void {
    const previewOpen = Boolean(
      this.previewPaneEl &&
      !this.previewPaneEl.hidden &&
      (this.activePreviewFile || this.pendingPreviewPath)
    );
    const width = this.rootEl?.getBoundingClientRect().width ?? 0;
    const overlay = previewOpen && width > 0 && width < 760;
    const browserCollapsed = previewOpen && !overlay && this.previewBrowserCollapsed;
    this.rootEl?.setAttribute("data-preview-mode", overlay ? "overlay" : "split");
    if (!previewOpen) this.rootEl?.removeAttribute("data-preview-mode");
    if (browserCollapsed) this.rootEl?.setAttribute("data-browser-collapsed", "true");
    else this.rootEl?.removeAttribute("data-browser-collapsed");
    if (overlay || browserCollapsed) {
      this.contentRegionEl?.setAttribute("inert", "");
      this.contentRegionEl?.setAttribute("aria-hidden", "true");
    } else {
      this.contentRegionEl?.removeAttribute("inert");
      this.contentRegionEl?.removeAttribute("aria-hidden");
    }
  }

  private syncPreviewSelection(): void {
    const activePath = this.activePreviewFile?.path || this.pendingPreviewPath;
    for (const row of Array.from(
      this.contentRegionEl?.querySelectorAll<HTMLElement>("[data-file-path]") ?? []
    )) {
      const selected = Boolean(activePath && row.dataset.filePath === activePath);
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-current", selected ? "true" : "false");
    }
  }

  private isCurrentPreviewRequest(requestId: number, filePath: string): boolean {
    return Boolean(
      requestId === this.previewRequestId &&
      this.previewPaneEl?.isConnected &&
      this.activePreviewFile?.path === filePath
    );
  }

  private recordPreviewHistory(file: TFile): void {
    this.previewHistory = mergePreviewHistory(
      this.previewHistory,
      file.path,
      (path) => {
        if (isExcludedPath(path) || isSensitivePath(path)) return false;
        return this.app.vault.getAbstractFileByPath(normalizePath(path)) instanceof TFile;
      }
    );
    if (!this.data) return;
    const item = this.findDashboardFileItem(file.path) ?? this.toDashboardFileItem(file);
    this.data.recent = [
      item,
      ...this.data.recent.filter((candidate) => candidate.path !== item.path),
    ].slice(0, 30);
    this.data.recentMode = "viewed";
  }

  private findDashboardFileItem(path: string): DashboardFileItem | undefined {
    if (!this.data) return undefined;
    const collections: DashboardFileItem[][] = [
      this.data.recent,
      this.data.areasRoot.files,
      ...this.data.programs.map((program) => program.files),
      ...Object.values(this.data.aiQueues).map((queue) => queue.files),
      this.data.people.files,
    ];
    for (const files of collections) {
      const match = files.find((candidate) => candidate.path === path);
      if (match) return match;
    }
    return undefined;
  }

  private toDashboardFileItem(file: TFile): DashboardFileItem {
    return {
      title: normalizeFileTitle(file.name) || file.basename,
      name: file.name,
      path: file.path,
      extension: file.extension.toLocaleLowerCase(),
      modifiedAt: file.stat.mtime,
      createdAt: file.stat.ctime,
      size: file.stat.size,
      category: this.categoryForPath(file.path),
    };
  }

  private categoryForPath(path: string): DashboardFileCategory {
    if (pathIsWithin(path, this.plugin.settings.programsFolder)) return "programs";
    if (pathIsWithin(path, this.plugin.settings.areasFolder)) return "areas";
    if (Object.values(this.plugin.settings.aiFolders).some((root) => pathIsWithin(path, root))) {
      return "ai";
    }
    if (pathIsWithin(path, this.plugin.settings.peopleFolder)) return "people";
    if (normalizeVaultPath(path) === normalizeVaultPath(this.plugin.settings.tasksFilePath)) {
      return "tasks";
    }
    return "vault";
  }

  private async openBookmark(bookmark: DashboardBookmark): Promise<void> {
    if (bookmark.type === "url") {
      this.openExternal(bookmark.target);
      return;
    }
    const targetPath = normalizeVaultPath(bookmark.target);
    if (!targetPath || isExcludedPath(targetPath) || isSensitivePath(targetPath)) {
      new Notice("That bookmark is not available from the dashboard.");
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(normalizePath(targetPath));
    if (target instanceof TFile) {
      await this.openPreview(target.path);
      return;
    }
    if (target instanceof TFolder) {
      const files: TFile[] = [];
      Vault.recurseChildren(target, (child) => {
        if (
          child instanceof TFile &&
          !isExcludedPath(child.path) &&
          !isSensitivePath(child.path)
        ) {
          files.push(child);
        }
      });
      files.sort((left, right) => right.stat.mtime - left.stat.mtime);
      if (files[0]) {
        await this.openPreview(files[0].path);
        return;
      }
      new Notice("That folder has no safe files available to preview.");
      return;
    }
    new Notice("That bookmark target is no longer available.");
  }

  private openExternal(url: string): void {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      new Notice("Only HTTP and HTTPS links can be opened from this dashboard.");
      return;
    }
    window.open(clean, "_blank", "noopener,noreferrer");
  }

  private updateTemplate(id: ClipboardTemplateId, value: string): void {
    this.plugin.settings.clipboardTemplates[id] = value;
    if (this.templateSaveTimer !== null) window.clearTimeout(this.templateSaveTimer);
    this.templateSaveTimer = window.setTimeout(() => {
      this.templateSaveTimer = null;
      void this.plugin.saveSettings();
    }, 400);
  }

  private async resetTemplate(id: ClipboardTemplateId): Promise<void> {
    this.plugin.settings.clipboardTemplates[id] = resetTemplateValue(id);
    await this.plugin.saveSettings();
    this.renderContent();
    new Notice("Template reset.");
  }

  private async setTheme(theme: DashboardTheme): Promise<void> {
    if (theme === this.plugin.settings.theme) return;
    this.plugin.settings.theme = theme;
    await this.plugin.saveSettings();
    this.plugin.applyTheme();
    this.renderShell();
  }

  private async setShellTheme(enabled: boolean): Promise<void> {
    this.plugin.settings.applyShellTheme = enabled;
    await this.plugin.saveSettings();
    this.plugin.applyTheme();
    this.renderContent();
  }

  private openNativeSettings(): void {
    const app = this.app as unknown as AppWithSettings;
    app.setting?.open?.();
    app.setting?.openTabById?.(this.plugin.manifest.id);
  }
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Unknown size";
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}
