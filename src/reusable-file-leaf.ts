import type { TFile, WorkspaceLeaf } from "obsidian";

export interface ReusableFileLeafWorkspace {
  getLeaf(newLeaf: "tab"): WorkspaceLeaf;
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void;
  revealLeaf(leaf: WorkspaceLeaf): Promise<void>;
}

export class ReusableFileLeafController {
  private currentLeaf: WorkspaceLeaf | null = null;

  constructor(private readonly workspace: ReusableFileLeafWorkspace) {}

  async openFile(file: TFile): Promise<void> {
    const leaf = resolveReusableFileLeaf(this.workspace, this.currentLeaf);
    this.currentLeaf = leaf;
    await leaf.openFile(file);
    await this.workspace.revealLeaf(leaf);
  }

  reset(): void {
    this.currentLeaf = null;
  }
}

export function resolveReusableFileLeaf(
  workspace: ReusableFileLeafWorkspace,
  currentLeaf: WorkspaceLeaf | null
): WorkspaceLeaf {
  if (currentLeaf && isAttachedUnpinnedLeaf(workspace, currentLeaf)) {
    return currentLeaf;
  }

  return workspace.getLeaf("tab");
}

function isAttachedUnpinnedLeaf(
  workspace: ReusableFileLeafWorkspace,
  candidate: WorkspaceLeaf
): boolean {
  let attached = false;
  workspace.iterateAllLeaves((leaf) => {
    if (leaf === candidate) attached = true;
  });

  return attached && candidate.getViewState().pinned !== true;
}
