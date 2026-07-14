# Changelog

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
