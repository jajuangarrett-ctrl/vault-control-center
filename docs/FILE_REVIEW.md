# Automation file review

Open **Vault Control Center → Automations → File review**, above the existing RAM and workflow controls. Search filenames, paths, or workflow names, or filter to one workflow. Each file appears once with its current vault-relative path. Expand **Processing history** for dates, original input names, and links to the authoritative processing dashboards. Select the filename to preview it. The displayed current document path is a separate underlined link: click it, or focus it with Tab and press Enter, to open the exact file in Obsidian’s reusable native document tab. The visible text stays vault-relative, including meaningful spaces and Unicode characters. Missing files show non-actionable path text; a file moved or replaced since rendering is rechecked at activation. Refreshed rows link to their verified current location.

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

Observed history and user-selected move locations are retained in `Artifacts/Vault Control Center Native Plugin/File Review Records.json`. This is portable runtime data, containing provenance, paths and SHA-256 fingerprints, never document contents. Refresh rereads both this synchronized file and the nine dashboards. The journal is a correction/history store, not an inclusion source: an entry absent from the current dashboards remains saved but is hidden. Dated location corrections survive reload and newer synchronized corrections take precedence only for the matching current output; reusing an event key for a different output does not transfer an old correction. Malformed saved JSON is reported and left untouched. Obsidian Sync's ordinary file-conflict behavior still applies if multiple devices edit simultaneously; physical second-device acceptance was not performed.

The plugin observes rename/delete events while loaded, including child file identities after folder renames. Version 0.3.12 can also recover unobserved moves using the verified identity rules below. **Refresh status** rereads sources. New outputs are retained when the plugin observes them. If a producer later shortens its dashboard, those saved records remain preserved but no longer appear in File review. Missing, unreadable or unrecognized dashboards contribute no rows until their valid output tables return. This does not reconstruct previously omitted history, nor record runs that never publish a valid output row. The Vault Folder dashboard currently caps its history at 250 rows. Sensitive and archived output paths follow the dashboard's exclusions.

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

## Current-path links in 0.3.11

The path link uses an accessible link role with Tab focus and Enter activation. Activation goes through the existing reusable document-tab controller with an exact `TFile` identity check rather than URI parsing or filename lookup. Tests cover Markdown and SVG targets, Unicode and significant spaces, missing/replaced files, stale paths after a move, and the refreshed current path. The filename continues to open the shared preview.

## Verified recovery and Locate file in 0.3.12

Refresh captures a read-only SHA-256 fingerprint and byte length for eligible, resolved dashboard outputs. No identifiers, frontmatter or tags are added to documents. If a tracked path later disappears, recovery compares its saved fingerprint against every eligible same-size candidate. Only a unique exact byte match after a complete check reconnects the file. Duplicate content stays unresolved. Filename similarity, creation times and fuzzy text matches never establish identity. This works for Markdown and binary documents; metadata edits are content changes too.

Existing missing files without a baseline cannot be recovered automatically. **Locate file** opens Obsidian's searchable native file picker, displaying complete current vault-relative paths. Enter selects the intended document and records the explicit association for all histories in that row; Escape cancels without a correction. Selection does not move or rewrite the document. The picker excludes sensitive/archived/hidden files and the review journal. It rechecks file object, path and stat snapshot, plus current dashboard event/output membership, before saving; a changed, removed or replaced selection is rejected. The chosen path and verification method are retained in history, and the direct link and Move action become available.

Newly bound files with a saved baseline must verify their exact content, including after reload. An offline edit may therefore require Locate even at the same path. Live edits to the already-bound file refresh its baseline. Exact duplicate bytes cannot distinguish the original from a copy: recovery is based on unique eligible content evidence, not a filesystem inode guarantee. Files over 16 MiB remain reviewable and manually locatable, but receive no automatic content fingerprint. Explicit path associations without fingerprints retain the existing path-based resolution limitation after reload.

Recovery never changes membership: current outputs from the same nine tables remain the sole inclusion source. The journal keeps distinct output revisions when a producer reuses an event ID; an old correction cannot attach to a newly named output. Removing a source row hides it; restoring it restores its own correction. Ordinary Obsidian Sync carries the journal, subject to normal sync conflicts and device clock ordering. Physical second-device testing was not performed.

Hashing starts at most 128 reads and 64 MiB per refresh, skips individual files over 16 MiB, and stops starting reads after 1.5 seconds. An already-started read may finish later. Incomplete checks stay unresolved and continue on later refreshes using cached results. Candidates are filtered by byte length before reading; digest caching uses the live file object and path/size/mtime/ctime, and observed modifications invalidate it. This avoids rehashing an unchanged vault every 30 seconds. Errors or concurrent candidate changes cannot establish uniqueness. Changes that preserve all filesystem metadata while evading Obsidian events require a reload or explicit Locate to re-read that file.

On the main Mac's 7,410-file vault, bounded baseline batches measured 79–87 ms; subsequent unchanged refreshes took 26–32 ms with zero binary reads. All 477 source-backed rows remained present, with 444 available and 33 pre-existing missing; 443 available files received fingerprints, with one above the per-file size cap. These are measured results for this vault, not universal latency guarantees.

## Collapsible processing days in 0.3.12

Each day has a native keyboard-accessible disclosure header and filtered file count, newest first. The newest day starts expanded and older days collapsed. A file with several processing events appears once under its latest valid processing day; all earlier events remain in Processing history. Dates use the calendar date written by the producer without timezone conversion. Unparseable dates group under **Unknown processing date**.

Day choices survive ordinary refreshes and route changes while the dashboard view remains open. They reset after plugin reload or closing the dashboard. Search and workflow filters apply before grouping, so counts represent matching files. Filtered results initially expose all matching days; disclosure choices are remembered separately for each filter combination, preserving the unfiltered view's choices.

Focused checks cover unique Markdown/SVG recovery and persistence after an unobserved move, duplicate-content rejection, edited/missing baselines, explicit Locate and cancel, stale file/history selection, merged histories, source disappearance/reappearance and event-key reuse, exact open/Move after recovery, bounded hashing/cache reuse, day ordering, merged-event dates, disclosure choices and filtered counts. Live disposable-file checks complement automated regressions; real notes and processor controls are not used as test fixtures.

Live acceptance used a disposable SVG and isolated dashboard/journal adapter: a missed move recovered after constructing a fresh store and persisted through another reload; native Locate search/Enter associated it without changing bytes, Escape preserved the journal, direct opening selected that exact file, and the native Move picker relocated it. Native processing-day disclosure retained its collapsed state through refresh; Enter toggled it, and filename filtering produced two matching files under one expanded day with count 2. All fixture files were removed through Obsidian Trash. No real dashboard tables were changed. Automated suite: 198 passing tests; production build and dependency audit passed.
