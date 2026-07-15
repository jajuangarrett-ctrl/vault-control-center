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
- Live Obsidian verification: documented after the installed-build pass.

final result: passed
