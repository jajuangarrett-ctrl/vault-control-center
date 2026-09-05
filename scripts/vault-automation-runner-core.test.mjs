import { describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_LABELS,
  EXECUTOR_SENTINEL_LABEL,
  OBSIDIAN_CLI,
  buildExecutorHeartbeat,
  isNearScheduledRun,
  processAutomationClaim,
} from "./vault-automation-runner-core.mjs";

const NOW = new Date("2026-08-10T20:00:00.000Z");

describe("vault automation runner security boundary", () => {
  it("requires the sentinel and exact target on every request", async () => {
    const noSentinel = launchdExec(new Set([AUTOMATION_LABELS.clippings]));
    const result = await processAutomationClaim(validClaim(), {
      now: NOW,
      uid: 501,
      execFile: noSentinel,
    });
    expect(result).toMatchObject({ state: "rejected", reasonCode: "sentinel-not-loaded" });
    expect(noSentinel).not.toHaveBeenCalledWith(
      "/bin/launchctl",
      expect.arrayContaining(["kickstart"]),
      expect.anything()
    );

    const missingTarget = launchdExec(new Set([EXECUTOR_SENTINEL_LABEL]));
    await expect(
      processAutomationClaim(validClaim(), { now: NOW, uid: 501, execFile: missingTarget })
    ).resolves.toMatchObject({ state: "rejected", reasonCode: "target-not-loaded" });
  });

  it("rejects a target already running without kickstarting it", async () => {
    const execFile = launchdExec(
      new Set([EXECUTOR_SENTINEL_LABEL, AUTOMATION_LABELS.clippings]),
      new Set([AUTOMATION_LABELS.clippings])
    );
    const result = await processAutomationClaim(validClaim(), { now: NOW, uid: 501, execFile });
    expect(result).toMatchObject({ state: "rejected", reasonCode: "already-running" });
    expect(execFile.mock.calls.some(([, args]) => args[0] === "kickstart")).toBe(false);
  });

  it("uses the exact no-shell launchctl argument vector", async () => {
    const execFile = launchdExec(new Set([EXECUTOR_SENTINEL_LABEL, AUTOMATION_LABELS.clippings]));
    const result = await processAutomationClaim(validClaim(), { now: NOW, uid: 501, execFile });
    expect(result).toMatchObject({ state: "started", reasonCode: "launchctl-accepted" });
    expect(execFile).toHaveBeenCalledWith(
      "/bin/launchctl",
      ["kickstart", "gui/501/com.franklingarrett.clippings-inbox-sort"],
      expect.objectContaining({ shell: false, timeout: 10_000 })
    );
    const kickstart = execFile.mock.calls.find(([, args]) => args[0] === "kickstart");
    expect(kickstart?.[1]).not.toContain("-k");
  });

  it("reloads Obsidian only through the fixed bundled CLI vector", async () => {
    const execFile = launchdExec(new Set([EXECUTOR_SENTINEL_LABEL]), new Set(), null, true);
    const result = await processAutomationClaim({ ...validClaim(), jobId: "reload-obsidian" }, {
      now: NOW,
      uid: 501,
      execFile,
      access: vi.fn().mockResolvedValue(undefined),
    });
    expect(result).toMatchObject({ state: "started", reasonCode: "obsidian-reload-accepted" });
    expect(execFile).toHaveBeenCalledWith(
      OBSIDIAN_CLI,
      ["eval", 'code=app.commands.executeCommandById("app:reload")'],
      expect.objectContaining({ shell: false, timeout: 10_000 })
    );
  });

  it("rejects unknown, extra-field, and expired claims before launchd execution", async () => {
    const execFile = vi.fn();
    await expect(
      processAutomationClaim({ ...validClaim(), jobId: "shell" }, { now: NOW, uid: 501, execFile })
    ).rejects.toThrow("Unknown job");
    await expect(
      processAutomationClaim({ ...validClaim(), path: "/tmp/no" }, { now: NOW, uid: 501, execFile })
    ).rejects.toThrow("Malformed claim");
    await expect(
      processAutomationClaim(
        { ...validClaim(), expiresAt: "2026-08-10T19:59:00.000Z" },
        { now: NOW, uid: 501, execFile }
      )
    ).rejects.toThrow("Expired claim");
    expect(execFile).not.toHaveBeenCalled();
  });

  it("publishes only fixed runnable IDs and sanitized RAM", async () => {
    const execFile = launchdExec(
      new Set([EXECUTOR_SENTINEL_LABEL, AUTOMATION_LABELS.clippings, AUTOMATION_LABELS["root-inbox"]])
    );
    const heartbeat = await buildExecutorHeartbeat({
      now: NOW,
      uid: 501,
      execFile,
      access: vi.fn().mockRejectedValue(new Error("not available")),
      osProvider: { totalmem: () => 1_000, freemem: () => 400 },
    });
    expect(heartbeat).toEqual({
      observedAt: NOW.toISOString(),
      sentinelLoaded: true,
      runnableJobIds: ["clippings", "root-inbox"],
      obsidianReloadAvailable: false,
      memory: { totalBytes: 1_000, usedBytes: 600, freePercent: 40, usedPercent: 60 },
    });
    expect(JSON.stringify(heartbeat)).not.toContain("franklingarrett");
  });

  it("prefers the fixed no-shell macOS memory-pressure summary", async () => {
    const execFile = launchdExec(
      new Set([EXECUTOR_SENTINEL_LABEL, AUTOMATION_LABELS.clippings]),
      new Set(),
      34
    );
    const heartbeat = await buildExecutorHeartbeat({
      now: NOW,
      uid: 501,
      execFile,
      osProvider: { totalmem: () => 1_000, freemem: () => 1 },
    });
    expect(heartbeat.memory).toEqual({
      totalBytes: 1_000,
      usedBytes: 660,
      freePercent: 34,
      usedPercent: 66,
    });
    expect(execFile).toHaveBeenCalledWith(
      "/usr/bin/memory_pressure",
      ["-Q"],
      expect.objectContaining({ shell: false, timeout: 4_000 })
    );
  });

  it("blocks manual starts during fixed scheduled-run windows", () => {
    expect(isNearScheduledRun("clippings", new Date(2026, 7, 10, 8, 1))).toBe(true);
    expect(isNearScheduledRun("clippings", new Date(2026, 7, 10, 8, 5))).toBe(false);
    expect(isNearScheduledRun("weekly-learning-review", new Date(2026, 7, 14, 16, 0))).toBe(true);
  });
});

function validClaim() {
  return {
    jobId: "clippings",
    requestId: "7a1de905-6768-4d3d-a94d-4ac2e0fa90a1",
    requestedAt: NOW.toISOString(),
    expiresAt: "2026-08-10T20:01:00.000Z",
  };
}

function launchdExec(loaded, running = new Set(), memoryFreePercent = null, obsidianCliAvailable = false) {
  return vi.fn(async (_executable, args, options) => {
    expect(options.shell).toBe(false);
    if (_executable === "/usr/bin/memory_pressure") {
      if (memoryFreePercent === null) throw new Error("not available");
      return { stdout: `System-wide memory free percentage: ${memoryFreePercent}%\n`, stderr: "" };
    }
    if (_executable === "/usr/bin/test") {
      if (!obsidianCliAvailable) throw new Error("not available");
      return { stdout: "", stderr: "" };
    }
    if (_executable === OBSIDIAN_CLI) return { stdout: "", stderr: "" };
    if (args[0] === "kickstart") return { stdout: "", stderr: "" };
    const label = String(args[1]).split("/").at(-1);
    if (!loaded.has(label)) throw new Error("not loaded");
    return {
      stdout: `state = ${running.has(label) ? "running" : "not running"}\n`,
      stderr: "",
    };
  });
}
