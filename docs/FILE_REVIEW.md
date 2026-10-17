# File Review — 0.3.20

Open **Vault Control Center → File Review** to review and file inbox notes. The queue has moved out of Automations. Open a filename, choose **Move**, then choose **Next** to review the next matching file without returning to the list. Next follows the current search and inbox filter, skips files that have left the queue, and disables when no other matching file remains. A move keeps its destination visible for inspection until Next is selected.

The picker accepts selection even when Obsidian delivers it after the close callback. Successful moves are checked against Obsidian's destination inventory before displaying success. Queue and preview refreshes follow both row and preview moves. Existing collision, stale-file, and repeated-move protection remains.

Validation on October 16, 2026: 200 tests, TypeScript, production build, diff checks, and production dependency audit pass. Focused computer-use testing in Obsidian verified the dedicated tab, Escape cancellation, preview Move outside the inboxes (453 → 452), Next opening the remaining matching note, row moves between inboxes with one current-path row and unchanged total, collision refusal without overwriting, and the final move restoring the baseline (452 → 451; zero matching fixture files). A live-test edge case was corrected: Next excludes the current file after an inbox-to-inbox move and updates immediately when search/filter changes. Both were retested in the final build. Filesystem checks confirmed the final locations. Only newly created fixtures were moved; they are retained outside the inboxes. Physical mobile and second-device Sync were not tested.

# Live inbox File review

Version 0.3.16 replaces processing-history membership with a live queue in **Vault Control Center → Automations → File review**. These exact vault-relative folders are watched:

- `AI Team/Formatted_Notes/`
- `AI Team/Team_Inbox/` (verified spelling/case in the canonical vault)
- `AI Team/owner_inbox/`

All files known to Obsidian beneath these roots are included recursively, at every depth and regardless of format, processing history, prior dismissal, archive-like folder names or filename keywords. No twelve-file cap applies. Hidden files excluded from Obsidian's own vault inventory are not indexed. Files outside these roots never appear, even if a processing dashboard or old journal lists them. No workflow runs, schedules, credentials or unrelated queue policies change.

The list groups by current inbox folder with counts, exact current paths, filename/path search and an inbox filter. **Refresh files** rescans only the queue without refreshing or starting automations. Filename buttons open the shared preview where permitted by its existing policy; files outside that preview policy open directly in a native tab. Underlined paths always open the exact current file in the reusable Obsidian document tab. Deleted, replaced or relocated objects are rechecked at activation.

**Move** uses the native searchable existing-folder picker and `app.fileManager.renameFile`, preserving Obsidian's configured link-update behavior. Escape cancels; same-folder choices do nothing. Collisions, missing folders, stale selections, replacements and overlapping move requests cannot overwrite another file. Destination choices retain the existing dashboard exclusions. File review itself never rewrites content, frontmatter or tags; other installed metadata plugins may react to Obsidian moves normally.

In local build **0.3.17**, Move is also available in the opened preview's upper-right action group, immediately after Edit and before Open in tab. The folder-input icon has a descriptive accessible label and a minimum 44 px touch target. The picker is shared with the existing row action, locks repeated taps/selection while active, releases on cancellation or errors, and refreshes the current preview path plus live queue after a move. This action always targets one captured file identity and location.

Moving outside all three roots removes the file and updates the queue total, matching count and empty state. Moving within or between roots leaves one row at the current path under its current inbox. Vault create, delete and rename events (including folder events) rebuild the in-memory inventory and repaint only File review immediately, independent of automation/broker status refresh. The visible **Refresh files** button rescans these three roots without running or refreshing automations. Plugin reload also reconstructs membership from the current inventory, so offline moves require no saved path recovery.

The prior workflow filter, processing-day grouping, provenance expansion, Locate, Dismiss and Show dismissed controls are removed from this queue. The legacy `Artifacts/Vault Control Center Native Plugin/File Review Records.json` remains untouched: it is neither read nor written by the live queue and does not influence membership. Processing dashboards remain intact and accessible through their usual workflow links.

## Focused validation

The five live-membership scenarios cover recursive exact-root inventory (including unknown formats and archive-like subfolders), external create/delete/replacement and movement, folder movement and unavailable roots, inbox/search filtering, and dashboard Move within/between/outside roots. The existing Move and exact-path opening regressions remain. Membership refresh performs no content reads, hashing, file writes or persistence. Desktop verification on October 2 used a disposable note: creation raised the live total from 391 to 392; filename preview opened its content; the native Move picker moved it between watched inboxes; an external filesystem move into Owner Inbox/Run Reports displayed the current nested path once; native Move outside the three roots returned the count to 391 and the search to zero matches. The fixture was removed through Obsidian Trash. No real user file was moved or processor started. Physical mobile/second-device acceptance is outside this focused check; the implementation uses portable Obsidian APIs and the release includes BRAT runtime assets.

Validation: 188 tests and the production build pass. The production dependency audit is clean. The full audit reports the existing moderate Moment advisory through the development-only Obsidian SDK; npm recommends a breaking SDK downgrade, which was not applied.
