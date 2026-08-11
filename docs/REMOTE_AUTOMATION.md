# Remote automation broker and runner

## Security model

Vault Control Center remote automation is a dedicated fixed-ID system. It is not shared with Agent Mission Control and cannot accept prompts, commands, paths, arguments, environment variables, scripts, or executable content.

The only remote mappings are:

| Automation ID | Current-user launchd label |
| --- | --- |
| `clippings` | `com.franklingarrett.clippings-inbox-sort` |
| `root-inbox` | `com.franklingarrett.root-inbox-sort` |
| `iflytek-notes` | `com.franklingarrett.iflytek-notes-process` |
| `youtube-notes` | `com.franklingarrett.youtube-transcript-note` |
| `fjg-capture-transcripts` | `com.franklingarrett.fjg-capture-transcripts-process` |
| `weekly-learning-review` | `com.franklingarrett.codex-weekly-learning-review` |

Mira email filing remains status-only because it has no verified launchd label. Services, repository sync, disabled, missing, high-impact, unverified, and external jobs are never remote-runnable and remain absent from the visible Services and Repository Sync section.

The broker requires separate Netlify environment secrets for clients and the executor. Requests use short expirations and UUID replay keys. Netlify Blobs conditional writes provide atomic create, claim, and per-job in-flight locks. The runner checks the harmless `com.fjg.vault-automation-executor` sentinel and exact target label for every claim, rejects a running target, and executes only:

```text
/bin/launchctl kickstart gui/<current-user-uid>/<fixed-label>
```

The runner never uses `-k`, sudo, a shell, or network-supplied subprocess arguments. Its credential is stored in macOS Keychain. Its private journal, rotated logs, and non-secret configuration are stored outside the synchronized vault with owner-only permissions.

## Netlify project

- Site: `fjg-vault-automation-broker`
- Production URL: `https://fjg-vault-automation-broker.netlify.app`
- Queue store: `vault-automation-queue`
- Functions: `vault-automation` and `vault-automation-cleanup`
- Environment variables: `VCC_AUTOMATION_CLIENT_TOKEN` and `VCC_AUTOMATION_EXECUTOR_TOKEN`

Never store either token in this repository, the vault, plugin `data.json`, a plist, a log, or chat. Use base64url credentials with at least 256 bits of randomness.

## Executor installation

The installer copies the runner outside the vault, creates a non-secret broker configuration, installs the harmless sentinel and poller as current-user LaunchAgents, and never creates or changes any scheduled processor job.

```bash
scripts/install-vault-automation-runner.sh https://fjg-vault-automation-broker.netlify.app
```

The executor token must already exist in the login Keychain under service `com.fjg.vault-automation-runner`, account `executor`. The LaunchAgent contains no secret. Verify both dedicated labels in the current user's domain:

```bash
launchctl print gui/$(id -u)/com.fjg.vault-automation-executor
launchctl print gui/$(id -u)/com.fjg.vault-automation-runner
```

## Main-Mac pairing

On the main Mac, generate the client token locally, save it directly into Obsidian Secret Storage, and set the same value in the Netlify production environment without displaying it. In Vault Control Center settings, enable remote automation controls, set the broker URL, and select that secret. The settings file stores only the secret identifier.

## Validation boundary

Live validation may use authenticated health and deliberately invalid/non-executing requests. Do not submit a valid routine ID during acceptance testing. A real processor should run only after Franklin deliberately selects **Run now** in the dashboard.
