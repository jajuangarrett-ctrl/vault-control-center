import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => mocks.requestUrl.mockReset());

  it("does not make a network request until an integration is enabled", async () => {
    const result = await fetchTaskboardSnapshot(fakeApp(), DISABLED_SETTINGS);
    expect(result.status).toBe("disabled");
    expect(mocks.requestUrl).not.toHaveBeenCalled();
  });

  it("uses an enabled Secret Storage connection before the optional adapter", async () => {
    mocks.requestUrl.mockResolvedValue({ status: 200, json: { tasks: [] } });
    const result = await fetchTaskboardSnapshot(fakeApp(), {
      reuseTaskCaptureConnection: true,
      enableRemoteTaskboard: true,
      taskboardUrl: "https://tasks.example.com",
      taskboardSecretId: "dashboard-password",
    });

    expect(result.status).toBe("ready");
    expect(mocks.requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://tasks.example.com/api/tasks",
        headers: { "X-Dashboard-Password": "separate-secret" },
      })
    );
  });

  it("accepts a short non-whitespace secret managed by Obsidian", async () => {
    mocks.requestUrl.mockResolvedValue({ status: 200, json: { tasks: [] } });
    const result = await fetchTaskboardSnapshot(fakeApp({ secret: "abc" }), {
      ...DISABLED_SETTINGS,
      enableRemoteTaskboard: true,
      taskboardUrl: "https://tasks.example.com",
      taskboardSecretId: "short-secret",
    });

    expect(result.status).toBe("ready");
    expect(mocks.requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "X-Dashboard-Password": "abc" } })
    );
  });

  it("rejects missing secrets and malformed responses without leaking request details", async () => {
    const missingSecret = await fetchTaskboardSnapshot(fakeApp({ secret: null }), {
      ...DISABLED_SETTINGS,
      enableRemoteTaskboard: true,
      taskboardUrl: "https://tasks.example.com",
      taskboardSecretId: "missing",
    });
    expect(missingSecret.status).toBe("unconfigured");
    expect(mocks.requestUrl).not.toHaveBeenCalled();

    mocks.requestUrl.mockResolvedValue({ status: 200, json: { unexpected: [] } });
    const malformed = await fetchTaskboardSnapshot(fakeApp(), {
      ...DISABLED_SETTINGS,
      enableRemoteTaskboard: true,
      taskboardUrl: "https://tasks.example.com",
      taskboardSecretId: "dashboard-password",
    });
    expect(malformed.status).toBe("error");
    expect(malformed.error).toBe("Taskboard returned an invalid response.");
  });

  it("uses the best-effort Task Capture adapter only when explicitly enabled", async () => {
    mocks.requestUrl.mockResolvedValue({ status: 200, json: { tasks: [] } });
    const result = await fetchTaskboardSnapshot(fakeApp(), {
      ...DISABLED_SETTINGS,
      reuseTaskCaptureConnection: true,
    });

    expect(result.status).toBe("ready");
    expect(mocks.requestUrl).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://capture.example.com/api/tasks" })
    );
  });
});

function fakeApp(options: { secret?: string | null } = {}): App {
  return {
    secretStorage: {
      getSecret: () => (Object.prototype.hasOwnProperty.call(options, "secret") ? options.secret ?? null : "separate-secret"),
    },
    plugins: {
      getPlugin: () => ({
        settings: {
          taskboardApiUrl: "https://capture.example.com",
          dashboardPassword: "capture-secret",
        },
      }),
    },
  } as unknown as App;
}
