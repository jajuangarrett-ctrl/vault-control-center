import type { ViewStateResult } from "obsidian";

export interface EmbeddedMarkdownView {
  readonly editor: {
    focus(): void;
    refresh(): void;
  };
  openIn(parent: HTMLElement): Promise<void>;
  closeEmbedded(): Promise<void>;
  setState(
    state: { file: string; mode: "source" },
    result: ViewStateResult
  ): Promise<void>;
}

/**
 * Owns one embedded Obsidian MarkdownView at a time. The request counter keeps
 * rapid file selections from finishing an older editor mount over a newer one.
 */
export class NativeMarkdownEditorSession {
  private currentView: EmbeddedMarkdownView | null = null;
  private currentPath = "";
  private closingPath = "";
  private requestId = 0;

  constructor(private readonly createView: () => EmbeddedMarkdownView) {}

  async mount(
    parent: HTMLElement,
    filePath: string,
    focus: boolean
  ): Promise<boolean> {
    const requestId = ++this.requestId;
    await this.closeCurrentView();
    if (requestId !== this.requestId) return false;

    const view = this.createView();
    this.currentView = view;
    this.currentPath = filePath;

    try {
      await view.openIn(parent);
      if (!this.isCurrent(requestId, view, filePath)) return false;
      await view.setState(
        { file: filePath, mode: "source" },
        {} as ViewStateResult
      );
      if (!this.isCurrent(requestId, view, filePath)) return false;
      view.editor.refresh();
      if (focus) view.editor.focus();
      return true;
    } catch (error) {
      if (this.currentView === view) {
        this.currentView = null;
        this.currentPath = "";
        await view.closeEmbedded();
      }
      throw error;
    }
  }

  isEditing(filePath: string): boolean {
    return Boolean(
      (this.currentView && this.currentPath === filePath) ||
      this.closingPath === filePath
    );
  }

  async dispose(): Promise<void> {
    this.requestId += 1;
    await this.closeCurrentView();
  }

  private async closeCurrentView(): Promise<void> {
    const view = this.currentView;
    const filePath = this.currentPath;
    this.currentView = null;
    this.currentPath = "";
    if (!view) return;
    this.closingPath = filePath;
    try {
      await view.closeEmbedded();
    } finally {
      if (this.closingPath === filePath) this.closingPath = "";
    }
  }

  private isCurrent(
    requestId: number,
    view: EmbeddedMarkdownView,
    filePath: string
  ): boolean {
    return (
      requestId === this.requestId &&
      view === this.currentView &&
      filePath === this.currentPath
    );
  }
}
