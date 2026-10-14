# Development log

## 2026-10-14 — Phase 0 foundation

Starting repository: `HAMZA-ALNAJJAR-CY/UniCore`, branch `main`, initial commit `baa6d97`, README only. Existing history is preserved.

Implemented the strict TypeScript/Vite foundation, Tailwind 4 design tokens, responsive shell, five application routes, 404 recovery, shared page headers and empty states, and a toast provider. Academic features are explicitly labeled planned. Documentation distinguishes delivered code from the offline-first PWA product vision.

Validation covers navigation and current-link synchronization, missing-route recovery, planned scope, route focus and titles, toast dismissal, expiry, and timer cleanup. TypeScript and ESLint passed; all eight Vitest tests passed; the production build passed. The default fork worker timed out in this Windows environment; Vitest uses thread workers instead. Browser inspection verified mobile and desktop rendering, no mobile horizontal overflow, and navigation to Courses. The npm dependency audit reported zero vulnerabilities at installation. Tailwind 4 uses its official Vite plugin: https://tailwindcss.com/docs/installation/using-vite.

GitHub connector confirms owner write access. A local Git push dry run failed because the Windows credential helper cannot access credentials in this execution environment. No credentials are stored in source files. Normal push will be attempted at delivery; failure will be reported with the local commit preserved.

Phase 1 has not been started.

## 2026-10-15 — Phase 1A local database foundation

Starting point: clean `main` at Phase 0 commit `79acd35`. The Phase 0 shell, routes, styles and shell tests are preserved without changes.

Added Dexie 4.4.6 and development-only fake-indexeddb 6.2.5. Added normalized models and version 1 stores for academic terms, courses, schedule sessions, actual lectures, lecture files, materials and material files. Files retain actual Blob bytes; file metadata is derived from the Blob. Unknown optional academic fields remain nullable. No timetable data is seeded or imported.

Added typed transactional repositories, runtime validation, per-term course-code uniqueness, stable UUIDs, timestamps, revisions and soft-delete tombstones. Default deletion rejects dependent records; explicit cascade requires a current reviewed dependency graph and rolls back atomically on failure. Bulk upsert inserts missing stable IDs only and reports existing identities/natural keys without overwriting user edits. ESLint enforces the UI/service import boundary. Database versioning, storage limitations, safe migration practice and future explicit sync conflict resolution are documented in DATABASE.md. No last-write-wins sync is implemented.

Validation executed: typecheck passed; ESLint passed; 36 tests passed across two files (28 database tests and the original eight shell tests); production build passed. Database tests use isolated fake-indexeddb stores in Node to preserve native Blob structured cloning. They cover all entity types, edits, reopening, uniqueness, relationships, invalid inputs, separate attachment storage, stale competing writers, reviewed deletion, cascade rollback, quota error injection, bulk idempotence/rollback, tombstones and an additive test-only version upgrade. Real device quota/eviction is not simulated; no claim of cross-browser storage certification is made. Dependency installation audit reported zero vulnerabilities.

The initial test run caught Dexie async transaction lifetime handling and a custom-error name collision with native IndexedDB DataError. Both were fixed before final validation. Local revisions support stale local edit detection, not multi-device causal tracking. Restoration, Blob garbage collection, pagination, backup/export and import workflows remain future work. IndexedDB alone does not make the application load offline.

The timetable remains unapproved. Discrete Mathematics instructor OCR is wrong and must remain null until corrected; B203's asterisk is an unconfirmed source note. Arabic/RTL UI, Supabase, authentication, cloud sync, PWA/service worker and AI are outside this phase.

Delivery: create the requested local Phase 1A commit after checks; do not push. Phase 1B has not been started.

## 2026-10-15 — Phase 1A identity and bulk hardening

Reviewed the implementation/tests at `7ec30c3` before editing. Preserved the Phase 0 shell, default restricted deletion, revision checks, tombstone retention and insert-if-absent behavior. No timetable data, screens, backup/restore, cloud sync, Supabase or PWA functionality was added. No project dependencies changed.

Added canonical lowercase UUID handling for every primary/reference field, repository lookup/filter/edit/delete, and deletion confirmations. Caller input is copied. Schema version 2 preflights all legacy identities and course term/code ownership before atomically rekeying case variants. Collisions abort with IDENTITY_COLLISION and retain the v1 records; no record or Blob is silently merged, purged or overwritten. Collision-free migration preserves all content, timestamps, revisions and tombstones. Existing version 1 declarations remain intact.

Bulk candidates now undergo structure/value/relationship checks even when their IDs already exist. Duplicate IDs within one entity batch, including letter-case variants, and conflicting course-code ownership reject. Results provide committed state and explicit inserted/skipped/rejected outcomes, with per-candidate reasons and canonical IDs. Existing-ID and tombstone skips do not write data. Every new write rolls back on any rejection or storage failure; rollback results never claim insertion. The created/skipped summary arrays remain available, but callers must check committed/outcomes. Validation failures now return rejected outcomes instead of throwing; malformed envelopes and legacy identity collisions can still throw.

Added typed createRelated orchestration across the seven stores in one parent-first transaction, using caller-supplied stable IDs without changing existing user records. Added explicit revision-checked historical lecture detachment; notes and attachments survive subsequent default session deletion. Attachment lists with parent filters use lectureId/materialId indexes; unfiltered lists still scan.

Executed final checks successfully: TypeScript, ESLint, all 76 tests in three files (the existing 36 plus 40 hardening cases), and production build. Tests include mixed-case IDs/foreign keys, all seven bulk entity types, duplicate and ownership conflicts, invalid existing candidates, preserved user-edited attachment bytes, migration collision rollback, multi-store validation/quota rollback, per-record outcomes, historical lecture preservation and indexed attachment queries. Tests use isolated fake-indexeddb; real-browser quota/eviction and cross-browser certification remain out of scope. Collision repair is deliberately explicit and not implemented as an automatic merge or repair UI.

Delivery: local commit only, with no push. Phase 1B has not been started.
