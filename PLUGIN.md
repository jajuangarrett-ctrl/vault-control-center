# Vault Control Center plugin guide

## Purpose

Vault Control Center is a standalone native Obsidian community plugin. It presents live operational views without embedding an HTML dashboard, invoking a local server, or persisting a snapshot of vault content.

## Architecture

- `src/plugin.ts` owns lifecycle, commands, settings migration, refresh scheduling, and theme cleanup.
- `src/view.ts` owns the native `ItemView`, routes, search, cache policy, and native opening behavior.
- `src/data.ts` builds the in-memory vault index and applies privacy filters.
- `src/program-navigation.ts` owns recursive folder views and safe route-wide Areas/Programs file search.
- `src/taskboard.ts` owns optional read-only network access and credential boundaries.
- `src/renderers.ts` renders all nine routes with native DOM elements.
- `src/settings.ts` exposes source paths, theme controls, and opt-in integrations.
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
- `task-capture:capture`

Missing companion commands produce an Obsidian notice and do not create files.

## Data and security boundary

The plugin persists validated settings only. Derived file lists, queue records, people records, bookmark results, and taskboard results remain in memory.

The optional taskboard connection is disabled by default. A separate connection uses an HTTPS endpoint and an Obsidian Secret Storage selection. Best-effort Task Capture reuse is isolated behind a narrow adapter because it depends on another plugin's runtime shape. Every URL is validated before a credential is sent.

Automatic refreshes reuse remote data for five minutes. Initial open, changed integration settings, the Refresh button, and the refresh command can fetch remote data.

## Areas and Programs search

Any nonblank query on Areas or Programs replaces the folder drill-down with one wide list of every safe matching file across the active route. Matching uses the file name and full folder path. Exact paths repeated through the synthetic **All Areas** root are shown once, while same-named files in different folders remain separate.

Search does not mutate the selected root or nested folder. **Clear search** restores the exact pre-search folder view. Opening a result uses the shared dashboard preview, and Back returns to the same query and result row. A route-level empty state handles zero matches, and long result paths wrap across desktop, split-pane, and mobile layouts.

## Build and verification

```bash
npm ci
npm run check
```

Before a release:

1. Confirm both theme modes and coordinated-shell cleanup in Obsidian.
2. Verify all nine routes, route-wide Areas/Programs search and clearing, no-results recovery, search-result preview/Back, refresh, the root-rail disclosure, compact preview actions, wrapped paths, split-pane responsiveness, and mobile-width layout.
3. Run a credential and machine-path scan across source and `main.js`.
4. Confirm `npm audit` reports no known vulnerabilities.
5. Update `package.json`, `package-lock.json`, `manifest.json`, `versions.json`, and `CHANGELOG.md` together.
6. Tag the version and attach `main.js`, `manifest.json`, and `styles.css` to the GitHub release.

## Release assets

BRAT-compatible releases must include these runtime files at the repository root and as release attachments:

- `main.js`
- `manifest.json`
- `styles.css`
