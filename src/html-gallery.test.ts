import type { App, TAbstractFile, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HTML_THUMBNAIL_FOLDER,
  HTML_METADATA_READ_CONCURRENCY,
  buildHtmlGallerySnapshot,
  decodeCommonHtmlEntities,
  filterHtmlGalleryItems,
  generateHtmlThumbnails,
  isSafeHtmlThumbnailFolder,
  parseHtmlMetadata,
  shouldExcludeHtmlPath,
  stableHtmlThumbnailPath,
  type HtmlGalleryItem,
  type HtmlThumbnailRuntime,
} from "./html-gallery";

describe("HTML gallery discovery", () => {
  it("includes configured HTML roots and mechanically excludes unsafe or development paths", async () => {
    const included = [
      file("Artifacts/Agent Mission Control/index.html", 500),
      file("02 Programs/Basic Needs/Dashboard.HTML", 400),
      file("03 Areas/Career/Overview.html", 300),
      file("10 Misc/Tool.html", 200),
      file("Wiki/Map.html", 100),
    ];
    const excluded = [
      file("Artifacts/.hidden/index.html", 900),
      file("Artifacts/Archive/Old.html", 900),
      file("Artifacts/Owner_Inbox/Private.html", 900),
      file("Artifacts/Reusable HTML Design System/starter.html", 900),
      file("Artifacts/Demo/src/index.html", 900),
      file("Artifacts/Policy-Dashboard/index.html", 900),
      file("03 Areas/private_keys/Secrets.html", 900),
      file("00 Inbox/Attachment.html", 900),
    ];
    const app = fakeApp([...included, ...excluded], {
      "Artifacts/Agent Mission Control/index.html": "<title>Mission Control</title>",
      "02 Programs/Basic Needs/Dashboard.HTML": "<title>Basic Needs</title>",
      "03 Areas/Career/Overview.html": "<title>Career</title>",
      "10 Misc/Tool.html": "<title>Misc Tool</title>",
      "Wiki/Map.html": "<title>Vault Map</title>",
    });

    const snapshot = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts", "02 Programs", "03 Areas", "10 Misc", "Wiki"],
      "Artifacts/Vault Control Center Native Plugin/runtime/html-gallery/thumbnails"
    );

    expect(snapshot.scannedCount).toBe(13);
    expect(snapshot.items.map((item) => item.title)).toEqual([
      "Mission Control",
      "Basic Needs",
      "Career",
      "Misc Tool",
      "Vault Map",
    ]);
    expect(snapshot.items.map((item) => item.category)).toEqual([
      "Artifacts",
      "Programs",
      "Areas",
      "Misc",
      "Wiki",
    ]);
    expect(snapshot.excludedCount).toBe(8);
  });

  it("pairs an existing derived thumbnail and isolates a file read failure", async () => {
    const good = file("Artifacts/Good/index.html", 200);
    const bad = file("Artifacts/Broken/Fallback Name.html", 300);
    const thumbnailPath = stableHtmlThumbnailPath(
      good.path,
      "Artifacts/VCC/Thumbnails"
    );
    const thumbnail = file(thumbnailPath, 250, "png");
    const app = fakeApp([good, bad, thumbnail], {
      [good.path]: "<title>Good &amp; Ready</title><meta content='A useful dashboard' name='description'>",
    }, new Set([bad.path]));

    const snapshot = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts"],
      "Artifacts/VCC/Thumbnails"
    );

    expect(snapshot.items).toHaveLength(2);
    expect(snapshot.items[0]).toMatchObject({
      path: bad.path,
      title: "Fallback Name",
      thumbnailFile: null,
    });
    expect(snapshot.items[1]).toMatchObject({
      path: good.path,
      title: "Good & Ready",
      description: "A useful dashboard",
      thumbnailFile: thumbnail,
    });
    expect(snapshot.errors).toEqual([{ path: bad.path, message: "read failed" }]);
  });

  it("returns a nonthrowing snapshot when vault enumeration fails", async () => {
    const app = {
      vault: {
        getFiles: () => {
          throw new Error("vault unavailable");
        },
      },
    } as unknown as App;

    const snapshot = await buildHtmlGallerySnapshot(app, ["Artifacts"], "Thumbnails");

    expect(snapshot.items).toEqual([]);
    expect(snapshot.errors).toEqual([{ path: "", message: "vault unavailable" }]);
  });

  it("bounds concurrent metadata reads and preserves deterministic output", async () => {
    const files = Array.from({ length: 12 }, (_, index) =>
      file(`Artifacts/Page ${String(index).padStart(2, "0")}.html`, 100)
    );
    const app = fakeApp(files, {});
    let activeReads = 0;
    let maximumActiveReads = 0;
    vi.mocked(app.vault.read).mockImplementation(async (entry: TFile) => {
      activeReads += 1;
      maximumActiveReads = Math.max(maximumActiveReads, activeReads);
      await new Promise((resolve) => setTimeout(resolve, 2));
      activeReads -= 1;
      return `<title>${entry.basename}</title>`;
    });

    const snapshot = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts"],
      "Artifacts/VCC/Thumbnails"
    );

    expect(maximumActiveReads).toBeLessThanOrEqual(HTML_METADATA_READ_CONCURRENCY);
    expect(snapshot.items.map((item) => item.title)).toEqual(
      files.map((entry) => entry.basename)
    );
  });

  it("reuses metadata for unchanged files and invalidates it after a file change", async () => {
    const source = file("Artifacts/Cached.html", 100);
    const app = fakeApp([source], {
      [source.path]: "<title>Cached dashboard</title>",
    });

    const first = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts"],
      "Artifacts/VCC/Thumbnails"
    );
    const second = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts"],
      "Artifacts/VCC/Thumbnails"
    );
    source.stat.mtime = 200;
    const third = await buildHtmlGallerySnapshot(
      app,
      ["Artifacts"],
      "Artifacts/VCC/Thumbnails"
    );

    expect(first.items[0].title).toBe("Cached dashboard");
    expect(second.items[0].title).toBe("Cached dashboard");
    expect(third.items[0].title).toBe("Cached dashboard");
    expect(app.vault.read).toHaveBeenCalledTimes(2);
  });

  it("uses a safe fallback and surfaces an error for an invalid thumbnail folder", async () => {
    const source = file("Artifacts/Dashboard.html", 100);
    const snapshot = await buildHtmlGallerySnapshot(
      fakeApp([source], { [source.path]: "<title>Dashboard</title>" }),
      ["Artifacts"],
      "Private/Secrets"
    );

    expect(snapshot.thumbnailFolder).toBe(DEFAULT_HTML_THUMBNAIL_FOLDER);
    expect(snapshot.items[0].thumbnailPath).toMatch(
      new RegExp(`^${DEFAULT_HTML_THUMBNAIL_FOLDER}/[0-9a-f]{16}\\.png$`)
    );
    expect(snapshot.errors[0]?.message).toContain("Using safe fallback");
    expect(isSafeHtmlThumbnailFolder("")).toBe(false);
    expect(isSafeHtmlThumbnailFolder(".obsidian/Thumbnails")).toBe(false);
  });
});

describe("HTML gallery metadata and filtering", () => {
  it("parses safe title and description text and decodes common entities", () => {
    expect(
      parseHtmlMetadata(
        `<html><head>
          <title>  Team &amp; Program <b>Board</b> </title>
          <meta CONTENT="A &quot;live&quot; view &#x26; queue" NAME="description">
        </head></html>`,
        "Fallback"
      )
    ).toEqual({
      title: "Team & Program Board",
      description: 'A "live" view & queue',
    });
    expect(decodeCommonHtmlEntities("&#65; &#x42; &nbsp; &unknown;")).toBe(
      "A B   &unknown;"
    );
  });

  it("uses fallback titles and explicitly identifies excluded path patterns", () => {
    expect(parseHtmlMetadata("<html></html>", "Fallback Page").title).toBe(
      "Fallback Page"
    );
    expect(shouldExcludeHtmlPath("Artifacts/Tests/Fixture.html")).toBe(true);
    expect(
      shouldExcludeHtmlPath("Artifacts/YouTube Meta App/runtime/index.html")
    ).toBe(true);
    expect(
      shouldExcludeHtmlPath(
        "10 Misc/Funding Opportunities/BlackRock Future Builders/blackrock-future-builders-rfp.html"
      )
    ).toBe(true);
    expect(
      shouldExcludeHtmlPath(
        "10 Misc/Funding Opportunities/BlackRock Future Builders/blackrock-future-builders-timeline-infographic.html"
      )
    ).toBe(true);
    expect(shouldExcludeHtmlPath("Artifacts/Live/Page.html")).toBe(false);
  });

  it("filters by all query terms and category, then sorts newest first", () => {
    const oldPrograms = galleryItem({
      title: "Basic Needs Overview",
      description: "Student support",
      category: "Programs",
      modifiedAt: 100,
    });
    const newPrograms = galleryItem({
      title: "Basic Needs Operations",
      description: "Live services dashboard",
      category: "Programs",
      modifiedAt: 300,
    });
    const artifact = galleryItem({
      title: "Basic Needs Prototype",
      category: "Artifacts",
      modifiedAt: 500,
    });

    expect(
      filterHtmlGalleryItems(
        [oldPrograms, newPrograms, artifact],
        "basic needs",
        "Programs"
      )
    ).toEqual([newPrograms, oldPrograms]);
    expect(filterHtmlGalleryItems([oldPrograms, newPrograms], "live services")).toEqual([
      newPrograms,
    ]);
  });

  it("derives a stable normalized 16-hex thumbnail filename", () => {
    const first = stableHtmlThumbnailPath(
      "Artifacts\\App/./index.html",
      "/Artifacts/VCC/Thumbnails/"
    );
    const repeated = stableHtmlThumbnailPath(
      "Artifacts/App/index.html",
      "Artifacts/VCC/Thumbnails"
    );
    const other = stableHtmlThumbnailPath(
      "Artifacts/Other/index.html",
      "Artifacts/VCC/Thumbnails"
    );

    expect(first).toBe(repeated);
    expect(first).toMatch(/^Artifacts\/VCC\/Thumbnails\/[0-9a-f]{16}\.png$/);
    expect(other).not.toBe(first);
    expect(stableHtmlThumbnailPath("Artifacts/App.html", "")).toMatch(
      new RegExp(`^${DEFAULT_HTML_THUMBNAIL_FOLDER}/[0-9a-f]{16}\\.png$`)
    );
  });
});

describe("Quick Look thumbnail generation", () => {
  it("rejects Quick Look's known blank image output", async () => {
    const item = galleryItem({ thumbnailPath: "Artifacts/VCC/Thumbs/blank.png" });
    const runtime = fakeRuntime({ thumbnailBytes: 10_745 });
    const app = fakeWritableApp([item.sourceFile]);

    const result = await generateHtmlThumbnails(app, [item], {
      isDesktopMac: true,
      runtime,
    });

    expect(result).toMatchObject({ generated: 0, failed: 1 });
    expect(result.errors[0]?.message).toContain("blank thumbnail");
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });

  it("is unavailable off desktop macOS without loading or executing a runtime", async () => {
    const runtime = fakeRuntime();
    const result = await generateHtmlThumbnails(
      fakeWritableApp([]),
      [galleryItem()],
      { isDesktopMac: false, runtime }
    );

    expect(result.status).toBe("unavailable");
    expect(runtime.execFile).not.toHaveBeenCalled();
  });

  it.each([
    "thumbnail.png",
    ".obsidian/Thumbnails/thumbnail.png",
    "Private/Secrets/thumbnail.png",
  ])("disables generation for unsafe destination %s", async (thumbnailPath) => {
    const runtime = fakeRuntime();
    const item = galleryItem({ thumbnailPath });
    const result = await generateHtmlThumbnails(
      fakeWritableApp([item.sourceFile]),
      [item],
      { isDesktopMac: true, runtime }
    );

    expect(result.status).toBe("unavailable");
    expect(result.reason).toContain("destination folder");
    expect(runtime.execFile).not.toHaveBeenCalled();
  });

  it("uses a fixed qlmanage argv with no shell and writes a vault-relative binary", async () => {
    const item = galleryItem({
      path: "Artifacts/Dashboard/index.html",
      thumbnailPath: "Artifacts/VCC/Thumbs/abc.png",
      modifiedAt: 500,
    });
    const runtime = fakeRuntime();
    const app = fakeWritableApp([item.sourceFile]);

    const result = await generateHtmlThumbnails(app, [item], {
      isDesktopMac: true,
      runtime,
      size: 640,
      concurrency: 2,
    });

    expect(result).toMatchObject({
      status: "completed",
      attempted: 1,
      generated: 1,
      failed: 0,
    });
    expect(runtime.execFile).toHaveBeenCalledWith(
      "/usr/bin/qlmanage",
      [
        "-t",
        "-s",
        "640",
        "-o",
        "/tmp/fjg-vcc-html-1",
        "/vault/Artifacts/Dashboard/index.html",
      ],
      expect.objectContaining({ shell: false })
    );
    expect(app.vault.createBinary).toHaveBeenCalledWith(
      "Artifacts/VCC/Thumbs/abc.png",
      expect.any(ArrayBuffer)
    );
    expect(runtime.removeDirectory).toHaveBeenCalledWith("/tmp/fjg-vcc-html-1");
  });

  it("skips fresh thumbnails and isolates one failed generation", async () => {
    const freshThumbnail = file("Artifacts/VCC/fresh.png", 600, "png");
    const fresh = galleryItem({
      path: "Artifacts/Fresh.html",
      modifiedAt: 500,
      thumbnailPath: freshThumbnail.path,
      thumbnailFile: freshThumbnail,
    });
    const broken = galleryItem({
      path: "Artifacts/Broken.html",
      modifiedAt: 700,
      thumbnailPath: "Artifacts/VCC/broken.png",
    });
    const good = galleryItem({
      path: "Artifacts/Good.html",
      modifiedAt: 800,
      thumbnailPath: "Artifacts/VCC/good.png",
    });
    const runtime = fakeRuntime({ failSource: "Broken.html" });
    const app = fakeWritableApp([fresh.sourceFile, broken.sourceFile, good.sourceFile]);

    const result = await generateHtmlThumbnails(app, [fresh, broken, good], {
      isDesktopMac: true,
      runtime,
      concurrency: 3,
    });

    expect(result).toMatchObject({
      attempted: 2,
      generated: 1,
      skipped: 1,
      failed: 1,
    });
    expect(result.errors).toEqual([
      { path: broken.path, message: "quick look failed" },
    ]);
    expect(app.vault.createBinary).toHaveBeenCalledTimes(1);
    expect(app.vault.createBinary).toHaveBeenCalledWith(
      good.thumbnailPath,
      expect.any(ArrayBuffer)
    );
  });

  it("prepares a shared thumbnail folder once before parallel generation", async () => {
    const first = galleryItem({
      path: "Artifacts/First.html",
      thumbnailPath: "Artifacts/VCC/Thumbs/first.png",
    });
    const second = galleryItem({
      path: "Artifacts/Second.html",
      thumbnailPath: "Artifacts/VCC/Thumbs/second.png",
    });
    const app = fakeWritableApp([first.sourceFile, second.sourceFile]);

    const result = await generateHtmlThumbnails(app, [first, second], {
      isDesktopMac: true,
      runtime: fakeRuntime(),
      concurrency: 3,
    });

    expect(result).toMatchObject({ generated: 2, failed: 0 });
    expect(app.vault.createFolder).toHaveBeenCalledTimes(3);
    expect(app.vault.createFolder).toHaveBeenNthCalledWith(1, "Artifacts");
    expect(app.vault.createFolder).toHaveBeenNthCalledWith(2, "Artifacts/VCC");
    expect(app.vault.createFolder).toHaveBeenNthCalledWith(
      3,
      "Artifacts/VCC/Thumbs"
    );
  });

  it("recovers when another view creates the same thumbnail during the write", async () => {
    const destination = "Artifacts/VCC/Thumbs/shared.png";
    const item = galleryItem({
      path: "Artifacts/Shared.html",
      thumbnailPath: destination,
    });
    const app = fakeWritableApp([item.sourceFile], { raceOnCreate: destination });

    const result = await generateHtmlThumbnails(app, [item], {
      isDesktopMac: true,
      runtime: fakeRuntime(),
    });

    expect(result).toMatchObject({ generated: 1, failed: 0 });
    expect(app.vault.createBinary).toHaveBeenCalledOnce();
    expect(app.vault.modifyBinary).toHaveBeenCalledWith(
      expect.objectContaining({ path: destination, extension: "png" }),
      expect.any(ArrayBuffer)
    );
  });

  it("recovers when another view creates the shared thumbnail folder", async () => {
    const item = galleryItem({
      path: "Artifacts/Shared Folder.html",
      thumbnailPath: "Artifacts/VCC/Thumbs/shared-folder.png",
    });
    const app = fakeWritableApp([item.sourceFile], {
      raceOnFolder: "Artifacts/VCC/Thumbs",
    });

    const result = await generateHtmlThumbnails(app, [item], {
      isDesktopMac: true,
      runtime: fakeRuntime(),
    });

    expect(result).toMatchObject({ generated: 1, failed: 0 });
    expect(app.vault.createBinary).toHaveBeenCalledOnce();
  });
});

function file(path: string, mtime: number, extension?: string): TFile {
  const name = path.split("/").pop() ?? path;
  const derivedExtension = extension ?? name.split(".").pop() ?? "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    extension: derivedExtension,
    stat: { mtime, ctime: mtime, size: 1024 },
  } as TFile;
}

function fakeApp(
  files: TFile[],
  contents: Record<string, string>,
  readFailures = new Set<string>()
): App {
  const byPath = new Map<string, TAbstractFile>(files.map((entry) => [entry.path, entry]));
  return {
    vault: {
      getFiles: () => files,
      getAbstractFileByPath: (path: string) => byPath.get(path) ?? null,
      read: vi.fn(async (entry: TFile) => {
        if (readFailures.has(entry.path)) throw new Error("read failed");
        return contents[entry.path] ?? "";
      }),
    },
  } as unknown as App;
}

function galleryItem(overrides: Partial<HtmlGalleryItem> = {}): HtmlGalleryItem {
  const path = overrides.path ?? "Artifacts/Dashboard.html";
  const sourceFile = overrides.sourceFile ?? file(path, overrides.modifiedAt ?? 100);
  return {
    path,
    title: "Dashboard",
    description: "",
    category: "Artifacts",
    folder: "Artifacts",
    folderPath: "Artifacts",
    modifiedAt: 100,
    size: 1024,
    sourceFile,
    thumbnailPath: "Artifacts/VCC/dashboard.png",
    thumbnailFile: null,
    ...overrides,
  };
}

function fakeRuntime(
  options: { failSource?: string; thumbnailBytes?: number } = {}
): HtmlThumbnailRuntime {
  let temporaryIndex = 0;
  return {
    makeTempDirectory: vi.fn(async () => {
      temporaryIndex += 1;
      return `/tmp/fjg-vcc-html-${temporaryIndex}`;
    }),
    execFile: vi.fn(async (_executable, args) => {
      if (options.failSource && args.at(-1)?.includes(options.failSource)) {
        throw new Error("quick look failed");
      }
    }),
    readFile: vi.fn(async () => new Uint8Array(options.thumbnailBytes ?? 16 * 1024)),
    removeDirectory: vi.fn(async () => undefined),
    joinPath: (...parts: string[]) => parts.join("/").replace(/\/{2,}/g, "/"),
    baseName: (path: string) => path.split("/").pop() ?? path,
  };
}

function fakeWritableApp(
  files: TFile[],
  options: { raceOnCreate?: string; raceOnFolder?: string } = {}
): App {
  const abstractFiles = new Map<string, TAbstractFile>(
    files.map((entry) => [entry.path, entry])
  );
  const folders = new Set<string>();
  const vault = {
    adapter: { getBasePath: () => "/vault" },
    getAbstractFileByPath: vi.fn((path: string) => abstractFiles.get(path) ?? (folders.has(path) ? ({ path } as TAbstractFile) : null)),
    createFolder: vi.fn(async (path: string) => {
      folders.add(path);
      if (path === options.raceOnFolder) {
        throw new Error("Folder already exists");
      }
    }),
    createBinary: vi.fn(async (path: string) => {
      abstractFiles.set(path, file(path, Date.now(), "png"));
      if (path === options.raceOnCreate) {
        throw new Error("File already exists");
      }
    }),
    modifyBinary: vi.fn(async () => undefined),
  };
  return { vault } as unknown as App;
}
