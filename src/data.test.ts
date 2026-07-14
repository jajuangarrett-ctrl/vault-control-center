import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
  buildDashboardData,
  countMarkdownTasks,
  isExcludedPath,
  isSensitivePath,
  normalizeFileTitle,
  normalizeVaultPath,
  parseBookmarks,
  pathIsWithin,
  type DashboardDataSettings,
} from "./data";

const SETTINGS: DashboardDataSettings = {
  programsFolder: "Programs",
  peopleFolder: "People/Agenda",
  aiFolders: {
    emailQueue: "Operations/Email Queue",
    formattedNotes: "Operations/Formatted Notes",
    ownerInbox: "Operations/Owner Inbox",
    teamInbox: "Operations/Team Inbox",
  },
  recentRoots: ["Programs", "Operations", "People", "Tasks"],
  tasksFilePath: "Tasks/Tasks.md",
};

describe("vault path helpers", () => {
  it("normalizes separators and path traversal segments", () => {
    expect(normalizeVaultPath("/Programs\\Alpha/./Notes/../Index.md/")).toBe(
      "Programs/Alpha/Index.md"
    );
  });

  it("uses folder boundaries instead of prefix matches", () => {
    expect(pathIsWithin("Operations/Email Queue/a.md", "Operations/Email Queue")).toBe(true);
    expect(pathIsWithin("Operations/Email Queue-old/a.md", "Operations/Email Queue")).toBe(false);
  });

  it("detects private and archived paths without overmatching tokenization", () => {
    expect(isSensitivePath("Private/passwords/account.md")).toBe(true);
    expect(isSensitivePath("Resources/api_keys.md")).toBe(true);
    expect(isSensitivePath("Resources/service_credentials.json")).toBe(true);
    expect(isSensitivePath("Resources/private_key.pem")).toBe(true);
    expect(isSensitivePath("Resources/access_token.txt")).toBe(true);
    expect(isSensitivePath("Wiki/Tokenization Research.md")).toBe(false);
    expect(isExcludedPath("Programs/Alpha/Archived/old.md")).toBe(true);
    expect(isExcludedPath("Programs/Alpha/current.md")).toBe(false);
  });

  it("strips Notion IDs from display titles without changing paths", () => {
    expect(
      normalizeFileTitle("Budget Report 2f7c6da26d4f80aca6b7fb56102dfe26.md")
    ).toBe("Budget Report");
  });
});

describe("parseBookmarks", () => {
  it("flattens nested groups and withholds sensitive or archived targets", () => {
    const parsed = parseBookmarks({
      items: [
        {
          type: "group",
          title: "Operations",
          items: [
            { type: "file", path: "Resources/Contacts.md" },
            { type: "file", path: "Private/passwords/Wi-Fi.md" },
            { type: "folder", path: "Programs/Alpha/Archived" },
          ],
        },
        { type: "url", title: "Portal", url: "https://example.edu/signed/path?view=all" },
        { type: "url", url: "https://user:password@example.edu/private" },
        { type: "url", title: "Private", url: "https://example.com/?token=secret" },
        { type: "search", query: "tag:#active" },
      ],
    });

    expect(parsed.visible).toEqual([
      {
        type: "file",
        label: "Contacts.md",
        target: "Resources/Contacts.md",
        displayTarget: "Resources/Contacts.md",
        group: "Operations",
      },
      {
        type: "url",
        label: "Portal",
        target: "https://example.edu/signed/path?view=all",
        displayTarget: "https://example.edu",
        group: "",
      },
    ]);
    expect(parsed.hiddenCount).toBe(4);
  });

  it("returns an empty result for unknown input", () => {
    expect(parseBookmarks(null)).toEqual({ visible: [], hiddenCount: 0 });
  });
});

describe("countMarkdownTasks", () => {
  it("counts standard Markdown checkboxes and ignores fenced examples", () => {
    const result = countMarkdownTasks(`
- [ ] Open task
- [x] Finished task
1. [X] Also finished

\`\`\`md
- [ ] Example only
\`\`\`

Not a task [ ]
- [-] Cancelled custom state
`);

    expect(result).toEqual({ open: 1, completed: 2, total: 3 });
  });
});

describe("buildDashboardData", () => {
  it("builds live summaries from one vault snapshot and excludes private files", async () => {
    const files = [
      file("Programs/Alpha/About.md", 100),
      file("Programs/Alpha/Meeting Notes/July.md", 500),
      file("Programs/Beta/About.md", 300),
      file("Programs/Beta/Archived/Old.md", 900),
      file("Operations/Email Queue/Reply.md", 700),
      file("Operations/Formatted Notes/Workshop.md", 600),
      file("Operations/Owner Inbox/service_credentials.md", 800),
      file("Operations/Team Inbox/Draft.md", 400),
      file("People/Agenda/Person One.md", 550),
      file("Tasks/Tasks.md", 750),
      file("Programs/Alpha/Poster.png", 950),
    ];

    const bookmarks = JSON.stringify({
      items: [
        { type: "file", title: "Contacts", path: "Resources/Contacts.md" },
        { type: "file", path: "Private/passwords/Wi-Fi.md" },
      ],
    });
    const tasks = "- [ ] Prepare agenda\n- [x] Send recap\n- [ ] Review budget";
    const app = fakeApp(files, {
      ".config/bookmarks.json": bookmarks,
      "Tasks/Tasks.md": tasks,
    });

    const data = await buildDashboardData(app, SETTINGS, {
      now: new Date("2026-07-13T12:00:00.000Z"),
    });

    expect(data.generatedAt).toBe("2026-07-13T12:00:00.000Z");
    expect(data.programs.map(({ name, count }) => ({ name, count }))).toEqual([
      { name: "Alpha", count: 2 },
      { name: "Beta", count: 1 },
    ]);
    expect(data.aiQueues.emailQueue.count).toBe(1);
    expect(data.aiQueues.formattedNotes.count).toBe(1);
    expect(data.aiQueues.ownerInbox.count).toBe(0);
    expect(data.aiQueues.teamInbox.count).toBe(1);
    expect(data.people.count).toBe(1);
    expect(data.recent[0].path).toBe("Tasks/Tasks.md");
    expect(data.bookmarks).toHaveLength(1);
    expect(data.metrics.hiddenBookmarks).toBe(1);
    expect(data.tasks).toEqual({
      path: "Tasks/Tasks.md",
      open: 2,
      completed: 1,
      total: 3,
    });
    expect(data.metrics).toMatchObject({
      programs: 2,
      aiQueues: 3,
      agenda: 1,
      bookmarks: 1,
      openTasks: 2,
      totalTasks: 3,
    });
  });

  it("retains every safe program file for recursive folder navigation", async () => {
    const files = Array.from({ length: 15 }, (_, index) =>
      file(
        `Programs/Alpha/Reporting/Record ${String(index + 1).padStart(2, "0")}.md`,
        index + 1
      )
    );
    files.push(file("Programs/Alpha/Overview.md", 100));
    files.push(file("Programs/Alpha/Archived/Old.md", 1_000));

    const data = await buildDashboardData(fakeApp(files, {}), SETTINGS);

    expect(data.programs).toHaveLength(1);
    expect(data.programs[0].count).toBe(16);
    expect(data.programs[0].files).toHaveLength(16);
    expect(data.programs[0].files[0].path).toBe("Programs/Alpha/Overview.md");
    expect(data.programs[0].files.map((entry) => entry.path)).not.toContain(
      "Programs/Alpha/Archived/Old.md"
    );
  });

  it("returns empty data and source states when configured paths are missing", async () => {
    const app = fakeApp([], {}, false);
    const data = await buildDashboardData(app, SETTINGS);

    expect(data.programs).toEqual([]);
    expect(data.recent).toEqual([]);
    expect(data.bookmarks).toEqual([]);
    expect(data.tasks.total).toBe(0);
    expect(data.sources.programsFolder.status).toBe("missing");
    expect(data.sources.bookmarks.status).toBe("missing");
  });

  it("does not throw or leak malformed bookmark JSON", async () => {
    const app = fakeApp([], { ".config/bookmarks.json": "{not-json" });
    const data = await buildDashboardData(app, SETTINGS);

    expect(data.bookmarks).toEqual([]);
    expect(data.sources.bookmarks.status).toBe("invalid");
  });
});

function file(path: string, mtime: number): TFile {
  const pathSegments = path.split("/");
  const name = pathSegments[pathSegments.length - 1] || path;
  const nameSegments = name.split(".");
  const extension = name.includes(".") ? nameSegments[nameSegments.length - 1] || "" : "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    extension,
    stat: { ctime: mtime - 1, mtime, size: 10 },
  } as TFile;
}

function fakeApp(
  files: TFile[],
  contents: Record<string, string>,
  foldersExist = true
): App {
  return {
    vault: {
      configDir: ".config",
      getFiles: () => files,
      cachedRead: async (target: TFile) => contents[target.path] ?? "",
      adapter: {
        exists: async (path: string) =>
          Object.prototype.hasOwnProperty.call(contents, path) || foldersExist,
        read: async (path: string) => {
          if (!Object.prototype.hasOwnProperty.call(contents, path)) {
            throw new Error("missing");
          }
          return contents[path];
        },
      },
    },
  } as unknown as App;
}
