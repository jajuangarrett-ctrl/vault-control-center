import type { TFile, WorkspaceLeaf } from "obsidian";

export interface ReusableFileLeafWorkspace {
  getLeaf(newLeaf: "tab"): WorkspaceLeaf;
  iterateAllLeaves(callback: (leaf: WorkspaceLeaf) => unknown): void;
  revealLeaf(leaf: WorkspaceLeaf): Promise<void>;
}

export interface ReusableFileLeafOpenOptions {
  expectedViewType?: string;
}

export type ReusableFileLeafOpenResult = "opened" | "superseded";

export class ReusableFileLeafController {
  private currentLeaf: WorkspaceLeaf | null = null;
  private latestRequestId = 0;
  private openQueue: Promise<void> = Promise.resolve();

  constructor(private readonly workspace: ReusableFileLeafWorkspace) {}

  openFile(
    file: TFile,
    options: ReusableFileLeafOpenOptions = {}
  ): Promise<ReusableFileLeafOpenResult> {
    const requestId = ++this.latestRequestId;
    const operation = this.openQueue.then(
      () => this.performOpen(file, options, requestId),
      () => this.performOpen(file, options, requestId)
    );
    this.openQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async performOpen(
    file: TFile,
    options: ReusableFileLeafOpenOptions,
    requestId: number
  ): Promise<ReusableFileLeafOpenResult> {
    if (requestId !== this.latestRequestId) return "superseded";
    const leaf = resolveReusableFileLeaf(this.workspace, this.currentLeaf);
    this.currentLeaf = leaf;
    try {
      await leaf.openFile(file);
    } catch (error) {
      if (requestId !== this.latestRequestId) return "superseded";
      throw error;
    }
    if (requestId !== this.latestRequestId) return "superseded";
    if (
      options.expectedViewType &&
      leaf.getViewState().type !== options.expectedViewType
    ) {
      throw new Error(`Obsidian did not open the registered ${options.expectedViewType} view.`);
    }
    await this.workspace.revealLeaf(leaf);
    return requestId === this.latestRequestId ? "opened" : "superseded";
  }

  reset(): void {
    this.latestRequestId += 1;
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
