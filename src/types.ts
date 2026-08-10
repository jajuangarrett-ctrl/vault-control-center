export const DASHBOARD_VIEW_TYPE = "fjg-vault-control-center";

export const ROUTES = [
  "home",
  "areas",
  "programs",
  "html",
  "ai-team",
  "automations",
  "recent",
  "bookmarks",
  "people",
  "clipboard",
  "settings",
] as const;

export type DashboardRoute = (typeof ROUTES)[number];
export type DashboardTheme = "dark" | "light";
export type ClipboardTemplateId = "meetingFollowUp" | "programUpdate" | "emailHandoff";

export interface DashboardSettings {
  schemaVersion: number;
  theme: DashboardTheme;
  applyShellTheme: boolean;
  areasFolder: string;
  programsFolder: string;
  contactListPath: string;
  peopleFolder: string;
  tasksFilePath: string;
  htmlRoots: string[];
  htmlThumbnailFolder: string;
  aiFolders: {
    emailQueue: string;
    formattedNotes: string;
    ownerInbox: string;
    teamInbox: string;
  };
  recentRoots: string[];
  reuseTaskCaptureConnection: boolean;
  enableRemoteTaskboard: boolean;
  taskboardUrl: string;
  taskboardSecretId: string;
  clipboardTemplates: Record<ClipboardTemplateId, string>;
}

export interface RouteDefinition {
  id: DashboardRoute;
  label: string;
  icon: string;
}

export const ROUTE_DEFINITIONS: readonly RouteDefinition[] = [
  { id: "home", label: "Home", icon: "home" },
  { id: "areas", label: "Areas", icon: "folders" },
  { id: "programs", label: "Programs", icon: "folder" },
  { id: "html", label: "HTML", icon: "panels-top-left" },
  { id: "ai-team", label: "AI Team", icon: "bot" },
  { id: "automations", label: "Automations", icon: "workflow" },
  { id: "recent", label: "Recent", icon: "clock-3" },
  { id: "bookmarks", label: "Bookmarks", icon: "bookmark" },
  { id: "people", label: "People", icon: "users" },
  { id: "clipboard", label: "Clipboard", icon: "clipboard-copy" },
  { id: "settings", label: "Settings", icon: "settings-2" },
] as const;

export const DEFAULT_SETTINGS: DashboardSettings = {
  schemaVersion: 5,
  theme: "dark",
  applyShellTheme: true,
  areasFolder: "03 Areas",
  programsFolder: "Programs",
  contactListPath: "People/Contacts.md",
  peopleFolder: "People/Agenda",
  tasksFilePath: "Tasks/Tasks.md",
  htmlRoots: ["Artifacts", "02 Programs", "03 Areas", "10 Misc", "Wiki"],
  htmlThumbnailFolder:
    "Artifacts/Vault Control Center Native Plugin/runtime/html-gallery/thumbnails",
  aiFolders: {
    emailQueue: "Operations/Email Queue",
    formattedNotes: "Operations/Formatted Notes",
    ownerInbox: "Operations/Owner Inbox",
    teamInbox: "Operations/Team Inbox",
  },
  recentRoots: ["Programs", "03 Areas", "Operations", "People", "Tasks", "Resources"],
  reuseTaskCaptureConnection: false,
  enableRemoteTaskboard: false,
  taskboardUrl: "",
  taskboardSecretId: "",
  clipboardTemplates: {
    meetingFollowUp:
      "Subject: Follow-up — [meeting]\n\nHi [name],\n\nThank you for meeting today. Here are the decisions and next steps:\n\n- Decision:\n- Owner:\n- Due date:\n\nFranklin",
    programUpdate:
      "Program: [program]\nStatus: [on track / needs attention]\n\nProgress\n- \n\nRisks or decisions needed\n- \n\nNext milestone\n- ",
    emailHandoff:
      "To: [recipient]\nSubject: [clear subject]\n\nPurpose:\n\nKey context:\n- \n\nRequested action and deadline:\n- \n\nFranklin",
  },
};
