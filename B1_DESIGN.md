# B1 data ownership and safety gate

Baseline: ad524421a27af7c80a6a6f67c58c599f439ad20d. Initial changes: only untracked f01.patch and f02.patch; preserve both.

| Field | Existing owner | B1 decision |
| --- | --- | --- |
| Code, name, credits | Course | Reuse |
| Section, instructor | Optional Course fields | Reuse; missing stays null |
| Activity | Optional Course theory/practical | Add lab to accepted values; no conversion of existing values |
| Registration date | Missing | Optional Course.registrationDate, ISO date or null; never inferred from creation time |
| Day, start/end | ScheduleSession | Reuse; one course may have many meetings |
| Room, online location, delivery mode | ScheduleSession | Reuse |

Dexie stores structured-clone objects; these additive unindexed values require no new index, database version, migration or rewrite. Old records without either optional field remain valid. No new identity model. Existing F-01/F-02 validators also validate the optional date when present.

PDF.js is the only new direct dependency: local text extraction, dynamically imported on upload, with a same-origin bundled worker. No document upload, script evaluation, raw-PDF persistence, OCR, or student-header persistence. Limit bytes/pages/text items; destroy cancelled loading tasks. Parse recognized column headers and coordinates, not extraction-array order. Unsupported/ambiguous layouts require manual correction, never fabricated values.

PDF results are memory-only TimetableDraft values. An existing source must be explicitly selected; source IDs are never inferred from file names or contents. Incoming row keys are fresh; the existing review resolves exact candidates or requires explicit identity selection, retains aliases, rejects tombstones, and never replaces saved edits. A changed time without a confident exact identity must be explicitly resolved. All confirmed writes remain saveTimetable's revision-checked transaction.

The saved view and PDF draft view use a scroll-contained semantic table, one course group with individual meeting rows. Existing course/session editors, safe removal, restoration and weekly view stay available. Preview edits invalidate review; exclusion affects only draft rows. Existing final confirmation remains mandatory.
