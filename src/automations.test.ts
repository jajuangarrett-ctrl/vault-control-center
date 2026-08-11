import type { App, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  FJG_AUTOMATION_ALLOWLIST,
  VISIBLE_AUTOMATION_GROUPS,
  buildAutomationSnapshot,
  isAutomationRunning,
  parseAutomationStatusMarkdown,
  parseLaunchctlPrint,
  runAutomation,
  type AutomationExecFile,
} from "./automations";

const NOW = new Date("2026-08-10T20:00:00.000Z");

describe("FJG automation allowlist", () => {
  it("contains the known routine, service/sync, and cloud entries", () => {
    expect(FJG_AUTOMATION_ALLOWLIST.map((entry) => entry.id)).toEqual([
      "clippings",
      "root-inbox",
      "mira-email-filing",
      "iflytek-notes",
      "youtube-notes",
      "fjg-capture-transcripts",
      "weekly-learning-review",
      "agent-mission-control",
      "auto-commit-codex-repos",
      "auto-pull-plugin-repos",
      "auto-pull-ios-repos",
      "mira-local-sync",
      "outlook-exporter",
      "gmail-capture",
      "netlify-retention-cleanup",
    ]);
    expect(new Set(FJG_AUTOMATION_ALLOWLIST.map((entry) => entry.group))).toEqual(
      new Set(["routine-vault", "services-sync", "external-cloud"])
    );
    expect(
      FJG_AUTOMATION_ALLOWLIST.filter((entry) => entry.manualPolicy === "routine")
        .every((entry) => Boolean(entry.launchdLabel))
    ).toBe(true);
  });

  it("keeps Services and Repository Sync out of the visible dashboard groups", () => {
    expect(VISIBLE_AUTOMATION_GROUPS).toEqual(["routine-vault", "external-cloud"]);
    expect(VISIBLE_AUTOMATION_GROUPS).not.toContain("services-sync");
  });
});

describe("automation status parsing", () => {
  it("parses the synchronized Result, Started, and Completed bullet fields", () => {
    expect(
      parseAutomationStatusMarkdown(`
- **Result:** Completed — no files waiting
- **Started:** 2026-08-10 12:00:01 PDT
- **Completed:** 2026-08-10 12:00:02 PDT
`)
    ).toEqual({
      result: "Completed — no files waiting",
      startedAt: "2026-08-10 12:00:01 PDT",
      completedAt: "2026-08-10 12:00:02 PDT",
    });
  });

  it("parses launchd state without treating an idle loaded job as absent", () => {
    expect(
      parseLaunchctlPrint(`
com.franklingarrett.clippings-inbox-sort = {
  state = not running
  last exit code = 0
}
`)
    ).toEqual({
      state: "not running",
      running: false,
      lastExitCode: 0,
    });
  });
});

describe("buildAutomationSnapshot", () => {
  it("detects the executor only from a loaded routine processor label", async () => {
    const execFile = launchdRunner(["com.franklingarrett.clippings-inbox-sort"]);
    const snapshot = await buildAutomationSnapshot(
      fakeApp({
        "Clippings/Clippings Processing Status.md":
          "- **Result:** Completed\n- **Completed:** 2026-08-10 12:00:02 PDT",
      }),
      { isDesktopMac: true, uid: 501, execFile, now: NOW }
    );

    expect(snapshot).toMatchObject({
      status: "ready",
      isExecutor: true,
      executorState: "executor",
      uid: 501,
    });
    expect(snapshot.items.find((entry) => entry.id === "clippings")).toMatchObject({
      loaded: true,
      canRun: true,
      availability: "ready",
      lastResult: "Completed",
    });
    expect(snapshot.items.find((entry) => entry.id === "youtube-notes")).toMatchObject({
      loaded: false,
      canRun: false,
      availability: "not-loaded",
    });

    expect(execFile).toHaveBeenCalledWith(
      "/bin/launchctl",
      ["print", "gui/501/com.franklingarrett.clippings-inbox-sort"],
      expect.objectContaining({ shell: false })
    );
  });

  it("does not mistake a loaded sync or high-impact service for the executor", async () => {
    const snapshot = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdRunner([
        "com.fjg.agent-mission-control.runner",
        "com.franklin.auto-commit-codex-repos",
      ]),
      now: NOW,
    });

    expect(snapshot.isExecutor).toBe(false);
    expect(snapshot.executorState).toBe("non-executor");
    expect(snapshot.items.find((entry) => entry.id === "agent-mission-control"))
      .toMatchObject({ loaded: true, availability: "service", canRun: false });
    expect(snapshot.items.find((entry) => entry.id === "auto-commit-codex-repos"))
      .toMatchObject({ loaded: true, availability: "high-impact", canRun: false });
  });

  it("surfaces configured service health without changing manual-run policy", async () => {
    const missing = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdHealthRunner({
        "com.franklingarrett.clippings-inbox-sort": {
          state: "not running",
          lastExitCode: 0,
        },
      }),
      now: NOW,
    });
    const running = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdHealthRunner({
        "com.franklingarrett.clippings-inbox-sort": {
          state: "not running",
          lastExitCode: 0,
        },
        "com.fjg.agent-mission-control.runner": {
          state: "running",
          lastExitCode: 0,
        },
      }),
      now: NOW,
    });
    const loadedButIdle = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdHealthRunner({
        "com.franklingarrett.clippings-inbox-sort": {
          state: "not running",
          lastExitCode: 0,
        },
        "com.fjg.agent-mission-control.runner": {
          state: "not running",
          lastExitCode: 0,
        },
      }),
      now: NOW,
    });

    expect(missing.items.find((entry) => entry.id === "agent-mission-control"))
      .toMatchObject({
        loaded: false,
        healthTone: "critical",
        healthMessage: "The expected continuous launchd service is not loaded.",
        canRun: false,
        availability: "service",
      });
    expect(running.items.find((entry) => entry.id === "agent-mission-control"))
      .toMatchObject({
        loaded: true,
        running: true,
        healthTone: "positive",
        healthMessage: "Running now under launchd.",
        canRun: false,
        availability: "service",
      });
    expect(
      loadedButIdle.items.find((entry) => entry.id === "agent-mission-control")
    ).toMatchObject({
      loaded: true,
      running: false,
      healthTone: "attention",
      healthMessage: "Loaded, but launchd reports not running.",
      canRun: false,
      availability: "service",
    });
  });

  it("warns for unexpectedly loaded disabled jobs and nonzero prior launchd exits", async () => {
    const snapshot = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdHealthRunner({
        "com.franklingarrett.clippings-inbox-sort": {
          state: "not running",
          lastExitCode: 0,
        },
        "com.franklin.auto-pull-plugin-repos": {
          state: "not running",
          lastExitCode: 0,
        },
        "com.franklin.auto-commit-codex-repos": {
          state: "not running",
          lastExitCode: 17,
        },
        "com.fjg.mira-email-local-sync": {
          state: "running",
          lastExitCode: 0,
        },
      }),
      now: NOW,
    });

    expect(snapshot.items.find((entry) => entry.id === "auto-pull-plugin-repos"))
      .toMatchObject({
        loaded: true,
        availability: "disabled",
        canRun: false,
        healthTone: "attention",
        healthMessage: "Unexpectedly loaded even though this automation is marked disabled.",
      });
    const autoCommit = snapshot.items.find(
      (entry) => entry.id === "auto-commit-codex-repos"
    );
    expect(autoCommit).toMatchObject({
      loaded: true,
      lastExitCode: 17,
      availability: "high-impact",
      canRun: false,
      healthTone: "attention",
      healthMessage: "Loaded; launchd reports previous exit code 17.",
    });
    expect(autoCommit?.healthMessage.toLocaleLowerCase()).not.toContain("failed");
    expect(snapshot.items.find((entry) => entry.id === "mira-local-sync"))
      .toMatchObject({
        loaded: true,
        running: true,
        availability: "status-only",
        canRun: false,
        healthTone: "positive",
        healthMessage: "Running now under launchd.",
      });
  });

  it("renders synchronized statuses on unsupported and non-executor devices", async () => {
    const execFile = vi.fn<AutomationExecFile>();
    const snapshot = await buildAutomationSnapshot(
      fakeApp({
        "00 Inbox/Inbox Processing Status.md":
          "- **Result:** Completed\n- **Completed:** 2026-08-10 12:10:56 PDT",
      }),
      { isDesktopMac: false, execFile, now: NOW }
    );

    expect(snapshot.executorState).toBe("unsupported");
    expect(snapshot.items.find((entry) => entry.id === "root-inbox")).toMatchObject({
      statusReadState: "available",
      lastResult: "Completed",
      canRun: false,
      availability: "remote",
    });
    expect(execFile).not.toHaveBeenCalled();
  });

  it("isolates one unreadable status note and still detects the latest weekly review", async () => {
    const snapshot = await buildAutomationSnapshot(
      fakeApp(
        {
          "Clippings/Clippings Processing Status.md":
            "- **Result:** Completed\n- **Completed:** 2026-08-10 12:00:02 PDT",
          "00 Inbox/Inbox Processing Status.md": new Error("read failed"),
          "AI Team/owner_inbox/2026-08-01_Review_Weekly-Codex-Learning.md":
            "---\nstatus: review-ready\n---\n# Older",
          "AI Team/owner_inbox/2026-08-08_Review_Weekly-Codex-Learning.md":
            "---\nstatus: review-ready\n---\n# Newer",
        },
      ),
      { isDesktopMac: true, uid: 501, execFile: launchdRunner([]), now: NOW }
    );

    expect(snapshot.items.find((entry) => entry.id === "clippings")).toMatchObject({
      statusReadState: "available",
      lastResult: "Completed",
    });
    expect(snapshot.items.find((entry) => entry.id === "root-inbox")).toMatchObject({
      statusReadState: "error",
      lastResult: null,
    });
    expect(snapshot.items.find((entry) => entry.id === "weekly-learning-review"))
      .toMatchObject({
        statusReadState: "available",
        resolvedStatusPath:
          "AI Team/owner_inbox/2026-08-08_Review_Weekly-Codex-Learning.md",
        lastResult: "Review ready",
        lastCompletedAt: "2026-08-08",
      });
  });
});

describe("runAutomation", () => {
  it("uses the exact no-shell launchctl kickstart vector without -k", async () => {
    const snapshot = await executorSnapshot();
    const execFile = vi.fn<AutomationExecFile>().mockResolvedValue({ stdout: "", stderr: "" });

    const result = await runAutomation("clippings", { snapshot, execFile });

    expect(result.status).toBe("started");
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(execFile).toHaveBeenCalledWith(
      "/bin/launchctl",
      ["kickstart", "gui/501/com.franklingarrett.clippings-inbox-sort"],
      {
        encoding: "utf8",
        maxBuffer: 128 * 1024,
        shell: false,
        timeout: 10_000,
      }
    );
    expect(execFile.mock.calls[0]?.[1]).not.toContain("-k");
  });

  it("rejects unknown, status-only, high-impact, and non-executor requests", async () => {
    const executor = await executorSnapshot();
    const nonExecutor = await buildAutomationSnapshot(fakeApp({}), {
      isDesktopMac: true,
      uid: 501,
      execFile: launchdRunner([]),
    });
    const execFile = vi.fn<AutomationExecFile>();

    expect((await runAutomation("not-real", { snapshot: executor, execFile })).status)
      .toBe("rejected");
    expect(
      (await runAutomation("mira-email-filing", { snapshot: executor, execFile })).status
    ).toBe("rejected");
    expect(
      (await runAutomation("auto-commit-codex-repos", { snapshot: executor, execFile }))
        .status
    ).toBe("rejected");
    expect(
      (await runAutomation("clippings", { snapshot: nonExecutor, execFile })).status
    ).toBe("rejected");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("suppresses duplicate concurrent starts for the same automation", async () => {
    const snapshot = await executorSnapshot();
    let finish: (() => void) | undefined;
    const execFile = vi.fn<AutomationExecFile>().mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ stdout: "", stderr: "" });
        })
    );

    const first = runAutomation("clippings", { snapshot, execFile });
    expect(isAutomationRunning("clippings")).toBe(true);
    const duplicate = await runAutomation("clippings", { snapshot, execFile });

    expect(duplicate).toMatchObject({ status: "rejected" });
    expect(duplicate.message).toContain("already");
    expect(execFile).toHaveBeenCalledTimes(1);

    finish?.();
    expect((await first).status).toBe("started");
    expect(isAutomationRunning("clippings")).toBe(false);
  });
});

async function executorSnapshot() {
  return buildAutomationSnapshot(fakeApp({}), {
    isDesktopMac: true,
    uid: 501,
    execFile: launchdRunner(["com.franklingarrett.clippings-inbox-sort"]),
    now: NOW,
  });
}

function launchdRunner(loadedLabels: string[]) {
  return vi.fn<AutomationExecFile>().mockImplementation(async (_executable, args) => {
    const target = args[1] ?? "";
    const label = loadedLabels.find((candidate) => target.endsWith(`/${candidate}`));
    if (!label) {
      throw new Error("not loaded");
    }
    return {
      stdout: `${label} = {\n  state = not running\n  last exit code = 0\n}\n`,
      stderr: "",
    };
  });
}

function launchdHealthRunner(
  jobs: Record<string, { state: string; lastExitCode: number }>
) {
  return vi.fn<AutomationExecFile>().mockImplementation(async (_executable, args) => {
    const target = args[1] ?? "";
    const label = Object.keys(jobs).find((candidate) => target.endsWith(`/${candidate}`));
    if (!label) {
      throw new Error("not loaded");
    }
    const job = jobs[label];
    return {
      stdout: `${label} = {\n  state = ${job.state}\n  last exit code = ${job.lastExitCode}\n}\n`,
      stderr: "",
    };
  });
}

function fakeApp(
  contents: Record<string, string | Error>
): App {
  const files = new Map(
    Object.keys(contents).map((path) => [
      path,
      { path, name: path.split("/").pop() ?? path },
    ])
  );
  return {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path) ?? null,
      getMarkdownFiles: () => [...files.values()] as TFile[],
      cachedRead: async (file: TFile) => {
        const value = contents[file.path];
        if (value instanceof Error) {
          throw value;
        }
        return value ?? "";
      },
    },
  } as unknown as App;
}
