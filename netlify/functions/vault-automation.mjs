import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import {
  BrokerError,
  createAutomationBroker,
  enforceRateLimit,
} from "./_shared/automation-broker.mjs";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const MAX_BODY_BYTES = 2_048;

export default async function vaultAutomation(request) {
  try {
    const url = new URL(request.url);
    const store = getStore({ name: "vault-automation-queue", consistency: "strong" });
    const broker = createAutomationBroker(store);

    if (url.pathname === "/api/vault-automation/health") {
      requireMethod(request, "GET");
      requireAuth(request, "VCC_AUTOMATION_CLIENT_TOKEN");
      await enforceRateLimit(store, "client-health", 30);
      return json(await broker.getHealth());
    }

    if (url.pathname === "/api/vault-automation/requests") {
      requireMethod(request, "POST");
      requireAuth(request, "VCC_AUTOMATION_CLIENT_TOKEN");
      await enforceRateLimit(store, "client-submit", 10);
      const result = await broker.submitRequest(await readJsonBody(request));
      return json(result, 202);
    }

    const requestMatch = url.pathname.match(
      /^\/api\/vault-automation\/requests\/([0-9a-f-]{36})$/i
    );
    if (requestMatch) {
      requireMethod(request, "GET");
      requireAuth(request, "VCC_AUTOMATION_CLIENT_TOKEN");
      await enforceRateLimit(store, "client-status", 30);
      return json(await broker.getRequestStatus(requestMatch[1]));
    }

    if (url.pathname === "/api/vault-automation/runner/poll") {
      requireMethod(request, "POST");
      requireAuth(request, "VCC_AUTOMATION_EXECUTOR_TOKEN");
      await enforceRateLimit(store, "executor-poll", 30);
      return json(await broker.pollExecutor(await readJsonBody(request)));
    }

    if (url.pathname === "/api/vault-automation/runner/events") {
      requireMethod(request, "POST");
      requireAuth(request, "VCC_AUTOMATION_EXECUTOR_TOKEN");
      await enforceRateLimit(store, "executor-events", 30);
      return json(await broker.recordEvent(await readJsonBody(request)));
    }

    return json({ error: "not-found", message: "Endpoint not found." }, 404);
  } catch (error) {
    if (error instanceof BrokerError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    return json({ error: "service-unavailable", message: "The broker is unavailable." }, 503);
  }
}

export const config = {
  path: [
    "/api/vault-automation/health",
    "/api/vault-automation/requests",
    "/api/vault-automation/requests/:requestId",
    "/api/vault-automation/runner/poll",
    "/api/vault-automation/runner/events",
  ],
  method: ["GET", "POST"],
};

function requireMethod(request, expected) {
  if (request.method !== expected) {
    throw new BrokerError("method-not-allowed", 405, "Method not allowed.");
  }
}

function requireAuth(request, environmentName) {
  const expected = environment(environmentName);
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{43,256})$/);
  if (!expected || !match || !constantTimeEqual(expected, match[1])) {
    throw new BrokerError("unauthorized", 401, "Authentication failed.");
  }
}

async function readJsonBody(request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new BrokerError("body-too-large", 413, "The request body is too large.");
  }
  const text = await request.text();
  if (!text || new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new BrokerError("malformed-request", 400, "The request body is malformed.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new BrokerError("malformed-request", 400, "The request body is malformed.");
  }
}

function environment(name) {
  return globalThis.Netlify?.env?.get(name) ?? process.env[name] ?? "";
}

function constantTimeEqual(left, right) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
