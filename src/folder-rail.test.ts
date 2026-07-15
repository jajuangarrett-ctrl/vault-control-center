import { describe, expect, it, vi } from "vitest";

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

import { VaultControlCenterView } from "./view";

interface FolderRailViewInternals {
  route: string;
  rootEl: HTMLElement | null;
  data: unknown;
  folderRailCollapsed: boolean;
  syncFolderRailAttribute: () => void;
  renderContext: () => {
    setFolderRailCollapsed: (collapsed: boolean) => void;
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

    internals.route = "recent";
    internals.syncFolderRailAttribute();
    expect(root.getAttribute("data-folder-rail-collapsed")).toBeNull();
  });
});

function makeView(): VaultControlCenterView {
  return new VaultControlCenterView(
    { app: { vault: { getAbstractFileByPath: () => null } } } as never,
    { settings: {} } as never
  );
}
