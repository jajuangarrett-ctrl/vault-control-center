import type { ViewStateResult } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  NativeMarkdownEditorSession,
  type EmbeddedMarkdownView,
} from "./native-markdown-editor";

describe("NativeMarkdownEditorSession", () => {
  it("opens a native source-mode view, refreshes it, and focuses on request", async () => {
    const view = fakeView();
    const session = new NativeMarkdownEditorSession(() => view);
    const parent = {} as HTMLElement;

    await expect(session.mount(parent, "Areas/Plan.md", true)).resolves.toBe(true);

    expect(view.openIn).toHaveBeenCalledWith(parent);
    expect(view.setState).toHaveBeenCalledWith(
      { file: "Areas/Plan.md", mode: "source" },
      {}
    );
    expect(view.editor.refresh).toHaveBeenCalledOnce();
    expect(view.editor.focus).toHaveBeenCalledOnce();
    expect(session.isEditing("Areas/Plan.md")).toBe(true);
  });

  it("closes the prior native view before mounting another file", async () => {
    const events: string[] = [];
    const first = fakeView(events, "first");
    const second = fakeView(events, "second");
    const createView = vi.fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const session = new NativeMarkdownEditorSession(createView);

    await session.mount({} as HTMLElement, "First.md", false);
    await session.mount({} as HTMLElement, "Second.md", false);

    expect(first.closeEmbedded).toHaveBeenCalledOnce();
    expect(events.indexOf("first:close")).toBeLessThan(
      events.indexOf("second:open")
    );
    expect(session.isEditing("First.md")).toBe(false);
    expect(session.isEditing("Second.md")).toBe(true);
  });

  it("closes a partially mounted view when native state loading fails", async () => {
    const view = fakeView();
    vi.mocked(view.setState).mockRejectedValueOnce(new Error("load failed"));
    const session = new NativeMarkdownEditorSession(() => view);

    await expect(
      session.mount({} as HTMLElement, "Broken.md", false)
    ).rejects.toThrow("load failed");

    expect(view.closeEmbedded).toHaveBeenCalledOnce();
    expect(session.isEditing("Broken.md")).toBe(false);
  });

  it("disposes the mounted view and clears its editing identity", async () => {
    const view = fakeView();
    const session = new NativeMarkdownEditorSession(() => view);
    await session.mount({} as HTMLElement, "Note.md", false);

    await session.dispose();

    expect(view.closeEmbedded).toHaveBeenCalledOnce();
    expect(session.isEditing("Note.md")).toBe(false);
  });

  it("still identifies the file as editing while its native save lifecycle closes", async () => {
    let finishClose: (() => void) | undefined;
    const view = fakeView();
    vi.mocked(view.closeEmbedded).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        finishClose = resolve;
      })
    );
    const session = new NativeMarkdownEditorSession(() => view);
    await session.mount({} as HTMLElement, "Saving.md", false);

    const disposing = session.dispose();
    expect(session.isEditing("Saving.md")).toBe(true);
    finishClose?.();
    await disposing;

    expect(session.isEditing("Saving.md")).toBe(false);
  });
});

function fakeView(events: string[] = [], name = "view"): EmbeddedMarkdownView {
  return {
    editor: {
      focus: vi.fn(() => events.push(`${name}:focus`)),
      refresh: vi.fn(() => events.push(`${name}:refresh`)),
    },
    openIn: vi.fn(async () => {
      events.push(`${name}:open`);
    }),
    closeEmbedded: vi.fn(async () => {
      events.push(`${name}:close`);
    }),
    setState: vi.fn(
      async (
        _state: { file: string; mode: "source" },
        _result: ViewStateResult
      ) => {
        events.push(`${name}:state`);
      }
    ),
  };
}
