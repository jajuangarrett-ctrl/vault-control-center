import { TFile, type Vault } from "obsidian";
import { isRemoteMailPath, MAX_REMOTE_WIRE_BYTES, type RemoteMailStore } from "./mail-cache-remote";

export function makeRemoteMailVaultStore(vault: Vault): RemoteMailStore {
  async function read(path: string): Promise<string | null> {
    if (!isRemoteMailPath(path)) throw new Error("Unexpected control path");
    const file = vault.getAbstractFileByPath(path);
    if (file === null) return null;
    if (!(file instanceof TFile)) throw new Error("Control path collision");
    const stat = await vault.adapter.stat(path);
    if (stat?.type !== "file" || stat.size > MAX_REMOTE_WIRE_BYTES) throw new Error("Invalid control note");
    const content = await vault.read(file);
    if (file.path !== path || content.length > MAX_REMOTE_WIRE_BYTES) throw new Error("Control note changed");
    return content;
  }

  return {
    read,
    async write(path, previous, next) {
      if (!isRemoteMailPath(path) || next.length > MAX_REMOTE_WIRE_BYTES) throw new Error("Unexpected control note");
      const file = vault.getAbstractFileByPath(path);
      if (previous === null) {
        if (file !== null) throw new Error("Control note already exists");
        await vault.create(path, next);
        return;
      }
      if (!(file instanceof TFile) || await read(path) !== previous) throw new Error("Control note changed");
      await vault.process(file, (current) => {
        if (file.path !== path || current !== previous) throw new Error("Control note changed");
        return next;
      });
    },
  };
}
