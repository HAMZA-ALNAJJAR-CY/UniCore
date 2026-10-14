# UniCore architecture

## Implemented

Phase 0 is a client-rendered React/TypeScript SPA. `src/main.tsx` mounts the router and imports global styles. `src/app/App.tsx` defines routes and the persistent responsive shell. `src/app/navigation.ts` is the shared desktop/mobile navigation source.

`src/pages/` holds a dashboard, a data-driven placeholder page for each planned academic area, and a 404 page. `src/components/` contains PageHeader, EmptyState, and ToastProvider. `src/test/` contains shell integration tests, database tests, and DOM test setup. `src/styles.css` owns Tailwind 4 theme tokens and shell/component styles. The layout switches at 768px; cards adapt at 1100px and 360px. No network service layer exists.

Phase 1A adds `src/data/models.ts` (domain records), `database.ts` (internal versioned Dexie schema), `identity.ts` (canonical UUID handling), `validation.ts` (runtime validation), `errors.ts` (typed storage failures), `store.ts` (transactional repositories), and `index.ts` (public factory/types). UI consumers use the public factory, never direct tables. Importing or constructing the service neither opens nor seeds a database. Phase 1B opens it only when the timetable page requests review/read operations or explicitly saves.

All stores participate in write transactions to protect relationships across connections. Stable IDs and revision checks prevent stale replacement. Default reads hide tombstones. Cascade deletion requires a confirmed graph of dependency IDs/revisions. Actual file content lives in separate lecture/material Blob stores. No generic ORM or network adapters are introduced.

The hardening update adds `createRelated(RelatedBatch)` as explicit service-level atomic insert-if-absent orchestration. It processes terms, courses, sessions, lectures, materials, lecture files, then material files in parent-first order. It validates incoming candidates even when their identities exist; existing values are never replaced. Every candidate receives inserted/skipped/rejected status. A rejection rolls back all new writes; skipped existing records remain untouched. This is a storage API, not an import workflow. UUID casing is normalized only for known ID/reference fields. Version 2 preflights legacy UUID/term-code collisions before atomic rekeying and preserves all record content and metadata. Parent-filtered attachment lists use their parent indexes. Explicit lecture detachment preserves history before a session is deleted.

The six supplied colors are exposed as Tailwind tokens. Derived colors improve active state, border, and small-text readability. System fonts avoid a runtime font dependency. Motion is intentionally omitted. Semantic navigation, active link states, visible keyboard focus, safe-area padding, a skip link, and focus movement after route changes support accessibility. Toast announcements use a polite live region and a dismiss button; timers are cleaned up on unmount. Components must call `useToast()` within ToastProvider.

React Router handles navigation. date-fns formats the local dashboard date; it does not drive a countdown. Vite uses the React and official Tailwind plugins. TypeScript is strict; ESLint checks React hooks; Vitest uses jsdom and Testing Library to verify routing, placeholder behavior, and toast lifecycle.

Vitest thread workers are capped at two after the expanded seven-file suite exceeded this Windows host's worker-startup capacity. Node/fake-indexeddb tests verify Blob persistence and transactional behavior; DOM tests exercise management against isolated real repositories.

## Phase 1B timetable workflow

`src/features/timetable/draft.ts` holds editable source DTOs and pure validation; it never writes or generates lecture records. `src/pages/TimetableImport.tsx` owns the five-step draft and calls only the public data service. `timetable-types.ts` defines its typed review/save contract; internal `timetable-review.ts` resolves stable identities and compares existing values.

Review runs in a read transaction and returns stable pending UUIDs, existing identities, differences and a snapshot. Resolution uses source mappings first, then explicit existing IDs or unambiguous natural matches (term year/semester, course code within term, session course/day/times). Ambiguity, deleted targets and broken mappings block saving. A source key remains stable when its editable code changes. Excluding a draft row does not delete an existing record or mapping.

Save rebuilds the review within one write transaction, checks the snapshot and explicit acknowledgments, then inserts missing academic rows and stores mappings atomically. Existing rows are passed through unchanged and reported skipped. A new revision, concurrent import, invalid reference, quota failure or metadata failure prevents partial writes. Differences offer an explicit keep-existing decision; this workflow does not apply extracted changes to existing academic records. Draft state is memory-only until confirmed save.

Version 3 adds only `importMappings`, plus optional unindexed term college/program and course activityType fields. No backfill rewrites existing records. The unchanged v2 collision-safe migration has a developer-assisted same-origin recovery runbook in RECOVERY.md. Arabic document language/direction, logical shell positioning and LTR codes/times preserve the dark design tokens. Dashboard/calendar remain placeholders without data integration.

## Phase 1C timetable management

`src/pages/Courses.tsx` replaces only the `/courses` placeholder. The importer remains at `/courses/import` and links to management after save. Management selects a stored term, displays each course with all of its own sessions, and switches to a daily agenda: two columns on desktop, stacked days on small screens. No timetable data, student identity or particular term is built into management logic. Dashboard/calendar remain unconnected placeholders.

`getTimetable(termId?)` performs one consistent read of terms, indexed courses and indexed sessions, without reading attachment Blobs. The default is the latest academic year/semester among active terms; users can select another. Course edits use the existing repository update with captured revision; session edits use `saveManagedSession`. Both patch existing records rather than replacing identity/metadata. Cancel affects only component draft state. Failed writes retain the draft; stale conflicts require explicit cancel/refresh/reconciliation. No automatic cross-tab subscription is added.

`features/timetable/schedule.ts` supplies pure generic time validation/overlap checks, independently of the source extraction. `saveManagedSession` rechecks the exact overlap IDs/revisions within its write transaction before using the existing repository update/insert. It rejects duplicate same-course/day/time slots and parent reassignment. This managed write API does not change importer or low-level bulk/repository contracts.

Deletion previews use existing dependency snapshots. `deleteManagedCourse` permits only a course and its reviewed sessions, rejecting lectures/materials even if a generic cascade would allow them. Session deletion uses default restricted deletion. The UI asks for confirmation only after a safe preview; dependency/revision changes still reject at commit. Import mappings are neither rewritten nor removed, so subsequent imports still resolve edited UUIDs and reject deleted targets. No schema or migration changes are necessary.

New management labels/messages are centralized in `features/timetable/messages.ts`. There was no localization framework to extend. Complete English support needs a parallel catalog, migration of existing shell/import/dashboard/placeholder strings, localized date formatting and accessible labels, locale selection/persistence, document direction updates and bidirectional tests. This phase exposes no language toggle. Existing Arabic RTL, design tokens and LTR identifiers/times remain intact.

## Planned

Service worker caching, installable PWA manifest, cloud sync, authentication, integrations, term/lecture/material editing, complete language switching and backup/restore need later-phase implementation. Dexie local persistence, timetable review/import and course/session management exist; no cloud database is configured. AI belongs to V2.

Production hosts must provide history fallback to `index.html`. The shell is not evidence of offline access or storage support.
