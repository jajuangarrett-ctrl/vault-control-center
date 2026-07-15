# Changelog

## 0.1.6 — 2026-07-15

- Kept **Back** and **Open in tab** visible while a note is in dashboard edit mode, so quick edits and full-tab editing remain part of one clear workflow.
- Protected unsaved dashboard edits by requiring them to be saved or discarded before the same note opens in a native Obsidian tab.

## 0.1.5 — 2026-07-15

- Made Markdown, TXT, CSV, HTML-source, and JSON previews editable inside the dashboard with explicit **Edit**, **Save**, and **Discard changes** actions plus Command/Ctrl+S.
- Added exact-source conflict protection so a vault file changed elsewhere is never overwritten by an older dashboard draft.
- Added one bounded temporary recovery draft for safe unsaved text edits, including close/reopen recovery, file-rename-safe cleanup, privacy/type/size revalidation, and automatic removal of unusable recovery records.
- Rebalanced the desktop preview to use roughly 63–73% of the available width and most of the available height; added **Hide files** / **Show files** so the note can expand to nearly the full dashboard.
- Kept compact mobile behavior below 760px, removed pane-height overflow, and prevented the preview header and path bar from shrinking into the note body.

## 0.1.4 — 2026-07-14

- Added a shared in-dashboard preview pane across Home, Areas, Programs, AI Team, Recent, Bookmarks, and People, so normal file clicks no longer replace or leave the dashboard.
- Added safe embedded previews for Markdown, text, CSV, HTML source, JSON, images, audio, video, PDF, and a bounded Canvas summary; Office and unsupported formats stay in the pane with an explicit native **Open in tab** action.
- Preserved route, folder, filter, query, scroll, and focus state while previewing; added Escape/Back behavior, selected-row state, internal Markdown-link routing, stale-render protection, and responsive mobile overlay behavior.
- Added dashboard preview history ahead of native/plugin open history so Recent accurately reflects files viewed inside Vault Control Center, while retaining only a capped list of safe paths in Obsidian workspace state.
- Expanded the live index to supported image, media, and JSON formats so those files are visible and previewable in Areas, Programs, queues, bookmarks, and Recent.
- Rebuilt dark and light themes around the supplied throwback Warriors palette: deep navy, royal blue, golden yellow, orange, and warm cream, including the optional coordinated Obsidian shell.

## 0.1.3 — 2026-07-14

- Corrected AI Team queue counts and lists so Owner Inbox and Team Inbox show every direct safe, supported file, without the former twelve-file display cap.
- Kept nested subfolders outside the active inbox queues so filed, grouped, or otherwise nested material does not inflate actionable queue counts.
- Changed Recent to follow Obsidian's actual file-open history across the vault, prioritizing the enabled Recent Files plugin's file-open sequence when available and appending Obsidian's native history.
- Retained modified-time activity from configured recent roots only as a fallback when no viewed-file history is available.

## 0.1.2 — 2026-07-14

- Added an Areas route between Home and Programs with a configurable vault-relative source.
- Indexed safe folders explicitly so empty Areas folders remain visible and navigable.
- Indexed every safe, supported file under Areas, including files stored directly at the root and files nested at any depth.
- Added top-level Area selection plus recursive folder drill-down, breadcrumbs, Up navigation, search, and native file opening.

## 0.1.1 — 2026-07-14

- Fixed Program subfolder controls so they drill down inside the dashboard instead of opening an arbitrary descendant file.
- Added recursive folder navigation with breadcrumbs, an Up action, direct-file lists, descendant counts, and current-folder Open Latest behavior.
- Removed the 12-file Program preview cap so every safe file remains available at any nesting depth.
- Added deep-tree, stale-path, boundary, privacy, and large-program regression coverage.

## 0.1.0 — 2026-07-13

- Replaced the HTML-launcher workflow with a native Obsidian `ItemView`.
- Added Home, Programs, AI Team, Recent, Bookmarks, People, Clipboard, and Settings views.
- Added live vault indexing, source-health states, search, filters, native file opening, and capture-command dispatch.
- Added coordinated navy/orange dark and light themes, optional shell theming, container-responsive layouts, and a mobile action dock.
- Added editable clipboard templates and an optional read-only taskboard summary.
- Added opt-in Secret Storage integration, HTTPS validation, remote-result caching, sensitive-path filtering, and bookmark URL sanitization.
- Added strict settings validation, automated data/security tests, and production build checks.
