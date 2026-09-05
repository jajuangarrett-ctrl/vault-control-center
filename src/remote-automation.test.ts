import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

const obsidianMocks = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock("obsidian", () => ({ requestUrl: obsidianMocks.requestUrl }));

import {
  applyRemoteAutomationAvailability,
  fetchRemoteAutomationSnapshot,
  submitRemoteAutomation,
  submitRemoteObsidianReload,
} from "./remote-automation";
import { DEFAULT_SETTINGS } from "./types";
import type { AutomationSnapshot } from "./automations";

const NOW = new Date("2026-08-10T20:00:00.000Z");
const SECRET = "a".repeat(48);

describe("remote automation client", () => {
  it("authenticates health checks and accepts sanitized remote RAM", async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      json: {
        status: "ok",
        checkedAt: NOW.toISOString(),
        executor: {
          reachable: true,
          observedAt: NOW.toISOString(),
          sentinelLoaded: true,
          runnableJobIds: ["clippings", "shell"],
        },
        memory: { totalBytes: 1_000, usedBytes: 750, freePercent: 25, usedPercent: 75 },
      },
    });
    const result = await fetchRemoteAutomationSnapshot(fakeApp(), enabledSettings(), request);
    expect(result).toMatchObject({ state: "ready", reachable: true, runnableJobIds: ["clippings"] });
    expect(result.memory).toMatchObject({ status: "ready", source: "remote-executor", usedPercent: 75 });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://broker.example/api/vault-automation/health",
      headers: expect.objectContaining({ Authorization: `Bearer ${SECRET}` }),
    }));
  });

  it("fails closed when unavailable, unconfigured, or unauthenticated", async () => {
    const unavailable = await fetchRemoteAutomationSnapshot(
      fakeApp(),
      enabledSettings(),
      vi.fn().mockRejectedValue(new Error("offline"))
    );
    expect(unavailable).toMatchObject({ state: "unreachable", reachable: false });

    const auth = await fetchRemoteAutomationSnapshot(
      fakeApp(),
      enabledSettings(),
      vi.fn().mockResolvedValue({ status: 401, json: {} })
    );
    expect(auth).toMatchObject({ state: "authentication-failed", reachable: false });

    const unconfigured = await fetchRemoteAutomationSnapshot(
      fakeApp(),
      { ...enabledSettings(), remoteAutomationSecretId: "" },
      vi.fn()
    );
    expect(unconfigured).toMatchObject({ state: "unconfigured", reachable: false });
  });

  it("submits only a fixed automation ID and only bounded request fields", async () => {
    const request = vi.fn(async (options) => {
      const body = JSON.parse(options.body ?? "{}");
      return { status: 202, json: { ...body, state: "queued" } };
    });
    const result = await submitRemoteAutomation(
      fakeApp(),
      enabledSettings(),
      "clippings",
      request,
      NOW
    );
    expect(result).toMatchObject({ status: "queued", brokerState: "queued" });
    const body = JSON.parse(request.mock.calls[0][0].body ?? "{}");
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "jobId", "requestId", "requestedAt"]);
    expect(body).toMatchObject({ jobId: "clippings", requestedAt: NOW.toISOString() });

    const rejectedRequest = vi.fn();
    await expect(
      submitRemoteAutomation(fakeApp(), enabledSettings(), "mira-email-filing", rejectedRequest, NOW)
    ).resolves.toMatchObject({ status: "rejected" });
    expect(rejectedRequest).not.toHaveBeenCalled();
  });

  it("submits only the fixed remote Obsidian reload action", async () => {
    const request = vi.fn(async (options) => ({ status: 202, json: { ...JSON.parse(options.body ?? "{}"), state: "queued" } }));
    await expect(submitRemoteObsidianReload(fakeApp(), enabledSettings(), request, NOW))
      .resolves.toMatchObject({ id: "reload-obsidian", status: "queued" });
    expect(JSON.parse(request.mock.calls[0][0].body ?? "{}")).toMatchObject({ jobId: "reload-obsidian" });
  });

  it("enables remote controls only for routine IDs reported ready", () => {
    const merged = applyRemoteAutomationAvailability(nonExecutorSnapshot(), {
      state: "ready",
      checkedAt: NOW.toISOString(),
      reachable: true,
      observedAt: NOW.toISOString(),
      runnableJobIds: ["clippings"],
      obsidianReloadAvailable: false,
      message: "ready",
      memory: { status: "unavailable", checkedAt: NOW.toISOString(), reason: "remote-unavailable", message: "n/a" },
    });
    expect(merged.items[0]).toMatchObject({ id: "clippings", canRun: true, runTarget: "remote" });
    expect(merged.items[1]).toMatchObject({ id: "mira-email-filing", canRun: false, runTarget: null });
  });
});

function fakeApp(): App {
  return { secretStorage: { getSecret: () => SECRET } } as unknown as App;
}

function enabledSettings() {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    remoteAutomationEnabled: true,
    remoteAutomationUrl: "https://broker.example",
    remoteAutomationSecretId: "vault-automation-client",
  };
}

function nonExecutorSnapshot(): AutomationSnapshot {
  const base = {
    label: "",
    description: "",
    group: "routine-vault" as const,
    schedule: "",
    resolvedStatusPath: null,
    statusReadState: "missing" as const,
    statusMessage: "",
    lastResult: null,
    lastStartedAt: null,
    lastCompletedAt: null,
    launchdAvailability: "not-checked" as const,
    loaded: null,
    running: null,
    launchdState: null,
    lastExitCode: null,
    healthTone: "neutral" as const,
    healthMessage: "",
    availability: "remote" as const,
    canRun: false,
    runTarget: null,
    runState: "unavailable" as const,
    runMessage: "",
  };
  return {
    status: "ready",
    checkedAt: NOW.toISOString(),
    isDesktopMac: true,
    isExecutor: false,
    executorState: "non-executor",
    uid: 501,
    message: "",
    items: [
      { ...base, id: "clippings", manualPolicy: "routine", launchdLabel: "com.example.clippings" },
      { ...base, id: "mira-email-filing", manualPolicy: "status-only" },
    ],
  };
}
