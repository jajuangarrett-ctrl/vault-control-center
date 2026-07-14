# Vault Control Center design system

Vault Control Center is an operational workspace, not a marketing dashboard. Its visual language is compact, quiet, and native to Obsidian: one shared information architecture, one component system, and two coordinated token sets.

## Product principles

1. Put capture and current work above the fold.
2. Prefer dense rows and grouped work regions over decorative cards.
3. Use orange as a signal, never as a background wash.
4. Keep navigation stable across all nine routes.
5. Make every visible count, file, person, area, and program actionable.
6. Read live vault state at runtime; never bundle personal vault data.

## Reference concepts

- `vault-control-center-dark-concept.png` — desktop dark mode and full Obsidian shell.
- `vault-control-center-light-concept.png` — the exact desktop structure in light mode.
- `vault-control-center-mobile-dark-concept.png` — touch-first responsive hierarchy.

These are visual targets rather than literal screenshots. Names and values shown in them are illustrative.

## Color tokens

| Role | Dark | Light |
| --- | --- | --- |
| Canvas | `#071826` | `#ffffff` |
| Surface | `#0b2438` | `#f3f7fa` |
| Raised surface | `#12334a` | `#eaf1f6` |
| Primary text | `#eaf2f7` | `#0b2545` |
| Muted text | `#93a9b8` | `#566c7d` |
| Border | `#28485c` | `#d2dee7` |
| Signal orange | `#f47a24` | `#e86f1c` |
| Cool accent | `#3ba6c9` | `#157b9a` |
| Positive | `#8bcf62` | `#5f9f3c` |
| Critical | `#ff5c5c` | `#cc3c3c` |

Orange appears on the active route, the signal rail, capture emphasis, selected states, and urgent task indicators. Cool blue is reserved for links, planning states, and secondary focus.

## Typography and rhythm

- Use Obsidian's interface font stack so the dashboard belongs inside the host application.
- Page title: 28px desktop, 22px mobile, 700 weight.
- Section label: 11px, 700 weight, uppercase, 0.12em tracking.
- Row title: 13–14px, 600 weight.
- Supporting metadata: 11–12px, muted.
- Base spacing unit: 4px. Common gaps: 8, 12, 16, 24px.
- Controls are at least 36px high on desktop and 44px on touch devices.

## Container model

The plugin renders one native `ItemView` with four persistent layers:

1. Header: title, search, refresh, and theme toggle.
2. Route strip: Home, Areas, Programs, AI Team, Recent, Bookmarks, People, Clipboard, Settings.
3. Route content: live, replaceable work region.
4. Mobile action dock: Home, Areas, Programs, Capture, Recent, More.

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
- `FolderRootRow`: area or program name, file count, modified time, open action.
- `QueueRow`: direct safe, supported file from a configured active queue; queue lists are complete rather than preview-capped.
- `PersonRow`: initials, name, agenda count, modified time.
- `FilterChip`: compact filter with selected state.
- `EmptyState`: useful explanation and the next available action.
- `Toast`: use Obsidian `Notice`; do not invent a parallel notification system.

Use Obsidian's icon set through `setIcon`. Do not ship an unrelated icon family.

## Interaction rules

- Clicking a file opens it in an Obsidian leaf.
- Clicking an area, program, or folder opens its route detail, then offers native file actions.
- `/` focuses dashboard search when the view is active.
- Search filters the current route without leaving the keyboard.
- Refresh immediately rebuilds the live index and reports completion.
- Owner Inbox and Team Inbox counts represent direct active files only; nested subfolders are intentionally outside those queue counts.
- Recent follows Obsidian's vault-wide file-open history, prioritizing an enabled Recent Files plugin in file-open mode before appending native history, and uses configured modified-time roots only when viewed history is unavailable.
- Theme changes update the dashboard and, when enabled, the coordinated shell class.
- Clipboard templates are editable, copyable, resettable, and stored only as preferences.
- Sensitive or archived paths are excluded before display.

## Responsive behavior

| Width | Behavior |
| --- | --- |
| `>= 1180px` | Three-column Home work grid; full header actions and route labels. |
| `760–1179px` | Two-column work grid; People moves to a full-width row. |
| `< 760px` | One column, horizontally scrollable route strip, 2×2 capture and signal grids, sticky mobile dock. |
| `< 420px` | Compact labels and metadata; preserve 44px targets and never truncate the primary action. |

At narrow widths, content order is Capture → Signals → Current work → Latest files → People. No desktop-only action may become unreachable.

## Accessibility

- Maintain WCAG AA contrast for text and controls.
- Show a visible two-pixel focus ring using the cool accent.
- Never communicate state by color alone; pair it with text or an icon.
- Respect `prefers-reduced-motion` and avoid structural animation.
- Use native buttons and inputs with explicit accessible labels.
- Keep route selection and disclosure state available to assistive technology.

## Shell theme boundary

The plugin may coordinate Obsidian chrome only while its explicit body class is enabled. Shell variables cover the title bar, tabs, ribbons, sidebars, status bar, menus, modals, settings, search, and tooltips. Unloading or disabling the option must remove every plugin-owned body class. The plugin never rewrites the user's installed Obsidian theme.

## Above-the-fold copy inventory

- Vault Control Center
- Search vault
- Refresh
- Dark mode / Light mode
- Nine route labels
- Thought, Email, Agenda item, Program update
- Programs, AI queues, Agenda files, Open tasks
- Current work, Latest files, People radar

Additional explanatory prose belongs in empty states or Settings, not in the primary operational surface.
