# Vault Control Center annotated split design QA

- Source visual truth path: `/var/folders/cb/x8yltvld0339lpxj2vnskzcc0000gn/T/codex-clipboard-10947151-3cdd-452c-bcc0-cc2284ad823b.png`
- Browser-rendered implementation screenshot: `/tmp/vcc-v010-final-desktop.png`
- Live Obsidian v0.1.10 search/preview screenshot: `/tmp/vcc-v010-live-search.png`
- Full source/implementation comparison: `/tmp/vcc-v010-design-comparison.png`
- Focused equal-size workspace comparison: `/tmp/vcc-v010-split-comparison.png`
- Primary comparison viewport: 1814 × 1005, matching the dashboard region inside the annotated source.
- Additional widths: 1600 × 1000, 1280 × 800, 1100 × 800, 760 × 800, 759 × 800, and 390 × 844.
- State: light theme, Areas route, route-wide search active, Markdown preview open. Dark theme, normal folder view, retracted rail, Hide/Show files, Back, and mobile overlay states were also checked.

## Source interpretation

The annotation's handwritten reference to the “left hand panel” conflicts with the drawn arrow and bracket. The geometry is unambiguous: the marked divider moves about 100 pixels left, enlarging the right-hand note preview from the existing 44–45% share to roughly 51% while retaining a substantial results panel. The implementation follows that measured drawing rather than returning to the earlier 63–73% preview layout that had disrupted the plugin UX.

The comparison composite confirms that the implemented divider aligns with the marked location. At the primary viewport, the two usable columns measure 869px for results and 905px for preview: 49.0% / 51.0% after excluding the 16px gap.

## Findings and iterations

1. Initial P2 fidelity finding — an exact 1fr/1fr draft was close but did not reproduce the annotation's slight preview preference. Fix: use 0.96fr/1fr. Final evidence: 49.0%/51.0% columns and a roughly 103px leftward divider move at 1600px.
2. Initial P1 responsive finding — widening the preview caused the normal Areas/Programs folder browser to cross its old 639px stacking threshold at a 1280px desktop pane. Fix: lower that nested threshold to 559px. Final evidence: the 1280px route remains side-by-side at 220px/347px, while the 1100px split intentionally stacks without overflow.
3. Initial P2 text-use finding — rendered Markdown still had a nested 78ch maximum, leaving broad empty margins inside the enlarged preview. Fix: remove the character cap and centered margin. Final evidence: the Markdown client width equals its scroll width (903px) with `max-width: none` at the primary viewport.
4. Initial P2 content-density finding — long result paths wrapped, but long file names retained one-line truncation as the results side narrowed. Fix: scope normal wrapping to both title and path inside route-wide folder search only. Final evidence: 760px rows expand vertically without timestamp overlap or horizontal scrolling; preview-closed search also remains bounded at 390px.
5. Final visual pass: no remaining P0, P1, or P2 difference affects the annotated layout intent. Borders, trim, typography, colors, compact controls, and existing Warriors-inspired light/dark tokens remain unchanged.

## Responsive and interaction evidence

- 1280px: normal Areas root rail and detail browser remain side-by-side.
- 1100px: the outer split remains 49/51 and the nested browser stacks intentionally.
- 760px: results and preview remain split at 359px/373px with no clipping.
- 759px: preview changes to a full-width overlay, the route becomes inert/hidden, and Hide files is omitted.
- 390px: preview overlay has no horizontal overflow; the preview-closed result list also stays inside the viewport.
- Hide files expanded the preview without closing it; Show files restored the same search and file selection.
- Back closed the preview, preserved the `att` query and all 11 live results, and restored focus to the originating file row.
- Open in tab remained present in both browser and live Obsidian states.
- Browser console warning/error check returned an empty list.

## Live Obsidian verification

The production v0.1.10 runtime files were copied into the vault plugin directory and Obsidian 1.12.7 was force-reloaded. The persisted Areas search and Markdown preview reopened successfully. In the live vault:

- the search result panel and preview matched the new near-even balance;
- the note body used the additional pane width;
- long names and paths wrapped inside result rows;
- Hide files, Show files, and Back worked without losing search state;
- Back restored focus to the selected search result;
- the preview was reopened and left visible for review.

## Automated verification

- Vitest: 8 files, 94 tests passed.
- TypeScript and production esbuild: passed.
- `npm audit`: 0 vulnerabilities.
- Installed `manifest.json`: 0.1.10.

final result: passed
