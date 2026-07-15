import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
  buildDashboardData,
  type DashboardDataSettings,
} from "./data";

const SETTINGS: DashboardDataSettings = {
  programsFolder: "Programs",
  areasFolder: "03 Areas",
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

describe("AI queue inventories", () => {
  it("counts direct safe files only in the owner and team inboxes", async () => {
    const files = [
      file("Operations/Owner Inbox/Owner direct.md", 70),
      file("Operations/Owner Inbox/Another direct.pdf", 60),
      file("Operations/Owner Inbox/Nested/Not an inbox item.md", 100),
      file("Operations/Owner Inbox/service_credentials.md", 101),
      file("Operations/Owner Inbox/Unsupported.zip", 102),
      file("Operations/Team Inbox/Team direct.md", 90),
      file("Operations/Team Inbox/Another direct.pdf", 80),
      file("Operations/Team Inbox/Email Drafts/Nested draft.md", 110),
      file("Operations/Email Queue/Replies/Nested reply.md", 120),
      file("Operations/Formatted Notes/Meetings/Nested note.md", 130),
    ];

    const data = await buildDashboardData(fakeApp(files), SETTINGS);

    expect(data.aiQueues.ownerInbox.count).toBe(2);
    expect(data.aiQueues.ownerInbox.files.map((entry) => entry.path)).toEqual([
      "Operations/Owner Inbox/Owner direct.md",
      "Operations/Owner Inbox/Another direct.pdf",
    ]);
    expect(
      data.aiQueues.ownerInbox.files.every(
        (entry) => relativeDepth(entry.path, data.aiQueues.ownerInbox.path) === 1
      )
    ).toBe(true);

    expect(data.aiQueues.teamInbox.count).toBe(2);
    expect(data.aiQueues.teamInbox.files.map((entry) => entry.path)).toEqual([
      "Operations/Team Inbox/Team direct.md",
      "Operations/Team Inbox/Another direct.pdf",
    ]);
    expect(data.aiQueues.teamInbox.files).toHaveLength(
      data.aiQueues.teamInbox.count
    );

    expect(data.aiQueues.emailQueue.files.map((entry) => entry.path)).toEqual([
      "Operations/Email Queue/Replies/Nested reply.md",
    ]);
    expect(data.aiQueues.formattedNotes.files.map((entry) => entry.path)).toEqual([
      "Operations/Formatted Notes/Meetings/Nested note.md",
    ]);
  });

  it("retains the full counted queue inventory beyond twelve files", async () => {
    const files = Array.from({ length: 15 }, (_, index) =>
      file(
        `Operations/Owner Inbox/Owner ${String(index + 1).padStart(2, "0")}.md`,
        index + 1
      )
    );

    const data = await buildDashboardData(fakeApp(files), SETTINGS);

    expect(data.aiQueues.ownerInbox.count).toBe(15);
    expect(data.aiQueues.ownerInbox.files).toHaveLength(15);
    expect(data.aiQueues.ownerInbox.files).toHaveLength(
      data.aiQueues.ownerInbox.count
    );
  });
});

describe("recent file history", () => {
  it("places in-dashboard preview history ahead of native and plugin history", async () => {
    const files = [
      file("Programs/Previewed.md", 10),
      file("Programs/Plugin.md", 20),
      file("Programs/Native.md", 30),
    ];
    const app = fakeApp(files, {
      lastOpenFiles: ["Programs/Native.md"],
      contents: {
        ".config/community-plugins.json": JSON.stringify(["recent-files-obsidian"]),
        ".config/plugins/recent-files-obsidian/data.json": JSON.stringify({
          updateOn: "file-open",
          recentFiles: [{ path: "Programs/Plugin.md" }],
        }),
      },
    });

    const data = await buildDashboardData(app, SETTINGS, {
      recentFilePaths: ["Programs/Previewed.md", "Programs/Plugin.md"],
    });

    expect(data.recent.map((entry) => entry.path)).toEqual([
      "Programs/Previewed.md",
      "Programs/Plugin.md",
      "Programs/Native.md",
    ]);
    expect(data.recentMode).toBe("viewed");
  });

  it("prioritizes Recent Files open history, then appends native history", async () => {
    const files = [
      file("Outside Roots/Viewed first.md", 10),
      file("Programs/Viewed second.md", 900),
      file("Anywhere/Plugin third.pdf", 20),
      file("Operations/Plugin fourth.md", 800),
      file("Programs/Fifth.md", 700),
      file("Private/passwords/Unsafe.md", 1_000),
      file("Outside Roots/Unsupported.zip", 1_100),
    ];
    const recentFilesData = JSON.stringify({
      updateOn: "file-open",
      recentFiles: [
        { basename: "Plugin third", path: "Anywhere/Plugin third.pdf" },
        { basename: "Viewed second", path: "Programs/Viewed second.md" },
        { basename: "Plugin fourth", path: "Operations/Plugin fourth.md" },
        { basename: "Missing", path: "Anywhere/Missing.md" },
        { basename: "Unsafe", path: "Private/passwords/Unsafe.md" },
        { basename: "Unsupported", path: "Outside Roots/Unsupported.zip" },
        { basename: "Fifth", path: "Programs/Fifth.md" },
      ],
    });
    const app = fakeApp(files, {
      lastOpenFiles: [
        "Outside Roots/Viewed first.md",
        "Programs/Viewed second.md",
        "Anywhere/Missing from workspace.md",
        "Private/passwords/Unsafe.md",
        "Outside Roots/Unsupported.zip",
      ],
      contents: {
        ".config/community-plugins.json": JSON.stringify([
          "recent-files-obsidian",
        ]),
        ".config/plugins/recent-files-obsidian/data.json": recentFilesData,
      },
    });

    const data = await buildDashboardData(app, SETTINGS, {
      limits: { recentFiles: 5 },
    });

    expect(data.recent.map((entry) => entry.path)).toEqual([
      "Anywhere/Plugin third.pdf",
      "Programs/Viewed second.md",
      "Operations/Plugin fourth.md",
      "Programs/Fifth.md",
      "Outside Roots/Viewed first.md",
    ]);
    expect(new Set(data.recent.map((entry) => entry.path)).size).toBe(5);
    expect(data.recentMode).toBe("viewed");
  });

  it("ignores Recent Files history that is not configured for file opens", async () => {
    const files = [
      file("Programs/Actually opened.md", 10),
      file("Programs/Only edited.md", 20),
    ];
    const app = fakeApp(files, {
      lastOpenFiles: ["Programs/Actually opened.md"],
      contents: {
        ".config/community-plugins.json": JSON.stringify([
          "recent-files-obsidian",
        ]),
        ".config/plugins/recent-files-obsidian/data.json": JSON.stringify({
          updateOn: "file-edit",
          recentFiles: [{ path: "Programs/Only edited.md" }],
        }),
      },
    });

    const data = await buildDashboardData(app, SETTINGS);

    expect(data.recent.map((entry) => entry.path)).toEqual([
      "Programs/Actually opened.md",
    ]);
    expect(data.recentMode).toBe("viewed");
  });

  it("falls back to modified time within configured roots without usable history", async () => {
    const files = [
      file("Programs/Older.md", 20),
      file("Tasks/Newer.md", 100),
      file("Outside Roots/Newest but outside fallback.md", 500),
      file("Private/passwords/Unsafe.md", 1_000),
    ];
    const app = fakeApp(files, {
      lastOpenFiles: [
        "Anywhere/Missing.md",
        "Private/passwords/Unsafe.md",
      ],
      contents: {
        ".config/community-plugins.json": JSON.stringify([
          "recent-files-obsidian",
        ]),
        ".config/plugins/recent-files-obsidian/data.json": JSON.stringify({
          updateOn: "file-open",
          recentFiles: [{ path: "Anywhere/Also missing.md" }],
        }),
      },
    });

    const data = await buildDashboardData(app, SETTINGS);

    expect(data.recent.map((entry) => entry.path)).toEqual([
      "Tasks/Newer.md",
      "Programs/Older.md",
    ]);
    expect(data.recentMode).toBe("modified");
  });
});

function relativeDepth(path: string, root: string): number {
  return path.slice(root.length + 1).split("/").length;
}

function file(path: string, mtime: number): TFile {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.includes(".") ? name.split(".").at(-1) ?? "" : "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    extension,
    stat: { ctime: mtime - 1, mtime, size: 10 },
  } as TFile;
}

interface FakeAppOptions {
  lastOpenFiles?: string[];
  contents?: Record<string, string>;
}

function fakeApp(files: TFile[], options: FakeAppOptions = {}): App {
  const contents = options.contents ?? {};
  return {
    workspace: {
      getLastOpenFiles: () => options.lastOpenFiles ?? [],
    },
    vault: {
      configDir: ".config",
      getFiles: () => files,
      getAllLoadedFiles: () => files,
      cachedRead: async (target: TFile) => contents[target.path] ?? "",
      adapter: {
        exists: async (path: string) =>
          Object.prototype.hasOwnProperty.call(contents, path) ||
          [
            SETTINGS.programsFolder,
            SETTINGS.areasFolder,
            SETTINGS.peopleFolder,
            ...Object.values(SETTINGS.aiFolders),
          ].includes(path),
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
