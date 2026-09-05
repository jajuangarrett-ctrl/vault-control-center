# Vault Control Center plugin guide

## Purpose

Vault Control Center is a standalone native Obsidian community plugin. It presents eleven live operational views without embedding an HTML dashboard, invoking a local server, or persisting a snapshot of vault content. Finished HTML artifacts are cataloged as vault files; a registered desktop viewer opens them in a reusable native tab, with a safe source-preview fallback on unsupported devices.

## Architecture

- `src/plugin.ts` owns lifecycle, commands, settings migration, refresh scheduling, and theme cleanup.
- `src/view.ts` owns the native `ItemView`, routes, search, cache policy, and in-dashboard preview behavior.
- `src/native-markdown-editor.ts` owns the race-safe lifecycle for the native `MarkdownView` embedded by the preview pane.
- `src/reusable-file-leaf.ts` keeps one unpinned native editor tab available for repeated **Open in tab** actions without replacing the dashboard.
- `src/data.ts` builds the in-memory vault index and applies privacy filters.
- `src/program-navigation.ts` owns recursive folder views and safe route-wide Areas/Programs file search.
- `src/html-gallery.ts` discovers safe finished HTML files, caches concurrency-bounded metadata parsing, derives stable thumbnail paths, and performs explicitly requested Quick Look generation.
- `src/automations.ts` owns the fixed automation inventory, synchronized status parsing, local launchd inspection, executor detection, and allowlisted local routine starts.
- `src/remote-automation.ts` owns the fail-closed broker client, Secret Storage lookup, remote executor health, sanitized RAM parsing, and fixed-ID request submission.
- `src/system-memory.ts` reads RAM only after the desktop-macOS and executor-host guards pass.
- `src/taskboard.ts` derives the Home task summary from local FJG Task Manager workspace notes; the older remote adapter remains inert compatibility code in v0.2.0.
- `src/renderers.ts` renders all eleven routes with native DOM elements.
- `src/settings.ts` exposes source paths, HTML runtime paths, theme controls, and retained compatibility settings.
- `styles.css` contains scoped component, responsive, and optional shell-theme rules.

## Commands

- **Vault Control Center: Open dashboard**
- **Vault Control Center: Refresh dashboard data**

The ribbon icon opens or reveals the existing dashboard leaf.

Home capture actions delegate to these optional command IDs:

- `thought-capture:capture`
- `email-capture:capture`
- `agenda-capture:capture`
- `program-update-capture:capture`

Missing companion commands produce an Obsidian notice and do not create files.

The Home task panel delegates its primary action to `fjg-task-manager:open-dashboard`. Task rows themselves open their local `task.md` files through the shared dashboard preview.

## Data and security boundary

The plugin persists validated settings only. Derived file lists, queue records, people records, bookmark results, task-workspace results, automation state, and RAM readings remain in memory. A capped safe-path preview history and the folder-rail disclosure state may remain in Obsidian workspace state. Explicitly generated HTML thumbnails are the intentional derived-file exception and are stored in the configured vault-relative runtime folder.

Vault content discovery stays inside the configured vault roots and applies the shared sensitive, hidden, and archived-path filters. HTML discovery adds mechanical exclusions for inbox/queue, development, build, test, template, and reusable-design-system paths. Metadata reads are capped, individual file errors fail open to a fallback card, and HTML source is never executed by the gallery.

On desktop macOS, **Update previews** invokes `/usr/bin/qlmanage` with `execFile`, an argument vector, `shell: false`, bounded time/buffer/concurrency settings, and one temporary directory per artifact. The explicit UI action regenerates the current gallery so changes in linked assets are reflected. Temporary output is removed after each attempt, and final PNGs are written through Obsidian's vault API with shared-folder and duplicate-file race recovery.

The Automations route uses only the compiled `FJG_AUTOMATION_ALLOWLIST`. Vault status notes can report results but cannot introduce a command or change a launchd label. Local checks and starts use `/bin/launchctl` through `execFile` with `shell: false`. On a non-executor device, the optional dedicated broker accepts only the six compiled routine IDs plus one distinct fixed `reload-obsidian` application action, each with four bounded request fields. The reload action is not a processor or **Run now** job and invokes only Obsidian's bundled CLI with its fixed in-app `app:reload` command after the executor reports capability. The broker uses separate client/executor authentication, short expirations, replay protection, conditional claims, rate limits, and one in-flight lock per job. Its current-user runner freshly verifies `com.fjg.vault-automation-executor`, the exact mapped target, and the target's non-running state before the same no-shell `kickstart` vector. `-k`, sudo, shells, paths, arguments, environment input, scripts, prompts, and executable content are never accepted. Service, high-impact, disabled, external, missing, status-only, unknown, expired, replayed, unloaded, and already-running requests are rejected.

RAM status uses the same proven-executor gate. It reads local counters on the executor Mac or a sanitized fresh authenticated heartbeat from the remote runner; it never substitutes the current device's RAM on a non-executor Mac, Windows/Linux desktop, or mobile device.

The v0.2.0 FJG Task Manager integration reads only `08 Tasks/Workspaces/*/task.md`, excludes completed and archived workspaces from the open count, sorts **Do First** tasks by due date, and renders at most eight task rows. It performs no taskboard network request. Retained remote-taskboard settings and adapter code do not supply the Home panel in this version.

## HTML gallery

The HTML route builds a live, searchable card catalog from the configured `htmlRoots`. Cards use capped, cached, concurrency-bounded `<title>` and description parsing, fall back safely when a file cannot be read, and sort newest first. Each source path maps to a stable 16-hex PNG name under `htmlThumbnailFolder`, allowing the portable thumbnails to sync independently of the development repository. Selecting a card uses the registered desktop HTML view through the same reusable native tab controller as **Open in tab**; unavailable or failed interactive opens fall back to the escaped in-dashboard source preview.

Thumbnail generation is intentionally unavailable outside desktop Obsidian on macOS or when the vault does not use a local `FileSystemAdapter`. Browsing already-indexed artifacts and synchronized thumbnails remains available on other devices, where card selection opens the safe source preview rather than executing the HTML.

## Automation inventory and RAM

The Automations route displays scheduled vault processors and external/cloud entries. Services and repository-sync entries remain part of the internal safety-reviewed inventory but are intentionally omitted from the dashboard. Synchronized status notes are readable on every device. Desktop macOS additionally checks each verified launchd label with `launchctl print`. This produces an executor/non-executor/unsupported state that governs every manual control and the RAM card; hostname alone is never treated as proof of executor identity.

The fixed inventory and manual policies are:

- **Routine, eligible only after all executor/load checks:** Clippings inbox, Root inbox, iFLYTEK notes, YouTube transcript notes, FJG capture transcripts, and Weekly Codex learning review.
- **Status only:** Mira email filing and Mira local sync; Outlook local exporter is also status-only and marked as an expected missing service.
- **Continuous service:** Agent Mission Control runner.
- **High impact, blocked:** Codex repository auto-commit.
- **Disabled:** Plugin repository auto-pull and iOS repository auto-pull.
- **External:** Gmail capture and Netlify retention cleanup.

Only the routine vault processors with verified labels can expose **Run now**, either locally on the confirmed executor or remotely when a fresh broker heartbeat reports the fixed job ID ready. External cloud jobs remain visible but non-runnable; continuous services, repository-committing jobs, disabled legacy sync, and missing services are omitted from the visible dashboard. RAM refreshes every 30 seconds while this route is open and can also be refreshed with the route status action.

The dedicated broker lives under `netlify/functions/`, and the current-user runner and LaunchAgent templates live under `scripts/` and `runner/`. See `docs/REMOTE_AUTOMATION.md` for installation, credential, validation, and pairing procedures.

## FJG Task Manager

The Home signal and task panel derive their counts from the local folder-based task workspaces. `totalCount` includes every matching workspace task file; `openCount` excludes `completed` and `archived`; the visible list contains only `do-first` work. A task row previews that workspace's `task.md`, while **Task Manager** executes `fjg-task-manager:open-dashboard` and reports when the companion plugin is not enabled.

## Areas and Programs search

Any nonblank query on Areas or Programs replaces the folder drill-down with one wide list of every safe matching file across the active route. Matching uses the file name and full folder path. Exact paths repeated through the synthetic **All Areas** root are shown once, while same-named files in different folders remain separate.

Search does not mutate the selected root or nested folder. **Clear search** restores the exact pre-search folder view. Opening a result uses the shared dashboard preview, and Back returns to the same query and result row. A route-level empty state handles zero matches, and long result file names and paths wrap across desktop, split-pane, and mobile layouts.

## Preview layout

The normal desktop workspace gives roughly 49% of the two-column space to route content and 51% to the preview. Rendered Markdown uses the pane's full inner width rather than a separate character-based cap. Markdown notes expose **Edit**, which mounts Obsidian's native `MarkdownView` and CodeMirror source editor inside the same pane; **Preview** runs the native close/save lifecycle before restoring rendered Markdown. Automatic vault refreshes leave an active editor mounted so cursor and scroll state survive autosaves. Retracting the Areas/Programs root rail still gives the pane roughly 55%, **Hide files** still expands it to nearly the full dashboard, and widths below 760px still use the full-width overlay. **Open in tab** creates one native editor tab when needed and reuses it for later files; closing or pinning that tab makes the next action create a fresh reusable tab.

## Build and verification

```bash
npm ci
npm run check
```

Before a release:

1. Confirm both theme modes and coordinated-shell cleanup in Obsidian.
2. Verify all eleven routes, route-wide Areas/Programs search and clearing, no-results recovery, search-result preview/Back, native Markdown Edit/Preview saving and cursor stability, HTML discovery/search/opening and Quick Look fallbacks, cross-device automation status, executor-only routine starts and RAM, FJG Task Manager counts/rows/command delegation, refresh, the root-rail disclosure, compact preview actions, reusable native editor-tab behavior, wrapped paths, split-pane responsiveness, and mobile-width layout.
3. Run a credential and machine-path scan across source, generated runtime paths, and `main.js`.
4. Confirm `npm audit` reports no known vulnerabilities.
5. Update `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` together.
6. Tag the version and attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## Release assets

BRAT-compatible releases must include these runtime files at the repository root and as release attachments:

- `main.js`
- `manifest.json`
- `styles.css`
