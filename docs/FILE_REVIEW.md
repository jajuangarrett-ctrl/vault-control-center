# Live inbox File review

Version 0.3.16 replaces processing-history membership with a live queue in **Vault Control Center → Automations → File review**. These exact vault-relative folders are watched:

- `AI Team/Formatted_Notes/`
- `AI Team/Team_Inbox/` (verified spelling/case in the canonical vault)
- `AI Team/owner_inbox/`

All files known to Obsidian beneath these roots are included recursively, at every depth and regardless of format, processing history, prior dismissal, archive-like folder names or filename keywords. No twelve-file cap applies. Hidden files excluded from Obsidian's own vault inventory are not indexed. Files outside these roots never appear, even if a processing dashboard or old journal lists them. No workflow runs, schedules, credentials or unrelated queue policies change.

The list groups by current inbox folder with counts, exact current paths, filename/path search and an inbox filter. **Refresh files** rescans only the queue without refreshing or starting automations. Filename buttons open the shared preview where permitted by its existing policy; files outside that preview policy open directly in a native tab. Underlined paths always open the exact current file in the reusable Obsidian document tab. Deleted, replaced or relocated objects are rechecked at activation.

**Move** uses the native searchable existing-folder picker and `app.fileManager.renameFile`, preserving Obsidian's configured link-update behavior. Escape cancels; same-folder choices do nothing. Collisions, missing folders, stale selections, replacements and overlapping move requests cannot overwrite another file. Destination choices retain the existing dashboard exclusions. File review itself never rewrites content, frontmatter or tags; other installed metadata plugins may react to Obsidian moves normally.

Moving outside all three roots removes the file and updates the queue total, matching count and empty state. Moving within or between roots leaves one row at the current path under its current inbox. Vault create, delete and rename events (including folder events) rebuild the in-memory inventory and repaint only File review immediately, independent of automation/broker status refresh. The visible **Refresh files** button rescans these three roots without running or refreshing automations. Plugin reload also reconstructs membership from the current inventory, so offline moves require no saved path recovery.

The prior workflow filter, processing-day grouping, provenance expansion, Locate, Dismiss and Show dismissed controls are removed from this queue. The legacy `Artifacts/Vault Control Center Native Plugin/File Review Records.json` remains untouched: it is neither read nor written by the live queue and does not influence membership. Processing dashboards remain intact and accessible through their usual workflow links.

## Focused validation

The five live-membership scenarios cover recursive exact-root inventory (including unknown formats and archive-like subfolders), external create/delete/replacement and movement, folder movement and unavailable roots, inbox/search filtering, and dashboard Move within/between/outside roots. The existing Move and exact-path opening regressions remain. Membership refresh performs no content reads, hashing, file writes or persistence. Desktop verification on October 2 used a disposable note: creation raised the live total from 391 to 392; filename preview opened its content; the native Move picker moved it between watched inboxes; an external filesystem move into Owner Inbox/Run Reports displayed the current nested path once; native Move outside the three roots returned the count to 391 and the search to zero matches. The fixture was removed through Obsidian Trash. No real user file was moved or processor started. Physical mobile/second-device acceptance is outside this focused check; the implementation uses portable Obsidian APIs and the release includes BRAT runtime assets.

Validation: 188 tests and the production build pass. The production dependency audit is clean. The full audit reports the existing moderate Moment advisory through the development-only Obsidian SDK; npm recommends a breaking SDK downgrade, which was not applied.
