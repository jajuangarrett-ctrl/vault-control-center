import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type VaultControlCenterPlugin from "./plugin";
import type { DashboardTheme } from "./types";

export class VaultControlCenterSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: VaultControlCenterPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("fjg-vcc-settings-tab");
    new Setting(containerEl).setName("Vault Control Center").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Configure the live folders and coordinated navy/orange interface. Derived vault data is never saved in plugin settings.",
    });

    new Setting(containerEl).setName("Appearance").setHeading();
    new Setting(containerEl)
      .setName("Dashboard theme")
      .setDesc("Use the same structure with dark or light interface tokens.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("dark", "Dark")
          .addOption("light", "Light")
          .setValue(this.plugin.settings.theme)
          .onChange(async (value) => {
            this.plugin.settings.theme = value as DashboardTheme;
            await this.plugin.saveSettings();
            this.plugin.applyTheme();
            await this.plugin.refreshDashboardViews(false);
          })
      );

    new Setting(containerEl)
      .setName("Coordinate the Obsidian shell")
      .setDesc("Apply matching colors to Obsidian chrome while this plugin is enabled. Disabling or unloading removes every shell class.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.applyShellTheme).onChange(async (value) => {
          this.plugin.settings.applyShellTheme = value;
          await this.plugin.saveSettings();
          this.plugin.applyTheme();
        })
      );

    new Setting(containerEl).setName("Vault sources").setHeading();
    this.addPathSetting("Areas folder", "Top-level folders become Area records with recursive navigation.", "areasFolder");
    this.addPathSetting("Programs folder", "Top-level folders become program records.", "programsFolder");
    this.addPathSetting("People agenda folder", "Markdown files become people and agenda records.", "peopleFolder");
    this.addPathSetting("Contact list", "Opened by the dashboard contact action.", "contactListPath");
    this.addPathSetting("Tasks file", "Used for local open and total task counts.", "tasksFilePath");

    new Setting(containerEl).setName("HTML gallery").setHeading();
    new Setting(containerEl)
      .setName("HTML gallery roots")
      .setDesc("One vault-relative folder per line. Safe finished HTML files under these roots appear as gallery cards.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text
          .setPlaceholder("Artifacts\n02 Programs\n03 Areas")
          .setValue(this.plugin.settings.htmlRoots.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.htmlRoots = value
              .split(/\r?\n/)
              .map((part) => part.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.scheduleRefresh();
          });
      });
    this.addPathSetting(
      "HTML thumbnail folder",
      "Generated thumbnails are stored here as portable vault-relative runtime files.",
      "htmlThumbnailFolder"
    );

    new Setting(containerEl).setName("AI Team queues").setHeading();
    this.addAiPathSetting("Email queue", "emailQueue");
    this.addAiPathSetting("Formatted notes", "formattedNotes");
    this.addAiPathSetting("Owner inbox", "ownerInbox");
    this.addAiPathSetting("Team inbox", "teamInbox");

    new Setting(containerEl)
      .setName("Recent roots")
      .setDesc("One vault-relative folder per line. The Recent view combines these sources.")
      .addTextArea((text) => {
        text.inputEl.rows = 5;
        text
          .setPlaceholder("Programs\nOperations\nPeople")
          .setValue(this.plugin.settings.recentRoots.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.recentRoots = value
              .split(/\r?\n/)
              .map((part) => part.trim())
              .filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.scheduleRefresh();
          });
      });

    new Setting(containerEl).setName("Optional remote taskboard").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Opt in to Task Capture's existing connection or select a credential from Obsidian Secret Storage. Secret values are never copied into this plugin's data or logs.",
    });
    new Setting(containerEl)
      .setName("Reuse Task Capture connection")
      .setDesc("Read Task Capture's configured taskboard URL and password in memory. The credential is never copied or saved by this plugin.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.reuseTaskCaptureConnection).onChange(async (value) => {
          this.plugin.settings.reuseTaskCaptureConnection = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );
    new Setting(containerEl)
      .setName("Use a separate taskboard connection")
      .setDesc("Use the HTTPS URL and Obsidian secret below instead of Task Capture's connection.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableRemoteTaskboard).onChange(async (value) => {
          this.plugin.settings.enableRemoteTaskboard = value;
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
    );
    this.addPathSetting("Taskboard URL", "HTTPS base URL without /api/tasks.", "taskboardUrl");
    const secretSetting = new Setting(containerEl)
      .setName("Taskboard credential")
      .setDesc("Select a value managed by Obsidian Secret Storage. Only the secret ID is saved in plugin settings.");
    new SecretComponent(this.app, secretSetting.controlEl)
      .setValue(this.plugin.settings.taskboardSecretId)
      .onChange(async (value) => {
        this.plugin.settings.taskboardSecretId = value.trim();
        await this.plugin.saveSettings();
        this.plugin.scheduleRefresh();
      });

    new Setting(containerEl).setName("Remote automation executor").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Use the dedicated authenticated broker to run approved routine jobs on the always-on Mac. Only the Obsidian Secret Storage identifier is saved here.",
    });
    new Setting(containerEl)
      .setName("Enable remote automation controls")
      .setDesc("When unavailable or incomplete, remote Run now controls remain disabled.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.remoteAutomationEnabled).onChange(async (value) => {
          this.plugin.settings.remoteAutomationEnabled = value;
          await this.plugin.saveSettings();
          await this.plugin.refreshDashboardViews(false);
        })
      );
    this.addPathSetting(
      "Automation broker URL",
      "Dedicated HTTPS Netlify site URL, without an API path.",
      "remoteAutomationUrl"
    );
    const automationSecret = new Setting(containerEl)
      .setName("Automation broker credential")
      .setDesc("Select a client credential managed by Obsidian Secret Storage. Its value is never copied into plugin data or logs.");
    new SecretComponent(this.app, automationSecret.controlEl)
      .setValue(this.plugin.settings.remoteAutomationSecretId)
      .onChange(async (value) => {
        this.plugin.settings.remoteAutomationSecretId = value.trim();
        await this.plugin.saveSettings();
        await this.plugin.refreshDashboardViews(false);
      });
  }

  private addPathSetting(
    name: string,
    description: string,
    key:
      | "areasFolder"
      | "programsFolder"
      | "peopleFolder"
      | "contactListPath"
      | "tasksFilePath"
      | "taskboardUrl"
      | "remoteAutomationUrl"
      | "htmlThumbnailFolder"
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
          this.plugin.scheduleRefresh();
        })
      );
  }

  private addAiPathSetting(
    name: string,
    key: keyof VaultControlCenterPlugin["settings"]["aiFolders"]
  ): void {
    new Setting(this.containerEl).setName(name).addText((text) =>
      text.setValue(this.plugin.settings.aiFolders[key]).onChange(async (value) => {
        this.plugin.settings.aiFolders[key] = value.trim();
        await this.plugin.saveSettings();
        this.plugin.scheduleRefresh();
      })
    );
  }
}
