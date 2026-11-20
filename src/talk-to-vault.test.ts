import { describe, expect, it, vi } from "vitest";
import { launchTalkToVault } from "./talk-to-vault";

const duo = "fjg-file-focus-duo:talk-to-vault";
const objectives = "fjg-task-manager:talk-to-dashboard";

describe("Talk to Vault Home launch", () => {
  it("only opens File Focus Duo when present, even if both providers are enabled", () => {
    const execute = vi.fn(() => true);
    expect(launchTalkToVault(execute)).toBe("opened");
    expect(execute.mock.calls).toEqual([[duo]]);
  });

  it("uses Objective Manager if the Duo command is unavailable", () => {
    const execute = vi.fn((id: string) => id === objectives);
    expect(launchTalkToVault(execute)).toBe("opened");
    expect(execute.mock.calls).toEqual([[duo], [objectives]]);
  });

  it("fails closed if neither command is available", () => {
    const execute = vi.fn(() => false);
    expect(launchTalkToVault(execute)).toBe("unavailable");
    expect(execute.mock.calls).toEqual([[duo], [objectives]]);
  });

  it("does not start a second provider if the first errors after starting", () => {
    const execute = vi.fn(() => { throw new Error("Provider failed"); });
    expect(launchTalkToVault(execute)).toBe("failed");
    expect(execute.mock.calls).toEqual([[duo]]);
  });
});
