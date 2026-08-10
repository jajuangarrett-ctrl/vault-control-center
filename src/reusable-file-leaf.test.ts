import type { TFile, WorkspaceLeaf } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  ReusableFileLeafController,
  resolveReusableFileLeaf,
  type ReusableFileLeafWorkspace,
} from "./reusable-file-leaf";

describe("reusable file leaf", () => {
  it("opens and reveals consecutive files in the same editor tab", async () => {
    const openFile = vi.fn(async () => {});
    const createdLeaf = leaf(false, openFile);
    const attachedLeaves: WorkspaceLeaf[] = [];
    const getLeaf = vi.fn(() => {
      attachedLeaves.push(createdLeaf);
      return createdLeaf;
    });
    const revealLeaf = vi.fn(async () => {});
    const workspace = workspaceWith(attachedLeaves, getLeaf, revealLeaf);
    const controller = new ReusableFileLeafController(workspace);
    const firstFile = {} as TFile;
    const secondFile = {} as TFile;

    await expect(controller.openFile(firstFile)).resolves.toBe("opened");
    await expect(controller.openFile(secondFile)).resolves.toBe("opened");

    expect(getLeaf).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(openFile).toHaveBeenNthCalledWith(2, secondFile);
    expect(revealLeaf).toHaveBeenNthCalledWith(1, createdLeaf);
    expect(revealLeaf).toHaveBeenNthCalledWith(2, createdLeaf);
  });

  it("serializes rapid opens so an older request cannot replace the latest file", async () => {
    let finishFirst: (() => void) | undefined;
    const firstOpen = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const firstFile = { path: "First.html" } as TFile;
    const secondFile = { path: "Second.html" } as TFile;
    const openFile = vi.fn((file: TFile) =>
      file === firstFile ? firstOpen : Promise.resolve()
    );
    const createdLeaf = leaf(false, openFile, "html-viewer");
    const attachedLeaves: WorkspaceLeaf[] = [];
    const getLeaf = vi.fn(() => {
      attachedLeaves.push(createdLeaf);
      return createdLeaf;
    });
    const revealLeaf = vi.fn(async () => {});
    const controller = new ReusableFileLeafController(
      workspaceWith(attachedLeaves, getLeaf, revealLeaf)
    );

    const first = controller.openFile(firstFile, {
      expectedViewType: "html-viewer",
    });
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(firstFile));
    const second = controller.openFile(secondFile, {
      expectedViewType: "html-viewer",
    });
    finishFirst?.();

    await expect(first).resolves.toBe("superseded");
    await expect(second).resolves.toBe("opened");
    expect(openFile).toHaveBeenNthCalledWith(1, firstFile);
    expect(openFile).toHaveBeenNthCalledWith(2, secondFile);
    expect(revealLeaf).toHaveBeenCalledTimes(1);
    expect(revealLeaf).toHaveBeenCalledWith(createdLeaf);
  });

  it("rejects when the registered viewer did not accept the file", async () => {
    const createdLeaf = leaf(false, async () => {}, "empty");
    const attachedLeaves: WorkspaceLeaf[] = [];
    const getLeaf = vi.fn(() => {
      attachedLeaves.push(createdLeaf);
      return createdLeaf;
    });
    const revealLeaf = vi.fn(async () => {});
    const controller = new ReusableFileLeafController(
      workspaceWith(attachedLeaves, getLeaf, revealLeaf)
    );

    await expect(
      controller.openFile({} as TFile, { expectedViewType: "html-viewer" })
    ).rejects.toThrow("registered html-viewer view");
    expect(revealLeaf).not.toHaveBeenCalled();
  });

  it("creates one editor tab and reuses it while it remains attached", () => {
    const createdLeaf = leaf();
    const attachedLeaves: WorkspaceLeaf[] = [];
    const getLeaf = vi.fn(() => {
      attachedLeaves.push(createdLeaf);
      return createdLeaf;
    });
    const workspace = workspaceWith(attachedLeaves, getLeaf);

    const first = resolveReusableFileLeaf(workspace, null);
    const second = resolveReusableFileLeaf(workspace, first);

    expect(first).toBe(createdLeaf);
    expect(second).toBe(createdLeaf);
    expect(getLeaf).toHaveBeenCalledTimes(1);
    expect(getLeaf).toHaveBeenCalledWith("tab");
  });

  it("creates a replacement after the reusable tab is closed", () => {
    const closedLeaf = leaf();
    const replacementLeaf = leaf();
    const getLeaf = vi.fn(() => replacementLeaf);
    const workspace = workspaceWith([], getLeaf);

    expect(resolveReusableFileLeaf(workspace, closedLeaf)).toBe(replacementLeaf);
    expect(getLeaf).toHaveBeenCalledWith("tab");
  });

  it("does not overwrite a reusable tab that the user pinned", () => {
    const pinnedLeaf = leaf(true);
    const replacementLeaf = leaf();
    const getLeaf = vi.fn(() => replacementLeaf);
    const workspace = workspaceWith([pinnedLeaf], getLeaf);

    expect(resolveReusableFileLeaf(workspace, pinnedLeaf)).toBe(replacementLeaf);
    expect(getLeaf).toHaveBeenCalledWith("tab");
  });
});

function leaf(
  pinned = false,
  openFile: (file: TFile) => Promise<void> = async () => {},
  viewType = "markdown"
): WorkspaceLeaf {
  return {
    getViewState: () => ({ type: viewType, pinned }),
    openFile,
  } as unknown as WorkspaceLeaf;
}

function workspaceWith(
  attachedLeaves: WorkspaceLeaf[],
  getLeaf: (newLeaf: "tab") => WorkspaceLeaf,
  revealLeaf: (leaf: WorkspaceLeaf) => Promise<void> = async () => {}
): ReusableFileLeafWorkspace {
  return {
    getLeaf,
    iterateAllLeaves: (callback) => attachedLeaves.forEach(callback),
    revealLeaf,
  };
}
