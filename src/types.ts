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
  htmlHomePages: string[];
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
  remoteAutomationEnabled: boolean;
  remoteAutomationUrl: string;
  remoteAutomationSecretId: string;
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
  schemaVersion: 7,
  theme: "dark",
  applyShellTheme: true,
  areasFolder: "03 Areas",
  programsFolder: "Programs",
  contactListPath: "People/Contacts.md",
  peopleFolder: "People/Agenda",
  tasksFilePath: "Tasks/Tasks.md",
  htmlRoots: ["Artifacts", "04 Artifacts", "02 Programs", "03 Areas", "10 Misc", "Wiki"],
  htmlHomePages: [
    "02 Programs/Basic-Needs/Dashboards and Indexes/Basic-Needs-Program-Overview.html",
    "02 Programs/Basic-Needs/Dashboards and Indexes/CARES-Basic-Needs-Expansion-and-Resource-Criteria-Infographic.html",
    "02 Programs/Basic-Needs/MEMOS/AB132_Infographic.html",
    "02 Programs/CalWORKs/Operations/Department Meetings/CalWORKs Agenda Template.html",
    "02 Programs/CalWORKs/Work-Study/index.html",
    "03 Areas/Career/Administrators Institute/Admin Institute Draft Proposal Site/Administrator Collaborative Draft Proposal.html",
    "03 Areas/Career/Full-Time Administration Job Search Dashboard/administration-job-search-dashboard.html",
    "03 Areas/Career/Job-Applications/Apply For VPSS Position at Grossmont College/Interview Prep Dashboard.html",
    "03 Areas/Career/Job-Applications/Apply for Mesa Dean Position/Interview Prep Dashboard.html",
    "03 Areas/Career/Job-Applications/Job Applications Tasks/Apply for Miramar Acting Dean Position/Miramar Acting Dean Interview Prep Dashboard.html",
    "03 Areas/Evaluations/Evaluations 2026 - 2027/Fall 2026 Faculty Evaluation Tracker.html",
    "03 Areas/Evaluations/Evaluations 2026 - 2027/Fall 2026 Faculty Evaluation Tracker (Roberta).html",
    "03 Areas/How-To/AI/Agent Communication/Agent Communication Infographic.html",
    "03 Areas/How-To/Codex/Codex Advanced Workflow Manual/index.html",
    "03 Areas/How-To/GitHub/github-repository-experiment-hub.html",
    "03 Areas/Policies, Processes & Job Aides/Policies and Procedures Dashboard/Policies and Procedures Dashboard.html",
    "03 Areas/Self Improvement/Cognitive Biases and Laws That Explain Human Behavior/Cognitive Biases and Laws That Explain Human Behavior.html",
    "Artifacts/Agenda Dashboard/agenda.html",
    "Artifacts/Agent Mission Control/index.html",
    "Artifacts/Budget Dashboard/index.html",
    "Artifacts/CalWORKs Growth Story/index.html",
    "Artifacts/CalWORKs Schedule HTML/CalWORKs Schedule.html",
    "Artifacts/Committee Hub/index.html",
    "Artifacts/CourtCraft/index.html",
    "Artifacts/Franklins Workout Library/index.html",
    "Artifacts/Habit Tracker/2026-06-01_Habit-Tracker-Streaks.html",
    "Artifacts/ICOR Agent Dashboard/AI Agent Dashboard.html",
    "Artifacts/Inbox Morning Brief/Inbox Morning Brief.html",
    "Artifacts/Water Tracker/index.html",
    "Wiki/48-laws-of-power-study-guide.html",
  ],
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
  remoteAutomationEnabled: false,
  remoteAutomationUrl: "",
  remoteAutomationSecretId: "",
  clipboardTemplates: {
    meetingFollowUp:
      "Subject: Follow-up — [meeting]\n\nHi [name],\n\nThank you for meeting today. Here are the decisions and next steps:\n\n- Decision:\n- Owner:\n- Due date:\n\nFranklin",
    programUpdate:
      "Program: [program]\nStatus: [on track / needs attention]\n\nProgress\n- \n\nRisks or decisions needed\n- \n\nNext milestone\n- ",
    emailHandoff:
      "To: [recipient]\nSubject: [clear subject]\n\nPurpose:\n\nKey context:\n- \n\nRequested action and deadline:\n- \n\nFranklin",
  },
};
