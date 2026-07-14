# Visual fidelity ledger

The implementation was compared against the selected reference workflow and the three concept studies in `docs/design/`. Concept names and values are illustrative; verification uses the live native Obsidian view.

| Reference characteristic | Implemented result | Verification |
| --- | --- | --- |
| One stable structure across themes | Header, nine-route strip, content region, and mobile dock are identical in dark and light modes | Theme toggle exercised in Obsidian; both states visually inspected |
| Restrained navy shell with orange signals | Navy canvas/surfaces, orange active rail and selections, blue secondary accent | Token comparison against `DESIGN.md`; actual shell inspected |
| Capture-first hierarchy | Four capture actions remain the first Home band and preserve clear open affordances | Desktop, narrow-pane, and mobile-width fixture checks |
| Dense operational rows instead of decorative bento cards | Areas, programs, files, people, bookmarks, queues, and tasks use compact actionable rows | All nine routes exercised with live data |
| Coordinated host application | Optional body classes theme tabs, ribbons, sidebars, menus, settings, and status chrome | Enabled in both themes; unload/disable cleanup verified in code and app |
| Responsive 2×2 signal/capture grids | Container queries respond to the dashboard pane, not only the window; mobile adds a six-action dock | Computed-width checks at desktop, narrow pane, and 390px viewport |
| Live, actionable content | Counts and rows come from the Vault API; files and bookmarks open natively | Live source counts and route actions tested in Obsidian |
| Privacy before presentation | Sensitive/archived items are excluded before rendering; URL metadata is origin-only | Unit regressions cover delimiter variants, bookmark credentials, and query secrets |
| Reference-inspired progress language | Program groups use actual recency and file counts instead of fictional completion percentages | Deliberate product adaptation; preserves the visual rhythm without inventing data |
