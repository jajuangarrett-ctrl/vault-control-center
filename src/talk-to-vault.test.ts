import { describe, expect, it, vi } from "vitest";
import { TalkToVaultHome } from "./talk-to-vault";

const duo = "fjg-file-focus-duo:talk-to-vault";
const objectives = "fjg-task-manager:talk-to-dashboard";
const root = {};
const makeLeaf = (type: string, path = "", host = root) => ({
  type, path, isDeferred: false,
  getRoot: () => host,
  getViewState() { return { type: this.type, state: { file: this.path } }; },
});
type Leaf = ReturnType<typeof makeLeaf>;

function fixture() {
  const home = makeLeaf("fjg-vault-control-center");
  const note = makeLeaf("markdown", "previous.md");
  const other = makeLeaf("markdown", "other.md");
  const sidebar = makeLeaf("markdown", "sidebar.md", {});
  const leaves = [home, note, other, sidebar];
  const workspace = {
    rootSplit: root, activeLeaf: home as Leaf,
    iterateRootLeaves: (callback: (leaf: Leaf) => unknown) => leaves.filter(leaf => leaf.getRoot() === root).forEach(callback),
    revealLeaf: vi.fn(async (_leaf: Leaf) => {}),
    setActiveLeaf: vi.fn((leaf: Leaf, _opts: { focus: false }) => { workspace.activeLeaf = leaf; }),
  };
  const launcher = new TalkToVaultHome(workspace);
  const active = (leaf: Leaf) => { workspace.activeLeaf = leaf; launcher.rememberActiveLeaf(leaf); };
  const visitHome = () => { active(note); active(home); };
  const registered = new Set([duo, objectives]);
  const versions: Record<string, string | undefined> = { [duo]: "0.1.20", [objectives]: "0.30.18" };
  let wide = true;
  const dispatched: string[] = [];
  const options = {
    wide: () => wide,
    providerInfo: ({ command }: { command: string }) => ({ version: versions[command], registered: registered.has(command) }),
    execute: vi.fn((id: string) => {
      if (!registered.has(id)) return false;
      dispatched.push(id);
      return true;
    }),
  };
  return { home, note, other, sidebar, workspace, leaves, active, visitHome, registered, versions, options, dispatched,
    launcher, launch: () => launcher.launch(home, options), setWide: (value: boolean) => { wide = value; } };
}

describe("Talk to Vault Home launch", () => {
  it("reveals and selects the exact existing native note before one updated provider", async () => {
    const f = fixture();
    f.visitHome();
    f.options.execute.mockImplementationOnce((id) => {
      expect(id).toBe(duo);
      expect(f.workspace.activeLeaf).toBe(f.note);
      return true;
    });
    expect(await f.launch()).toMatchObject({ outcome: "opened", provider: { command: duo }, suggestUpdate: false });
    expect(f.workspace.revealLeaf).toHaveBeenCalledExactlyOnceWith(f.note);
    expect(f.workspace.setActiveLeaf).toHaveBeenCalledExactlyOnceWith(f.note, { focus: false });
    expect(f.options.execute).toHaveBeenCalledTimes(1);
  });

  it("prefers updated Objective Manager over outdated Duo only on a wide mobile workspace", async () => {
    const f = fixture();
    f.versions[duo] = "0.1.19";
    f.versions[objectives] = "v0.30.18";
    f.visitHome();
    await f.launch();
    expect(f.dispatched).toEqual([objectives]);
    expect(f.workspace.activeLeaf).toBe(f.note);
    f.active(f.home);
    f.setWide(false);
    await f.launch();
    expect(f.dispatched).toEqual([objectives, duo]);
    expect(f.workspace.activeLeaf).toBe(f.home);
  });

  it("falls back to an available legacy provider without reveal, with an update hint", async () => {
    const f = fixture();
    f.versions[objectives] = "0.30.17";
    f.registered.delete(duo);
    f.visitHome();
    expect(await f.launch()).toMatchObject({ outcome: "opened", provider: { command: objectives }, suggestUpdate: true });
    expect(f.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(f.dispatched).toEqual([objectives]);
  });

  it("retains unknown provider compatibility without assuming side-by-side support", async () => {
    const f = fixture();
    f.versions[duo] = undefined;
    f.versions[objectives] = undefined;
    f.visitHome();
    expect(await f.launch()).toMatchObject({ outcome: "opened", provider: { command: duo }, suggestUpdate: false });
    expect(f.workspace.revealLeaf).not.toHaveBeenCalled();
  });

  it("does not open another file on cold launch, after detachment, or after the prior state changes", async () => {
    for (const change of ["cold", "detach", "replace", "defer", "sidebar"]) {
      const f = fixture();
      if (change === "sidebar") { f.active(f.sidebar); f.active(f.home); }
      else if (change !== "cold") f.visitHome();
      if (change === "detach") f.leaves.splice(f.leaves.indexOf(f.note), 1);
      if (change === "replace") f.note.path = "new.md";
      if (change === "defer") f.note.isDeferred = true;
      expect(await f.launch()).toMatchObject({ outcome: "opened" });
      expect(f.workspace.revealLeaf).not.toHaveBeenCalled();
      expect(f.workspace.activeLeaf).toBe(f.home);
    }
  });

  it("stays on Home and runs the provider when the existing note fails to reveal", async () => {
    const f = fixture();
    f.visitHome();
    f.workspace.revealLeaf.mockRejectedValueOnce(new Error("Native reveal refused"));
    expect(await f.launch()).toMatchObject({ outcome: "opened" });
    expect(f.workspace.setActiveLeaf).not.toHaveBeenCalled();
    expect(f.workspace.activeLeaf).toBe(f.home);
  });

  it("ignores repeated Home taps during a delayed reveal and calls the provider once after it settles", async () => {
    const f = fixture();
    f.visitHome();
    let finish!: () => void;
    f.workspace.revealLeaf.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.launch();
    expect(await f.launch()).toEqual({ outcome: "superseded" });
    expect(f.dispatched).toEqual([]);
    finish();
    expect(await first).toMatchObject({ outcome: "opened" });
    expect(f.workspace.revealLeaf).toHaveBeenCalledTimes(1);
    expect(f.dispatched).toEqual([duo]);
  });

  it("does not force an old note or launch if the user changes tabs during delayed reveal", async () => {
    const f = fixture();
    f.visitHome();
    let finish!: () => void;
    f.workspace.revealLeaf.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.launch();
    f.active(f.other);
    finish();
    expect(await first).toEqual({ outcome: "superseded" });
    expect(f.workspace.activeLeaf).toBe(f.other);
    expect(f.workspace.setActiveLeaf).not.toHaveBeenCalled();
    expect(f.options.execute).not.toHaveBeenCalled();
  });

  it("fails closed without revealing the note when no provider is registered", async () => {
    const f = fixture();
    f.visitHome();
    f.registered.clear();
    expect(await f.launch()).toEqual({ outcome: "unavailable" });
    expect(f.workspace.revealLeaf).not.toHaveBeenCalled();
    expect(f.dispatched).toEqual([]);
  });

  it("does not start a second provider if the first may already have opened", async () => {
    const f = fixture();
    f.options.execute.mockImplementationOnce(() => { throw new Error("Provider failed"); });
    expect(await f.launch()).toEqual({ outcome: "failed" });
    expect(f.options.execute).toHaveBeenCalledExactlyOnceWith(duo);
  });
});
