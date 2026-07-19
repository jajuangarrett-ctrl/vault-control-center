# Vault Control Center design system

Vault Control Center is an operational workspace, not a marketing dashboard. Its visual language is compact and native to Obsidian: one shared information architecture, one component system, a persistent file-preview experience, and two coordinated throwback token sets.

## Product principles

1. Put capture and current work above the fold.
2. Prefer dense rows and grouped work regions over decorative cards.
3. Use gold for active navigation, orange for operational signals, and royal blue for focus and links.
4. Keep navigation stable across all nine routes.
5. Make every visible count, file, person, area, and program actionable.
6. Read live vault state at runtime; never bundle personal vault data.

## Reference concepts

- `vault-control-center-dark-concept.png` — desktop dark mode and full Obsidian shell.
- `vault-control-center-light-concept.png` — the exact desktop structure in light mode.
- `vault-control-center-mobile-dark-concept.png` — touch-first responsive hierarchy.

These are legacy structure references rather than current palette references. Names and values shown in them are illustrative. The current color system was derived from Franklin's supplied old-school Golden State Warriors jersey reference: deep navy fabric, royal-blue depth, golden-yellow trim, orange outlines, and a warm cream light-mode ground. Sports branding and imagery are intentionally not placed in the product UI.

## Color tokens

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#0a1238` | `#fffdf5` |
| Surface | `#111d4f` | `#f1f4ff` |
| Raised surface | `#1a2a64` | `#e5eaff` |
| Primary text | `#f8faff` | `#151b4b` |
| Muted text | `#c7cde0` | `#586184` |
| Border | `#344781` | `#cbd3f1` |
| Signal orange | `#f47a24` | `#c64b0a` |
| Golden accent | `#ffc72c` | `#e9ab00` |
| Royal-blue accent | `#83a2ff` | `#3049a8` |
| Positive | `#83d16b` | `#477e33` |
| Critical | `#ff6b67` | `#b52f36` |

Gold appears on the active route, preview trim, and small selected details. Orange remains the operational signal rail, selected-row rail, and urgent indicator. Royal blue is reserved for links, planning states, secondary emphasis, and visible focus. Bright gold is decorative in light mode; readable small text uses a darker ochre token.

## Typography and rhythm

- Use Obsidian's interface font stack so the dashboard belongs inside the host application.
- Page title: 28px desktop, 22px mobile, 700 weight.
- Section label: 11px, 700 weight, uppercase, 0.12em tracking.
- Row title: 13–14px, 600 weight.
- Supporting metadata: 11–12px, muted.
- Base spacing unit: 4px. Common gaps: 8, 12, 16, 24px.
- General controls are at least 36px high on desktop and 44px on touch devices. Compact preview and folder-rail chrome may use 32px desktop controls with explicit accessible labels; those controls expand to at least 44px on touch devices.

## Container model

The plugin renders one native `ItemView` with five persistent layers:

1. Header: title, search, refresh, and theme toggle.
2. Route strip: Home, Areas, Programs, AI Team, Recent, Bookmarks, People, Clipboard, Settings.
3. Route content: live, replaceable work region whose navigation and filters survive preview actions.
4. Preview pane: a sibling of route content, split beside it on desktop and replacing only the route region on mobile.
5. Mobile action dock: Home, Areas, Programs, Capture, Recent, More; hidden while the full-width mobile preview is open.

Areas and Programs divide route content into a root-folder rail and a detail browser. The rail can retract to a 44px disclosure strip without losing the selected root or nested folder. With a preview open, the default two-column workspace uses a measured 49/51 route-to-preview balance, and the note receives roughly 55% while that rail is retracted; hiding all files gives the note nearly the full frame. Rendered Markdown fills the preview's inner width rather than introducing a second character-based width cap.

A nonblank query temporarily replaces that rail/detail composition with one wide route-level result panel. The result set spans every safe file in the active Areas or Programs route, while the underlying root and nested-folder selection remains unchanged for clearing search.

The Home route adds three stacked operational bands:

- Four capture actions.
- An orange-edged signal strip with four live counts.
- A responsive work grid for current programs, latest files, and people radar.

The orange signal rail is the signature visual element. It should remain visible at desktop and mobile widths.

## Components

- `RouteTab`: text label, active underline, keyboard-operable.
- `CaptureAction`: icon, label, and a clear open affordance.
- `Signal`: icon, label, live value, optional attention dot.
- `WorkPanel`: section label, optional action, bordered row region.
- `FileRow`: file icon, basename, compact path, and relative modified time or a contextual viewed-status label.
- `PreviewPane`: compact Back, file title/path/size, safe read-only renderer, **Hide files** / **Show files** expansion, and the only **Open in tab** escape.
- `FolderRailDisclosure`: Areas/Programs control that retracts or restores the root list while preserving route, folder, focus, and assistive-technology state.
- `FolderSearchResults`: wide Areas/Programs result panel with a live count, clear action, wrapped full paths, no-results guidance, and normal previewable file rows.
- `FolderRootRow`: area or program name, file count, modified time, open action.
- `QueueRow`: direct safe, supported file from a configured active queue; queue lists are complete rather than preview-capped.
- `PersonRow`: initials, name, agenda count, modified time.
- `FilterChip`: compact filter with selected state.
- `EmptyState`: useful explanation and the next available action.
- `Toast`: use Obsidian `Notice`; do not invent a parallel notification system.

Use Obsidian's icon set through `setIcon`. Do not ship an unrelated icon family.

## Interaction rules

- Clicking a file previews it inside the dashboard without replacing the dashboard leaf.
- Clicking an area, program, or folder drills into its route detail; only file rows invoke the preview.
- The Areas/Programs root rail retracts independently of the preview. Its disclosure retains focus, exposes its expanded state, and does not reset the selected root or folder.
- **Open in tab** is the only file action that deliberately opens Obsidian's native viewer/editor outside the dashboard. Its first use creates one editor tab, and later uses reuse that tab unless Franklin closes or pins it.
- **Hide files** temporarily collapses the whole route browser on desktop; **Show files** restores the wider preview split and the previous root-rail state without changing route state.
- Markdown internal links resolve into the same preview pane; HTTP(S) links remain external.
- Back and Escape close the preview and restore route-row focus. Slow earlier renders cannot overwrite a later file selection.
- Rendered Markdown, long note titles, and long paths must wrap within the preview's actual inner width at every display scale; tables and code blocks may scroll inside their own bounded region.
- `/` focuses dashboard search when the view is active.
- On Areas and Programs, a nonblank search replaces drill-down with every safe matching file across the active route. It matches file names and full folder paths, deduplicates exact paths repeated through **All Areas**, and keeps same-named files at different paths.
- Searching never mutates the selected root or nested folder. **Clear search** restores the exact folder view, while preview and Back preserve the query, result list, selected-row state, and focus return target.
- A zero-match query presents one route-wide empty state with a clear recovery action rather than a misleading folder selection.
- Refresh immediately rebuilds the live index and reports completion.
- Owner Inbox and Team Inbox counts represent direct active files only; nested subfolders are intentionally outside those queue counts.
- Recent places the dashboard's capped safe-path preview history first, then prioritizes an enabled Recent Files plugin in file-open mode before appending native history. Configured modified-time roots are used only when viewed history is unavailable.
- Theme changes update the dashboard and, when enabled, the coordinated shell class.
- Clipboard templates are editable, copyable, resettable, and stored only as preferences.
- Sensitive or archived paths are excluded before display.

## Responsive behavior

| Width | Behavior |
| --- | --- |
| `>= 1180px` | Three-column Home work grid when closed; preview opens as a sticky right-hand split pane. |
| `760–1179px` | Two-column work grid; People moves to a full-width row; preview keeps a minimum readable width. |
| `< 760px` | One-column route, horizontally scrollable route strip, 2×2 capture and signal grids; preview replaces the route region and hides the mobile dock until closed. |
| `< 420px` | Compact labels and metadata; preserve 44px targets and never truncate the primary action. |

When the Areas or Programs route region itself falls below 560px, its root rail and detail browser stack. A retracted rail becomes a compact horizontal disclosure row so its restore action remains available. The lower threshold preserves the two-column folder browser in medium desktop panes after the outer workspace was rebalanced.

Route-wide search results stay a single column at every width. File names and full paths wrap inside each row, and opening a result uses the existing full-width mobile preview below 760px; Back restores the responsive result list.

At narrow widths, content order is Capture → Signals → Current work → Latest files → People. No desktop-only action may become unreachable.

## Accessibility

- Maintain WCAG AA contrast for text and controls.
- Show a visible two-pixel focus ring using the cool accent.
- Never communicate state by color alone; pair it with text or an icon.
- Respect `prefers-reduced-motion` and avoid structural animation.
- Use native buttons and inputs with explicit accessible labels.
- Keep route selection and disclosure state available to assistive technology.
- Label the preview region and title, use status/alert semantics, keep 44px mobile controls, and make the covered mobile route inert while the preview is open.

## Shell theme boundary

The plugin may coordinate Obsidian chrome only while its explicit body class is enabled. Shell variables cover the title bar, tabs, ribbons, sidebars, status bar, menus, modals, settings, search, and tooltips. Unloading or disabling the option must remove every plugin-owned body class. The plugin never rewrites the user's installed Obsidian theme.

## Above-the-fold copy inventory

- Vault Control Center
- Search this tab
- Refresh
- Dark mode / Light mode
- Nine route labels
- Thought, Email, Agenda item, Program update
- Programs, AI queues, Agenda files, Open tasks
- Current work, Latest files, People radar

Additional explanatory prose belongs in empty states or Settings, not in the primary operational surface.
