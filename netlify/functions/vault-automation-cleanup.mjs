import { getStore } from "@netlify/blobs";
import { createAutomationBroker } from "./_shared/automation-broker.mjs";

export default async function cleanupVaultAutomationQueue() {
  const store = getStore({ name: "vault-automation-queue", consistency: "strong" });
  const result = await createAutomationBroker(store).cleanup();
  return new Response(JSON.stringify({ removed: result.removed }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const config = {
  schedule: "17 4 * * *",
};
