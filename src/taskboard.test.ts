import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const mocks = vi.hoisted(() => ({ requestUrl: vi.fn() }));

vi.mock("obsidian", () => ({ requestUrl: mocks.requestUrl }));

import {
  fetchTaskboardSnapshot,
  normalizeTaskboardUrl,
  type TaskboardSettings,
} from "./taskboard";

const DISABLED_SETTINGS: TaskboardSettings = {
  reuseTaskCaptureConnection: false,
  enableRemoteTaskboard: false,
  taskboardUrl: "",
  taskboardSecretId: "",
};

describe("normalizeTaskboardUrl", () => {
  it("accepts HTTPS and local development URLs", () => {
    expect(normalizeTaskboardUrl("https://tasks.example.com/base/")).toBe(
      "https://tasks.example.com/base"
    );
    expect(normalizeTaskboardUrl("http://localhost:8888/")).toBe("http://localhost:8888");
  });

  it("rejects insecure remote, credentialed, query, and fragment URLs", () => {
    expect(normalizeTaskboardUrl("http://tasks.example.com")).toBeNull();
    expect(normalizeTaskboardUrl("https://user:pass@tasks.example.com")).toBeNull();
    expect(normalizeTaskboardUrl("https://tasks.example.com?token=value")).toBeNull();
    expect(normalizeTaskboardUrl("https://tasks.example.com/#private")).toBeNull();
  });
});

describe("fetchTaskboardSnapshot", () => {
  it("reads active workspace tasks, excludes completed work, and sorts Do First by due date", async () => {
    const result = await fetchTaskboardSnapshot(fakeApp(), DISABLED_SETTINGS);

    expect(result.status).toBe("ready");
    expect(result.totalCount).toBe(3);
    expect(result.openCount).toBe(2);
    expect(result.items.map((task) => task.title)).toEqual(["Earlier task", "Later task"]);
    expect(result.items.every((task) => task.bucket === "do-first" && task.vaultPath.endsWith("/task.md"))).toBe(true);
    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });
});

function fakeApp(): App {
  const files = [
    { path: "08 Tasks/Workspaces/Earlier task/task.md", contents: task("Earlier task", "2026-08-04", "do-first") },
    { path: "08 Tasks/Workspaces/Later task/task.md", contents: task("Later task", "2026-08-06", "do-first") },
    { path: "08 Tasks/Workspaces/Finished task/task.md", contents: task("Finished task", "2026-08-01", "completed") },
  ];
  return {
    vault: {
      getMarkdownFiles: () => files,
      cachedRead: async (file: { contents: string }) => file.contents,
    },
  } as unknown as App;
}

function task(title: string, due: string, status: string): string {
  return `---\ntask_id: tsk_${title}\ntitle: ${title}\nstatus: ${status}\ndue: ${due}\nproject: Test\ndelegated_to: ""\nupdated_at: 2026-08-01T12:00:00.000Z\n---\n`;
}
