import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class MockItemView {
    app: unknown;

    constructor(leaf: { app?: unknown } = {}) {
      this.app = leaf.app;
    }

    getState(): Record<string, unknown> {
      return {};
    }

    async setState(): Promise<void> {}
  }

  return {
    Component: class {},
    ItemView: MockItemView,
    MarkdownRenderer: { render: vi.fn() },
    MarkdownView: class extends MockItemView {},
    Notice: class {},
    TFile: class {},
    TFolder: class {},
    Vault: class {},
    normalizePath: (path: string) => path,
    parseLinktext: (path: string) => ({ path, subpath: "" }),
    requestUrl: vi.fn(),
    setIcon: vi.fn(),
  };
});

import { TFolder } from "obsidian";
import type { DashboardData, DashboardFileItem, DashboardProgram } from "./data";
import { VaultControlCenterView } from "./view";

interface FolderRailViewInternals {
  route: string;
  rootEl: HTMLElement | null;
  data: unknown;
  folderRailCollapsed: boolean;
  searchInputEl: HTMLInputElement | null;
  renderState: {
    query: string;
    selectedAreaPath: string;
    selectedAreaFolderPath: string;
    selectedProgramPath: string;
    selectedProgramFolderPath: string;
  };
  syncFolderRailAttribute: () => void;
  currentFolderPath: () => string;
  canCopyCurrentFolderPath: () => boolean;
  copyCurrentFolderPath: (path?: string) => Promise<boolean>;
  renderContext: () => {
    setFolderRailCollapsed: (collapsed: boolean) => void;
    clearSearch: () => void;
    selectAreaFolder: (path: string) => void;
    selectProgramFolder: (path: string) => void;
    copyFolderPath: (path: string) => void;
  };
}

class AttributeHost {
  private readonly attributes = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

describe("folder rail state", () => {
  it("persists and restores the collapsed preference", async () => {
    const source = makeView();

    await source.setState({ route: "areas", folderRailCollapsed: true }, {} as never);
    const saved = source.getState();
    const restored = makeView();
    await restored.setState(saved, {} as never);

    expect(saved).toMatchObject({
      route: "areas",
      folderRailCollapsed: true,
    });
    expect(restored.getState()).toMatchObject({
      route: "areas",
      folderRailCollapsed: true,
    });

    await restored.setState({ folderRailCollapsed: false }, {} as never);
    expect(restored.getState().folderRailCollapsed).toBe(false);
  });

  it("synchronizes the collapsed layout attribute through the render context", () => {
    const view = makeView();
    const internals = view as unknown as FolderRailViewInternals;
    const root = new AttributeHost();
    internals.route = "areas";
    internals.rootEl = root as unknown as HTMLElement;
    internals.data = {};

    const context = internals.renderContext();
    context.setFolderRailCollapsed(true);

    expect(root.getAttribute("data-folder-rail-collapsed")).toBe("true");
    expect(view.getState().folderRailCollapsed).toBe(true);

    context.setFolderRailCollapsed(false);
    expect(root.getAttribute("data-folder-rail-collapsed")).toBeNull();
    expect(view.getState().folderRailCollapsed).toBe(false);
  });

  it("only applies the layout attribute on Areas and Programs routes", () => {
    const view = makeView();
    const internals = view as unknown as FolderRailViewInternals;
    const root = new AttributeHost();
    internals.rootEl = root as unknown as HTMLElement;
    internals.folderRailCollapsed = true;

    internals.route = "programs";
    internals.syncFolderRailAttribute();
    expect(root.getAttribute("data-folder-rail-collapsed")).toBe("true");

    internals.renderState.query = "cw";
    internals.syncFolderRailAttribute();
    expect(root.getAttribute("data-folder-rail-collapsed")).toBeNull();

    internals.renderState.query = "";
    internals.syncFolderRailAttribute();
    expect(root.getAttribute("data-folder-rail-collapsed")).toBe("true");

    internals.route = "recent";
    internals.syncFolderRailAttribute();
    expect(root.getAttribute("data-folder-rail-collapsed")).toBeNull();
  });

  it("clears search without changing the pre-search folder selection", () => {
    const view = makeView();
    const internals = view as unknown as FolderRailViewInternals;
    const focus = vi.fn();
    const searchInput = { value: "cw", focus } as unknown as HTMLInputElement;
    internals.data = {};
    internals.searchInputEl = searchInput;
    internals.renderState.query = "cw";
    internals.renderState.selectedAreaPath = "03 Areas/Recruitment";
    internals.renderState.selectedAreaFolderPath =
      "03 Areas/Recruitment/Hire CalWORKs - ISSP Counselor";
    internals.renderState.selectedProgramPath = "02 Programs/BSSP";
    internals.renderState.selectedProgramFolderPath = "02 Programs/BSSP/Events";

    internals.renderContext().clearSearch();

    expect(internals.renderState.query).toBe("");
    expect(searchInput.value).toBe("");
    expect(internals.renderState.selectedAreaPath).toBe("03 Areas/Recruitment");
    expect(internals.renderState.selectedAreaFolderPath).toBe(
      "03 Areas/Recruitment/Hire CalWORKs - ISSP Counselor"
    );
    expect(internals.renderState.selectedProgramPath).toBe("02 Programs/BSSP");
    expect(internals.renderState.selectedProgramFolderPath).toBe(
      "02 Programs/BSSP/Events"
    );
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});

describe("copy current folder path", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();

  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", {
      setTimeout: (callback: TimerHandler) => {
        if (typeof callback === "function") callback();
        return 1;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("copies the active Programs root, child, and breadcrumb parent as vault-relative paths", async () => {
    const program = folderRoot(
      "Rising Scholar Program",
      "02 Programs/Rising Scholar Program",
      [
        dashboardFile(
          "02 Programs/Rising Scholar Program/Overview.md",
          "programs"
        ),
        dashboardFile(
          "02 Programs/Rising Scholar Program/Grant Administration/Budget.md",
          "programs"
        ),
      ]
    );
    const data = dashboardData({ programs: [program] });
    const view = makeView(folderPaths(data));
    const internals = view as unknown as FolderRailViewInternals;
    internals.data = data;
    internals.route = "programs";
    internals.renderState.selectedProgramPath = program.path;
    internals.renderState.selectedProgramFolderPath = program.path;

    expect(internals.canCopyCurrentFolderPath()).toBe(true);
    expect(await internals.copyCurrentFolderPath()).toBe(true);

    const context = internals.renderContext();
    const child = `${program.path}/Grant Administration`;
    context.selectProgramFolder(child);
    expect(internals.currentFolderPath()).toBe(child);
    context.copyFolderPath(child);
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));

    context.selectProgramFolder(program.path);
    expect(internals.currentFolderPath()).toBe(program.path);
    expect(await internals.copyCurrentFolderPath()).toBe(true);

    expect(writeText.mock.calls.map(([path]) => path)).toEqual([
      program.path,
      child,
      program.path,
    ]);
    expect(writeText.mock.calls.flat().join("\n")).not.toContain("/Users/");
  });

  it("keeps the copied Areas path current after drilling down and returning to its parent", async () => {
    const area = folderRoot("Scheduling", "03 Areas/Scheduling", [
      dashboardFile("03 Areas/Scheduling/Calendar.md", "areas"),
      dashboardFile(
        "03 Areas/Scheduling/Academic Calendar/2026 Dates.md",
        "areas"
      ),
    ]);
    const data = dashboardData({ areas: [area] });
    const view = makeView(folderPaths(data));
    const internals = view as unknown as FolderRailViewInternals;
    internals.data = data;
    internals.route = "areas";
    internals.renderState.selectedAreaPath = area.path;
    internals.renderState.selectedAreaFolderPath = area.path;
    const context = internals.renderContext();

    const child = `${area.path}/Academic Calendar`;
    context.selectAreaFolder(child);
    expect(await internals.copyCurrentFolderPath()).toBe(true);

    context.selectAreaFolder(area.path);
    expect(await internals.copyCurrentFolderPath()).toBe(true);

    expect(writeText.mock.calls.map(([path]) => path)).toEqual([
      child,
      area.path,
    ]);
    expect(writeText.mock.calls.flat().join("\n")).not.toContain("/Users/");
  });

  it("rejects copying outside Areas or Programs and never writes an absolute path", async () => {
    const program = folderRoot(
      "Rising Scholar Program",
      "02 Programs/Rising Scholar Program",
      [dashboardFile("02 Programs/Rising Scholar Program/Overview.md", "programs")]
    );
    const data = dashboardData({ programs: [program] });
    const view = makeView(folderPaths(data));
    const internals = view as unknown as FolderRailViewInternals;
    internals.data = data;
    internals.route = "recent";
    internals.renderState.selectedProgramPath = program.path;
    internals.renderState.selectedProgramFolderPath = program.path;

    expect(internals.currentFolderPath()).toBe("");
    expect(internals.canCopyCurrentFolderPath()).toBe(false);
    expect(await internals.copyCurrentFolderPath()).toBe(false);
    expect(
      await internals.copyCurrentFolderPath(
        `/Users/franklingarrett/FJG Vault/${program.path}`
      )
    ).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });
});

function makeView(knownFolderPaths: ReadonlySet<string> = new Set()): VaultControlCenterView {
  const folder = Object.create(TFolder.prototype) as TFolder;
  return new VaultControlCenterView(
    {
      app: {
        vault: {
          getAbstractFileByPath: (path: string) =>
            knownFolderPaths.has(path) ? folder : null,
        },
      },
    } as never,
    { settings: {} } as never
  );
}

function folderRoot(
  name: string,
  path: string,
  files: DashboardFileItem[]
): DashboardProgram {
  return { name, path, count: files.length, files };
}

function dashboardFile(
  path: string,
  category: DashboardFileItem["category"]
): DashboardFileItem {
  const name = path.split("/").at(-1) ?? path;
  return {
    title: name.replace(/\.[^.]+$/, ""),
    name,
    path,
    extension: name.split(".").at(-1) ?? "",
    modifiedAt: 1,
    createdAt: 1,
    size: 1,
    category,
  };
}

function dashboardData({
  programs = [],
  areas = [],
}: {
  programs?: DashboardProgram[];
  areas?: DashboardProgram[];
}): DashboardData {
  const areasRoot = folderRoot(
    "All Areas",
    "03 Areas",
    areas.flatMap((area) => area.files)
  );
  return {
    programs,
    areas,
    areasRoot,
  } as DashboardData;
}

function folderPaths(data: DashboardData): ReadonlySet<string> {
  const paths = new Set<string>();
  for (const root of [data.areasRoot, ...data.areas, ...data.programs]) {
    paths.add(root.path);
    for (const file of root.files) {
      const segments = file.path.split("/");
      while (segments.length > 1) {
        segments.pop();
        paths.add(segments.join("/"));
      }
    }
  }
  return paths;
}
