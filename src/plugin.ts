import { Notice, Plugin, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import {
  isExcludedPath,
  isSensitivePath,
  normalizeVaultPath,
  remapVaultPathAfterRename,
} from "./data";
import {
  canPersistPreviewRecovery,
  classifyPreviewKind,
  isEditablePreviewKind,
  isPreviewRecoveryPayloadWithinLimit,
} from "./preview";
import { VaultControlCenterSettingTab } from "./settings";
import { applyDashboardTheme, clearDashboardTheme } from "./theme";
import { DASHBOARD_VIEW_TYPE, DEFAULT_SETTINGS, type DashboardSettings } from "./types";
import { VaultControlCenterView } from "./view";

type CommandHost = {
  commands?: {
    executeCommandById?: (id: string) => boolean;
  };
};

export interface PreviewRecoveryDraft {
  path: string;
  baselineContent: string;
  draft: string;
  savedAt: number;
}

export default class VaultControlCenterPlugin extends Plugin {
  settings: DashboardSettings = structuredClone(DEFAULT_SETTINGS);
  private previewRecoveryDraft: PreviewRecoveryDraft | null = null;
  private recoveryRevisionClock = 0;
  private dataWritePromise: Promise<void> = Promise.resolve();
  private refreshTimer: number | null = null;

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
      this.registerEvent(
        this.app.vault.on("rename", (file, oldPath) => {
          schedule();
          void this.migratePreviewRecoveryAfterRename(file.path, oldPath).catch(() => {
            new Notice("A retained dashboard draft could not follow its renamed file.");
          });
        })
      );
      this.registerEvent(this.app.workspace.on("file-open", schedule));
    });
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
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
    this.previewRecoveryDraft = parsePreviewRecoveryDraft(saved.previewRecoveryDraft);
    this.recoveryRevisionClock = Math.max(
      this.recoveryRevisionClock,
      this.previewRecoveryDraft?.savedAt ?? 0
    );
    const discardedInvalidRecovery =
      saved.previewRecoveryDraft != null && !this.previewRecoveryDraft;
    this.settings = {
      schemaVersion: DEFAULT_SETTINGS.schemaVersion,
      theme: saved.theme === "light" ? "light" : "dark",
      applyShellTheme: booleanSetting(saved.applyShellTheme, DEFAULT_SETTINGS.applyShellTheme),
      areasFolder: stringSetting(saved.areasFolder, DEFAULT_SETTINGS.areasFolder),
      programsFolder: stringSetting(saved.programsFolder, DEFAULT_SETTINGS.programsFolder),
      contactListPath: stringSetting(saved.contactListPath, DEFAULT_SETTINGS.contactListPath),
      peopleFolder: stringSetting(saved.peopleFolder, DEFAULT_SETTINGS.peopleFolder),
      tasksFilePath: stringSetting(saved.tasksFilePath, DEFAULT_SETTINGS.tasksFilePath),
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

    if (savedSchemaVersion < DEFAULT_SETTINGS.schemaVersion || discardedInvalidRecovery) {
      await this.saveSettings();
    }
  }

  async saveSettings(): Promise<void> {
    const snapshot = {
      ...this.settings,
      previewRecoveryDraft: this.previewRecoveryDraft,
    };
    const operation = this.dataWritePromise.then(() => this.saveData(snapshot));
    this.dataWritePromise = operation.catch(() => undefined);
    await operation;
  }

  getPreviewRecoveryDraft(): PreviewRecoveryDraft | null {
    return this.previewRecoveryDraft ? { ...this.previewRecoveryDraft } : null;
  }

  async storePreviewRecoveryDraft(
    draft: PreviewRecoveryDraft,
    options: { preserveSavedAt?: boolean } = {}
  ): Promise<void> {
    const previous = this.previewRecoveryDraft;
    const savedAt = options.preserveSavedAt
      ? draft.savedAt
      : Math.max(Date.now(), this.recoveryRevisionClock + 1);
    this.recoveryRevisionClock = Math.max(this.recoveryRevisionClock, savedAt);
    const next = { ...draft, savedAt };
    this.previewRecoveryDraft = next;
    try {
      await this.saveSettings();
    } catch (error) {
      if (this.previewRecoveryDraft === next) this.previewRecoveryDraft = previous;
      throw error;
    }
  }

  async clearPreviewRecoveryDraft(
    path?: string,
    expectedSavedAt?: number
  ): Promise<boolean> {
    if (!this.previewRecoveryDraft) return true;
    if (
      path &&
      normalizeVaultPath(path) !== normalizeVaultPath(this.previewRecoveryDraft.path)
    ) return false;
    if (
      expectedSavedAt !== undefined &&
      this.previewRecoveryDraft.savedAt !== expectedSavedAt
    ) return false;
    const previous = this.previewRecoveryDraft;
    this.previewRecoveryDraft = null;
    try {
      await this.saveSettings();
    } catch (error) {
      if (this.previewRecoveryDraft === null) this.previewRecoveryDraft = previous;
      throw error;
    }
    return true;
  }

  private async migratePreviewRecoveryAfterRename(
    newPath: string,
    oldPath: string
  ): Promise<void> {
    const recovery = this.previewRecoveryDraft;
    if (!recovery) return;
    const remappedPath = remapVaultPathAfterRename(recovery.path, oldPath, newPath);
    if (!remappedPath) return;

    const target = this.app.vault.getAbstractFileByPath(normalizePath(remappedPath));
    const canMigrate =
      target instanceof TFile &&
      canPersistPreviewRecovery({
        fileIsCurrent: true,
        pathIsSafe:
          !isExcludedPath(remappedPath) && !isSensitivePath(remappedPath),
        kind: classifyPreviewKind(target.extension),
        fileSize: target.stat.size,
        baselineContent: recovery.baselineContent,
        draft: recovery.draft,
      });
    if (!(target instanceof TFile) || !canMigrate) {
      await this.clearPreviewRecoveryDraft(recovery.path, recovery.savedAt);
      new Notice("A retained dashboard draft was discarded after its file moved outside the safe editor.");
      return;
    }

    await this.storePreviewRecoveryDraft({
      ...recovery,
      path: target.path,
    }, { preserveSavedAt: true });
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
    await this.app.workspace.getLeaf("tab").openFile(file);
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

function parsePreviewRecoveryDraft(value: unknown): PreviewRecoveryDraft | null {
  if (!isRecord(value)) return null;
  const path = normalizeVaultPath(stringSetting(value.path, ""));
  if (
    !path ||
    isExcludedPath(path) ||
    isSensitivePath(path) ||
    !isEditablePreviewKind(classifyPreviewKind(path)) ||
    typeof value.baselineContent !== "string" ||
    typeof value.draft !== "string" ||
    !isPreviewRecoveryPayloadWithinLimit(value.baselineContent, value.draft)
  ) return null;
  return {
    path,
    baselineContent: value.baselineContent,
    draft: value.draft,
    savedAt: typeof value.savedAt === "number" && Number.isFinite(value.savedAt)
      ? value.savedAt
      : Date.now(),
  };
}
