export type PreviewKind =
  | "markdown"
  | "text"
  | "image"
  | "audio"
  | "video"
  | "pdf"
  | "native-fallback";

/** Largest UTF-8 text payload rendered directly inside the dashboard preview. */
export const PREVIEW_TEXT_SIZE_LIMIT = 1_048_576;

/** Hard ceiling for the dashboard's persisted preview history. */
export const PREVIEW_HISTORY_LIMIT = 30;

const MARKDOWN_EXTENSIONS = new Set(["md"]);
const TEXT_EXTENSIONS = new Set(["txt", "csv", "html", "json"]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
]);
const AUDIO_EXTENSIONS = new Set([
  "mp3",
  "wav",
  "m4a",
  "ogg",
  "oga",
  "flac",
  "aac",
  "opus",
]);
const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "mov",
  "webm",
  "ogv",
  "mkv",
]);

/**
 * Classifies a file extension for the in-dashboard preview. A bare extension,
 * dotted extension, or full vault path is accepted to keep call sites simple.
 */
export function classifyPreviewKind(extension: string): PreviewKind {
  const normalizedExtension = extractExtension(extension);
  if (MARKDOWN_EXTENSIONS.has(normalizedExtension)) return "markdown";
  if (TEXT_EXTENSIONS.has(normalizedExtension)) return "text";
  if (IMAGE_EXTENSIONS.has(normalizedExtension)) return "image";
  if (AUDIO_EXTENSIONS.has(normalizedExtension)) return "audio";
  if (VIDEO_EXTENSIONS.has(normalizedExtension)) return "video";
  if (normalizedExtension === "pdf") return "pdf";
  return "native-fallback";
}

/**
 * Adds one most-recent path without mutating the supplied history. Paths are
 * trimmed and slash-normalized, but `.` and `..` segments are deliberately not
 * resolved; the caller's allow-list remains the authority for vault safety.
 */
export function mergePreviewHistory(
  current: string[],
  nextPath: string,
  isAllowed: (path: string) => boolean = () => true,
  limit = PREVIEW_HISTORY_LIMIT
): string[] {
  const effectiveLimit = normalizeHistoryLimit(limit);
  if (effectiveLimit === 0) return [];

  const merged = [nextPath, ...current];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of merged) {
    const normalizedPath = normalizeHistoryPath(candidate);
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    if (!passesFilter(normalizedPath, isAllowed)) continue;

    seen.add(normalizedPath);
    result.push(normalizedPath);
    if (result.length >= effectiveLimit) break;
  }

  return result;
}

/**
 * Returns an Obsidian linkpath suitable for metadata-cache resolution. The
 * `data-href` value is preferred because Obsidian keeps the original link
 * target there, while external URLs and same-document anchors are ignored.
 */
export function parseInternalLinkTarget(
  href: string | null | undefined,
  dataHref?: string | null
): string | null {
  for (const candidate of [dataHref, href]) {
    const parsed = parseLinkCandidate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function extractExtension(input: string): string {
  const withoutQueryOrHash = input.trim().split(/[?#]/, 1)[0] ?? "";
  const filename = withoutQueryOrHash
    .replace(/\\/g, "/")
    .slice(withoutQueryOrHash.replace(/\\/g, "/").lastIndexOf("/") + 1);
  const dotIndex = filename.lastIndexOf(".");
  const extension = dotIndex >= 0 ? filename.slice(dotIndex + 1) : filename;
  return extension.trim().toLowerCase();
}

function normalizeHistoryPath(path: unknown): string {
  if (typeof path !== "string") return "";
  return path
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");
}

function normalizeHistoryLimit(limit: number): number {
  if (!Number.isFinite(limit)) return PREVIEW_HISTORY_LIMIT;
  return Math.max(
    0,
    Math.min(PREVIEW_HISTORY_LIMIT, Math.floor(limit))
  );
}

function passesFilter(
  path: string,
  isAllowed: (path: string) => boolean
): boolean {
  try {
    return isAllowed(path);
  } catch {
    return false;
  }
}

function parseLinkCandidate(candidate: string | null | undefined): string | null {
  if (typeof candidate !== "string") return null;

  let value = candidate.trim();
  if (!value || value.startsWith("#") || value.startsWith("?")) return null;

  value = decodeUriComponentSafely(value).trim();
  if (!value || value.startsWith("//")) return null;
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return null;

  if (value.startsWith("[[") && value.endsWith("]]")) {
    value = value.slice(2, -2).trim();
  }

  value = value.split("|", 1)[0] ?? "";
  value = value.split(/[?#]/, 1)[0] ?? "";
  value = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\.\//, "");

  return value && value !== "." ? value : null;
}

function decodeUriComponentSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
