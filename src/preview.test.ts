import { describe, expect, it } from "vitest";
import {
  PREVIEW_HISTORY_LIMIT,
  PREVIEW_TEXT_SIZE_LIMIT,
  classifyPreviewKind,
  mergePreviewHistory,
  parseInternalLinkTarget,
  type PreviewKind,
} from "./preview";

describe("classifyPreviewKind", () => {
  it.each<[string, PreviewKind]>([
    ["md", "markdown"],
    ["txt", "text"],
    ["csv", "text"],
    ["html", "text"],
    ["json", "text"],
    ["png", "image"],
    ["jpg", "image"],
    ["jpeg", "image"],
    ["gif", "image"],
    ["webp", "image"],
    ["bmp", "image"],
    ["svg", "image"],
    ["mp3", "audio"],
    ["wav", "audio"],
    ["m4a", "audio"],
    ["ogg", "audio"],
    ["flac", "audio"],
    ["mp4", "video"],
    ["webm", "video"],
    ["mov", "video"],
    ["pdf", "pdf"],
    ["canvas", "native-fallback"],
    ["docx", "native-fallback"],
    ["unknown", "native-fallback"],
  ])("classifies %s as %s", (extension, expected) => {
    expect(classifyPreviewKind(extension)).toBe(expected);
  });

  it("is case-insensitive and accepts dotted extensions or full paths", () => {
    expect(classifyPreviewKind(".MD")).toBe("markdown");
    expect(classifyPreviewKind("Folder/PHOTO.JpEg")).toBe("image");
    expect(classifyPreviewKind("Folder\\Clip.MP4?cache=1#frame")).toBe("video");
  });

  it("exposes stable, positive safety ceilings", () => {
    expect(PREVIEW_TEXT_SIZE_LIMIT).toBeGreaterThan(0);
    expect(PREVIEW_HISTORY_LIMIT).toBeGreaterThan(0);
  });
});

describe("mergePreviewHistory", () => {
  it("puts the next file first, slash-normalizes, and deduplicates", () => {
    const current = [
      " Areas\\Planning\\Roadmap.md ",
      "Programs/Alpha/Overview.md",
      "Areas/Planning/Roadmap.md",
    ];
    const snapshot = [...current];

    expect(
      mergePreviewHistory(current, " Areas//Planning / Roadmap.md ")
    ).toEqual([
      "Areas/Planning/Roadmap.md",
      "Programs/Alpha/Overview.md",
    ]);
    expect(current).toEqual(snapshot);
  });

  it("preserves traversal-looking segments for the caller to approve or reject", () => {
    expect(
      mergePreviewHistory([], "Programs/Alpha/../Shared/Note.md")
    ).toEqual(["Programs/Alpha/../Shared/Note.md"]);
  });

  it("keeps newest-first order and applies a caller-supplied cap", () => {
    expect(
      mergePreviewHistory(["B.md", "C.md", "D.md"], "A.md", undefined, 3)
    ).toEqual(["A.md", "B.md", "C.md"]);
  });

  it("never exceeds the hard history ceiling", () => {
    const current = Array.from(
      { length: PREVIEW_HISTORY_LIMIT + 10 },
      (_, index) => `Note ${index}.md`
    );
    const result = mergePreviewHistory(current, "Newest.md", undefined, 10_000);

    expect(result).toHaveLength(PREVIEW_HISTORY_LIMIT);
    expect(result[0]).toBe("Newest.md");
  });

  it("filters normalized new and existing paths and safely handles filter errors", () => {
    const result = mergePreviewHistory(
      ["Allowed/One.md", "Private/Two.md", "Broken.md"],
      " Allowed\\Newest.md ",
      (path) => {
        if (path === "Broken.md") throw new Error("bad predicate input");
        return path.startsWith("Allowed/");
      }
    );

    expect(result).toEqual(["Allowed/Newest.md", "Allowed/One.md"]);
  });

  it("returns an empty history for zero or negative limits", () => {
    expect(mergePreviewHistory(["Old.md"], "New.md", undefined, 0)).toEqual([]);
    expect(mergePreviewHistory(["Old.md"], "New.md", undefined, -5)).toEqual([]);
  });
});

describe("parseInternalLinkTarget", () => {
  it("prefers data-href and strips heading, block, query, and alias syntax", () => {
    expect(
      parseInternalLinkTarget(
        "Fallback.md",
        "[[Folder/Primary%20Note.md#^block|Visible name]]"
      )
    ).toBe("Folder/Primary Note.md");
    expect(parseInternalLinkTarget("Folder/Plan.md?view=compact#Overview")).toBe(
      "Folder/Plan.md"
    );
  });

  it("cleans relative internal paths without resolving parent segments", () => {
    expect(parseInternalLinkTarget("./Sibling\\Note.md#Section")).toBe(
      "Sibling/Note.md"
    );
    expect(parseInternalLinkTarget("../Shared/Note.md")).toBe(
      "../Shared/Note.md"
    );
  });

  it.each([
    "https://example.com/note",
    "HTTP://example.com/note",
    "mailto:person@example.com",
    "obsidian://open?vault=FJG",
    "javascript:alert(1)",
    "data:text/plain,hello",
    "//example.com/note",
    "#Heading",
    "?query=only",
    "",
  ])("rejects non-internal target %j", (target) => {
    expect(parseInternalLinkTarget(target)).toBeNull();
  });

  it("falls back to href when data-href is empty or hash-only", () => {
    expect(parseInternalLinkTarget("Folder/Fallback.md", " ")).toBe(
      "Folder/Fallback.md"
    );
    expect(parseInternalLinkTarget("Folder/Fallback.md", "#Heading")).toBe(
      "Folder/Fallback.md"
    );
  });

  it("does not throw on malformed URI encoding", () => {
    expect(parseInternalLinkTarget("Folder/100% Ready.md")).toBe(
      "Folder/100% Ready.md"
    );
  });
});
