const PROVIDERS = [
  { pluginId: "fjg-file-focus-duo", command: "fjg-file-focus-duo:talk-to-vault", name: "FJG File Focus Duo", wideSince: "0.1.20" },
  { pluginId: "fjg-task-manager", command: "fjg-task-manager:talk-to-dashboard", name: "FJG Objective Manager", wideSince: "0.30.18" },
] as const;

type Provider = typeof PROVIDERS[number];
type Leaf = {
  getRoot(): unknown;
  getViewState(): { type: string; state?: { file?: unknown } };
  isDeferred?: boolean;
};
type Workspace<L extends Leaf> = {
  rootSplit: unknown;
  activeLeaf: L | null;
  iterateRootLeaves(callback: (leaf: L) => unknown): void;
  revealLeaf(leaf: L): Promise<void>;
  setActiveLeaf(leaf: L, options: { focus: false }): void;
};
type ProviderInfo = { version?: string; registered?: boolean };
type LaunchOptions = {
  wide: () => boolean;
  providerInfo(provider: Provider): ProviderInfo;
  execute(id: string): boolean;
};

export type TalkToVaultResult =
  | { outcome: "opened"; provider: Provider; suggestUpdate: boolean }
  | { outcome: "unavailable" | "failed" | "superseded" };

function hasWideSupport(version: string | undefined, minimum: string): boolean | undefined {
  const parsed = version?.match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[\w.-]+)?$/i);
  if (!parsed) return undefined;
  const candidate = parsed.slice(1).map(Number);
  const floor = minimum.split(".").map(Number);
  const firstDifference = candidate.findIndex((part, index) => part !== floor[index]);
  return firstDifference < 0 || candidate[firstDifference] > floor[firstDifference];
}

export function hasWideTalkToVaultWorkspace(container: HTMLElement | undefined): boolean {
  const root = container?.querySelector<HTMLElement>(":scope > .workspace-split.mod-root") ??
    container?.querySelector<HTMLElement>(".workspace-split.mod-root");
  const win = root?.ownerDocument.defaultView;
  // A layout-consuming pinned drawer reduces clientWidth. An overlay can
  // translate the root temporarily; the voice provider can dismiss that drawer.
  return !!root?.isConnected && !!win &&
    Math.min(root.clientWidth, win.visualViewport?.width ?? win.innerWidth) >= 720;
}

type Note<L> = { leaf: L; path: string };
type Handoff<L> = { origin: L; note: Note<L>; sawNote: boolean; interrupted: boolean };

/** Remember only a native Markdown tab that was actually active, never a vault history path. */
export class TalkToVaultHome<L extends Leaf> {
  private previousNote?: Note<L>;
  private handoff?: Handoff<L>;
  private pending = false;
  private disposed = false;

  constructor(private readonly workspace: Workspace<L>) {}

  rememberActiveLeaf(leaf: L | null): void {
    if (this.disposed) return;
    const handoff = this.handoff;
    if (handoff && leaf) {
      if (leaf === handoff.note.leaf) handoff.sawNote = true;
      else if (leaf !== handoff.origin || handoff.sawNote) handoff.interrupted = true;
    }
    if (!leaf || leaf !== this.workspace.activeLeaf) return;
    const path = this.nativeNotePath(leaf);
    if (path && this.isAttached(leaf)) this.previousNote = { leaf, path };
  }

  dispose(): void {
    this.disposed = true;
    this.previousNote = undefined;
    this.handoff = undefined;
  }

  async launch(origin: L, options: LaunchOptions): Promise<TalkToVaultResult> {
    if (this.pending || this.disposed) return { outcome: "superseded" };
    this.pending = true;
    try {
      const wide = options.wide();
      const candidates = PROVIDERS.map(provider => {
        const meta = options.providerInfo(provider);
        return { provider, meta, supportsWide: hasWideSupport(meta.version, provider.wideSince) };
      });
      const ready = wide ? candidates.filter(candidate => candidate.supportsWide === true && candidate.meta.registered === true) : [];
      const previous = this.previousNote;
      if (ready.length && previous && this.workspace.activeLeaf === origin && this.isExactNote(previous)) {
        const handoff: Handoff<L> = { origin, note: previous, sawNote: false, interrupted: false };
        this.handoff = handoff;
        let revealed = false;
        try {
          await this.workspace.revealLeaf(previous.leaf);
          revealed = true;
        } catch {
          // Keep the command usable if native reveal fails and Home remains active.
        }
        if (this.disposed || handoff.interrupted) return { outcome: "superseded" };
        const active = this.workspace.activeLeaf;
        if (active !== origin && (active !== previous.leaf || !this.isExactNote(previous))) {
          return { outcome: "superseded" };
        }
        if (revealed && active === origin && options.wide() && this.isExactNote(previous)) {
          // revealLeaf may select the tab without updating the active leaf on some layouts.
          // Do not focus an editor or request a keyboard.
          try {
            this.workspace.setActiveLeaf(previous.leaf, { focus: false });
          } catch {
            // Existing provider fallback still works if Home retains focus.
          }
          const selected = this.workspace.activeLeaf;
          if (handoff.interrupted || (selected !== origin && (selected !== previous.leaf || !this.isExactNote(previous)))) {
            return { outcome: "superseded" };
          }
        }
      }

      const nowWide = options.wide();
      const ordered = nowWide
        ? [...candidates.filter(candidate => candidate.supportsWide === true),
           ...candidates.filter(candidate => candidate.supportsWide !== true)]
        : candidates;
      for (const { provider, supportsWide } of ordered) {
        try {
          if (options.execute(provider.command)) {
            return { outcome: "opened", provider, suggestUpdate: nowWide && supportsWide === false };
          }
        } catch {
          // A throwing command may already have started opening. Do not start another provider.
          return { outcome: "failed" };
        }
      }
      return { outcome: "unavailable" };
    } finally {
      this.handoff = undefined;
      this.pending = false;
    }
  }

  private nativeNotePath(leaf: L): string | undefined {
    if (leaf.getRoot() !== this.workspace.rootSplit || leaf.isDeferred) return undefined;
    const view = leaf.getViewState();
    const path = view.type === "markdown" ? view.state?.file : undefined;
    return typeof path === "string" && path.toLowerCase().endsWith(".md") ? path : undefined;
  }

  private isAttached(candidate: L): boolean {
    let attached = false;
    this.workspace.iterateRootLeaves(leaf => { if (leaf === candidate) attached = true; });
    return attached;
  }

  private isExactNote(note: Note<L>): boolean {
    return this.isAttached(note.leaf) && this.nativeNotePath(note.leaf) === note.path;
  }
}
