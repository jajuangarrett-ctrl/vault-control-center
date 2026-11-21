import { TFile, type App } from "obsidian";
import { normalizeVaultPath } from "./data";
import {
  DEFAULT_HTML_THUMBNAIL_FOLDER,
  isSafeHtmlThumbnailFolder,
  stableHtmlThumbnailPath,
} from "./html-gallery";
import { isMobileHtmlPath } from "./mobile-html";

type CatalogProvider = {
  getHtmlCatalog(): Promise<unknown>;
  subscribeHtmlCatalog?: (onChange: () => void) => () => void;
};
type PluginApp = App & {
  plugins?: { getPlugin?: (id: string) => unknown; plugins?: Record<string, unknown> };
};

export interface CatalogPage {
  path: string;
  title: string;
  modifiedAt: number;
}
export interface CatalogSnapshot {
  status: "loading" | "unavailable" | "incompatible" | "error" | "ready";
  items: readonly CatalogPage[];
  missing: number;
  capped: boolean;
}
type ProviderState = { status: "ready"; provider: CatalogProvider } | { status: "unavailable" | "incompatible" };

const CATALOG_LIMIT = 10_000;
const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const PNG_MAX_EDGE = 1600;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

export function emptyCatalog(status: CatalogSnapshot["status"]): CatalogSnapshot {
  return { status, items: [], missing: 0, capped: false };
}

function readProvider(app: App): ProviderState {
  try {
    // Read the installed instance only. Never activate the plugin or read its files/settings.
    const registry = (app as PluginApp).plugins;
    const provider = registry?.getPlugin
      ? registry.getPlugin("html-viewer") : registry?.plugins?.["html-viewer"];
    if (!provider || typeof provider !== "object") return { status: "unavailable" };
    if (typeof (provider as Partial<CatalogProvider>).getHtmlCatalog !== "function") return { status: "incompatible" };
    return { status: "ready", provider: provider as CatalogProvider };
  } catch {
    return { status: "unavailable" };
  }
}

function safeCatalogPath(path: unknown): path is string {
  return typeof path === "string" && path.length <= 2048 && path === normalizeVaultPath(path)
    && /^.+\.html?$/i.test(path) && !/[\u0000-\u001F\u007F\\]/.test(path) && isMobileHtmlPath(path);
}

export function extractCatalogSnapshot(app: App, payload: unknown): CatalogSnapshot {
  if (!Array.isArray(payload)) return emptyCatalog("error");
  const seen = new Set<string>();
  const items: CatalogPage[] = [];
  let missing = 0;
  for (const entry of payload.slice(0, CATALOG_LIMIT)) {
    if (!entry || typeof entry !== "object" || !safeCatalogPath(entry.path) || seen.has(entry.path)) continue;
    const { path } = entry;
    seen.add(path);
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.path !== path || !/^html?$/i.test(file.extension)) {
      missing++;
      continue;
    }
    const title = typeof entry.title === "string"
      ? entry.title.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 200) : "";
    items.push({ path, title: title || file.basename || "Untitled HTML", modifiedAt: file.stat.mtime });
  }
  return { status: "ready", items, missing, capped: payload.length > CATALOG_LIMIT };
}

/** A visible VCC HTML tab follows the enabled plugin, without owning a vault index. */
export class HtmlViewerCatalogFeed {
  private provider?: CatalogProvider;
  private unsubscribe?: () => void;
  private inactive = true;
  private generation = 0;
  private status: CatalogSnapshot["status"] = "loading";

  constructor(private readonly app: App, private readonly publish: (catalog: CatalogSnapshot) => void) {}

  start(): void {
    this.inactive = false;
    void this.refresh();
  }

  stop(): void {
    this.inactive = true;
    this.generation++;
    this.disconnect();
    this.status = "loading";
  }

  reconcile(): void {
    if (this.inactive) return;
    const source = readProvider(this.app);
    if (source.status !== "ready" ? this.status !== source.status : this.provider !== source.provider) void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.inactive) return;
    const generation = ++this.generation;
    const source = readProvider(this.app);
    if (source.status !== "ready") {
      this.disconnect();
      this.set(emptyCatalog(source.status));
      return;
    }
    const provider = source.provider;
    if (provider !== this.provider) {
      this.disconnect();
      this.provider = provider;
      this.set(emptyCatalog("loading"));
      try {
        this.unsubscribe = provider.subscribeHtmlCatalog?.(() => {
          if (this.provider === provider && !this.inactive) void this.refresh();
        });
      } catch { /* Manual Refresh remains available. */ }
    }
    let snapshot: CatalogSnapshot;
    try {
      const payload = await provider.getHtmlCatalog();
      if (generation !== this.generation || this.inactive) return;
      snapshot = extractCatalogSnapshot(this.app, payload);
    } catch {
      snapshot = emptyCatalog("error");
    }
    if (generation !== this.generation || this.inactive) return;
    const current = readProvider(this.app);
    if (current.status !== "ready" || current.provider !== provider) { void this.refresh(); return; }
    this.set(snapshot);
  }

  private set(snapshot: CatalogSnapshot): void {
    this.status = snapshot.status;
    this.publish(snapshot);
  }

  private disconnect(): void {
    const unsubscribe = this.unsubscribe;
    this.provider = undefined;
    this.unsubscribe = undefined;
    try { unsubscribe?.(); } catch { /* A disabled source may already have torn down. */ }
  }
}

/** Only bundled, precomputed raster bytes are used. No URL or markup comes from HTML Viewer. */
export async function readLocalCatalogThumbnail(app: App, path: string, folder: string): Promise<string | null> {
  if (!safeCatalogPath(path)) return null;
  const safeFolder = isSafeHtmlThumbnailFolder(folder) ? folder : DEFAULT_HTML_THUMBNAIL_FOLDER;
  const thumbnailPath = stableHtmlThumbnailPath(path, safeFolder);
  const file = app.vault.getAbstractFileByPath(thumbnailPath);
  if (!(file instanceof TFile) || file.path !== thumbnailPath || file.extension.toLowerCase() !== "png"
      || file.stat.size < 33 || file.stat.size > THUMBNAIL_MAX_BYTES) return null;
  const fingerprint = { size: file.stat.size, modifiedAt: file.stat.mtime };
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    if (
      app.vault.getAbstractFileByPath(thumbnailPath) !== file || fingerprint.modifiedAt !== file.stat.mtime
      || fingerprint.size !== file.stat.size || fingerprint.size !== bytes.length || !hasBoundedPngHeader(bytes)
    ) return null;
    const parts: string[] = [];
    for (let i = 0; i < bytes.length; i += 0x4000) {
      parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x4000)));
    }
    return "data:image/png;base64," + btoa(parts.join(""));
  } catch {
    return null;
  }
}

export function hasBoundedPngHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 33 || bytes.length > THUMBNAIL_MAX_BYTES
      || !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
      || bytes[12] !== 73 || bytes[13] !== 72 || bytes[14] !== 68 || bytes[15] !== 82) return false;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16);
  const height = header.getUint32(20);
  return header.getUint32(8) === 13 && width > 0 && height > 0 && width <= PNG_MAX_EDGE && height <= PNG_MAX_EDGE;
}
