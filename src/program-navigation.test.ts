import { describe, expect, it } from "vitest";
import type {
  DashboardFileItem,
  DashboardProgram,
} from "./data";
import {
  buildProgramFolderView,
  resolveProgramFolderPath,
} from "./program-navigation";

const PROGRAM_PATH = "Programs/Alpha";

describe("program folder navigation", () => {
  it("drills through three or more levels using immediate folders and direct files", () => {
    const program = makeProgram([
      dashboardFile(`${PROGRAM_PATH}/Overview.md`, 50),
      dashboardFile(`${PROGRAM_PATH}/Reporting/Status.md`, 500),
      dashboardFile(`${PROGRAM_PATH}/Reporting/Quarterly/Q1.md`, 100),
      dashboardFile(`${PROGRAM_PATH}/Reporting/Quarterly/Q2.md`, 400),
      dashboardFile(`${PROGRAM_PATH}/Reporting/Quarterly/2026/July.md`, 900),
      dashboardFile(`${PROGRAM_PATH}/Events/Kickoff.md`, 300),
    ]);

    const root = buildProgramFolderView(program, PROGRAM_PATH);
    expect(root).toMatchObject({
      path: PROGRAM_PATH,
      parentPath: null,
      count: 6,
      latestModifiedAt: 900,
      breadcrumbs: [{ name: "Alpha", path: PROGRAM_PATH }],
    });
    expect(root.folders).toEqual([
      {
        name: "Reporting",
        path: `${PROGRAM_PATH}/Reporting`,
        count: 4,
        latestModifiedAt: 900,
      },
      {
        name: "Events",
        path: `${PROGRAM_PATH}/Events`,
        count: 1,
        latestModifiedAt: 300,
      },
    ]);
    expect(root.files.map((file) => file.path)).toEqual([
      `${PROGRAM_PATH}/Overview.md`,
    ]);

    const reporting = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Reporting`
    );
    expect(reporting).toMatchObject({
      path: `${PROGRAM_PATH}/Reporting`,
      parentPath: PROGRAM_PATH,
      count: 4,
      latestModifiedAt: 900,
      breadcrumbs: [
        { name: "Alpha", path: PROGRAM_PATH },
        { name: "Reporting", path: `${PROGRAM_PATH}/Reporting` },
      ],
    });
    expect(reporting.folders).toEqual([
      {
        name: "Quarterly",
        path: `${PROGRAM_PATH}/Reporting/Quarterly`,
        count: 3,
        latestModifiedAt: 900,
      },
    ]);
    expect(reporting.files.map((file) => file.path)).toEqual([
      `${PROGRAM_PATH}/Reporting/Status.md`,
    ]);

    const quarterly = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Reporting/Quarterly`
    );
    expect(quarterly.folders).toEqual([
      {
        name: "2026",
        path: `${PROGRAM_PATH}/Reporting/Quarterly/2026`,
        count: 1,
        latestModifiedAt: 900,
      },
    ]);
    expect(quarterly.files.map((file) => file.path)).toEqual([
      `${PROGRAM_PATH}/Reporting/Quarterly/Q2.md`,
      `${PROGRAM_PATH}/Reporting/Quarterly/Q1.md`,
    ]);

    const deepest = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Reporting/Quarterly/2026`
    );
    expect(deepest).toMatchObject({
      path: `${PROGRAM_PATH}/Reporting/Quarterly/2026`,
      parentPath: `${PROGRAM_PATH}/Reporting/Quarterly`,
      count: 1,
      latestModifiedAt: 900,
      breadcrumbs: [
        { name: "Alpha", path: PROGRAM_PATH },
        { name: "Reporting", path: `${PROGRAM_PATH}/Reporting` },
        {
          name: "Quarterly",
          path: `${PROGRAM_PATH}/Reporting/Quarterly`,
        },
        {
          name: "2026",
          path: `${PROGRAM_PATH}/Reporting/Quarterly/2026`,
        },
      ],
    });
    expect(deepest.folders).toEqual([]);
    expect(deepest.files.map((file) => file.path)).toEqual([
      `${PROGRAM_PATH}/Reporting/Quarterly/2026/July.md`,
    ]);
  });

  it("keeps more than twelve program files available and sorts by descendant activity", () => {
    const files = Array.from({ length: 15 }, (_, index) =>
      dashboardFile(
        `${PROGRAM_PATH}/Archive Set/Record ${String(index + 1).padStart(2, "0")}.md`,
        index + 1
      )
    );
    files.push(dashboardFile(`${PROGRAM_PATH}/Current/Now.md`, 100));
    const program = makeProgram(files);

    const root = buildProgramFolderView(program, PROGRAM_PATH);
    expect(root.count).toBe(16);
    expect(root.files).toEqual([]);
    expect(root.folders).toEqual([
      {
        name: "Archive Set",
        path: `${PROGRAM_PATH}/Archive Set`,
        count: 15,
        latestModifiedAt: 15,
      },
      {
        name: "Current",
        path: `${PROGRAM_PATH}/Current`,
        count: 1,
        latestModifiedAt: 100,
      },
    ]);

    const archive = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Archive Set`
    );
    expect(archive.count).toBe(15);
    expect(archive.files).toHaveLength(15);
    expect(archive.files[0].path).toBe(
      `${PROGRAM_PATH}/Archive Set/Record 15.md`
    );
    expect(archive.files.at(-1)?.path).toBe(
      `${PROGRAM_PATH}/Archive Set/Record 01.md`
    );
  });

  it("uses full paths to keep same-named folders in separate branches", () => {
    const program = makeProgram([
      dashboardFile(`${PROGRAM_PATH}/Events/2026/Plan.md`, 200),
      dashboardFile(`${PROGRAM_PATH}/Reporting/2026/Summary.md`, 300),
    ]);

    const events = buildProgramFolderView(program, `${PROGRAM_PATH}/Events`);
    const reporting = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Reporting`
    );

    expect(events.folders[0].path).toBe(`${PROGRAM_PATH}/Events/2026`);
    expect(reporting.folders[0].path).toBe(`${PROGRAM_PATH}/Reporting/2026`);
  });

  it("does not expose out-of-boundary, excluded, or sensitive paths", () => {
    const program = makeProgram([
      dashboardFile(`${PROGRAM_PATH}/Public/Allowed.md`, 100),
      dashboardFile(`${PROGRAM_PATH}/Tokenization Research/Notes.md`, 90),
      dashboardFile(`${PROGRAM_PATH}/Archived/Old.md`, 800),
      dashboardFile(`${PROGRAM_PATH}/.private/Hidden.md`, 700),
      dashboardFile(`${PROGRAM_PATH}/Passwords/Account.md`, 600),
      dashboardFile(`${PROGRAM_PATH}/Resources/api_keys.md`, 500),
      dashboardFile(`${PROGRAM_PATH}-Backup/Elsewhere.md`, 900),
      dashboardFile(`Programs/Beta/Other.md`, 1_000),
    ]);

    const root = buildProgramFolderView(program, PROGRAM_PATH);
    expect(root.count).toBe(2);
    expect(root.folders.map((folder) => folder.name)).toEqual([
      "Public",
      "Tokenization Research",
    ]);
    expect(JSON.stringify(root)).not.toMatch(
      /Archived|\.private|Passwords|api_keys|Backup|Beta/
    );

    expect(
      resolveProgramFolderPath(program, `${PROGRAM_PATH}-Backup`)
    ).toBe(PROGRAM_PATH);
    expect(resolveProgramFolderPath(program, "Programs/Beta")).toBe(
      PROGRAM_PATH
    );
    expect(
      resolveProgramFolderPath(program, `${PROGRAM_PATH}/Passwords`)
    ).toBe(PROGRAM_PATH);
  });

  it("falls back from stale paths to the nearest existing safe ancestor", () => {
    const program = makeProgram([
      dashboardFile(`${PROGRAM_PATH}/Reporting/Quarterly/Q1.md`, 100),
      dashboardFile(`${PROGRAM_PATH}/Overview.md`, 50),
    ]);

    expect(
      resolveProgramFolderPath(
        program,
        `${PROGRAM_PATH}/Reporting/Quarterly/Renamed/Deep`
      )
    ).toBe(`${PROGRAM_PATH}/Reporting/Quarterly`);
    expect(
      resolveProgramFolderPath(program, `${PROGRAM_PATH}/Removed Folder`)
    ).toBe(PROGRAM_PATH);
    expect(resolveProgramFolderPath(program, "")).toBe(PROGRAM_PATH);

    const view = buildProgramFolderView(
      program,
      `${PROGRAM_PATH}/Reporting/Quarterly/Renamed/Deep`
    );
    expect(view.path).toBe(`${PROGRAM_PATH}/Reporting/Quarterly`);
    expect(view.files.map((file) => file.path)).toEqual([
      `${PROGRAM_PATH}/Reporting/Quarterly/Q1.md`,
    ]);
  });
});

function makeProgram(files: DashboardFileItem[]): DashboardProgram {
  return {
    name: "Alpha",
    path: PROGRAM_PATH,
    count: files.length,
    files,
  };
}

function dashboardFile(path: string, modifiedAt: number): DashboardFileItem {
  const name = path.split("/").at(-1) ?? path;
  const extension = name.split(".").at(-1) ?? "";
  return {
    title: name.replace(/\.[^.]+$/, ""),
    name,
    path,
    extension,
    modifiedAt,
    createdAt: Math.max(0, modifiedAt - 1),
    size: 10,
    category: "programs",
  };
}
