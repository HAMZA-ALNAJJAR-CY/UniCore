# UniCore architecture

## Implemented

Phase 0 is a client-rendered React/TypeScript SPA. `src/main.tsx` mounts the router and imports global styles. `src/app/App.tsx` defines routes and the persistent responsive shell. `src/app/navigation.ts` is the shared desktop/mobile navigation source.

`src/pages/` holds a dashboard, a data-driven placeholder page for each planned academic area, and a 404 page. `src/components/` contains PageHeader, EmptyState, and ToastProvider. `src/test/` contains shell integration tests, database tests, and DOM test setup. `src/styles.css` owns Tailwind 4 theme tokens and shell/component styles. The layout switches at 768px; cards adapt at 1100px and 360px. No network service layer exists.

Phase 1A adds `src/data/models.ts` (domain records), `database.ts` (internal versioned Dexie schema), `identity.ts` (canonical UUID handling), `validation.ts` (runtime validation), `errors.ts` (typed storage failures), `store.ts` (transactional repositories), and `index.ts` (public factory/types). UI consumers use the public factory, never direct tables. Importing or constructing the service neither opens nor seeds a database. Phase 1B opens it only when the timetable page requests review/read operations or explicitly saves.

All stores participate in write transactions to protect relationships across connections. Stable IDs and revision checks prevent stale replacement. Default reads hide tombstones. Cascade deletion requires a confirmed graph of dependency IDs/revisions. Actual file content lives in separate lecture/material Blob stores. No generic ORM, network adapters, or import workflow is introduced.

The hardening update adds `createRelated(RelatedBatch)` as explicit service-level atomic insert-if-absent orchestration. It processes terms, courses, sessions, lectures, materials, lecture files, then material files in parent-first order. It validates incoming candidates even when their identities exist; existing values are never replaced. Every candidate receives inserted/skipped/rejected status. A rejection rolls back all new writes; skipped existing records remain untouched. This is a storage API, not an import workflow. UUID casing is normalized only for known ID/reference fields. Version 2 preflights legacy UUID/term-code collisions before atomic rekeying and preserves all record content and metadata. Parent-filtered attachment lists use their parent indexes. Explicit lecture detachment preserves history before a session is deleted.

The six supplied colors are exposed as Tailwind tokens. Derived colors improve active state, border, and small-text readability. System fonts avoid a runtime font dependency. Motion is intentionally omitted. Semantic navigation, active link states, visible keyboard focus, safe-area padding, a skip link, and focus movement after route changes support accessibility. Toast announcements use a polite live region and a dismiss button; timers are cleaned up on unmount. Components must call `useToast()` within ToastProvider.

React Router handles navigation. date-fns formats the local dashboard date; it does not drive a countdown. Vite uses the React and official Tailwind plugins. TypeScript is strict; ESLint checks React hooks; Vitest uses jsdom and Testing Library to verify routing, placeholder behavior, and toast lifecycle.

## Phase 1B timetable workflow

`src/features/timetable/draft.ts` holds editable source DTOs and pure validation; it never writes or generates lecture records. `src/pages/TimetableImport.tsx` owns the five-step draft and calls only the public data service. `timetable-types.ts` defines its typed review/save contract; internal `timetable-review.ts` resolves stable identities and compares existing values.

Review runs in a read transaction and returns stable pending UUIDs, existing identities, differences and a snapshot. Resolution uses source mappings first, then explicit existing IDs or unambiguous natural matches (term year/semester, course code within term, session course/day/times). Ambiguity, deleted targets and broken mappings block saving. A source key remains stable when its editable code changes. Excluding a draft row does not delete an existing record or mapping.

Save rebuilds the review within one write transaction, checks the snapshot and explicit acknowledgments, then inserts missing academic rows and stores mappings atomically. Existing rows are passed through unchanged and reported skipped. A new revision, concurrent import, invalid reference, quota failure or metadata failure prevents partial writes. Differences offer an explicit keep-existing decision; this workflow does not apply extracted changes to existing academic records. Draft state is memory-only until confirmed save.

Version 3 adds only `importMappings`, plus optional unindexed term college/program and course activityType fields. No backfill rewrites existing records. The unchanged v2 collision-safe migration has a developer-assisted same-origin recovery runbook in RECOVERY.md. Arabic document language/direction, logical shell positioning and LTR codes/times preserve the dark design tokens. Dashboard/calendar remain placeholders without data integration.

## Planned

Service worker caching, installable PWA manifest, cloud sync, authentication, integrations, general academic editing screens and backup/restore need later-phase implementation. Dexie local persistence and timetable review/import exist; no cloud database is configured. AI belongs to V2.

Production hosts must provide history fallback to `index.html`. The shell is not evidence of offline access or storage support.
