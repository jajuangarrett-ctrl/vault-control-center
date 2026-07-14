import {
  ItemView,
  Notice,
  TFile,
  TFolder,
  Vault,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import {
  buildDashboardData,
  isExcludedPath,
  isSensitivePath,
  pathIsWithin,
  type AiFolderKey,
  type DashboardBookmark,
  type DashboardData,
} from "./data";
import { createButton, createIcon } from "./dom";
import type VaultControlCenterPlugin from "./plugin";
import { resolveProgramFolderPath } from "./program-navigation";
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
  selectedProgramPath?: unknown;
  selectedProgramFolderPath?: unknown;
  selectedAiQueue?: unknown;
  recentFilter?: unknown;
  bookmarkFilter?: unknown;
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
    selectedProgramPath: "",
    selectedProgramFolderPath: "",
    selectedAiQueue: "emailQueue",
    recentFilter: "all",
    bookmarkFilter: "all",
  };
  private rootEl: HTMLElement | null = null;
  private routeTabsEl: HTMLElement | null = null;
  private contentRegionEl: HTMLElement | null = null;
  private mobileDockEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private templateSaveTimer: number | null = null;
  private refreshPromise: Promise<void> | null = null;
  private taskboardFetchedAt = 0;
  private taskboardSettingsKey = "";

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
    await this.refresh();
  }

  async onClose(): Promise<void> {
    if (this.templateSaveTimer !== null) {
      window.clearTimeout(this.templateSaveTimer);
      this.templateSaveTimer = null;
      await this.plugin.saveSettings();
    }
    this.contentEl.empty();
    this.rootEl = null;
    this.contentRegionEl = null;
    this.routeTabsEl = null;
    this.mobileDockEl = null;
    this.searchInputEl = null;
  }

  getState(): Record<string, unknown> {
    return {
      ...super.getState(),
      route: this.route,
      selectedProgramPath: this.renderState.selectedProgramPath,
      selectedProgramFolderPath: this.renderState.selectedProgramFolderPath,
      selectedAiQueue: this.renderState.selectedAiQueue,
      recentFilter: this.renderState.recentFilter,
      bookmarkFilter: this.renderState.bookmarkFilter,
    };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    await super.setState(state, result);
    const saved = (state && typeof state === "object" ? state : {}) as PersistedViewState;
    if (typeof saved.route === "string" && ROUTES.includes(saved.route as DashboardRoute)) {
      this.route = saved.route as DashboardRoute;
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

    if (this.rootEl) {
      this.canonicalizeProgramSelection();
      this.renderRouteTabs();
      this.renderContent();
      this.renderMobileDock();
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
        buildDashboardData(this.app, this.plugin.settings),
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
      this.canonicalizeProgramSelection();
      this.renderContent();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dashboard refresh failed.";
      new Notice(message);
      this.renderFailure(message);
    } finally {
      this.rootEl?.removeAttribute("data-refreshing");
    }
  }

  private renderShell(): void {
    const previousFocus = document.activeElement === this.searchInputEl;
    this.contentEl.empty();
    this.rootEl = this.contentEl.createDiv({
      cls: "fjg-vcc",
      attr: { "data-theme": this.plugin.settings.theme },
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
        this.route === "programs" &&
        !previousQuery.trim() &&
        this.renderState.query.trim()
      ) {
        this.renderState.selectedProgramFolderPath =
          this.renderState.selectedProgramPath;
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
    this.contentRegionEl = this.rootEl.createEl("main", { cls: "fjg-vcc-content" });
    this.mobileDockEl = this.rootEl.createEl("nav", {
      cls: "fjg-vcc-mobile-dock",
      attr: { "aria-label": "Mobile dashboard navigation" },
    });
    this.renderMobileDock();
    this.renderContent();

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

  private renderContext(): DashboardRenderContext {
    if (!this.data) throw new Error("Dashboard data is not ready.");
    return {
      data: this.data,
      taskboard: this.taskboard,
      settings: this.plugin.settings,
      state: this.renderState,
      navigate: (route) => this.navigate(route),
      openFile: (path) => void this.plugin.openVaultFile(path),
      openBookmark: (bookmark) => void this.openBookmark(bookmark),
      openExternal: (url) => this.openExternal(url),
      capture: (commandId, label) => this.plugin.executeCapture(commandId, label),
      selectProgram: (path) => {
        this.renderState.selectedProgramPath = path;
        this.renderState.selectedProgramFolderPath = path;
        this.renderContent();
        this.focusProgramFolderHeading();
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
        this.focusProgramFolderHeading();
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
    this.route = route;
    this.renderRouteTabs();
    this.renderMobileDock();
    this.renderContent();
    this.contentRegionEl?.scrollTo({ top: 0 });
  }

  private focusProgramFolderHeading(): void {
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
    state.createEl("p", { text: "Programs, queues, files, bookmarks, people, and tasks are being refreshed." });
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
    if (event.key === "/" && !isEditing) {
      event.preventDefault();
      this.searchInputEl?.focus();
    }
  }

  private async openBookmark(bookmark: DashboardBookmark): Promise<void> {
    if (bookmark.type === "url") {
      this.openExternal(bookmark.target);
      return;
    }
    const target = this.app.vault.getAbstractFileByPath(bookmark.target);
    if (target instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(target);
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
        await this.app.workspace.getLeaf(false).openFile(files[0]);
        return;
      }
      new Notice("That folder has no safe files available to open.");
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
