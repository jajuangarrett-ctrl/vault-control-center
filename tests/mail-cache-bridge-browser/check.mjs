import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import os from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const [binary, directory = "/tmp/vcc-mail-bridge-browser"] = process.argv.slice(2);
if (!binary) throw new Error("Pass a Chromium or Chrome headless shell executable.");
const profile = await mkdtemp(path.join(os.tmpdir(), "vcc-mail-browser-profile-"));
const child = spawn(binary, [
  "--headless", "--remote-debugging-pipe", "--disable-background-networking", "--disable-extensions",
  "--no-first-run", "--no-default-browser-check", "--disable-sync", "--no-proxy-server",
  "--disable-breakpad", "--disable-crash-reporter",
  "--host-resolver-rules=MAP * ~NOTFOUND", "--user-data-dir=" + profile, "about:blank",
], { stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"] });

let next = 0, received = "";
const pending = new Map();
const exited = new Promise((resolve) => child.once("exit", resolve));
function stopped(error) {
  for (const { reject } of pending.values()) reject(error);
  pending.clear();
}
child.once("error", stopped);
child.once("exit", (code) => stopped(new Error("Chromium closed: " + code)));
child.stdio[3].on("error", stopped);
child.stdio[4].on("data", (chunk) => {
  received += chunk.toString("utf8");
  let end;
  while ((end = received.indexOf("\0")) !== -1) {
    const message = JSON.parse(received.slice(0, end));
    received = received.slice(end + 1);
    const receiver = pending.get(message.id);
    if (receiver) {
      pending.delete(message.id);
      if (message.error) receiver.reject(new Error(JSON.stringify(message.error)));
      else receiver.resolve(message.result);
    }
  }
});
function call(method, params = {}, sessionId) {
  const id = ++next;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
  });
}
const watchdog = setTimeout(() => { stopped(new Error("Browser verification timed out")); child.kill(); }, 18_000);

try {
  const target = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  const evaluate = async (expression) => {
    const reply = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text + ": " + reply.result.description);
    return reply.result.value;
  };
  async function ready(expression) {
    for (let i = 0; i < 45; i += 1) {
      if (await evaluate(expression)) return;
      await delay(50);
    }
    throw new Error("Expected DOM state did not appear: " + expression);
  }
  const url = pathToFileURL(path.join(directory, "index.html")).href;
  const sync = '.fjg-vcc-mail-bridge-sync';
  const state = '.fjg-vcc-mail-bridge-state';
  const refresh = '[aria-label="Refresh status"]';
  const click = async (selector) => {
    const [x, y] = await evaluate(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    })()`);
    for (const type of ["mousePressed", "mouseReleased"]) {
      await call("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }, sessionId);
    }
  };
  await call("Emulation.setDeviceMetricsOverride", { width: 1040, height: 760, mobile: false, deviceScaleFactor: 1 }, sessionId);
  await call("Page.navigate", { url }, sessionId);
  await ready(`document.querySelector('${state}')?.innerText.includes("Ready to sync")`);
  assert.deepEqual(await evaluate(`Array.from(document.querySelectorAll("section button"), b => b.getAttribute("aria-label"))`),
    ["Sync Now", "Refresh status"]);
  assert.equal(await evaluate(`document.body.innerText.includes("Indexed messages") && document.body.innerText.includes("27")`), true);
  assert.equal(await evaluate(`/Reload Obsidian|Scheduled vault processors|Always-on Mac RAM/.test(document.body.innerText)`), false);
  await evaluate(`document.querySelector('${sync}').click()`);
  assert.equal(await evaluate("fixture.requests()"), 0, "synthetic DOM click must not dispatch");
  await click(sync);
  await ready(`document.body.innerText.includes("Sync requested. Waiting")`);
  assert.equal(await evaluate(`document.querySelector('${sync}').disabled`), true);
  await click(sync);
  assert.equal(await evaluate("fixture.requests()"), 1, "repeat click must not dispatch");
  await evaluate(`fixture.setStatus("syncing", false, true)`);
  await click(refresh);
  await ready(`document.body.innerText.includes("Mail Cache Bridge accepted the request.")`);
  assert.equal(await evaluate(`document.querySelector('${state}').innerText.includes("Syncing Inbox")`), true);
  await evaluate(`fixture.setStatus("completed", false, true)`);
  await click(refresh);
  await ready(`document.querySelector('${state}').innerText.includes("Sync complete")`);
  assert.equal(await evaluate(`document.querySelector('${sync}').disabled`), false);
  await evaluate(`fixture.setStatus("completed", true)`);
  await click(refresh);
  await ready(`document.querySelector('${state}').innerText.includes("Bridge not responding")`);
  assert.equal(await evaluate(`document.querySelector('${sync}').disabled`), true);

  for (const width of [375, 756]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 720, mobile: true, deviceScaleFactor: 1 }, sessionId);
    await call("Page.navigate", { url: url + "?mobile=" + width }, sessionId);
    await ready(`document.querySelector('${state}')?.innerText.includes("Available on Mac")`);
    assert.equal(await evaluate(`document.querySelector('${sync}').disabled`), true);
    assert.equal(await evaluate("fixture.reads() + fixture.requests()"), 0);
    assert.equal(await evaluate(`document.querySelector('.fjg-vcc-mail-bridge-summary').hidden`), true);
    assert.equal(await evaluate(`document.querySelector('.fjg-vcc-mail-bridge').getBoundingClientRect().right <= innerWidth`), true);
  }
  console.log("VCC Mail Cache Bridge browser: trusted Sync Now, duplicate guard, matching receipt, completion, stale state, compact and unfolded mobile passed.");
} finally {
  clearTimeout(watchdog);
  child.kill();
  await Promise.race([exited, delay(1500)]);
  await rm(profile, { recursive: true, force: true });
}
