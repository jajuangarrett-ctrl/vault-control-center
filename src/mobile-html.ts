import type { App, Component, TFile } from "obsidian";
import { isSensitivePath } from "./data";

export const MOBILE_HTML_BUILD = "0.3.19";

/** Native mobile can use a desktop-style layout; do not rely on UI mode alone. */
export function usesMobileHtmlViewer(platform: { isMobile?: boolean; isMobileApp?: boolean }): boolean {
  return platform.isMobileApp === true || platform.isMobile === true;
}

export const MOBILE_HTML_FILE_LIMIT = 8 * 1024 * 1024;
export const MOBILE_HTML_TOTAL_LIMIT = 32 * 1024 * 1024;
const STORAGE_LIMIT = 2 * 1024 * 1024;

export function isMobileHtmlPath(path: string): boolean {
  return /\.html?$/i.test(path) && isMobileResourcePath(path);
}

export function isMobileResourcePath(path: string): boolean {
  return Boolean(path) && !isSensitivePath(path) && !path.split("/").some(
    (part) => !part || part.startsWith(".") || part === "node_modules"
  );
}

/** Resolve browser-style local URLs without permitting access outside the vault. */
export function resolveHtmlResource(reference: string, sourcePath: string): string | null {
  const value = reference.trim();
  if (!value || value.startsWith("#") || value.startsWith("//") || /^[a-z][\w+.-]*:/i.test(value)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value.split(/[?#]/, 1)[0]); } catch { return null; }
  if (decoded.includes("\\") || /[\x00-\x1f]/.test(decoded)) return null;
  const parts = decoded.startsWith("/") ? [] : sourcePath.split("/").slice(0, -1);
  for (const part of decoded.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); }
    else parts.push(part);
  }
  const path = parts.join("/");
  return isMobileResourcePath(path) ? path : null;
}

export interface MobileHtmlSource {
  text(path: string): Promise<string>;
  binary(path: string): Promise<ArrayBuffer>;
  size(path: string): number | null;
}

export interface PreparedMobileHtml {
  document: Document;
  warnings: string[];
  bytes: number;
}

const MIME: Record<string, string> = {
  css: "text/css", js: "text/javascript", mjs: "text/javascript", json: "application/json",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", ico: "image/x-icon", avif: "image/avif",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  mp3: "audio/mpeg", mp4: "video/mp4", wav: "audio/wav", ogg: "audio/ogg",
};

function dataUrl(data: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(data);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}

function textUrl(value: string, mime: string): string {
  return dataUrl(new TextEncoder().encode(value).buffer as ArrayBuffer, mime);
}

async function replaceAsync(value: string, pattern: RegExp, replace: (match: RegExpExecArray) => Promise<string>): Promise<string> {
  let result = "", last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    result += value.slice(last, match.index) + await replace(match);
    last = match.index + match[0].length;
  }
  return result + value.slice(last);
}

/** Only prepares a transient copy. It never modifies an HTML file or its assets. */
export async function prepareMobileHtml(
  html: string, path: string, source: MobileHtmlSource,
  parser: DOMParser = new DOMParser(), isCurrent: () => boolean = () => true,
): Promise<PreparedMobileHtml> {
  let bytes = new TextEncoder().encode(html).length;
  if (bytes > MOBILE_HTML_FILE_LIMIT) throw new Error("This HTML file is too large for the mobile viewer (8 MB limit).");
  const warnings = new Set<string>();
  const counted = new Set([path]);
  const assets = new Map<string, string>();
  const check = (target: string) => {
    if (!isCurrent()) throw new Error("Preview closed.");
    const size = source.size(target);
    if (size === null) throw new Error(`Missing asset: ${target}`);
    if (size > MOBILE_HTML_FILE_LIMIT) throw new Error(`Asset exceeds the mobile size limit: ${target}`);
    if (!counted.has(target)) { bytes += size; counted.add(target); }
    if (bytes > MOBILE_HTML_TOTAL_LIMIT || counted.size > 256) throw new Error("This page exceeds the mobile asset limit (32 MB / 256 files).");
  };
  const resource = async (ref: string, owner: string): Promise<string> => {
    if (/^(?:https?:)?\/\//i.test(ref)) {
      warnings.add("Online resources need an internet connection.");
      return ref;
    }
    if (/^(?:data:|blob:|#)/i.test(ref)) return ref;
    const target = resolveHtmlResource(ref, owner);
    if (!target) { warnings.add(`Unsupported asset: ${ref.slice(0, 160)}`); return "data:,"; }
    if (assets.has(target)) return assets.get(target)!;
    try {
      check(target);
      const result = dataUrl(await source.binary(target), MIME[target.split(".").pop()!.toLowerCase()] || "application/octet-stream");
      assets.set(target, result);
      return result;
    } catch (error) { warnings.add(String((error as Error).message)); return "data:,"; }
  };
  const css = async (value: string, owner: string, ancestors: string[] = []): Promise<string> => {
    let result = await replaceAsync(value, /@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*([^;]*);/gi, async (m) => {
      if (/^(?:https?:)?\/\//i.test(m[1])) { warnings.add("Online resources need an internet connection."); return m[0]; }
      const target = resolveHtmlResource(m[1], owner);
      if (!target || ancestors.includes(target) || ancestors.length >= 12) { warnings.add("A CSS import could not be included."); return ""; }
      try {
        check(target);
        const imported = await css(await source.text(target), target, [...ancestors, target]);
        return m[2].trim() ? `@media ${m[2]} {${imported}}` : imported;
      } catch (error) { warnings.add((error as Error).message); return ""; }
    });
    result = await replaceAsync(result, /url\(\s*(["']?)(.*?)\1\s*\)/gi, async (m) => `url("${(await resource(m[2], owner)).replace(/"/g, "%22")}")`);
    return result;
  };
  const doc = parser.parseFromString(html, "text/html");
  if (doc.querySelector("base")) warnings.add("Custom base URLs are ignored; assets resolve from this file's folder.");
  doc.querySelectorAll("base, meta[http-equiv], link[rel='manifest'], link[rel='modulepreload'], link[rel='preload'], link[rel='prefetch']").forEach(el => el.remove());
  if (doc.querySelector("iframe, object, embed")) warnings.add("Embedded websites are unavailable in this viewer.");
  doc.querySelectorAll("iframe, object, embed").forEach(el => el.remove());
  for (const el of Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))) {
    const ref = el.getAttribute("href") || "";
    if (/^(?:https?:)?\/\//i.test(ref)) { warnings.add("Online resources need an internet connection."); continue; }
    const target = resolveHtmlResource(ref, path);
    try {
      if (!target) throw new Error(`Unsupported stylesheet: ${ref}`);
      check(target);
      el.setAttribute("href", textUrl(await css(await source.text(target), target, [target]), "text/css"));
      el.removeAttribute("integrity"); el.removeAttribute("crossorigin");
    } catch (error) { warnings.add((error as Error).message); el.remove(); }
  }
  for (const el of Array.from(doc.querySelectorAll("style, [style]"))) {
    if (el.tagName === "STYLE") el.textContent = await css(el.textContent || "", path);
    if (el.hasAttribute("style")) el.setAttribute("style", await css(el.getAttribute("style")!, path));
  }
  for (const el of Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"))) {
    const ref = el.getAttribute("src") || "";
    if (/^(?:https?:)?\/\//i.test(ref)) { warnings.add("Online resources need an internet connection."); continue; }
    const target = resolveHtmlResource(ref, path);
    try {
      if (!target) throw new Error(`Unsupported script: ${ref}`);
      check(target);
      const script = await source.text(target);
      if (/\.(jsx|tsx)$/i.test(target) || /\b(?:import|export)\s+[^;\n]*["']\.{1,2}\//.test(script)) {
        warnings.add("This page needs a compiled JavaScript bundle for mobile.");
      }
      el.setAttribute("src", textUrl(script, "text/javascript"));
      el.removeAttribute("integrity"); el.removeAttribute("crossorigin");
    } catch (error) { warnings.add((error as Error).message); el.remove(); }
  }
  for (const el of Array.from(doc.querySelectorAll("img, source, video, audio, input[type='image'], link[rel~='icon']"))) {
    for (const attr of ["src", "poster", "href"]) {
      if (el.hasAttribute(attr)) el.setAttribute(attr, await resource(el.getAttribute(attr)!, path));
    }
    // Use the first responsive candidate as a portable image; keep existing src if present.
    if (el.hasAttribute("srcset")) {
      const first = (el.getAttribute("srcset") || "").trim().split(/\s+/)[0].replace(/,$/, "");
      if (!el.hasAttribute("src")) el.setAttribute("src", await resource(first, path));
      el.removeAttribute("srcset");
    }
  }
  if (!doc.querySelector('meta[name="viewport"]')) {
    const viewport = doc.createElement("meta"); viewport.name = "viewport";
    viewport.content = "width=device-width, initial-scale=1"; doc.head.append(viewport);
  }
  return { document: doc, warnings: [...warnings], bytes };
}

// This function is serialized into an opaque-origin iframe. Keep it closure-free.
function mobileBootstrap(config: { channel: string; storage: Record<string, string> }): void {
  const send = (type: string, detail: Record<string, unknown>) => parent.postMessage({ channel: config.channel, type, ...detail }, "*");
  const storage = (initial: Record<string, string>, persist: boolean) => {
    const values = new Map(Object.entries(initial));
    const save = () => { if (persist) send("storage", { values: Array.from(values).reduce<Record<string, string>>((all, [key, value]) => { Object.defineProperty(all, key, { value, enumerable: true, configurable: true }); return all; }, {}) }); };
    return {
      get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(String(key)) ?? null,
      setItem: (key: string, value: string) => { values.set(String(key), String(value)); save(); },
      removeItem: (key: string) => { values.delete(String(key)); save(); },
      clear: () => { values.clear(); save(); },
    };
  };
  Object.defineProperty(window, "localStorage", { value: storage(config.storage, true) });
  Object.defineProperty(window, "sessionStorage", { value: storage({}, false) });
  const nativeFetch = window.fetch.bind(window);
  let next = 0;
  const pending = new Map<number, { resolve: (value: Response) => void; reject: (error: Error) => void; timer: number }>();
  window.addEventListener("message", event => {
    const msg = event.data;
    if (event.source !== parent || msg?.channel !== config.channel || msg.type !== "fetch-result") return;
    const request = pending.get(msg.id); if (!request) return;
    clearTimeout(request.timer); pending.delete(msg.id);
    if (msg.error) request.reject(new Error(msg.error));
    else request.resolve(new Response(msg.text, { status: 200, headers: { "Content-Type": msg.contentType } }));
  });
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (/^[a-z][\w+.-]*:|^\/\//i.test(url)) return nativeFetch(input, init);
    if ((init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase() !== "GET") return Promise.reject(new Error("Local mobile data is read-only."));
    return new Promise((resolve, reject) => {
      const id = ++next;
      const timer = window.setTimeout(() => { pending.delete(id); reject(new Error("Local data request timed out.")); }, 10000);
      pending.set(id, { resolve, reject, timer }); send("fetch", { id, url });
    });
  };
  document.addEventListener("click", event => {
    const anchor = (event.target as Element)?.closest?.("a[href]");
    const href = anchor?.getAttribute("href");
    if (!href || href.startsWith("#") || anchor?.hasAttribute("download")) return;
    if (/^(https?:|mailto:|tel:)/i.test(href)) { anchor!.setAttribute("target", "_blank"); anchor!.setAttribute("rel", "noopener noreferrer"); return; }
    event.preventDefault();
    if (!/^[a-z][\w+.-]*:|^\/\//i.test(href)) send("navigate", { url: href });
  }, true);
  window.addEventListener("error", () => send("page-error", {}));
  window.addEventListener("unhandledrejection", () => send("page-error", {}));
  window.addEventListener("DOMContentLoaded", () => send("ready", {}));
}

export async function renderMobileHtml(
  app: App, file: TFile, body: HTMLElement, session: Component,
  isCurrent: () => boolean, openHtml: (path: string) => void,
): Promise<void> {
  const find = (path: string): TFile | null => {
    if (!isMobileResourcePath(path)) return null;
    const found = app.vault.getAbstractFileByPath(path);
    return found && "stat" in found ? found as TFile : null;
  };
  const source: MobileHtmlSource = {
    size: path => find(path)?.stat.size ?? null,
    text: async path => { const target = find(path); if (!target) throw new Error(`Missing asset: ${path}`); return app.vault.read(target); },
    binary: async path => { const target = find(path); if (!target) throw new Error(`Missing asset: ${path}`); return app.vault.readBinary(target); },
  };
  if (file.stat.size > MOBILE_HTML_FILE_LIMIT) throw new Error("This HTML file exceeds the 8 MB mobile limit.");
  const prepared = await prepareMobileHtml(await app.vault.read(file), file.path, source, undefined, isCurrent);
  if (!isCurrent()) return;
  const ownerWindow = body.ownerDocument.defaultView!;
  const channel = `vcc-html-${crypto.randomUUID()}`;
  const storageKey = `fjg-vcc-mobile-html:${file.path}`;
  let saved: Record<string, string> = {};
  try { saved = JSON.parse(ownerWindow.localStorage.getItem(storageKey) || "{}"); } catch { /* isolated storage can be unavailable */ }
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
  const bootstrap = prepared.document.createElement("script");
  bootstrap.textContent = `(${mobileBootstrap.toString()})(${JSON.stringify({ channel, storage: saved }).replace(/</g, "\\u003c")});`;
  prepared.document.head.prepend(bootstrap);
  const policy = prepared.document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src data: blob: https: http:; script-src 'unsafe-inline' 'unsafe-eval' data: blob: https: http:; style-src 'unsafe-inline' data: blob: https: http:; connect-src data: blob: https: http:; frame-src 'none'; object-src 'none'; base-uri 'none'";
  prepared.document.head.prepend(policy);
  body.empty(); body.addClass("fjg-vcc-mobile-html");
  const status = body.createDiv({ cls: "fjg-vcc-mobile-html-status", attr: { role: "status" } });
  const showWarning = (message: string) => { status.hidden = false; status.textContent = message; };
  const message = prepared.warnings.length ? `Some features may be unavailable. ${prepared.warnings.slice(0, 3).join(" ")}` : "";
  status.textContent = message; status.hidden = !message;
  const frame = body.createEl("iframe", {
    cls: "fjg-vcc-mobile-html-frame",
    attr: { title: file.basename, sandbox: "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads", referrerpolicy: "no-referrer" },
  });
  frame.dataset.sourceRevision = `${file.path}:${file.stat.mtime}:${file.stat.size}`;
  let disposed = false, requests = 0;
  const readyTimer = ownerWindow.setTimeout(() => {
    if (!disposed && isCurrent()) showWarning("This page has not started. Reopen it after its support files finish syncing; this mobile browser may not support all of its features.");
  }, 10000);
  const listener = async (event: MessageEvent) => {
    if (disposed || !isCurrent() || event.source !== frame.contentWindow || event.data?.channel !== channel) return;
    const data = event.data;
    if (data.type === "ready") {
      ownerWindow.clearTimeout(readyTimer);
    } else if (data.type === "storage") {
      try {
        if (!data.values || typeof data.values !== "object" || Array.isArray(data.values)) return;
        if (Object.values(data.values).some(value => typeof value !== "string")) return;
        const json = JSON.stringify(data.values);
        if (json.length <= STORAGE_LIMIT) ownerWindow.localStorage.setItem(storageKey, json);
        else showWarning("This page's saved data exceeds the mobile limit. Recent edits may not persist.");
      } catch { showWarning("This page works, but this device could not save its changes."); }
    } else if (data.type === "navigate" && typeof data.url === "string") {
      const target = resolveHtmlResource(data.url, file.path);
      if (target && isMobileHtmlPath(target) && find(target)) openHtml(target);
      else showWarning("That linked file is not an available HTML page in this vault.");
    } else if (data.type === "page-error") {
      showWarning("Some page features could not run on mobile. This page may need a server, online connection, or a newer mobile browser.");
    } else if (data.type === "fetch" && typeof data.url === "string" && Number.isSafeInteger(data.id)) {
      const reply = (detail: Record<string, unknown>) => {
        if (!disposed && isCurrent()) frame.contentWindow?.postMessage({ channel, type: "fetch-result", id: data.id, ...detail }, "*");
      };
      try {
        // Limit page scripts to read-only data in the current package; never proxy network calls or writes.
        const target = resolveHtmlResource(data.url, file.path);
        const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
        if (!target || !target.startsWith(folder) || !/\.(json|csv|txt)$/i.test(target) || ++requests > 128) throw new Error("This local data request is unavailable in mobile preview.");
        const size = source.size(target);
        if (size === null || size > MOBILE_HTML_FILE_LIMIT) throw new Error("Local data is missing or exceeds the mobile limit.");
        reply({ text: await source.text(target), contentType: /\.json$/i.test(target) ? "application/json" : "text/plain" });
      } catch (error) { reply({ error: (error as Error).message }); showWarning("Some local page data is unavailable. Check that the page's support files have synced."); }
    }
  };
  ownerWindow.addEventListener("message", listener);
  session.register(() => { disposed = true; ownerWindow.clearTimeout(readyTimer); ownerWindow.removeEventListener("message", listener); frame.removeAttribute("srcdoc"); frame.src = "about:blank"; });
  frame.srcdoc = `<!DOCTYPE html>\n${prepared.document.documentElement.outerHTML}`;
}
