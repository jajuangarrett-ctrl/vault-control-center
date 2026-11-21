import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

const [viewer, destination] = process.argv.slice(2);
if (!viewer || !destination) throw new Error("Usage: node tests/html-catalog-browser/build.mjs <HTML Viewer checkout> <output directory>");
const catalog = resolve(viewer, "src/htmlCatalog.ts");
const target = resolve(destination);
const fixture = resolve("tests/html-catalog-browser");
await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(resolve(fixture, "index.html"), resolve(target, "index.html")),
  copyFile("styles.css", resolve(target, "plugin.css")),
  build({
    entryPoints: [resolve(fixture, "fixture.ts")],
    outfile: resolve(target, "app.js"),
    bundle: true, platform: "browser", external: ["node:*"], target: "safari16",
    alias: { "obsidian": resolve(fixture, "obsidian.ts"), "html-viewer-test-catalog": catalog },
  }),
]);
