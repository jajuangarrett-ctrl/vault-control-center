import { describe, expect, it, vi } from "vitest";
import { TFile, type App } from "obsidian";
import { extractCatalogSnapshot, hasBoundedPngHeader, HtmlViewerCatalogFeed, readLocalCatalogThumbnail } from "./html-viewer-catalog";
import { DEFAULT_HTML_THUMBNAIL_FOLDER, stableHtmlThumbnailPath } from "./html-gallery";

vi.mock("obsidian", () => ({ TFile: class {} }));

function fixtureFile(path: string, size = 0): TFile {
  return Object.assign(new TFile(), {
    path, basename: path.split("/").at(-1)!.replace(/\.[^.]+$/, ""),
    extension: path.split(".").at(-1)!, stat: { mtime: 1000, size },
  });
}
function appFixture() {
  const selected = fixtureFile("Work/z-page.HTM");
  const second = fixtureFile("Work/a-page.html");
  const excluded = fixtureFile("Work/ignored.html");
  const thumbnails = new Map<string, TFile>();
  const files = new Map([selected, second, excluded].map((file) => [file.path, file]));
  const readBinary = vi.fn();
  const getFiles = vi.fn(() => Array.from(files.values()));
  const getAbstractFileByPath = vi.fn((path: string) => files.get(path) ?? thumbnails.get(path) ?? null);
  const getPlugin = vi.fn<(id: string) => unknown>();
  const app = { plugins: { getPlugin }, vault: { getAbstractFileByPath, getFiles, readBinary } } as unknown as App;
  return { app, selected, second, excluded, thumbnails, readBinary, getFiles, getAbstractFileByPath, getPlugin };
}

describe("HTML Viewer catalog feed", () => {
  it("consumes the actual API entry shape in source order and never rescans the vault", () => {
    const { app, selected, second, getFiles, getAbstractFileByPath, readBinary } = appFixture();
    const snapshot = extractCatalogSnapshot(app, [
      { path: selected.path, title: "Z page" }, { path: second.path, title: "<img onerror=example>" },
      { path: selected.path, title: "Duplicate" }, { path: "Work/local.txt", title: "Not HTML" },
      { path: "https://example.com/page.html", title: "External" },
      { path: "Work/../private.html", title: "Traversal" },
      { path: ".obsidian/plugins/secret.html", title: "Hidden" },
      { path: "Work/Not synced.html", title: "Absent" },
    ]);
    expect(snapshot.status).toBe("ready");
    expect(snapshot.items.map(({ path, title }) => ({ path, title }))).toEqual([
      { path: selected.path, title: "Z page" }, { path: second.path, title: "<img onerror=example>" },
    ]);
    expect(snapshot.missing).toBe(1);
    expect(getAbstractFileByPath.mock.calls).toEqual([[selected.path], [second.path], ["Work/Not synced.html"]]);
    expect(getFiles).not.toHaveBeenCalled();
    expect(readBinary).not.toHaveBeenCalled();
  });

  it("handles disabled, old, malformed and failed providers without a fallback", async () => {
    const { app, getPlugin, getFiles } = appFixture();
    const publish = vi.fn();
    const feed = new HtmlViewerCatalogFeed(app, publish);
    feed.start();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "unavailable", items: [] });
    getPlugin.mockReturnValue({ getHtmlFiles: vi.fn() });
    feed.reconcile();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "incompatible", items: [] });
    getPlugin.mockReturnValue({ getHtmlCatalog: async () => ({ pages: [] }) });
    await feed.refresh();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "error", items: [] });
    getPlugin.mockReturnValue({ getHtmlCatalog: vi.fn().mockRejectedValue(new Error("offline")) });
    await feed.refresh();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "error", items: [] });
    expect(getFiles).not.toHaveBeenCalled();
    feed.stop();
  });

  it("uses provider subscription to clear exclusions, and drops stale responses on refresh or disable", async () => {
    const { app, getPlugin, selected, second } = appFixture();
    const publish = vi.fn();
    const feed = new HtmlViewerCatalogFeed(app, publish);
    let notify!: () => void;
    let releaseOld!: (payload: unknown) => void;
    let releaseDisabled!: (payload: unknown) => void;
    const unsubscribe = vi.fn();
    const getHtmlCatalog = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { releaseOld = resolve; }))
      .mockResolvedValueOnce([{ path: second.path, title: "Still visible" }])
      .mockImplementationOnce(() => new Promise((resolve) => { releaseDisabled = resolve; }));
    getPlugin.mockReturnValue({ getHtmlCatalog, subscribeHtmlCatalog: (callback: () => void) => { notify = callback; return unsubscribe; } });
    feed.start();
    notify();
    await vi.waitFor(() => expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "ready", items: [{ path: second.path }] }));
    releaseOld([{ path: selected.path, title: "Excluded" }]);
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0].items).toHaveLength(1);
    expect(publish.mock.lastCall?.[0].items[0].path).toBe(second.path);
    notify();
    getPlugin.mockReturnValue(undefined);
    feed.reconcile();
    expect(unsubscribe).toHaveBeenCalledOnce();
    releaseDisabled([{ path: selected.path, title: "Stale" }]);
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0]).toMatchObject({ status: "unavailable", items: [] });
    const reads = getHtmlCatalog.mock.calls.length;
    feed.stop();
    notify();
    expect(getHtmlCatalog).toHaveBeenCalledTimes(reads);
  });
});

const png = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr4sAAAAASUVORK5CYII=", "base64",
));

describe("HTML listing local raster gate", () => {
  it("skips missing and oversized PNGs without reading anything", async () => {
    const { app, selected, thumbnails, readBinary } = appFixture();
    const path = stableHtmlThumbnailPath(selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER);
    expect(await readLocalCatalogThumbnail(app, selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER)).toBeNull();
    thumbnails.set(path, fixtureFile(path, 3 * 1024 * 1024));
    expect(await readLocalCatalogThumbnail(app, selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER)).toBeNull();
    expect(readBinary).not.toHaveBeenCalled();
  });

  it("matches only the page’s own local PNG path and never returns executable markup", async () => {
    const { app, selected, thumbnails, readBinary } = appFixture();
    const path = stableHtmlThumbnailPath(selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER);
    const raster = fixtureFile(path, png.length);
    thumbnails.set(path, raster);
    readBinary.mockResolvedValue(png.slice().buffer);
    expect(await readLocalCatalogThumbnail(app, selected.path, ".obsidian")).toMatch(/^data:image\/png;base64,/);
    expect(readBinary).toHaveBeenCalledExactlyOnceWith(raster);
    const markedUp = new TextEncoder().encode("<svg onload='example'>".padEnd(png.length));
    readBinary.mockResolvedValue(markedUp.buffer);
    expect(await readLocalCatalogThumbnail(app, selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER)).toBeNull();
  });

  it("rejects huge dimensions and an async read of a replaced raster", async () => {
    const { app, selected, thumbnails, readBinary } = appFixture();
    const oversizedRaster = png.slice();
    new DataView(oversizedRaster.buffer).setUint32(16, 100_000);
    expect(hasBoundedPngHeader(oversizedRaster)).toBe(false);
    expect(hasBoundedPngHeader(png)).toBe(true);
    const path = stableHtmlThumbnailPath(selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER);
    thumbnails.set(path, fixtureFile(path, png.length));
    readBinary.mockImplementation(async () => {
      thumbnails.set(path, fixtureFile(path, png.length));
      return png.slice().buffer;
    });
    expect(await readLocalCatalogThumbnail(app, selected.path, DEFAULT_HTML_THUMBNAIL_FOLDER)).toBeNull();
  });
});
