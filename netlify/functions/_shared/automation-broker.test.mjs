import { describe, expect, it } from "vitest";
import {
  BrokerError,
  createAutomationBroker,
} from "./automation-broker.mjs";

const NOW = new Date("2026-08-10T20:00:00.000Z");
const REQUEST_ID = "7a1de905-6768-4d3d-a94d-4ac2e0fa90a1";

describe("dedicated automation broker", () => {
  it("queues and atomically claims a valid fixed-ID request", async () => {
    const store = memoryStore();
    const broker = createAutomationBroker(store, { now: () => NOW });
    const queued = await broker.submitRequest(validRequest());
    const poll = await broker.pollExecutor(validHeartbeat());

    expect(queued).toMatchObject({ state: "queued", jobId: "clippings", requestId: REQUEST_ID });
    expect(poll).toEqual({
      executorAccepted: true,
      request: validRequest(),
    });
    expect((await broker.getRequestStatus(REQUEST_ID)).state).toBe("claimed");
  });

  it("rejects unknown IDs, executable fields, expired requests, and replayed IDs", async () => {
    const broker = createAutomationBroker(memoryStore(), { now: () => NOW });
    await expect(broker.submitRequest({ ...validRequest(), jobId: "shell" }))
      .rejects.toMatchObject({ code: "unknown-job", status: 400 });
    await expect(broker.submitRequest({ ...validRequest(), command: "echo no" }))
      .rejects.toMatchObject({ code: "malformed-request", status: 400 });
    await expect(
      broker.submitRequest({
        ...validRequest(),
        requestedAt: "2026-08-10T19:58:00.000Z",
        expiresAt: "2026-08-10T19:59:00.000Z",
      })
    ).rejects.toMatchObject({ code: "invalid-request-time", status: 400 });

    await broker.submitRequest(validRequest());
    await expect(broker.submitRequest(validRequest()))
      .rejects.toMatchObject({ code: "duplicate-request", status: 409 });
  });

  it("enforces one in-flight request per automation", async () => {
    const broker = createAutomationBroker(memoryStore(), { now: () => NOW });
    await broker.submitRequest(validRequest());
    await expect(
      broker.submitRequest({
        ...validRequest(),
        requestId: "58c5ce86-8ca0-44b6-814c-010cd6f631b2",
      })
    ).rejects.toMatchObject({ code: "already-in-flight", status: 409 });
  });

  it("will not claim when the executor sentinel is absent", async () => {
    const broker = createAutomationBroker(memoryStore(), { now: () => NOW });
    await broker.submitRequest(validRequest());
    const result = await broker.pollExecutor({ ...validHeartbeat(), sentinelLoaded: false, runnableJobIds: [], memory: null });
    expect(result).toEqual({ executorAccepted: false, request: null });
    expect((await broker.getHealth()).executor.reachable).toBe(false);
  });

  it("records only bounded terminal runner states and releases the per-job lock", async () => {
    const broker = createAutomationBroker(memoryStore(), { now: () => NOW });
    await broker.submitRequest(validRequest());
    await broker.pollExecutor(validHeartbeat());
    const started = await broker.recordEvent({
      requestId: REQUEST_ID,
      jobId: "clippings",
      state: "started",
      occurredAt: NOW.toISOString(),
      reasonCode: "launchctl-accepted",
    });
    expect(started).toMatchObject({ state: "started", reasonCode: "launchctl-accepted" });

    await expect(
      broker.recordEvent({
        requestId: REQUEST_ID,
        jobId: "clippings",
        state: "started",
        occurredAt: NOW.toISOString(),
        reasonCode: "runner-error",
      })
    ).rejects.toBeInstanceOf(BrokerError);

    await expect(
      broker.submitRequest({
        ...validRequest(),
        requestId: "58c5ce86-8ca0-44b6-814c-010cd6f631b2",
      })
    ).resolves.toMatchObject({ state: "queued" });
  });

  it("returns a sanitized reachable executor and RAM health response", async () => {
    const broker = createAutomationBroker(memoryStore(), { now: () => NOW });
    await broker.pollExecutor(validHeartbeat());
    expect(await broker.getHealth()).toEqual({
      status: "ok",
      checkedAt: NOW.toISOString(),
      executor: {
        reachable: true,
        observedAt: NOW.toISOString(),
        sentinelLoaded: true,
        runnableJobIds: ["clippings", "root-inbox"],
      },
      memory: {
        totalBytes: 16_000,
        usedBytes: 8_000,
        freePercent: 50,
        usedPercent: 50,
        checkedAt: NOW.toISOString(),
      },
    });
  });
});

function validRequest() {
  return {
    jobId: "clippings",
    requestId: REQUEST_ID,
    requestedAt: NOW.toISOString(),
    expiresAt: "2026-08-10T20:01:00.000Z",
  };
}

function validHeartbeat() {
  return {
    observedAt: NOW.toISOString(),
    sentinelLoaded: true,
    runnableJobIds: ["clippings", "root-inbox"],
    memory: { totalBytes: 16_000, usedBytes: 8_000, freePercent: 50, usedPercent: 50 },
  };
}

function memoryStore() {
  const entries = new Map();
  let sequence = 0;
  return {
    async setJSON(key, value, options = {}) {
      const existing = entries.get(key);
      if (options.onlyIfNew && existing) return { modified: false };
      if (options.onlyIfMatch && existing?.etag !== options.onlyIfMatch) return { modified: false };
      if (options.onlyIfMatch && !existing) return { modified: false };
      const etag = `\"${++sequence}\"`;
      entries.set(key, { data: structuredClone(value), etag });
      return { modified: true, etag };
    },
    async getWithMetadata(key) {
      const value = entries.get(key);
      return value ? structuredClone(value) : null;
    },
    async list({ prefix = "" } = {}) {
      return {
        blobs: [...entries.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => ({ key, etag: value.etag })),
      };
    },
    async delete(key) {
      entries.delete(key);
    },
  };
}
