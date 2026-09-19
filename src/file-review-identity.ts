import type { App, TFile } from "obsidian";

export interface ReviewIdentity { algorithm: "sha256"; digest: string; size: number }
export const IDENTITY_LIMITS = { fileBytes: 16 * 1024 * 1024, refreshBytes: 64 * 1024 * 1024, reads: 128, milliseconds: 1500 };
export function validIdentity(value: any): value is ReviewIdentity {
  return value?.algorithm === "sha256" && /^[a-f0-9]{64}$/.test(value.digest) &&
    Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= IDENTITY_LIMITS.fileBytes;
}
export const sameIdentity = (a: ReviewIdentity, b: ReviewIdentity) => a.size === b.size && a.digest === b.digest;
export const fileStamp = (file: TFile) => JSON.stringify([file.path, file.stat.size, file.stat.mtime, file.stat.ctime]);

/** Memory-only digest cache. Persist only identities of dashboard-listed outputs. */
export class ReviewIdentityIndex {
  private cache = new WeakMap<TFile, { stamp: string; identity: ReviewIdentity }>();
  private reads = 0;
  private bytes = 0;
  private started = 0;
  constructor(private app: App, private allowed: (path: string) => boolean) {}
  begin(): void { this.reads = 0; this.bytes = 0; this.started = Date.now(); }
  invalidate(file: TFile): void { this.cache.delete(file); }
  async fingerprint(file: TFile): Promise<ReviewIdentity | null> {
    if (!this.allowed(file.path) || this.app.vault.getAbstractFileByPath(file.path) !== file) return null;
    const stamp = fileStamp(file);
    const cached = this.cache.get(file);
    if (cached?.stamp === stamp) return cached.identity;
    const size = file.stat.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > IDENTITY_LIMITS.fileBytes ||
      this.reads >= IDENTITY_LIMITS.reads || this.bytes + size > IDENTITY_LIMITS.refreshBytes ||
      Date.now() - this.started >= IDENTITY_LIMITS.milliseconds) return null;
    this.reads++; this.bytes += size;
    try {
      const bytes = await this.app.vault.readBinary(file);
      const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      if (bytes.byteLength !== size || fileStamp(file) !== stamp || this.app.vault.getAbstractFileByPath(file.path) !== file) return null;
      const identity: ReviewIdentity = { algorithm: "sha256", size, digest: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") };
      this.cache.set(file, { stamp, identity });
      return identity;
    } catch { return null; }
  }
  private candidates(size: number): TFile[] {
    return (this.app.vault.getFiles?.() ?? []).filter(f => f.stat.size === size && this.allowed(f.path));
  }
  async find(identity: ReviewIdentity): Promise<{ file: TFile | null; state: string }> {
    const candidates = this.candidates(identity.size);
    const stamps = candidates.map(fileStamp);
    const matches: TFile[] = [];
    let incomplete = false;
    for (const file of candidates) {
      const value = await this.fingerprint(file);
      if (!value) incomplete = true;
      else if (sameIdentity(value, identity)) matches.push(file);
    }
    if (matches.length > 1) return { file: null, state: "Multiple identical files — use Locate file." };
    const current = this.candidates(identity.size);
    if (incomplete || current.length !== candidates.length || current.some((f, i) => f !== candidates[i] || fileStamp(f) !== stamps[i]))
      return { file: null, state: "Identity check incomplete — refresh to continue, or use Locate file." };
    return matches.length === 1 ? { file: matches[0], state: "Recovered by unique exact content" }
      : { file: null, state: "No exact content match — use Locate file." };
  }
}
