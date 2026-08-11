import type { App, FileSystemAdapter, TAbstractFile, TFile } from "obsidian";
import {
  isExcludedPath,
  isSensitivePath,
  normalizeFileTitle,
  normalizeVaultPath,
  pathIsWithin,
} from "./data";

export const HTML_METADATA_READ_LIMIT = 256 * 1024;
export const HTML_METADATA_READ_CONCURRENCY = 4;
export const DEFAULT_HTML_THUMBNAIL_SIZE = 720;
export const DEFAULT_HTML_THUMBNAIL_CONCURRENCY = 2;
// macOS Quick Look's all-white HTML fallback is a 720px PNG below this size.
// Treat it as unusable so it cannot appear as an empty gallery card.
export const MIN_USABLE_HTML_THUMBNAIL_BYTES = 16 * 1024;
export const DEFAULT_HTML_THUMBNAIL_FOLDER =
  "Artifacts/Vault Control Center Native Plugin/runtime/html-gallery/thumbnails";

export interface HtmlGalleryError {
  path: string;
  message: string;
}

export interface HtmlGalleryItem {
  path: string;
  title: string;
  description: string;
  category: string;
  folder: string;
  folderPath: string;
  modifiedAt: number;
  size: number;
  sourceFile: TFile;
  thumbnailPath: string;
  thumbnailFile: TFile | null;
}

export interface HtmlGallerySnapshot {
  generatedAt: string;
  roots: string[];
  thumbnailFolder: string;
  scannedCount: number;
  excludedCount: number;
  errorCount: number;
  errors: HtmlGalleryError[];
  items: HtmlGalleryItem[];
}

export interface ParsedHtmlMetadata {
  title: string;
  description: string;
}

interface CachedHtmlMetadata {
  modifiedAt: number;
  size: number;
  metadata: ParsedHtmlMetadata;
}

export interface HtmlThumbnailCommandOptions {
  shell: false;
  timeout: number;
  maxBuffer: number;
  windowsHide: true;
}

export interface HtmlThumbnailRuntime {
  makeTempDirectory(prefix: string): Promise<string>;
  execFile(
    executable: string,
    args: readonly string[],
    options: HtmlThumbnailCommandOptions
  ): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  removeDirectory(path: string): Promise<void>;
  joinPath(...parts: string[]): string;
  baseName(path: string): string;
}

export interface GenerateHtmlThumbnailOptions {
  isDesktopMac: boolean;
  force?: boolean;
  concurrency?: number;
  size?: number;
  timeoutMs?: number;
  maxBufferBytes?: number;
  runtime?: HtmlThumbnailRuntime;
}

export interface HtmlThumbnailGenerationResult {
  status: "completed" | "unavailable";
  reason: string;
  attempted: number;
  generated: number;
  skipped: number;
  failed: number;
  errors: HtmlGalleryError[];
}

const DEVELOPMENT_SEGMENTS = new Set([
  "node modules",
  "src",
  "source",
  "build",
  "dist",
  "test",
  "tests",
]);

const QUEUE_SEGMENTS = new Set([
  "inbox",
  "owner inbox",
  "owner queue",
  "team inbox",
  "team queue",
]);

const TEMPLATE_SEGMENTS = new Set([
  "template",
  "templates",
  "codex skill",
]);

const POLICY_DASHBOARD_BOOTSTRAP = "artifacts/policy-dashboard/index.html";
const YOUTUBE_GLASSES_RUNTIME = "artifacts/youtube meta app/runtime/index.html";
const BLACKROCK_FUTURE_BUILDERS_PREFIX =
  "10 misc/funding opportunities/blackrock future builders/";
const HTML_METADATA_CACHES = new WeakMap<App, Map<string, CachedHtmlMetadata>>();

/**
 * Builds a live, read-only catalog of safe HTML files. A bad file contributes a
 * fallback card and an error instead of preventing the rest of the catalog.
 */
export async function buildHtmlGallerySnapshot(
  app: App,
  roots: string[],
  thumbnailFolder: string
): Promise<HtmlGallerySnapshot> {
  const normalizedRoots = normalizeRoots(roots);
  const errors: HtmlGalleryError[] = [];
  const requestedThumbnailFolder = normalizeVaultPath(thumbnailFolder);
  const normalizedThumbnailFolder = isSafeHtmlThumbnailFolder(
    requestedThumbnailFolder
  )
    ? requestedThumbnailFolder
    : DEFAULT_HTML_THUMBNAIL_FOLDER;
  if (normalizedThumbnailFolder !== requestedThumbnailFolder) {
    errors.push({
      path: "",
      message:
        `Configured thumbnail folder is empty or excluded. Using safe fallback ` +
        `“${DEFAULT_HTML_THUMBNAIL_FOLDER}”.`,
    });
  }
  const candidates: TFile[] = [];
  let scannedCount = 0;
  let excludedCount = 0;

  try {
    for (const file of app.vault.getFiles()) {
      if (!isHtmlFile(file)) continue;
      scannedCount += 1;
      const path = normalizeVaultPath(file.path);
      const withinConfiguredRoot = normalizedRoots.some((root) =>
        pathIsWithin(path, root)
      );
      if (!withinConfiguredRoot || shouldExcludeHtmlPath(path)) {
        excludedCount += 1;
        continue;
      }
      candidates.push(file);
    }
  } catch (error) {
    errors.push({ path: "", message: errorMessage(error) });
  }

  const itemSlots = new Array<HtmlGalleryItem | undefined>(candidates.length);
  const metadataErrors = new Array<HtmlGalleryError | undefined>(candidates.length);
  const metadataCache = htmlMetadataCache(app);
  await runWithConcurrency(
    candidates,
    HTML_METADATA_READ_CONCURRENCY,
    async (file, index): Promise<void> => {
      const path = normalizeVaultPath(file.path);
      const root = bestMatchingRoot(path, normalizedRoots);
      const thumbnailPath = stableHtmlThumbnailPath(
        path,
        normalizedThumbnailFolder
      );
      const fallbackTitle = normalizeFileTitle(file.name) || "Untitled HTML";
      const modifiedAt = finiteNumber(file.stat?.mtime);
      const size = finiteNumber(file.stat?.size);
      let metadata: ParsedHtmlMetadata = {
        title: fallbackTitle,
        description: "",
      };

      const cached = metadataCache.get(path);
      if (cached && cached.modifiedAt === modifiedAt && cached.size === size) {
        metadata = cached.metadata;
      } else {
        try {
          const html = await app.vault.read(file);
          metadata = parseHtmlMetadata(html, fallbackTitle);
          metadataCache.set(path, { modifiedAt, size, metadata });
        } catch (error) {
          metadataCache.delete(path);
          metadataErrors[index] = { path, message: errorMessage(error) };
        }
      }

      const thumbnailCandidate = asTFile(
        safeGetAbstractFile(app, thumbnailPath),
        "png"
      );
      const thumbnailFile = await usableHtmlThumbnailFile(app, thumbnailCandidate);
      const folderPath = parentPath(path);
      itemSlots[index] = {
        path,
        title: metadata.title,
        description: metadata.description,
        category: categoryLabel(root),
        folder: folderLabel(folderPath, root),
        folderPath,
        modifiedAt,
        size,
        sourceFile: file,
        thumbnailPath,
        thumbnailFile,
      };
    }
  );
  errors.push(...metadataErrors.filter(isDefined));
  const items = itemSlots.filter(isDefined);
  const currentPaths = new Set(candidates.map((file) => normalizeVaultPath(file.path)));
  for (const cachedPath of metadataCache.keys()) {
    if (!currentPaths.has(cachedPath)) metadataCache.delete(cachedPath);
  }

  return {
    generatedAt: new Date().toISOString(),
    roots: normalizedRoots,
    thumbnailFolder: normalizedThumbnailFolder,
    scannedCount,
    excludedCount,
    errorCount: errors.length,
    errors,
    items: sortHtmlGalleryItems(items),
  };
}

function htmlMetadataCache(app: App): Map<string, CachedHtmlMetadata> {
  let cache = HTML_METADATA_CACHES.get(app);
  if (!cache) {
    cache = new Map<string, CachedHtmlMetadata>();
    HTML_METADATA_CACHES.set(app, cache);
  }
  return cache;
}

export function shouldExcludeHtmlPath(path: string): boolean {
  const normalized = normalizeVaultPath(path);
  const lowerPath = normalized.toLocaleLowerCase();
  if (!normalized || isExcludedPath(normalized) || isSensitivePath(normalized)) {
    return true;
  }
  if (
    lowerPath === POLICY_DASHBOARD_BOOTSTRAP ||
    lowerPath === YOUTUBE_GLASSES_RUNTIME ||
    lowerPath.startsWith(BLACKROCK_FUTURE_BUILDERS_PREFIX)
  ) {
    return true;
  }

  const segments = normalized.split("/").filter(Boolean);
  const segmentKeys = segments.map(segmentKey);
  if (
    segmentKeys.some(
      (segment) =>
        segment === "archive" ||
        segment === "archived" ||
        DEVELOPMENT_SEGMENTS.has(segment) ||
        QUEUE_SEGMENTS.has(segment) ||
        TEMPLATE_SEGMENTS.has(segment) ||
        /^\d+ inbox$/.test(segment)
    )
  ) {
    return true;
  }

  const inspectionPath = segmentKeys.join("/");
  return (
    inspectionPath.includes("reusable html design system") ||
    inspectionPath.includes("design system source")
  );
}

export function parseHtmlMetadata(
  html: string,
  fallbackTitle = "Untitled HTML"
): ParsedHtmlMetadata {
  const capped = String(html ?? "").slice(0, HTML_METADATA_READ_LIMIT);
  const rawTitle = capped.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)?.[1] ?? "";
  const title = cleanMetadataText(rawTitle) || cleanMetadataText(fallbackTitle) || "Untitled HTML";
  let description = "";

  for (const tag of capped.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = parseHtmlAttributes(tag);
    const name = (attributes.name ?? attributes.property ?? "").toLocaleLowerCase();
    if (name !== "description" && name !== "og:description") continue;
    description = cleanMetadataText(attributes.content ?? "");
    if (description) break;
  }

  return { title, description };
}

export function decodeCommonHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return String(value ?? "").replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return named[name.toLocaleLowerCase()] ?? entity;
      const codePoint = Number.parseInt(decimal ?? hex ?? "", hex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return entity;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return entity;
      }
    }
  );
}

export function stableHtmlThumbnailPath(
  htmlPath: string,
  thumbnailFolder: string
): string {
  const normalizedPath = normalizeVaultPath(htmlPath);
  const requestedFolder = normalizeVaultPath(thumbnailFolder);
  const normalizedFolder = isSafeHtmlThumbnailFolder(requestedFolder)
    ? requestedFolder
    : DEFAULT_HTML_THUMBNAIL_FOLDER;
  const hash = `${hash32(normalizedPath, 0x811c9dc5)}${hash32(
    `thumbnail\0${normalizedPath}`,
    0x9e3779b9
  )}`;
  return normalizeVaultPath(`${normalizedFolder}/${hash}.png`);
}

export function isSafeHtmlThumbnailFolder(folder: string): boolean {
  const normalized = normalizeVaultPath(folder);
  return Boolean(
    normalized &&
      !shouldExcludeHtmlPath(`${normalized}/thumbnail-placeholder.html`)
  );
}

export function filterHtmlGalleryItems(
  items: readonly HtmlGalleryItem[],
  query = "",
  category = ""
): HtmlGalleryItem[] {
  const terms = String(query ?? "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const categoryKey = String(category ?? "").trim().toLocaleLowerCase();

  return sortHtmlGalleryItems(
    items.filter((item) => {
      if (categoryKey && item.category.toLocaleLowerCase() !== categoryKey) {
        return false;
      }
      if (terms.length === 0) return true;
      const haystack = [
        item.title,
        item.description,
        item.path,
        item.folder,
        item.category,
      ]
        .join("\n")
        .toLocaleLowerCase();
      return terms.every((term) => haystack.includes(term));
    })
  );
}

/**
 * Generates missing or stale Quick Look thumbnails locally. Node modules load
 * only after the explicit desktop-macOS guard passes.
 */
export async function generateHtmlThumbnails(
  app: App,
  items: readonly HtmlGalleryItem[],
  options: GenerateHtmlThumbnailOptions
): Promise<HtmlThumbnailGenerationResult> {
  if (!options.isDesktopMac) {
    return unavailableGenerationResult("Thumbnail generation is available on the desktop Mac only.");
  }

  const basePath = fileSystemAdapterBasePath(app);
  if (!basePath) {
    return unavailableGenerationResult("The vault is not using a local FileSystemAdapter.");
  }

  const unsafeDestination = items.find(
    (item) => !isSafeHtmlThumbnailFolder(parentPath(item.thumbnailPath))
  );
  if (unsafeDestination) {
    return unavailableGenerationResult(
      "Thumbnail generation is disabled because its destination folder is empty or excluded."
    );
  }

  let runtime: HtmlThumbnailRuntime;
  try {
    runtime = options.runtime ?? (await loadNodeThumbnailRuntime());
  } catch (error) {
    return unavailableGenerationResult(errorMessage(error));
  }

  const force = options.force === true;
  const pending = items.filter((item) =>
    force ||
    !item.thumbnailFile ||
    finiteNumber(item.thumbnailFile.stat?.mtime) < item.modifiedAt
  );
  const errors: HtmlGalleryError[] = [];
  let generated = 0;
  let failed = 0;
  const size = clampInteger(options.size, 240, 1600, DEFAULT_HTML_THUMBNAIL_SIZE);
  const timeout = clampInteger(options.timeoutMs, 1_000, 120_000, 30_000);
  const maxBuffer = clampInteger(
    options.maxBufferBytes,
    64 * 1024,
    16 * 1024 * 1024,
    2 * 1024 * 1024
  );
  const concurrency = clampInteger(
    options.concurrency,
    1,
    3,
    DEFAULT_HTML_THUMBNAIL_CONCURRENCY
  );

  // Prepare shared destinations before concurrent Quick Look work begins.
  // Otherwise two first-run workers can race while creating the same folder.
  try {
    const folders = [...new Set(pending.map((item) => parentPath(item.thumbnailPath)))];
    for (const folder of folders) {
      await ensureVaultFolder(app, folder);
    }
  } catch (error) {
    const message = `Thumbnail folder could not be prepared: ${errorMessage(error)}`;
    return {
      status: "completed",
      reason: "",
      attempted: pending.length,
      generated: 0,
      skipped: Math.max(0, items.length - pending.length),
      failed: pending.length,
      errors: pending.map((item) => ({ path: item.path, message })),
    };
  }

  await runWithConcurrency(pending, concurrency, async (item) => {
    let temporaryDirectory = "";
    try {
      temporaryDirectory = await runtime.makeTempDirectory("fjg-vcc-html-");
      const absoluteSourcePath = runtime.joinPath(basePath, item.path);
      const args = [
        "-t",
        "-s",
        String(size),
        "-o",
        temporaryDirectory,
        absoluteSourcePath,
      ] as const;
      await runtime.execFile("/usr/bin/qlmanage", args, {
        shell: false,
        timeout,
        maxBuffer,
        windowsHide: true,
      });
      const outputPath = runtime.joinPath(
        temporaryDirectory,
        `${runtime.baseName(absoluteSourcePath)}.png`
      );
      const bytes = await runtime.readFile(outputPath);
      const blankQuickLookPreview =
        bytes.byteLength < MIN_USABLE_HTML_THUMBNAIL_BYTES ||
        (await isVisuallyEmptyHtmlThumbnail(bytes));
      if (blankQuickLookPreview) {
        const generatedFallback = await createBrandedHtmlThumbnail(item.title);
        if (!generatedFallback) {
          throw new Error("Quick Look returned a blank thumbnail.");
        }
        await writeVaultBinary(app, item.thumbnailPath, generatedFallback);
        generated += 1;
        return;
      }
      await writeVaultBinary(app, item.thumbnailPath, bytes);
      generated += 1;
    } catch (error) {
      failed += 1;
      errors.push({ path: item.path, message: errorMessage(error) });
    } finally {
      if (temporaryDirectory) {
        try {
          await runtime.removeDirectory(temporaryDirectory);
        } catch (error) {
          errors.push({
            path: item.path,
            message: `Temporary thumbnail cleanup failed: ${errorMessage(error)}`,
          });
        }
      }
    }
  });

  return {
    status: "completed",
    reason: "",
    attempted: pending.length,
    generated,
    skipped: Math.max(0, items.length - pending.length),
    failed,
    errors,
  };
}

function isHtmlFile(file: TFile): boolean {
  const extension = String(file.extension ?? "").replace(/^\./, "").toLocaleLowerCase();
  return extension === "html" || /\.html$/i.test(String(file.path ?? ""));
}

function normalizeRoots(roots: readonly string[]): string[] {
  return [...new Set((roots ?? []).map(normalizeVaultPath).filter(Boolean))];
}

function bestMatchingRoot(path: string, roots: readonly string[]): string {
  return roots
    .filter((root) => pathIsWithin(path, root))
    .sort((left, right) => right.length - left.length)[0] ?? "";
}

function categoryLabel(root: string): string {
  const segment = normalizeVaultPath(root).split("/").filter(Boolean).pop() ?? "Vault";
  return segment.replace(/^\d+\s*[-_.]?\s*/, "").trim() || "Vault";
}

function folderLabel(folderPath: string, root: string): string {
  if (!folderPath || folderPath === root) return categoryLabel(root);
  return folderPath.split("/").filter(Boolean).pop() ?? categoryLabel(root);
}

function parentPath(path: string): string {
  const segments = normalizeVaultPath(path).split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

function segmentKey(segment: string): string {
  return segment
    .toLocaleLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanMetadataText(value: string): string {
  return decodeCommonHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of tag.matchAll(pattern)) {
    const key = match[1].toLocaleLowerCase();
    attributes[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function sortHtmlGalleryItems(items: readonly HtmlGalleryItem[]): HtmlGalleryItem[] {
  return [...items].sort(
    (left, right) =>
      right.modifiedAt - left.modifiedAt ||
      left.title.localeCompare(right.title) ||
      left.path.localeCompare(right.path)
  );
}

function hash32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  hash ^= value.length;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function safeGetAbstractFile(app: App, path: string): TAbstractFile | null {
  try {
    return app.vault.getAbstractFileByPath(path);
  } catch {
    return null;
  }
}

function asTFile(file: TAbstractFile | null, expectedExtension = ""): TFile | null {
  if (!file || typeof file !== "object") return null;
  const candidate = file as Partial<TFile>;
  if (typeof candidate.path !== "string" || typeof candidate.extension !== "string") {
    return null;
  }
  if (
    expectedExtension &&
    candidate.extension.replace(/^\./, "").toLocaleLowerCase() !== expectedExtension
  ) {
    return null;
  }
  return candidate as TFile;
}

async function usableHtmlThumbnailFile(app: App, file: TFile | null): Promise<TFile | null> {
  if (!file || finiteNumber(file.stat?.size) < MIN_USABLE_HTML_THUMBNAIL_BYTES) {
    return null;
  }
  try {
    const bytes = new Uint8Array(await app.vault.readBinary(file));
    return (await isVisuallyEmptyHtmlThumbnail(bytes)) ? null : file;
  } catch {
    // Leave an existing thumbnail visible when the device cannot inspect it.
    return file;
  }
}

/**
 * Detects Quick Look's visually empty HTML output instead of trusting PNG size.
 * Downsampling keeps this bounded while catching uniform near-white/near-pastel
 * canvases such as the GLBR and Administrator Collaborative previews.
 */
async function isVisuallyEmptyHtmlThumbnail(bytes: Uint8Array): Promise<boolean> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    return false;
  }
  let image: ImageBitmap | null = null;
  try {
    const data = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    image = await createImageBitmap(new Blob([data], { type: "image/png" }));
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0;
    let nearWhite = 0;
    let lowest = 255;
    let highest = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 32) continue;
      opaque += 1;
      const brightness =
        pixels[index] * 0.2126 + pixels[index + 1] * 0.7152 + pixels[index + 2] * 0.0722;
      lowest = Math.min(lowest, brightness);
      highest = Math.max(highest, brightness);
      if (brightness >= 220) nearWhite += 1;
    }
    return opaque > 0 && nearWhite / opaque >= 0.985 && highest - lowest < 42;
  } catch {
    return false;
  } finally {
    image?.close();
  }
}

/** Creates an offline, deterministic visual preview when Quick Look renders a page blank. */
async function createBrandedHtmlThumbnail(title: string): Promise<Uint8Array | null> {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 450;
    const context = canvas.getContext("2d");
    if (!context) return null;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#081b33");
    gradient.addColorStop(0.58, "#123d70");
    gradient.addColorStop(1, "#0f274a");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(255, 197, 40, 0.16)";
    context.beginPath();
    context.arc(630, 72, 150, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255, 255, 255, 0.08)";
    context.fillRect(44, 300, 632, 2);
    context.fillStyle = "#ffc528";
    context.fillRect(44, 66, 74, 8);
    context.fillStyle = "#f8f4e8";
    context.font = "700 15px system-ui, -apple-system, sans-serif";
    context.fillText("FJG VAULT · HTML ARTIFACT", 44, 112);
    context.fillStyle = "#ffffff";
    context.font = "700 38px system-ui, -apple-system, sans-serif";
    const words = String(title || "HTML artifact").split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width > 590 && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    lines.slice(0, 3).forEach((entry, index) => context.fillText(entry, 44, 175 + index * 52));
    context.fillStyle = "#c8d8ee";
    context.font = "500 18px system-ui, -apple-system, sans-serif";
    context.fillText("Local visual preview", 44, 350);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

function fileSystemAdapterBasePath(app: App): string | null {
  try {
    const adapter = app.vault.adapter as FileSystemAdapter;
    if (!adapter || typeof adapter.getBasePath !== "function") return null;
    const path = adapter.getBasePath();
    return typeof path === "string" && path.trim() ? path : null;
  } catch {
    return null;
  }
}

async function loadNodeThumbnailRuntime(): Promise<HtmlThumbnailRuntime> {
  const { execFile } = require("node:child_process") as typeof import("node:child_process");
  const fs = require("node:fs/promises") as typeof import("node:fs/promises");
  const os = require("node:os") as typeof import("node:os");
  const path = require("node:path") as typeof import("node:path");

  return {
    makeTempDirectory: (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix)),
    execFile: (executable, args, options) =>
      new Promise<void>((resolve, reject) => {
        execFile(executable, [...args], options, (error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
    readFile: async (filePath) => new Uint8Array(await fs.readFile(filePath)),
    removeDirectory: async (directoryPath) => {
      await fs.rm(directoryPath, { recursive: true, force: true });
    },
    joinPath: path.join,
    baseName: path.basename,
  };
}

async function writeVaultBinary(
  app: App,
  path: string,
  bytes: Uint8Array
): Promise<void> {
  const normalizedPath = normalizeVaultPath(path);
  if (!normalizedPath || isSensitivePath(normalizedPath)) {
    throw new Error("Invalid thumbnail path.");
  }
  await ensureVaultFolder(app, parentPath(normalizedPath));
  const existing = safeGetAbstractFile(app, normalizedPath);
  const data = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const existingFile = asTFile(existing);
  if (existingFile) {
    await app.vault.modifyBinary(existingFile, data);
    return;
  }
  if (existing) throw new Error("Thumbnail destination is not a file.");
  try {
    await app.vault.createBinary(normalizedPath, data);
  } catch (error) {
    // Another dashboard leaf may have created this exact deterministic path
    // after our initial lookup. Re-fetch and update only when it is now a file.
    const racedDestination = safeGetAbstractFile(app, normalizedPath);
    const racedFile = asTFile(racedDestination);
    if (racedFile) {
      await app.vault.modifyBinary(racedFile, data);
      return;
    }
    if (racedDestination) {
      throw new Error("Thumbnail destination is not a file.");
    }
    throw error;
  }
}

async function ensureVaultFolder(app: App, folderPath: string): Promise<void> {
  const segments = normalizeVaultPath(folderPath).split("/").filter(Boolean);
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = safeGetAbstractFile(app, current);
    if (existing) continue;
    try {
      await app.vault.createFolder(current);
    } catch (error) {
      // A second dashboard leaf may have created the shared folder between
      // lookup and creation. Treat that race as success, but preserve real
      // failures and file/folder collisions.
      const racedFolder = safeGetAbstractFile(app, current);
      if (!racedFolder || asTFile(racedFolder)) throw error;
    }
  }
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  work: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      const index = nextIndex;
      nextIndex += 1;
      await work(item, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
}

function unavailableGenerationResult(reason: string): HtmlThumbnailGenerationResult {
  return {
    status: "unavailable",
    reason,
    attempted: 0,
    generated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value as number)));
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error || "Unknown error");
}
