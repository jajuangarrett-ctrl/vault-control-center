# Visual fidelity ledger

The implementation was compared against the selected reference workflow and the three concept studies in `docs/design/`. Concept names and values are illustrative; verification uses the live native Obsidian view.

| Reference characteristic | Implemented result | Verification |
| --- | --- | --- |
| One stable structure across themes | Header, nine-route strip, content region, and mobile dock are identical in dark and light modes | Theme toggle exercised in Obsidian; both states visually inspected |
| Throwback Warriors palette without sports branding | Deep navy and royal-blue depth, golden active trim, orange signal rails, and warm cream light mode translate the supplied jersey reference into product tokens | Source image and final implementation screenshot reviewed together; token contrast and actual shell inspected |
| Capture-first hierarchy | Four capture actions remain the first Home band and preserve clear open affordances | Desktop, narrow-pane, and mobile-width fixture checks |
| Dense operational rows instead of decorative bento cards | Areas, programs, files, people, bookmarks, queues, and tasks use compact actionable rows | All nine routes exercised with live data |
| Coordinated host application | Optional body classes theme tabs, ribbons, sidebars, menus, settings, and status chrome | Enabled in both themes; unload/disable cleanup verified in code and app |
| Responsive preview composition | Route-aware container queries collapse capture, signals, and work grids when the preview narrows the route; mobile preview replaces only route content and hides the dock | Computed-width/overflow checks at 1280×900 and 390×844 plus live Obsidian inspection |
| Live, actionable content | Counts and rows come from the Vault API; vault files and bookmark folders preview in the dashboard, while HTTP(S) bookmarks remain external | All file-bearing routes, safe renderers, fallback states, and the explicit Open-in-tab escape tested in Obsidian |
| Actionable inbox semantics | Owner Inbox and Team Inbox show every direct safe, supported file; nested subfolders are excluded from active counts and lists | Queue fixtures cover more than twelve direct files plus nested material |
| Viewed-history recency | Recent starts with capped safe dashboard preview history, then the enabled Recent Files plugin's file-open sequence and native history; modified-time roots remain a no-history fallback | Preview/native/plugin priority, configuration, deduplication, filtering, cap, and fallback fixtures |
| Preview state preservation | Preview is a persistent sibling of replaceable route content; route, search, folder, filter, scroll, and focus state remain intact | Close/Back/Escape, selected-row, rapid-switch, theme rebuild, and refresh behavior exercised |
| Privacy before presentation | Sensitive/archived items are excluded before rendering; URL metadata is origin-only | Unit regressions cover delimiter variants, bookmark credentials, and query secrets |
| Reference-inspired progress language | Program groups use actual recency and file counts instead of fictional completion percentages | Deliberate product adaptation; preserves the visual rhythm without inventing data |
