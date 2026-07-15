import { describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import {
  buildDashboardData,
  countMarkdownTasks,
  isExcludedPath,
  isSensitivePath,
  normalizeFileTitle,
  normalizeVaultPath,
  remapVaultPathAfterRename,
  parseBookmarks,
  pathIsWithin,
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

  it("maps direct file renames and files inside renamed folders", () => {
    expect(remapVaultPathAfterRename("Areas/A.md", "Areas/A.md", "Areas/B.md")).toBe(
      "Areas/B.md"
    );
    expect(
      remapVaultPathAfterRename(
        "Areas/Planning/Notes/A.md",
        "Areas/Planning",
        "Areas/Strategy"
      )
    ).toBe("Areas/Strategy/Notes/A.md");
  });

  it("does not remap siblings or invalid paths", () => {
    expect(
      remapVaultPathAfterRename("Areas/Planning-Old/A.md", "Areas/Planning", "Areas/New")
    ).toBeNull();
    expect(remapVaultPathAfterRename("Areas/A.md", "", "Areas/B.md")).toBeNull();
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
      { name: "Alpha", count: 3 },
      { name: "Beta", count: 1 },
    ]);
    expect(data.aiQueues.emailQueue.count).toBe(1);
    expect(data.aiQueues.formattedNotes.count).toBe(1);
    expect(data.aiQueues.ownerInbox.count).toBe(0);
    expect(data.aiQueues.teamInbox.count).toBe(1);
    expect(data.people.count).toBe(1);
    expect(data.recent[0].path).toBe("Programs/Alpha/Poster.png");
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

  it("groups every safe top-level Areas folder with its full nested inventory", async () => {
    const studentSupportFiles = Array.from({ length: 15 }, (_, index) =>
      file(
        `03 Areas/Student-Support/Department-Meetings/Record ${String(index + 1).padStart(2, "0")}.md`,
        index + 1
      )
    );
    const files = [
      ...studentSupportFiles,
      file("03 Areas/03 Areas.md", 110),
      file("03 Areas/Student-Support/Overview.md", 100),
      file("03 Areas/How-To/Obsidian/Guide.md", 90),
      file("03 Areas/How-To/Claude Code/Deep/Reference.pdf", 80),
      file("03 Areas/Reference/Job-Aids/Payroll.pdf", 70),
      file("03 Areas/Student-Support/Archived/Old.md", 1_000),
      file("03 Areas/Student-Support/Passwords/Account.md", 990),
      file("03 Areas/Passwords/Dashboard.md", 980),
      file("03 Areas/.private/Hidden.md", 970),
      file("03 Areas Archive/How-To/Outside.md", 960),
      file("03 Areas/Student-Support/Image.png", 950),
    ];

    const data = await buildDashboardData(fakeApp(files, {}), SETTINGS);

    expect(data.areasRoot).toMatchObject({
      name: "All Areas",
      path: "03 Areas",
      count: 21,
    });
    expect(data.areasRoot.files).toHaveLength(21);
    expect(data.areasRoot.files[0].path).toBe(
      "03 Areas/Student-Support/Image.png"
    );
    expect(data.areasRoot.files.every((entry) => entry.category === "areas")).toBe(
      true
    );

    expect(
      data.areas.map(({ name, path, count }) => ({ name, path, count }))
    ).toEqual([
      {
        name: "Student-Support",
        path: "03 Areas/Student-Support",
        count: 17,
      },
      { name: "How-To", path: "03 Areas/How-To", count: 2 },
      { name: "Reference", path: "03 Areas/Reference", count: 1 },
    ]);

    const studentSupport = data.areas.find(
      (area) => area.path === "03 Areas/Student-Support"
    );
    expect(studentSupport?.files).toHaveLength(17);
    expect(studentSupport?.files[0].path).toBe(
      "03 Areas/Student-Support/Image.png"
    );
    expect(studentSupport?.files.every((entry) => entry.category === "areas")).toBe(
      true
    );
    expect(JSON.stringify({ root: data.areasRoot, areas: data.areas })).not.toMatch(
      /Archived|Passwords|\.private|Areas Archive/
    );
    expect(data.sources.areasFolder).toEqual({
      path: "03 Areas",
      status: "available",
    });
  });

  it("does not cap the number of top-level Areas folders", async () => {
    const files = Array.from({ length: 20 }, (_, index) =>
      file(
        `03 Areas/Area ${String(index + 1).padStart(2, "0")}/Overview.md`,
        index + 1
      )
    );

    const data = await buildDashboardData(fakeApp(files, {}), SETTINGS);

    expect(data.areas).toHaveLength(20);
    expect(data.areas.map((area) => area.name)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `Area ${String(index + 1).padStart(2, "0")}`
      )
    );
    expect(data.areasRoot.count).toBe(20);
  });

  it("indexes safe empty Areas folders even when they contain no files", async () => {
    const data = await buildDashboardData(
      fakeApp(
        [file("03 Areas/Student-Support/Overview.md", 100)],
        {},
        true,
        [
          "03 Areas",
          "03 Areas/Empty Area",
          "03 Areas/Empty Area/Planning",
          "03 Areas/Student-Support",
          "03 Areas/Student-Support/Empty Branch",
          "03 Areas/Student-Support/Empty Branch/Next Level",
          "03 Areas/Passwords/Empty",
          "03 Areas/Student-Support/Archived/Empty",
          "03 Areas Archive/Outside",
        ]
      ),
      SETTINGS
    );

    expect(data.areas.map(({ name, count }) => ({ name, count }))).toEqual([
      { name: "Student-Support", count: 1 },
      { name: "Empty Area", count: 0 },
    ]);
    expect(data.areasRoot.folderPaths).toEqual([
      "03 Areas/Empty Area",
      "03 Areas/Empty Area/Planning",
      "03 Areas/Student-Support",
      "03 Areas/Student-Support/Empty Branch",
      "03 Areas/Student-Support/Empty Branch/Next Level",
    ]);
    expect(
      data.areas.find((area) => area.name === "Empty Area")?.folderPaths
    ).toEqual([
      "03 Areas/Empty Area",
      "03 Areas/Empty Area/Planning",
    ]);
  });

  it("returns empty data and source states when configured paths are missing", async () => {
    const app = fakeApp([], {}, false);
    const data = await buildDashboardData(app, SETTINGS);

    expect(data.programs).toEqual([]);
    expect(data.areas).toEqual([]);
    expect(data.areasRoot).toEqual({
      name: "All Areas",
      path: "03 Areas",
      count: 0,
      files: [],
      folderPaths: [],
    });
    expect(data.recent).toEqual([]);
    expect(data.bookmarks).toEqual([]);
    expect(data.tasks.total).toBe(0);
    expect(data.sources.programsFolder.status).toBe("missing");
    expect(data.sources.areasFolder.status).toBe("missing");
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
  foldersExist = true,
  folderPaths: string[] = []
): App {
  return {
    vault: {
      configDir: ".config",
      getFiles: () => files,
      getAllLoadedFiles: () => [
        ...folderPaths.map((path) => ({
          path,
          name: path.split("/").at(-1) ?? path,
          children: [],
        })),
        ...files,
      ],
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
