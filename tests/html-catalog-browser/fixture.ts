// The synthetic provider runs HTML Viewer's real catalog service, not a duplicate implementation.
import { HtmlCatalog } from "html-viewer-test-catalog";
import { TFile } from "obsidian";
import { renderHtmlCatalog } from "../../src/html-catalog-renderer";
import { HtmlViewerCatalogFeed, emptyCatalog, readLocalCatalogThumbnail } from "../../src/html-viewer-catalog";
import { DEFAULT_HTML_THUMBNAIL_FOLDER, stableHtmlThumbnailPath } from "../../src/html-gallery";

const first = "Examples/01 Dashboard.html";
const second = "Examples/02 Checklist.htm";
const excluded = "Examples/Excluded.html";
const fake = "Examples/Fake.html";
const body = `<!doctype html><html><head><title>Unused</title></head><body>
  <h1>Example</h1><script>throw new Error("page script executed")</script><img src="https://example.com/not-a-raster">
  </body></html>`;
const source = new Map<string, string>([
  [first, body], [second, "<article><h2>Checklist</h2></article>"],
  [excluded, body], [fake, "Plain text posing as HTML"],
  ["Examples/Notes.txt", body], ...Array.from({ length: 32 }, (_, i) => [`Examples/Extra ${String(i).padStart(2, "0")}.html`, body] as const),
]);
const files = new Map([...source].map(([path, contents]) => [path, new TFile(path, contents.length)]));
const rasterPath = stableHtmlThumbnailPath(first, DEFAULT_HTML_THUMBNAIL_FOLDER);
const offscreen = document.createElement("canvas");
offscreen.width = 120;
offscreen.height = 72;
const ctx = offscreen.getContext("2d")!;
ctx.fillStyle = "#3444cc"; ctx.fillRect(0, 0, 120, 72);
ctx.fillStyle = "#fff"; ctx.font = "bold 20px system-ui"; ctx.fillText("Dashboard", 5, 30);
ctx.fillRect(6, 41, 104, 10); ctx.fillRect(6, 56, 65, 8);
const raster = Uint8Array.from(atob(offscreen.toDataURL().split(",")[1]), (byte) => byte.charCodeAt(0));
const rasterFile = new TFile(rasterPath, raster.length);
let disableFirst = false;
let providerActive = true;
let providerReads = 0;
let thumbnailReads = 0;
let consumerScans = 0;
let opened = "none";
let page = 0;
let disposeImages: (() => void) | undefined;
let snapshot = emptyCatalog("loading");
const query = document.querySelector<HTMLInputElement>("input")!;
const status = document.querySelector<HTMLOutputElement>("#status")!;
const shell = document.querySelector<HTMLElement>("#fixture")!;
const view = shell.querySelector<HTMLElement>(".fjg-vcc-route-view")!;
const report = () => { status.textContent = `Catalog source reads: ${providerReads} · Raster reads: ${thumbnailReads} · VCC scans: ${consumerScans} · Opened: ${opened}`; };

const service = new HtmlCatalog(
  () => [...files.values()],
  async (file: TFile) => { providerReads++; report(); return source.get(file.path)!; },
  (path: string) => path !== excluded && (!disableFirst || path !== first),
);
const provider = {
  getHtmlCatalog: () => service.get(),
  subscribeHtmlCatalog: (listener: () => void) => service.subscribe(listener),
};
const app = {
  plugins: { getPlugin: (id: string) => id === "html-viewer" && providerActive ? provider : null },
  vault: {
    getFiles: () => { consumerScans++; report(); return [...files.values()]; },
    getAbstractFileByPath: (path: string) => path === rasterPath ? rasterFile : files.get(path) ?? null,
    readBinary: async (file: TFile) => { thumbnailReads++; report(); if (file !== rasterFile) throw new Error("unexpected read"); return raster.slice().buffer; },
  },
};
const feed = new HtmlViewerCatalogFeed(app as never, (next) => { snapshot = next; render(); });
function render() {
  report();
  disposeImages?.();
  view.replaceChildren();
  disposeImages = renderHtmlCatalog(view, {
    catalog: snapshot, query: query.value, mobile: true, page, generating: false,
    onPage: (next) => { page = next; view.scrollTop = 0; render(); },
    refresh: () => void feed.refresh(),
    generate: () => { throw new Error("mobile generation not permitted"); },
    open: (path) => { opened = path; report(); },
    thumbnail: (path) => readLocalCatalogThumbnail(app as never, path, DEFAULT_HTML_THUMBNAIL_FOLDER),
  });
}
query.oninput = () => { page = 0; render(); };
document.querySelector<HTMLButtonElement>("#fold")!.onclick = () => { shell.dataset.wide = "false"; };
document.querySelector<HTMLButtonElement>("#unfold")!.onclick = () => { shell.dataset.wide = "true"; };
document.querySelector<HTMLButtonElement>("#exclude")!.onclick = () => { disableFirst = true; service.invalidate(first); };
document.querySelector<HTMLButtonElement>("#disable")!.onclick = () => { providerActive = false; feed.reconcile(); };
document.querySelector<HTMLButtonElement>("#enable")!.onclick = () => { providerActive = true; feed.reconcile(); };
feed.start();
