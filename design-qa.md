# Design QA — in-dashboard preview and throwback theme

## Visual sources

- Palette reference: `/var/folders/cb/x8yltvld0339lpxj2vnskzcc0000gn/T/codex-clipboard-2ba9acfd-de80-42a7-aa8c-edb410baf288.png`
- Desktop dark implementation: `tests/visual/qa/dashboard-preview-split-dark-final.jpg`
- Desktop light implementation: `tests/visual/qa/dashboard-preview-split-light-final.jpg`
- Mobile dark implementation: `tests/visual/qa/dashboard-preview-mobile-dark-v2.jpg`

The supplied jersey is a color reference, not a request to place sports imagery or branding in the product. The implementation translates its deep navy fabric, royal-blue depth, bright golden trim, and orange outline into accessible dashboard tokens; light mode uses warm cream and pale royal surfaces with darker blue/orange text accents.

## Verified states

| State | Viewport | Result |
| --- | --- | --- |
| Dark split preview | 1280×900 | Route and preview remain readable side by side; route-aware grids collapse to two columns; no horizontal page overflow. |
| Light split preview | 1280×900 | Warm cream canvas, royal-blue text/focus, gold trim, and orange signals preserve hierarchy and contrast. |
| Dark mobile preview | 390×844 | Preview replaces only route content, route tabs remain available, mobile dock hides, icon controls fit, and no horizontal page overflow occurs. |
| Close and reopen | 390×844 | Back restores the dashboard/dock and clears row selection; the file row reopens the preview. |
| Escape | 390×844 | Escape closes the visible preview and restores the route state. |

## Full-view comparison

The palette source and final dark implementation were opened together in one visual comparison. The dominant navy is preserved as the canvas and surface family; the jersey's yellow trim becomes the active-route and preview-edge gold; orange becomes selection and signal rails; cool royal blue becomes borders, focus, links, and raised depth. The resulting dashboard remains recognizably Vault Control Center rather than resembling a branded sports page.

## Focused comparison and iterations

1. The first split layout left the People panel too narrow at 1280px. A route-scoped container query now changes the Home work region to two columns below 900px and moves People to a full-width row.
2. Four capture and signal columns became cramped when the preview was open. The same route-scoped query now uses 2×2 capture and signal grids.
3. The first 390px preview header allowed the Open-in-tab label to wrap vertically. Narrow layouts now use icon-only Back and Open-in-tab controls while retaining accessible labels in the live plugin.
4. The desktop and mobile fixtures were rechecked after these changes; computed layout reports no horizontal document overflow.

## Functional coverage

- Unit coverage: preview-kind dispatch, safe history filtering/deduplication/cap, internal-link parsing, preview-history precedence, image/media indexing, recursive folder behavior, privacy filtering, queues, and taskboard behavior.
- Browser fixture: dark/light toggle, split preview, mobile overlay, Back, reopen, Escape, selected row, dock visibility, and runtime logs.
- Live Obsidian verification: installed v0.1.4 in Obsidian 1.12.7, force-reloaded the app, and exercised the actual plugin through Computer Use plus the live Electron DOM.

## Live Obsidian results

| Check | Result |
| --- | --- |
| Areas drill-down | Recruitment → Hire CalWORKs - ISSP Counselor → 03 Misc stayed in the Areas browser and exposed the correct PDF rows. |
| Programs drill-down | Basic-Needs → Budgets and Funding stayed in the Programs browser and exposed Markdown, PDF, and XLSX rows. |
| Embedded formats | Markdown, PDF, PNG, TXT, HTML source, and Canvas summary rendered inside the shared pane. The live PNG loaded at 636px natural width. |
| Safe fallback | XLSX stayed in the dashboard and displayed `Native preview required`; no blank or outside tab was opened automatically. |
| Markdown links | An internal link from Self Improvement opened its destination inside the same preview pane and kept the dashboard leaf active. |
| Rapid selection | Concurrent large-text and image requests settled on the last selected image without stale content replacing it. |
| Explicit tab action | `Open in tab` increased Markdown leaves from 5 to 6, activated the requested file, and preserved the dashboard plus its preview state. |
| Recent history | After previewing Canvas, HTML, TXT, PNG, and Markdown, Recent listed those dashboard-viewed files in that order with Canvas first. |
| Inbox counts | Owner inbox showed 48 direct files and 48 rows; Team inbox showed 16 direct files and 16 rows. The only extra direct item in each filesystem folder was `.DS_Store`, which is intentionally excluded. |
| Search and filters | Searching Recent for `Thoughts` returned only `09 Thoughts/Thoughts.md`; the Areas filter returned six paths and all began with `03 Areas/`. |
| Other routes | Home capture launcher opened and closed safely; Bookmarks file filtering exposed nine previewable files; People opened an agenda note in the pane; Clipboard exposed three editable templates with Copy/Reset controls; Settings exposed both throwback themes. |
| Refresh | The live Refresh control entered and cleared its refreshing state without losing the Home route. |
| Live layout | At a 793px dashboard width, the pane measured 342px, route content measured 423px, split mode was active, and horizontal overflow was false. |
| Theme tokens | Light: `#fffdf5`, `#f1f4ff`, `#151b4b`, `#c64b0a`, `#e9ab00`, `#3049a8`. Dark: `#0a1238`, `#111d4f`, `#f8faff`, `#f47a24`, `#ffc72c`, `#83a2ff`. |

No Vault Control Center errors were observed in the live console. Existing TaskNotes frontmatter warnings and other unrelated plugin/theme warnings were outside this change.

final result: passed
