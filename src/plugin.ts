import { Notice, Platform, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { isExcludedPath, isSensitivePath, normalizeVaultPath } from "./data";
import {
  ReusableFileLeafController,
  type ReusableFileLeafOpenResult,
} from "./reusable-file-leaf";
import { VaultControlCenterSettingTab } from "./settings";
import { applyDashboardTheme, clearDashboardTheme } from "./theme";
import { DASHBOARD_VIEW_TYPE, DEFAULT_SETTINGS, type DashboardSettings } from "./types";
import { VaultControlCenterView } from "./view";

type CommandHost = {
  commands?: {
    executeCommandById?: (id: string) => boolean;
  };
};

type AppWithViewRegistry = {
  viewRegistry?: {
    getTypeByExtension?: (extension: string) => string | null | undefined;
  };
};

export type InteractiveHtmlOpenResult = ReusableFileLeafOpenResult | "fallback";

export default class VaultControlCenterPlugin extends Plugin {
  settings: DashboardSettings = structuredClone(DEFAULT_SETTINGS);
  private refreshTimer: number | null = null;
  private reusableFileLeafController: ReusableFileLeafController | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.applyTheme();

    this.registerView(
      DASHBOARD_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new VaultControlCenterView(leaf, this)
    );

    this.addRibbonIcon("layout-dashboard", "Open Vault Control Center", () => {
      void this.openDashboard();
    });

    this.addCommand({
      id: "open-vault-control-center",
      name: "Open dashboard",
      callback: () => void this.openDashboard(),
    });
    this.addCommand({
      id: "refresh-vault-control-center",
      name: "Refresh dashboard data",
      callback: () => void this.refreshDashboardViews(true),
    });

    this.addSettingTab(new VaultControlCenterSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      const schedule = () => this.scheduleRefresh();
      this.registerEvent(this.app.vault.on("create", schedule));
      this.registerEvent(this.app.vault.on("modify", schedule));
      this.registerEvent(this.app.vault.on("delete", schedule));
      this.registerEvent(this.app.vault.on("rename", schedule));
      this.registerEvent(this.app.workspace.on("file-open", schedule));
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.reusableFileLeafController?.reset();
    this.reusableFileLeafController = null;
    clearDashboardTheme();
  }

  async loadSettings(): Promise<void> {
    const raw = await this.loadData();
    const saved = isRecord(raw) ? raw : {};
    const aiFolders = isRecord(saved.aiFolders) ? saved.aiFolders : {};
    const clipboardTemplates = isRecord(saved.clipboardTemplates)
      ? saved.clipboardTemplates
      : {};
    const savedSchemaVersion = finiteInteger(saved.schemaVersion, 0);
    const taskboardSecretId = stringSetting(saved.taskboardSecretId, "");
    const remoteAutomationSecretId = stringSetting(saved.remoteAutomationSecretId, "");
    this.settings = {
      schemaVersion: DEFAULT_SETTINGS.schemaVersion,
      theme: saved.theme === "light" ? "light" : "dark",
      applyShellTheme: booleanSetting(saved.applyShellTheme, DEFAULT_SETTINGS.applyShellTheme),
      areasFolder: stringSetting(saved.areasFolder, DEFAULT_SETTINGS.areasFolder),
      programsFolder: stringSetting(saved.programsFolder, DEFAULT_SETTINGS.programsFolder),
      contactListPath: stringSetting(saved.contactListPath, DEFAULT_SETTINGS.contactListPath),
      peopleFolder: stringSetting(saved.peopleFolder, DEFAULT_SETTINGS.peopleFolder),
      tasksFilePath: stringSetting(saved.tasksFilePath, DEFAULT_SETTINGS.tasksFilePath),
      htmlRoots: stringArraySetting(saved.htmlRoots, DEFAULT_SETTINGS.htmlRoots),
      htmlThumbnailFolder: stringSetting(
        saved.htmlThumbnailFolder,
        DEFAULT_SETTINGS.htmlThumbnailFolder
      ),
      aiFolders: {
        emailQueue: stringSetting(
          aiFolders.emailQueue,
          DEFAULT_SETTINGS.aiFolders.emailQueue
        ),
        formattedNotes: stringSetting(
          aiFolders.formattedNotes,
          DEFAULT_SETTINGS.aiFolders.formattedNotes
        ),
        ownerInbox: stringSetting(aiFolders.ownerInbox, DEFAULT_SETTINGS.aiFolders.ownerInbox),
        teamInbox: stringSetting(aiFolders.teamInbox, DEFAULT_SETTINGS.aiFolders.teamInbox),
      },
      recentRoots: stringArraySetting(saved.recentRoots, DEFAULT_SETTINGS.recentRoots),
      reuseTaskCaptureConnection: booleanSetting(
        saved.reuseTaskCaptureConnection,
        DEFAULT_SETTINGS.reuseTaskCaptureConnection
      ),
      enableRemoteTaskboard:
        savedSchemaVersion < 3 && !taskboardSecretId
          ? false
          : booleanSetting(saved.enableRemoteTaskboard, DEFAULT_SETTINGS.enableRemoteTaskboard),
      taskboardUrl: stringSetting(saved.taskboardUrl, DEFAULT_SETTINGS.taskboardUrl),
      taskboardSecretId,
      remoteAutomationEnabled: booleanSetting(
        saved.remoteAutomationEnabled,
        DEFAULT_SETTINGS.remoteAutomationEnabled
      ),
      remoteAutomationUrl: stringSetting(
        saved.remoteAutomationUrl,
        DEFAULT_SETTINGS.remoteAutomationUrl
      ),
      remoteAutomationSecretId,
      clipboardTemplates: {
        meetingFollowUp: stringSetting(
          clipboardTemplates.meetingFollowUp,
          DEFAULT_SETTINGS.clipboardTemplates.meetingFollowUp
        ),
        programUpdate: stringSetting(
          clipboardTemplates.programUpdate,
          DEFAULT_SETTINGS.clipboardTemplates.programUpdate
        ),
        emailHandoff: stringSetting(
          clipboardTemplates.emailHandoff,
          DEFAULT_SETTINGS.clipboardTemplates.emailHandoff
        ),
      },
    };

    if (savedSchemaVersion < DEFAULT_SETTINGS.schemaVersion) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async onExternalSettingsChange(): Promise<void> {
    await this.loadSettings();
    this.applyTheme();
    await this.refreshDashboardViews(false);
  }

  applyTheme(): void {
    applyDashboardTheme(this.settings);
  }

  scheduleRefresh(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshDashboardViews(false);
    }, 600);
  }

  async refreshDashboardViews(showNotice: boolean): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
    await Promise.all(
      leaves.map(async (leaf) => {
        if (leaf.view instanceof VaultControlCenterView) await leaf.view.refresh(showNotice);
      })
    );
    if (showNotice) new Notice("Vault Control Center refreshed.");
  }

  async openDashboard(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }

    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: DASHBOARD_VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  executeCapture(commandId: string, label: string): void {
    try {
      const host = this.app as unknown as CommandHost;
      const ran = host.commands?.executeCommandById?.(commandId) ?? false;
      if (!ran) new Notice(`${label} is not enabled.`);
    } catch {
      new Notice(`${label} could not be opened.`);
    }
  }

  async openVaultFileInTab(path: string): Promise<void> {
    const normalizedPath = normalizeVaultPath(path);
    if (
      !normalizedPath ||
      isExcludedPath(normalizedPath) ||
      isSensitivePath(normalizedPath)
    ) {
      new Notice("That file is not available from the dashboard.");
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(normalizedPath));
    if (!(file instanceof TFile)) {
      new Notice("That file is no longer available.");
      return;
    }
    try {
      await this.reusableFileLeaf().openFile(file);
    } catch {
      new Notice("That file could not be opened in an Obsidian tab.");
    }
  }

  async openHtmlFileInteractively(path: string): Promise<InteractiveHtmlOpenResult> {
    if (!Platform.isDesktopApp) return "fallback";

    const normalizedPath = normalizeVaultPath(path);
    if (
      !normalizedPath ||
      isExcludedPath(normalizedPath) ||
      isSensitivePath(normalizedPath)
    ) {
      return "fallback";
    }
    const file = this.app.vault.getAbstractFileByPath(normalizePath(normalizedPath));
    if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "html") {
      return "fallback";
    }

    const registeredViewType = registeredViewTypeForExtension(
      this.app,
      file.extension
    );
    if (!registeredViewType) return "fallback";

    return this.reusableFileLeaf().openFile(file, {
      expectedViewType: registeredViewType,
    });
  }

  private reusableFileLeaf(): ReusableFileLeafController {
    this.reusableFileLeafController ??= new ReusableFileLeafController(
      this.app.workspace
    );
    return this.reusableFileLeafController;
  }
}

function registeredViewTypeForExtension(app: unknown, extension: string): string {
  try {
    const registry = (app as AppWithViewRegistry).viewRegistry;
    const viewType = registry?.getTypeByExtension?.(
      extension.trim().toLocaleLowerCase()
    );
    return typeof viewType === "string" ? viewType.trim() : "";
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function finiteInteger(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

function stringArraySetting(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const strings = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return strings.length ? strings : [...fallback];
}
