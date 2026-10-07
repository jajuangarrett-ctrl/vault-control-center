import { describe, expect, it } from "vitest";
import { isMobileHtmlPath, resolveHtmlResource, usesMobileHtmlViewer } from "./mobile-html";

describe("mobile HTML paths", () => {
  it("uses the viewer on native mobile even in desktop layout, while retaining desktop behavior", () => {
    expect(usesMobileHtmlViewer({ isMobileApp: true, isMobile: false })).toBe(true);
    expect(usesMobileHtmlViewer({ isMobileApp: false, isMobile: true })).toBe(true);
    expect(usesMobileHtmlViewer({ isMobileApp: false, isMobile: false })).toBe(false);
  });
  it("includes HTML and HTM throughout the vault, including inboxes and archives", () => {
    for (const path of ["00 Inbox/Page.html", "Artifacts/Archive/old.HTML", "page.HTM", "Templates/start.html"]) expect(isMobileHtmlPath(path)).toBe(true);
    for (const path of [".obsidian/page.html", "secret/page.html", "node_modules/pkg/index.html", "note.md"]) expect(isMobileHtmlPath(path)).toBe(false);
  });
  it("resolves encoded and relative assets with query strings without escaping the vault", () => {
    expect(resolveHtmlResource("../Shared/a%20b.css?v=1#font", "Docs/Pages/index.html")).toBe("Docs/Shared/a b.css");
    expect(resolveHtmlResource("/Assets/icon.svg", "Docs/index.html")).toBe("Assets/icon.svg");
    for (const ref of ["../../outside.json", "%2e%2e/%2e%2e/out.json", "../.obsidian/data.json", "../credentials.json", "https://example.com/a.js", "file:///etc/passwd", "//example.com/a", "foo%00.js", "a\\b.js", "%zz"]) {
      expect(resolveHtmlResource(ref, "Docs/index.html")).toBeNull();
    }
  });
});
