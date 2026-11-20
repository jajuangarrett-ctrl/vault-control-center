const PROVIDER_COMMANDS = [
  "fjg-file-focus-duo:talk-to-vault",
  "fjg-task-manager:talk-to-dashboard",
] as const;

export type TalkToVaultOutcome = "opened" | "unavailable" | "failed";

/** Route an explicit gesture to exactly one provider; never create a session here. */
export function launchTalkToVault(executeCommand: (id: string) => boolean): TalkToVaultOutcome {
  for (const id of PROVIDER_COMMANDS) {
    try {
      if (executeCommand(id)) return "opened";
    } catch {
      // A throwing command may already have started opening. Do not start a second provider.
      return "failed";
    }
  }
  return "unavailable";
}
