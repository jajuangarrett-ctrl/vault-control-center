import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";

const target = resolve(process.argv[2] ?? "/tmp/vcc-mail-bridge-browser");
const fixture = resolve("tests/mail-cache-bridge-browser");
await mkdir(target, { recursive: true });
await Promise.all([
  copyFile(resolve(fixture, "index.html"), resolve(target, "index.html")),
  copyFile("styles.css", resolve(target, "plugin.css")),
  build({
    entryPoints: [resolve(fixture, "fixture.ts")],
    outfile: resolve(target, "app.js"),
    bundle: true, platform: "browser", external: ["node:*"], target: "safari16",
    alias: { obsidian: resolve(fixture, "obsidian.ts") },
  }),
]);
