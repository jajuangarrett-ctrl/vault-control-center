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
  canPersistPreviewRecovery,
  classifyPreviewKind,
  detectPreviewLineEnding,
  hasPreviewEditConflict,
  isEditablePreviewKind,
  isPreviewRecoveryPayloadWithinLimit,
  mergePreviewHistory,
  normalizePreviewEditorContent,
  parseInternalLinkTarget,
  serializePreviewEditorContent,
  type PreviewLineEnding,
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

interface PreviewOpenOptions {
  focus?: boolean;
  recordHistory?: boolean;
}

interface PreviewCloseOptions {
  restoreFocus?: boolean;
  discardDraft?: boolean;
}

interface PreviewEditorState {
  file: TFile;
  recoveryPath: string | null;
  recoverySavedAt: number | null;
  baselineContent: string;
  baselineEditorContent: string;
  draft: string;
  lineEnding: PreviewLineEnding;
  dirty: boolean;
  saving: boolean;
  conflict: boolean;
}

interface PreviewSaveOptions {
  announceSuccess?: boolean;
  renderAfterSave?: boolean;
}

let dashboardViewSequence = 0;

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
  private previewEditorState: PreviewEditorState | null = null;
  private previewEditStartRequestId = 0;
  private previewSavePromise: Promise<void> | null = null;
  private previewBrowserCollapsed = false;
  private previewRequestId = 0;
  private previewHistory: string[] = [];
  private previewResizeObserver: ResizeObserver | null = null;
  private templateSaveTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private taskboardFetchedAt = 0;
  private taskboardSettingsKey = "";
  private readonly browserRegionId = `fjg-vcc-browser-${++dashboardViewSequence}`;

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
    const recoveredDraft = await this.restorePreviewRecoveryDraft();
    if (!recoveredDraft && this.pendingPreviewPath) {
      void this.openPreview(this.pendingPreviewPath, { focus: false, recordHistory: false });
    }
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.previewSavePromise) {
      await this.previewSavePromise;
    }
    if (this.previewEditorState?.dirty) {
      const state = this.previewEditorState;
      const currentPath = normalizeVaultPath(state.file.path);
      const currentTarget = currentPath
        ? this.app.vault.getAbstractFileByPath(normalizePath(currentPath))
        : null;
      const canRetain = canPersistPreviewRecovery({
        fileIsCurrent: currentTarget === state.file,
        pathIsSafe:
          Boolean(currentPath) &&
          !isExcludedPath(currentPath) &&
          !isSensitivePath(currentPath),
        kind: classifyPreviewKind(state.file.extension),
        fileSize: state.file.stat.size,
        baselineContent: state.baselineContent,
        draft: state.draft,
      });
      try {
        if (canRetain) {
          await this.plugin.storePreviewRecoveryDraft({
            path: state.file.path,
            baselineContent: state.baselineContent,
            draft: state.draft,
            savedAt: Date.now(),
          });
          new Notice("The unsaved dashboard draft was retained and will reopen with the dashboard.");
        } else {
          if (state.recoveryPath) {
            await this.clearPreviewRecoveryForState(state);
          }
          new Notice("This draft could not be retained because the file is no longer safe for dashboard editing.");
        }
      } catch {
        new Notice("The dashboard could not save or retain this draft before closing.");
      }
    }
    if (
      this.previewEditorState &&
      !this.previewEditorState.dirty &&
      this.previewEditorState.recoveryPath
    ) {
      try {
        const cleared = await this.clearPreviewRecoveryForState(this.previewEditorState);
        if (!cleared) throw new Error("Recovery path mismatch");
      } catch {
        new Notice("The clean dashboard draft closed, but its old recovery marker could not be cleared yet.");
      }
    }
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
    this.previewEditorState = null;
    this.previewEditStartRequestId += 1;
    this.previewSavePromise = null;
    this.previewBrowserCollapsed = false;
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
      if (
        (this.activePreviewFile || this.pendingPreviewPath) &&
        !this.previewEditorState
      ) {
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
    const header = this.rootEl.createEl("header", { cls: "fjg-vcc-header" });
    const titleGroup = header.createDiv({ cls: "fjg-vcc-title-group" });
    titleGroup.createEl("h1", { cls: "fjg-vcc-title", text: "Vault Control Center" });
    titleGroup.createEl("p", { cls: "fjg-vcc-subtitle", text: "Live vault operations" });

    const actions = header.createDiv({ cls: "fjg-vcc-header-actions" });
    const search = actions.createDiv({ cls: "fjg-vcc-search" });
    createIcon(search, "search");
    this.searchInputEl = search.createEl("input", {
      attr: {
        type: "search",
        placeholder: "Search vault",
        "aria-label": "Search the current dashboard view",
      },
    });
    this.searchInputEl.value = this.renderState.query;
    this.searchInputEl.addEventListener("input", () => {
      const previousQuery = this.renderState.query;
      this.renderState.query = this.searchInputEl?.value ?? "";
      if (
        (this.route === "areas" || this.route === "programs") &&
        !previousQuery.trim() &&
        this.renderState.query.trim()
      ) {
        if (this.route === "areas") {
          this.renderState.selectedAreaFolderPath = this.renderState.selectedAreaPath;
        } else {
          this.renderState.selectedProgramFolderPath = this.renderState.selectedProgramPath;
        }
      }
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
    if (
      (this.activePreviewFile || this.pendingPreviewPath) &&
      (this.previewEditorState || !this.plugin.getPreviewRecoveryDraft())
    ) {
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
    if (!this.closePreview({ restoreFocus: false })) return;
    this.route = route;
    this.renderRouteTabs();
    this.renderMobileDock();
    this.renderContent();
    this.contentRegionEl?.scrollTo({ top: 0 });
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
    if (
      this.previewEditorState &&
      (event.metaKey || event.ctrlKey) &&
      event.key.toLocaleLowerCase() === "s"
    ) {
      event.preventDefault();
      void this.savePreviewEditing();
      return;
    }
    if (event.key === "Escape" && (this.activePreviewFile || this.pendingPreviewPath)) {
      event.preventDefault();
      if (this.previewEditorState) {
        if (this.previewEditorState.dirty) {
          this.noticeUnsavedPreviewChanges();
          this.focusPreviewEditor();
        } else if (this.activePreviewFile) {
          void this.cancelPreviewEditing(this.activePreviewFile);
        }
        return;
      }
      this.closePreview();
      return;
    }
    if (event.key === "/" && !isEditing) {
      event.preventDefault();
      this.searchInputEl?.focus();
    }
  }

  private async restorePreviewRecoveryDraft(): Promise<boolean> {
    const recovery = this.plugin.getPreviewRecoveryDraft();
    if (!recovery) return false;

    const path = normalizeVaultPath(recovery.path);
    const target = path
      ? this.app.vault.getAbstractFileByPath(normalizePath(path))
      : null;
    const canRestore =
      target instanceof TFile &&
      canPersistPreviewRecovery({
        fileIsCurrent: true,
        pathIsSafe: !isExcludedPath(path) && !isSensitivePath(path),
        kind: classifyPreviewKind(target.extension),
        fileSize: target.stat.size,
        baselineContent: recovery.baselineContent,
        draft: recovery.draft,
      });
    if (!(target instanceof TFile) || !canRestore) {
      try {
        await this.plugin.clearPreviewRecoveryDraft(path, recovery.savedAt);
        new Notice("An unusable dashboard recovery draft was discarded because its file is no longer safe to open here.");
      } catch {
        new Notice("An unusable dashboard recovery draft could not be cleared yet.");
      }
      return false;
    }

    const restoreRequestId = this.previewRequestId;
    const restoreEditStartRequestId = this.previewEditStartRequestId;
    const restoreActiveFile = this.activePreviewFile;
    const restorePendingPath = this.pendingPreviewPath;
    try {
      const currentContent = await this.app.vault.read(target);
      if (
        restoreRequestId !== this.previewRequestId ||
        restoreEditStartRequestId !== this.previewEditStartRequestId ||
        this.previewEditorState !== null ||
        this.activePreviewFile !== restoreActiveFile ||
        this.pendingPreviewPath !== restorePendingPath
      ) return false;
      const latestRecovery = this.plugin.getPreviewRecoveryDraft();
      if (
        !latestRecovery ||
        latestRecovery.baselineContent !== recovery.baselineContent ||
        latestRecovery.draft !== recovery.draft
      ) return false;
      const currentPath = normalizeVaultPath(target.path);
      const latestRecoveryPath = normalizeVaultPath(latestRecovery.path);
      if (
        latestRecoveryPath !== path &&
        latestRecoveryPath !== currentPath
      ) return false;
      const currentTarget = currentPath
        ? this.app.vault.getAbstractFileByPath(normalizePath(currentPath))
        : null;
      const stillSafe = canPersistPreviewRecovery({
        fileIsCurrent: currentTarget === target,
        pathIsSafe:
          Boolean(currentPath) &&
          !isExcludedPath(currentPath) &&
          !isSensitivePath(currentPath),
        kind: classifyPreviewKind(target.extension),
        fileSize: target.stat.size,
        baselineContent: latestRecovery.baselineContent,
        draft: latestRecovery.draft,
      });
      if (!stillSafe) {
        try {
          await this.clearPreviewRecoveryPaths(
            [path, currentPath],
            latestRecovery.savedAt
          );
          new Notice("An unusable dashboard recovery draft was discarded after its file changed.");
        } catch {
          new Notice("An unusable dashboard recovery draft could not be cleared yet.");
        }
        return false;
      }
      const recoveryPath = latestRecoveryPath || path;
      const baselineEditorContent = normalizePreviewEditorContent(latestRecovery.baselineContent);
      const draft = normalizePreviewEditorContent(latestRecovery.draft);
      if (draft === baselineEditorContent) {
        await this.clearPreviewRecoveryPaths(
          [recoveryPath, currentPath],
          latestRecovery.savedAt
        );
        return false;
      }
      const lineEnding = detectPreviewLineEnding(latestRecovery.baselineContent);
      if (currentContent === serializePreviewEditorContent(draft, lineEnding)) {
        await this.clearPreviewRecoveryPaths(
          [recoveryPath, currentPath],
          latestRecovery.savedAt
        );
        return false;
      }
      this.previewEditorState = {
        file: target,
        recoveryPath,
        recoverySavedAt: latestRecovery.savedAt,
        baselineContent: latestRecovery.baselineContent,
        baselineEditorContent,
        draft,
        lineEnding,
        dirty: true,
        saving: false,
        conflict: hasPreviewEditConflict(latestRecovery.baselineContent, currentContent),
      };
      this.activePreviewFile = target;
      this.pendingPreviewPath = target.path;
      this.syncPreviewSelection();
      await this.renderPreview(target, true);
      new Notice(
        this.previewEditorState.conflict
          ? "Recovered your dashboard draft. The vault copy changed, so it was not overwritten."
          : "Recovered your unsaved dashboard draft."
      );
      return true;
    } catch {
      new Notice("A dashboard draft is retained, but it could not be reopened yet.");
      return false;
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

    if (
      this.previewEditorState?.dirty &&
      this.previewEditorState.file !== target &&
      this.previewEditorState.file.path !== target.path
    ) {
      this.noticeUnsavedPreviewChanges();
      this.focusPreviewEditor();
      return;
    }
    if (
      this.previewEditorState &&
      this.previewEditorState.file !== target &&
      this.previewEditorState.file.path !== target.path
    ) {
      if (this.previewEditorState.recoveryPath) {
        this.clearPreviewRecoveryInBackground(this.previewEditorState);
      }
      this.previewEditorState = null;
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
    const kind = classifyPreviewKind(file.extension);
    const editorState =
      this.previewEditorState &&
      (this.previewEditorState.file === file || this.previewEditorState.file.path === file.path)
      ? this.previewEditorState
      : null;

    const header = pane.createEl("header", { cls: "fjg-vcc-preview-header" });
    createButton(header, {
      label: "Back",
      icon: "arrow-left",
      className: "fjg-vcc-preview-back",
      ariaLabel: "Close preview and return to the dashboard",
      onClick: () => this.closePreview(),
    });
    const headingGroup = header.createDiv({ cls: "fjg-vcc-preview-heading" });
    headingGroup.createSpan({
      cls: "fjg-vcc-preview-kicker",
      text: editorState
        ? `Editing ${file.extension.toLocaleUpperCase() || "FILE"}`
        : `${file.extension.toLocaleUpperCase() || "FILE"} preview`,
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
    if (editorState) {
      createButton(actions, {
        label: editorState.dirty || editorState.conflict ? "Discard changes" : "Cancel",
        icon: "x",
        className: "fjg-vcc-button fjg-vcc-preview-cancel",
        disabled: editorState.saving,
        onClick: () => void this.cancelPreviewEditing(file),
      });
      createButton(actions, {
        label: editorState.saving ? "Saving…" : "Save",
        icon: "save",
        className: "fjg-vcc-button is-primary fjg-vcc-preview-save",
        disabled: !editorState.dirty || editorState.saving || editorState.conflict,
        onClick: () => void this.savePreviewEditing(),
      });
    } else {
      if (isEditablePreviewKind(kind) && file.stat.size <= PREVIEW_TEXT_SIZE_LIMIT) {
        createButton(actions, {
          label: "Edit",
          icon: "pencil",
          className: "fjg-vcc-button fjg-vcc-preview-edit",
          onClick: () => void this.startPreviewEditing(file),
        });
      }
    }
    createButton(actions, {
      label: "Open in tab",
      icon: "external-link",
      className: "fjg-vcc-button fjg-vcc-preview-open-tab",
      disabled: editorState?.saving ?? false,
      onClick: () => void this.openPreviewInTab(file),
    });
    this.createPreviewBrowserToggle(actions);
    const pathBar = pane.createDiv({ cls: "fjg-vcc-preview-pathbar" });
    pathBar.createSpan({ cls: "fjg-vcc-preview-path", text: file.path });
    if (editorState) {
      pathBar.createSpan({
        cls: `fjg-vcc-preview-edit-status${editorState.conflict ? " is-conflict" : editorState.dirty ? " is-dirty" : ""}`,
        text: this.previewEditorStatus(editorState),
        attr: { role: "status", "aria-live": "polite" },
      });
    } else {
      pathBar.createSpan({
        cls: "fjg-vcc-preview-size",
        text: formatFileSize(file.stat.size),
      });
    }
    const body = pane.createDiv({
      cls: "fjg-vcc-preview-body",
      attr: { tabindex: "0" },
    });

    if (editorState) {
      this.renderPreviewEditor(file, body, editorState, focus);
      this.updatePreviewLayoutMode();
      return;
    }

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

  private async startPreviewEditing(file: TFile): Promise<void> {
    const kind = classifyPreviewKind(file.extension);
    if (!isEditablePreviewKind(kind) || file.stat.size > PREVIEW_TEXT_SIZE_LIMIT) {
      new Notice("This file type cannot be edited safely inside the dashboard.");
      return;
    }
    if (
      this.previewEditorState &&
      (this.previewEditorState.file === file || this.previewEditorState.file.path === file.path)
    ) {
      this.focusPreviewEditor();
      return;
    }

    const editStartRequestId = ++this.previewEditStartRequestId;
    const previewRequestId = this.previewRequestId;
    try {
      const content = await this.app.vault.read(file);
      const currentPath = normalizeVaultPath(file.path);
      const currentTarget = currentPath
        ? this.app.vault.getAbstractFileByPath(normalizePath(currentPath))
        : null;
      if (
        editStartRequestId !== this.previewEditStartRequestId ||
        previewRequestId !== this.previewRequestId ||
        this.activePreviewFile?.path !== file.path ||
        currentTarget !== file ||
        isExcludedPath(currentPath) ||
        isSensitivePath(currentPath) ||
        !isEditablePreviewKind(classifyPreviewKind(file.extension)) ||
        file.stat.size > PREVIEW_TEXT_SIZE_LIMIT
      ) return;
      const baselineEditorContent = normalizePreviewEditorContent(content);
      this.previewEditorState = {
        file,
        recoveryPath: null,
        recoverySavedAt: null,
        baselineContent: content,
        baselineEditorContent,
        draft: baselineEditorContent,
        lineEnding: detectPreviewLineEnding(content),
        dirty: false,
        saving: false,
        conflict: false,
      };
      await this.renderPreview(file, true);
    } catch (error) {
      if (
        editStartRequestId !== this.previewEditStartRequestId ||
        previewRequestId !== this.previewRequestId
      ) return;
      const message = error instanceof Error ? error.message : "The file could not be loaded for editing.";
      new Notice(`Could not start editing: ${message}`);
    }
  }

  private renderPreviewEditor(
    file: TFile,
    body: HTMLElement,
    state: PreviewEditorState,
    focus: boolean
  ): void {
    body.empty();
    body.addClass("fjg-vcc-preview-editor-body");
    const conflictHelpId = `fjg-vcc-preview-conflict-help-${this.previewRequestId}`;

    if (state.conflict) {
      const warning = body.createDiv({
        cls: "fjg-vcc-preview-conflict",
        attr: { role: "alert", id: conflictHelpId },
      });
      createIcon(warning, "triangle-alert");
      const message = warning.createDiv();
      message.createEl("strong", { text: "A newer vault copy is available" });
      message.createEl("p", {
        text: "Your draft is still here and was not saved. Use Discard changes to reload the vault copy, then reapply the changes you want to keep.",
      });
    }

    const editorId = `fjg-vcc-preview-editor-${this.previewRequestId}`;
    body.createEl("label", {
      cls: "fjg-vcc-visually-hidden",
      text: `Edit ${normalizeFileTitle(file.name) || file.name}`,
      attr: { for: editorId },
    });
    const editor = body.createEl("textarea", {
      cls: "fjg-vcc-preview-editor",
      attr: {
        id: editorId,
        "aria-label": `Edit ${normalizeFileTitle(file.name) || file.name}`,
        "aria-describedby": state.conflict ? conflictHelpId : "",
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
      },
    });
    if (!state.conflict) editor.removeAttribute("aria-describedby");
    editor.value = state.draft;
    editor.spellcheck = ["md", "txt"].includes(file.extension.toLocaleLowerCase());
    editor.disabled = state.saving;
    editor.addEventListener("input", () => {
      if (this.previewEditorState !== state) return;
      state.draft = editor.value;
      state.dirty = state.draft !== state.baselineEditorContent;
      this.updatePreviewEditorChrome(state);
    });

    if (focus) {
      this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(0, 0);
      }, 0);
    }
  }

  private savePreviewEditing(options: PreviewSaveOptions = {}): Promise<void> {
    if (this.previewSavePromise) return this.previewSavePromise;
    let operation!: Promise<void>;
    operation = (async () => {
      try {
        await this.performSavePreviewEditing(options);
      } finally {
        if (this.previewSavePromise === operation) this.previewSavePromise = null;
      }
    })();
    this.previewSavePromise = operation;
    return operation;
  }

  private async performSavePreviewEditing(options: PreviewSaveOptions): Promise<void> {
    const state = this.previewEditorState;
    if (!state || !state.dirty || state.saving || state.conflict) return;

    const target = state.file;
    const previewRequestId = this.previewRequestId;
    const currentPath = normalizeVaultPath(target.path);
    const currentTarget = currentPath
      ? this.app.vault.getAbstractFileByPath(normalizePath(currentPath))
      : null;
    if (
      currentTarget !== target ||
      isExcludedPath(currentPath) ||
      isSensitivePath(currentPath) ||
      !isEditablePreviewKind(classifyPreviewKind(target.extension)) ||
      target.stat.size > PREVIEW_TEXT_SIZE_LIMIT
    ) {
      new Notice("This file moved outside the dashboard's safe editor. Your draft has not been discarded.");
      this.focusPreviewEditor();
      return;
    }
    if (!isPreviewRecoveryPayloadWithinLimit(state.baselineContent, state.draft)) {
      new Notice("This draft is too large for the dashboard editor. Shorten it before saving.");
      this.focusPreviewEditor();
      return;
    }

    state.saving = true;
    this.updatePreviewEditorChrome(state);
    try {
      await this.app.vault.process(target, (currentContent) => {
        if (hasPreviewEditConflict(state.baselineContent, currentContent)) {
          throw new PreviewEditConflictError();
        }
        return serializePreviewEditorContent(state.draft, state.lineEnding);
      });
      if (this.previewEditorState !== state) return;

      this.previewEditorState = null;
      try {
        const cleared = await this.clearPreviewRecoveryForState(state);
        if (!cleared) throw new Error("Recovery path mismatch");
      } catch {
        new Notice("The note was saved, but the old recovery marker could not be cleared yet.");
      }
      const savedFile = this.app.vault.getAbstractFileByPath(normalizePath(target.path));
      if (savedFile instanceof TFile && options.announceSuccess !== false) {
        new Notice(`Saved ${normalizeFileTitle(savedFile.name) || savedFile.name} to the vault.`);
      }
      if (previewRequestId !== this.previewRequestId) {
        const stillShowingSavedFile =
          savedFile instanceof TFile &&
          !this.previewEditorState &&
          (this.activePreviewFile === savedFile ||
            this.activePreviewFile?.path === savedFile.path ||
            this.pendingPreviewPath === savedFile.path);
        if (stillShowingSavedFile && options.renderAfterSave !== false) {
          await this.renderPreview(savedFile, false);
        }
        return;
      }
      if (!(savedFile instanceof TFile)) {
        this.activePreviewFile = null;
        this.pendingPreviewPath = target.path;
        if (options.renderAfterSave !== false) this.renderMissingPreview(target.path);
        return;
      }
      this.activePreviewFile = savedFile;
      this.pendingPreviewPath = savedFile.path;
      if (options.renderAfterSave !== false) await this.renderPreview(savedFile, true);
    } catch (error) {
      if (this.previewEditorState !== state) return;
      state.saving = false;
      if (error instanceof PreviewEditConflictError) {
        state.conflict = true;
        new Notice("The vault file changed elsewhere. Your dashboard draft was not overwritten.");
        await this.renderPreview(target, true);
        return;
      }
      this.updatePreviewEditorChrome(state);
      const message = error instanceof Error ? error.message : "The vault write failed.";
      new Notice(`Could not save this file: ${message}`);
      this.focusPreviewEditor();
    }
  }

  private async cancelPreviewEditing(file: TFile): Promise<void> {
    const state = this.previewEditorState;
    if (
      !state ||
      (state.file !== file && state.file.path !== file.path) ||
      state.saving
    ) return;
    const previewRequestId = this.previewRequestId;
    this.previewEditorState = null;
    try {
      const cleared = await this.clearPreviewRecoveryForState(state);
      if (!cleared) throw new Error("Recovery path mismatch");
    } catch {
      new Notice("The draft was discarded, but its recovery marker could not be cleared yet.");
    }
    if (previewRequestId !== this.previewRequestId) return;
    const currentFile = this.app.vault.getAbstractFileByPath(normalizePath(state.file.path));
    if (!(currentFile instanceof TFile)) {
      this.activePreviewFile = null;
      this.pendingPreviewPath = state.file.path;
      this.renderMissingPreview(state.file.path);
      return;
    }
    this.activePreviewFile = currentFile;
    this.pendingPreviewPath = currentFile.path;
    await this.renderPreview(currentFile, true);
  }

  private previewEditorStatus(state: PreviewEditorState): string {
    if (state.conflict) return "Vault copy changed · Draft not saved";
    if (state.saving) return "Saving to vault…";
    if (state.dirty) return "Unsaved changes";
    return "Ready to edit";
  }

  private updatePreviewEditorChrome(state: PreviewEditorState): void {
    if (this.previewEditorState !== state || !this.previewPaneEl) return;
    const saveButton = this.previewPaneEl.querySelector<HTMLButtonElement>(".fjg-vcc-preview-save");
    if (saveButton) {
      saveButton.disabled = !state.dirty || state.saving || state.conflict;
      const labels = saveButton.querySelectorAll<HTMLSpanElement>("span");
      const label = labels.item(labels.length - 1);
      if (label) label.textContent = state.saving ? "Saving…" : "Save";
    }
    const cancelButton = this.previewPaneEl.querySelector<HTMLButtonElement>(".fjg-vcc-preview-cancel");
    if (cancelButton) {
      cancelButton.disabled = state.saving;
      const cancelLabel = state.dirty || state.conflict ? "Discard changes" : "Cancel";
      cancelButton.setAttribute("aria-label", cancelLabel);
      const labels = cancelButton.querySelectorAll<HTMLSpanElement>("span");
      const label = labels.item(labels.length - 1);
      if (label) label.textContent = cancelLabel;
    }
    const openTabButton = this.previewPaneEl.querySelector<HTMLButtonElement>(
      ".fjg-vcc-preview-open-tab"
    );
    if (openTabButton) openTabButton.disabled = state.saving;
    const status = this.previewPaneEl.querySelector<HTMLElement>(".fjg-vcc-preview-edit-status");
    if (status) {
      status.textContent = this.previewEditorStatus(state);
      status.classList.toggle("is-dirty", state.dirty && !state.conflict);
      status.classList.toggle("is-conflict", state.conflict);
    }
    const editor = this.previewPaneEl.querySelector<HTMLTextAreaElement>(".fjg-vcc-preview-editor");
    if (editor) editor.disabled = state.saving;
  }

  private noticeUnsavedPreviewChanges(): void {
    new Notice("Save or discard your dashboard edits before leaving this note.");
  }

  private async openPreviewInTab(file: TFile): Promise<void> {
    const state = this.previewEditorState;
    const isCurrentEditor =
      state && (state.file === file || state.file.path === file.path);
    if (isCurrentEditor && (state.dirty || state.conflict)) {
      new Notice("Save or discard your dashboard edits before opening this note in a tab.");
      this.focusPreviewEditor();
      return;
    }
    if (isCurrentEditor && state.saving) {
      new Notice("Wait for the dashboard save to finish before opening this note in a tab.");
      return;
    }
    await this.plugin.openVaultFileInTab(file.path);
  }

  private focusPreviewEditor(): void {
    this.contentEl.ownerDocument.defaultView?.setTimeout(
      () => this.previewPaneEl?.querySelector<HTMLTextAreaElement>(".fjg-vcc-preview-editor")?.focus({ preventScroll: true }),
      0
    );
  }

  private async clearPreviewRecoveryForState(state: PreviewEditorState): Promise<boolean> {
    if (state.recoverySavedAt === null) return true;
    return this.clearPreviewRecoveryPaths(
      [state.recoveryPath, state.file.path],
      state.recoverySavedAt
    );
  }

  private async clearPreviewRecoveryPaths(
    candidates: Array<string | null | undefined>,
    expectedSavedAt?: number
  ): Promise<boolean> {
    const paths = [...new Set(candidates.filter(Boolean))] as string[];
    for (const path of paths) {
      if (await this.plugin.clearPreviewRecoveryDraft(path, expectedSavedAt)) return true;
    }
    return this.plugin.getPreviewRecoveryDraft() === null;
  }

  private clearPreviewRecoveryInBackground(state: PreviewEditorState): void {
    void this.clearPreviewRecoveryForState(state)
      .then((cleared) => {
        if (!cleared) {
          new Notice("The old dashboard recovery marker could not be matched for cleanup.");
        }
      })
      .catch(() => {
        new Notice("The old dashboard recovery marker could not be cleared yet.");
      });
  }

  private createPreviewBrowserToggle(parent: HTMLElement): void {
    const label = this.previewBrowserCollapsed ? "Show files" : "Hide files";
    let button: HTMLButtonElement;
    button = createButton(parent, {
      label,
      icon: "panel-left",
      className: "fjg-vcc-button fjg-vcc-preview-browser-toggle",
      ariaLabel: `${label} while previewing this file`,
      onClick: () => {
        this.previewBrowserCollapsed = !this.previewBrowserCollapsed;
        this.updatePreviewLayoutMode();
        const nextLabel = this.previewBrowserCollapsed ? "Show files" : "Hide files";
        button.setAttribute("aria-label", `${nextLabel} while previewing this file`);
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

  private closePreview(options: PreviewCloseOptions = {}): boolean {
    if (this.previewEditorState?.dirty && options.discardDraft !== true) {
      this.noticeUnsavedPreviewChanges();
      this.focusPreviewEditor();
      return false;
    }
    const activePath = this.activePreviewFile?.path || this.pendingPreviewPath;
    if (this.previewEditorState?.recoveryPath) {
      this.clearPreviewRecoveryInBackground(this.previewEditorState);
    }
    const returnFocus = this.previewReturnFocusEl;
    this.previewRequestId += 1;
    this.previewEditStartRequestId += 1;
    this.disposePreviewComponent();
    this.activePreviewFile = null;
    this.pendingPreviewPath = "";
    this.previewReturnFocusEl = null;
    this.previewEditorState = null;
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

    if (options.restoreFocus === false) return true;
    const fallback = Array.from(
      this.contentRegionEl?.querySelectorAll<HTMLElement>("[data-file-path]") ?? []
    )
      .find((element) => element.dataset.filePath === activePath);
    this.contentEl.ownerDocument.defaultView?.setTimeout(() => {
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      else fallback?.focus({ preventScroll: true });
    }, 0);
    return true;
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

class PreviewEditConflictError extends Error {
  constructor() {
    super("The vault file changed after dashboard editing began.");
    this.name = "PreviewEditConflictError";
  }
}
