import { describe, expect, it } from "vitest";
import type { DashboardFileItem, DashboardProgram } from "./data";
import {
  buildProgramFolderView,
  programFolderMatchesNavigationQuery,
  programMatchesNavigationQuery,
  resolveProgramFolderPath,
} from "./program-navigation";

const AREA_PATH = "03 Areas/Student-Support";

describe("Areas recursive folder navigation", () => {
  it("keeps safe direct root files available through the synthetic All Areas root", () => {
    const areasRoot: DashboardProgram = {
      name: "All Areas",
      path: "03 Areas",
      count: 4,
      files: [
        areaFile("03 Areas/03 Areas.md", 500),
        areaFile(`${AREA_PATH}/Overview.md`, 400),
        areaFile("03 Areas/How-To/Obsidian/Guide.md", 300),
        areaFile("03 Areas/Passwords/Dashboard.md", 900),
      ],
    };

    const root = buildProgramFolderView(areasRoot, "03 Areas");
    expect(root.breadcrumbs).toEqual([
      { name: "All Areas", path: "03 Areas" },
    ]);
    expect(root.files.map((entry) => entry.path)).toEqual([
      "03 Areas/03 Areas.md",
    ]);
    expect(root.folders.map(({ name, path, count }) => ({ name, path, count }))).toEqual([
      {
        name: "How-To",
        path: "03 Areas/How-To",
        count: 1,
      },
      {
        name: "Student-Support",
        path: AREA_PATH,
        count: 1,
      },
    ]);
    expect(root.count).toBe(3);
    expect(JSON.stringify(root)).not.toContain("Passwords");
  });

  it("drills from an Area through deep subfolders while keeping direct files separate", () => {
    const area = makeArea([
      areaFile(`${AREA_PATH}/Overview.md`, 50),
      areaFile(`${AREA_PATH}/Department-Meetings/Status.md`, 500),
      areaFile(
        `${AREA_PATH}/Department-Meetings/Managers/2026/July.md`,
        900
      ),
      areaFile(`${AREA_PATH}/Equity-Oversight/Plan.md`, 300),
    ]);

    const root = buildProgramFolderView(area, AREA_PATH);
    expect(root.breadcrumbs).toEqual([
      { name: "Student-Support", path: AREA_PATH },
    ]);
    expect(root.files.map((entry) => entry.path)).toEqual([
      `${AREA_PATH}/Overview.md`,
    ]);
    expect(root.folders).toEqual([
      {
        name: "Department-Meetings",
        path: `${AREA_PATH}/Department-Meetings`,
        count: 2,
        latestModifiedAt: 900,
      },
      {
        name: "Equity-Oversight",
        path: `${AREA_PATH}/Equity-Oversight`,
        count: 1,
        latestModifiedAt: 300,
      },
    ]);

    const managers = buildProgramFolderView(
      area,
      `${AREA_PATH}/Department-Meetings/Managers`
    );
    expect(managers.parentPath).toBe(`${AREA_PATH}/Department-Meetings`);
    expect(managers.folders).toEqual([
      {
        name: "2026",
        path: `${AREA_PATH}/Department-Meetings/Managers/2026`,
        count: 1,
        latestModifiedAt: 900,
      },
    ]);

    const deepest = buildProgramFolderView(
      area,
      `${AREA_PATH}/Department-Meetings/Managers/2026`
    );
    expect(deepest.breadcrumbs.map((crumb) => crumb.name)).toEqual([
      "Student-Support",
      "Department-Meetings",
      "Managers",
      "2026",
    ]);
    expect(deepest.files.map((entry) => entry.path)).toEqual([
      `${AREA_PATH}/Department-Meetings/Managers/2026/July.md`,
    ]);
  });

  it("keeps deep search ancestors visible without exposing excluded matches", () => {
    const area = makeArea([
      areaFile(
        `${AREA_PATH}/Department-Meetings/Managers/2026/Needle Agenda.md`,
        500
      ),
      areaFile(`${AREA_PATH}/Equity-Oversight/Plan.md`, 200),
      areaFile(`${AREA_PATH}/Passwords/Needle Account.md`, 900),
      areaFile(`${AREA_PATH}/Archived/Needle Old.md`, 800),
    ]);
    const root = buildProgramFolderView(area, AREA_PATH);
    const departmentMeetings = root.folders.find(
      (folder) => folder.name === "Department-Meetings"
    );

    expect(programMatchesNavigationQuery(area, "Needle Agenda")).toBe(true);
    expect(programMatchesNavigationQuery(area, "Managers")).toBe(true);
    expect(programMatchesNavigationQuery(area, "Needle Account")).toBe(false);
    expect(programMatchesNavigationQuery(area, "Needle Old")).toBe(false);
    expect(departmentMeetings).toBeDefined();
    expect(
      programFolderMatchesNavigationQuery(
        area,
        departmentMeetings!,
        "Needle Agenda"
      )
    ).toBe(true);
    expect(JSON.stringify(root)).not.toMatch(/Passwords|Archived/);
  });

  it("rejects folder state outside the selected Area boundary", () => {
    const area = makeArea([
      areaFile(`${AREA_PATH}/Department-Meetings/Agenda.md`, 100),
    ]);

    expect(resolveProgramFolderPath(area, "03 Areas/How-To")).toBe(AREA_PATH);
    expect(
      resolveProgramFolderPath(area, "03 Areas/Student-Support-Archive")
    ).toBe(AREA_PATH);
    expect(resolveProgramFolderPath(area, `${AREA_PATH}/Passwords`)).toBe(
      AREA_PATH
    );
  });

  it("keeps empty folders and their empty descendants navigable", () => {
    const area: DashboardProgram = {
      name: "Student-Support",
      path: AREA_PATH,
      count: 0,
      files: [],
      folderPaths: [
        `${AREA_PATH}/Empty Branch`,
        `${AREA_PATH}/Empty Branch/Next Level`,
        `${AREA_PATH}/Passwords/Hidden Empty`,
        `${AREA_PATH}/Archived/Hidden Empty`,
      ],
    };

    const root = buildProgramFolderView(area, AREA_PATH);
    expect(root.folders).toEqual([
      {
        name: "Empty Branch",
        path: `${AREA_PATH}/Empty Branch`,
        count: 0,
        latestModifiedAt: 0,
      },
    ]);

    const emptyBranch = buildProgramFolderView(
      area,
      `${AREA_PATH}/Empty Branch`
    );
    expect(emptyBranch.folders).toEqual([
      {
        name: "Next Level",
        path: `${AREA_PATH}/Empty Branch/Next Level`,
        count: 0,
        latestModifiedAt: 0,
      },
    ]);
    expect(emptyBranch.files).toEqual([]);
    expect(
      resolveProgramFolderPath(area, `${AREA_PATH}/Empty Branch/Next Level`)
    ).toBe(`${AREA_PATH}/Empty Branch/Next Level`);
    expect(programMatchesNavigationQuery(area, "Next Level")).toBe(true);
    expect(
      programFolderMatchesNavigationQuery(
        area,
        root.folders[0],
        "Next Level"
      )
    ).toBe(true);
  });
});

function makeArea(files: DashboardFileItem[]): DashboardProgram {
  return {
    name: "Student-Support",
    path: AREA_PATH,
    count: files.length,
    files,
  };
}

function areaFile(path: string, modifiedAt: number): DashboardFileItem {
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
    category: "areas",
  };
}
