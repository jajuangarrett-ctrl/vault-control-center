# Automation file review

Open **Vault Control Center → Automations → File review**, above the existing RAM and workflow controls. Search filenames, paths, or workflow names, or filter to one workflow. Each file appears once with its current vault-relative path. Expand **Processing history** for dates, original input names, and links to the authoritative processing dashboards. Select the filename to preview it.

**Move** opens Obsidian's searchable native folder picker. Choosing an existing folder moves that one file; Escape cancels. The filename stays the same. The operation uses `app.fileManager.renameFile`, so Obsidian applies the user's link-update preference. Vault Control Center does not rewrite note content or tags. Other installed plugins can react normally: on Franklin's installation, File Focus maintains the existing `location` metadata after a move.

The picker excludes hidden, archived, and sensitive folders according to existing dashboard path policy. It includes the vault root. A same-folder choice is a no-op. Filename collisions never overwrite; a missing folder, replaced file, or file relocated after the picker opened rejects the selection. Missing history targets remain visible with Move disabled. There is no bulk-move action.

## Sources

Only the currently published processed-output rows in the following nine fixed source tables grant display membership. Queue rows, input/source links, archived-original columns, ancillary reports, arbitrary links, file modification times and saved journal records never add rows. The processing details show the exact source section, column and dashboard output separately from the original input.

| Workflow | Vault-relative dashboard | History section / output column |
| --- | --- | --- |
| Vault Folder Processing | `Artifacts/Vault Folder Processing Workflow/Vault Folder Processing Dashboard.md` | Organization History / Destination |
| Clippings | `Clippings/Clippings Processing Dashboard.md` | Complete Processing History / Filed record |
| Root Inbox | `00 Inbox/Inbox Processing Dashboard.md` | Complete Processing History / Filed record |
| Mira | `AI Team/Mira Emails/Processed Emails/Mira Email Processing Dashboard.md` | Processed Email History / Filed record |
| iFLYTEK | `00 Inbox/Iflytex Notes/Processed/iFLYTEK Notes Processing Dashboard.md` | Formatted Note History / Formatted note |
| YouTube | `00 Inbox/YouTube Videos to Process/Processed YT Videos/YouTube Processing Dashboard.md` | Processing History / Formatted note |
| FJG Capture | `00 Inbox/FJG Capture Transcripts/Processed/FJG Capture Transcripts Processing Dashboard.md` | Formatted Note History / Formatted note |
| Vocci | `Artifacts/Vocci Notes Processing Workflow/Vocci Notes Processing Dashboard.md` | Processing History / Verbatim Vocci note |
| Formatted Notes Filing | `AI Team/Formatted_Notes/Formatted Notes Filing Dashboard.md` | Filing History / Filed note |

This scope is independent of automation execution permissions. No processors, schedules, broker settings, credentials, or executor configuration are changed.

## Current locations and retention

Paths resolve exactly. Legacy producer links containing an absolute path through the current vault's name are converted to vault-relative paths. Significant spaces within folder names are preserved. For subsequent filing, only explicit source-to-destination records currently present in these nine tables supply a chain; ambiguous chains stop. Same filenames elsewhere never trigger a fallback. Histories for the same final path are combined into one row.

Observed history and user-selected move locations are retained in `Artifacts/Vault Control Center Native Plugin/File Review Records.json`. This is portable runtime data, containing provenance and paths rather than note contents. Refresh rereads both this synchronized file and the nine dashboards. The journal is a correction/history store, not an inclusion source: an entry absent from the current dashboards remains saved but is hidden. Dated location corrections survive reload and newer synchronized corrections take precedence only for the matching current output; reusing an event key for a different output does not transfer an old correction. Malformed saved JSON is reported and left untouched. Obsidian Sync's ordinary file-conflict behavior still applies if multiple devices edit simultaneously; physical second-device acceptance was not performed.

The plugin observes rename/delete events while loaded. Moves made while the plugin is unavailable require updated source history or a previously retained correction; it does not invent a new location. **Refresh status** rereads sources. New outputs are retained when the plugin observes them. If a producer later shortens its dashboard, those saved records remain preserved but no longer appear in File review. Missing, unreadable or unrecognized dashboards contribute no rows until their valid output tables return. This does not reconstruct previously omitted history, nor record runs that never publish a valid output row. The Vault Folder dashboard currently caps its history at 250 rows. Sensitive and archived output paths follow the dashboard's exclusions.

The first live read on September 18, 2026 found 536 eligible history entries, grouped into 477 file rows: 444 exact current targets and 33 missing/stale targets. These are observed source counts, not a completeness claim.

## Focused acceptance

- Automated parsing verifies section/column specificity, escaped table pipes, preserved folder spaces, legacy absolute paths, unsafe-path rejection, explicit filing chains and ambiguity.
- Move tests cover cancellation/same-folder no-ops, single FileManager execution, collisions, missing destinations, missing/replaced/relocated files, API failure and overlapping requests.
- Persistence tests cover combined workflow provenance, observed rename/reload, delete/replacement protection, synchronized location corrections, and unreadable-state protection.
- Live Obsidian tests used only disposable notes: native picker search and Escape, collision rejection, successful relocation and incoming wikilink update, stale-picker rejection after an external fixture move, and disabled Move after fixture deletion. Fixture bodies and the collision note remained intact; File Focus updated managed location metadata.
- All disposable files and injected fixture records were removed. Existing user notes were not moved and real processors were not started. The pre-existing Copy path regression suite passes.

## Scope correction in 0.3.10

The source-to-row audit found zero cache-only live events at the time of inspection: the 536 eligible events were all present in the nine tables (two additional sensitive-path Root Inbox records were excluded by existing path policy). The prior implementation nevertheless used the accumulated journal for membership, so an output removed from a table could have remained visible indefinitely, and a cached filing record could have redirected a current row. Version 0.3.10 rebuilds membership and filing chains from current tables on each refresh. No journal cleanup or note deletion is used to achieve the scope change.

Regression checks cover cache-only records and chains, emptied/removed/unreadable/unrecognized source tables, a corrected file disappearing and reappearing in a dashboard, event-key reuse for a different output, and output-only column selection across all nine schemas. The existing move and Copy path tests remain passing.
