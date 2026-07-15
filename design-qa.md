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
| Editable split pane | 760–1600px wide | Note pane receives 63–73% of the dashboard width; the file browser receives 27–37%; no horizontal overflow. |
| Collapsed file browser | 1280×900 | **Hide files** expands the note pane to 97% of the available dashboard width; **Show files** restores the split. |
| Live save and restore | Obsidian 1.12.7 | A reversible Markdown edit saved to the vault, rendered immediately, and restored byte-for-byte to its original SHA-256. |
| Conflict and recovery | Obsidian 1.12.7 | An external vault edit blocked Save; the dashboard draft survived tab close/reopen and cleared cleanly on Discard without changing the note. |
| Persistent edit toolbar | 1280×720, 760×900, 390×844 | **Back** and **Open in tab** remain available in edit mode with no horizontal overflow; mobile keeps both as accessible icon controls. A dirty draft blocks Open in tab and returns focus to the editor; after Save, the tab action succeeds. |

## Full-view comparison

The palette source and final dark implementation were opened together in one visual comparison. The dominant navy is preserved as the canvas and surface family; the jersey's yellow trim becomes the active-route and preview-edge gold; orange becomes selection and signal rails; cool royal blue becomes borders, focus, links, and raised depth. The resulting dashboard remains recognizably Vault Control Center rather than resembling a branded sports page.

## Focused comparison and iterations

1. The first split layout left the People panel too narrow at 1280px. A route-scoped container query now changes the Home work region to two columns below 900px and moves People to a full-width row.
2. Four capture and signal columns became cramped when the preview was open. The same route-scoped query now uses 2×2 capture and signal grids.
3. The first 390px preview header allowed the Open-in-tab label to wrap vertically. Narrow layouts now use icon-only Back and Open-in-tab controls while retaining accessible labels in the live plugin.
4. The desktop and mobile fixtures were rechecked after these changes; computed layout reports no horizontal document overflow.

## Functional coverage

- Unit coverage: preview-kind dispatch, editor eligibility, UTF-8 recovery bounds, conflict detection, line-ending preservation, safe history filtering/deduplication/cap, internal-link parsing, preview-history precedence, image/media indexing, recursive folder behavior, privacy filtering, queues, and taskboard behavior.
- Browser fixture: dark/light toggle, split and collapsed preview, Edit/Save/Discard controls, persistent Back/Open-in-tab controls, dirty-draft tab guard, mobile overlay, Back, reopen, Escape, selected row, dock visibility, exact 760px breakpoint, and runtime logs.
- Live Obsidian verification: installed the v0.1.5 editor foundation in Obsidian 1.12.7, cleanly restarted the app, and exercised the actual plugin through Computer Use plus the live Electron DOM. The installed v0.1.6 toolbar refinement was then rechecked in both the browser fixture and the real Obsidian plugin.

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
| Quick-edit tab handoff | In edit mode, Back and Open in tab remained visible. A temporary dirty draft kept the Open action in the pane but blocked the native tab and refocused the editor; Discard restored the vault copy, after which Open created and activated the native note tab. |
| Recent history | After previewing Canvas, HTML, TXT, PNG, and Markdown, Recent listed those dashboard-viewed files in that order with Canvas first. |
| Inbox counts | Owner inbox showed 48 direct files and 48 rows; Team inbox showed 16 direct files and 16 rows. The only extra direct item in each filesystem folder was `.DS_Store`, which is intentionally excluded. |
| Search and filters | Searching Recent for `Thoughts` returned only `09 Thoughts/Thoughts.md`; the Areas filter returned six paths and all began with `03 Areas/`. |
| Other routes | Home capture launcher opened and closed safely; Bookmarks file filtering exposed nine previewable files; People opened an agenda note in the pane; Clipboard exposed three editable templates with Copy/Reset controls; Settings exposed both throwback themes. |
| Refresh | The live Refresh control entered and cleared its refreshing state without losing the Home route. |
| Live layout | At a 793px dashboard width, the pane measured 342px, route content measured 423px, split mode was active, and horizontal overflow was false. |
| Theme tokens | Light: `#fffdf5`, `#f1f4ff`, `#151b4b`, `#c64b0a`, `#e9ab00`, `#3049a8`. Dark: `#0a1238`, `#111d4f`, `#f8faff`, `#f47a24`, `#ffc72c`, `#83a2ff`. |

No Vault Control Center errors were observed in the live console. Existing TaskNotes frontmatter warnings and other unrelated plugin/theme warnings were outside this change.

final result: passed
