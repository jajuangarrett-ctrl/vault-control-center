import { describe, expect, it, vi } from "vitest";
import {
  buildSystemMemorySnapshot,
  calculateMemoryUsage,
  parseMemoryPressureFreePercent,
  type SystemMemoryCommandRunner,
} from "./system-memory";

describe("memory pressure parsing and calculations", () => {
  it("parses the macOS summary and calculates bytes and health", () => {
    expect(
      parseMemoryPressureFreePercent(
        "The system has 17179869184 bytes\nSystem-wide memory free percentage: 37%\n"
      )
    ).toBe(37);

    expect(calculateMemoryUsage(1_000, 37)).toEqual({
      totalBytes: 1_000,
      availableBytes: 370,
      usedBytes: 630,
      freePercent: 37,
      usedPercent: 63,
      tone: "positive",
    });
    expect(calculateMemoryUsage(1_000, 20)?.tone).toBe("attention");
    expect(calculateMemoryUsage(1_000, 10)?.tone).toBe("critical");
  });

  it("rejects missing, out-of-range, and invalid values", () => {
    expect(parseMemoryPressureFreePercent("No percentage here")).toBeNull();
    expect(parseMemoryPressureFreePercent("System-wide memory free percentage: 101%"))
      .toBeNull();
    expect(calculateMemoryUsage(0, 50)).toBeNull();
    expect(calculateMemoryUsage(Number.POSITIVE_INFINITY, 50)).toBeNull();
    expect(calculateMemoryUsage(1_000, -1)).toBeNull();
  });
});

describe("buildSystemMemorySnapshot", () => {
  it("does not touch Node services without explicit platform and executor eligibility", async () => {
    const runner = vi.fn<SystemMemoryCommandRunner>();
    const osProvider = {
      totalmem: vi.fn(() => 1_000),
      freemem: vi.fn(() => 500),
    };

    const unsupported = await buildSystemMemorySnapshot({
      isDesktopMac: false,
      isExecutorEligible: true,
      runner,
      osProvider,
      now: new Date("2026-08-10T20:00:00.000Z"),
    });
    const ineligible = await buildSystemMemorySnapshot({
      isDesktopMac: true,
      isExecutorEligible: false,
      runner,
      osProvider,
      now: new Date("2026-08-10T20:00:00.000Z"),
    });

    expect(unsupported).toMatchObject({
      status: "unavailable",
      reason: "unsupported-platform",
    });
    expect(ineligible).toMatchObject({
      status: "unavailable",
      reason: "ineligible-host",
    });
    expect(runner).not.toHaveBeenCalled();
    expect(osProvider.totalmem).not.toHaveBeenCalled();
  });

  it("uses a fixed, no-shell memory_pressure command on an eligible Mac", async () => {
    const runner = vi.fn<SystemMemoryCommandRunner>().mockResolvedValue({
      stdout: "System-wide memory free percentage: 25%\n",
      stderr: "",
    });

    const result = await buildSystemMemorySnapshot({
      isDesktopMac: true,
      isExecutorEligible: true,
      runner,
      osProvider: { totalmem: () => 8_000, freemem: () => 1 },
      now: new Date("2026-08-10T20:00:00.000Z"),
    });

    expect(runner).toHaveBeenCalledWith(
      "/usr/bin/memory_pressure",
      ["-Q"],
      expect.objectContaining({ shell: false })
    );
    expect(result).toMatchObject({
      status: "ready",
      source: "memory-pressure",
      totalBytes: 8_000,
      availableBytes: 2_000,
      usedBytes: 6_000,
      usedPercent: 75,
      tone: "attention",
    });
  });

  it("falls back to local OS counters when the command fails or is unparseable", async () => {
    const failedRunner = vi
      .fn<SystemMemoryCommandRunner>()
      .mockRejectedValue(new Error("not available"));
    const invalidRunner = vi.fn<SystemMemoryCommandRunner>().mockResolvedValue({
      stdout: "unexpected output",
      stderr: "",
    });
    const options = {
      isDesktopMac: true,
      isExecutorEligible: true,
      osProvider: { totalmem: () => 10_000, freemem: () => 4_000 },
    } as const;

    const failed = await buildSystemMemorySnapshot({ ...options, runner: failedRunner });
    const invalid = await buildSystemMemorySnapshot({ ...options, runner: invalidRunner });

    expect(failed).toMatchObject({
      status: "ready",
      source: "node-os",
      usedPercent: 60,
    });
    expect(invalid).toMatchObject({
      status: "ready",
      source: "node-os",
      usedPercent: 60,
    });
  });

  it("returns a typed error instead of throwing when all local reads fail", async () => {
    const result = await buildSystemMemorySnapshot({
      isDesktopMac: true,
      isExecutorEligible: true,
      runner: vi.fn<SystemMemoryCommandRunner>().mockRejectedValue(new Error("failed")),
      osProvider: {
        totalmem: () => {
          throw new Error("failed");
        },
        freemem: () => 0,
      },
    });

    expect(result).toMatchObject({
      status: "error",
      reason: "memory-read-failed",
    });
  });
});
