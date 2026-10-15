# UniCore

**Your Academic Life, Under Control.**

UniCore is a university management application with an offline-first PWA vision. Phase 0 provides the frontend shell; Phase 1A adds local data access; Phase 1B adds Arabic timetable review and confirmed local import. It is not yet an installable or offline-capable PWA.

## Implemented in Phase 0

- React + TypeScript application with Vite and Tailwind CSS 4.
- Responsive desktop sidebar and mobile bottom navigation.
- Dashboard, Courses, Calendar, Lectures, Materials, and 404 routes.
- Shared page header, planned-feature empty states, and toast foundation.
- Dark design tokens, keyboard focus, skip link, route announcements through document titles, and accessible navigation labels.
- TypeScript, ESLint, Vitest, and production build scripts.

## Implemented in Phase 1A

- Seven normalized Dexie/IndexedDB stores for terms, courses, weekly sessions, actual lectures, materials, and separate lecture/material Blob attachments.
- Typed CRUD/filter operations, relationship validation, transactional writes, stable UUIDs, timestamps, tombstones, and stale-edit rejection using revisions.
- Version 2 schema with collision-safe UUID canonicalization, reviewed cascade deletion, and validated insert-if-absent bulk operations that preserve user corrections.
- Explicit per-candidate outcomes and atomic `createRelated` operations across stores; historical lectures can be explicitly detached from a session without losing notes or files.
- No automatic timetable seeds. Existing records and attachment Blobs survive the additive Phase 1B upgrade.

## Implemented in Phase 1B

- Arabic RTL shell and `/courses/import`, reached from Courses.
- Five steps: editable term, courses, weekly sessions, validation, and explicit confirmation.
- Review works with typed timetable drafts. Tracked fixtures are fully synthetic; production never seeds academic records.
- Missing instructors remain null and uncertain source notes remain flagged. Optional unknowns do not block saving. Overlaps and zero-minute transitions are reported separately.
- Atomic save of term/courses/sessions and separate source mappings. Re-import shows existing records and differences; users must explicitly keep differing saved values or return to edit/exclude draft rows. Existing academic fields are never overwritten by import.
- Additive schema v3 retains seven domain stores and adds one import-metadata store. See [RECOVERY.md](RECOVERY.md) for UUID migration recovery.

Developers use `createAcademicStore()` from `src/data`, never direct Dexie tables. See DATABASE.md for contracts and migration rules.

## Implemented in Phase 1C

- `/courses` now reads saved terms/courses/sessions and offers course cards or a responsive weekly agenda. Each session retains its own day/time/room/mode; no misleading combined time ranges.
- Inline course and session editors with save/cancel, nullable instructors, additions, validation, revision checks and persistent UUIDs. Management uses only stored records, without personal timetable assumptions.
- Overlap warnings for saved schedules and pending session edits; acknowledgment is rechecked transactionally against current overlap IDs/revisions. Adjacent sessions are not overlaps. Identical weekly sessions are rejected.
- Confirmed removal preserves tombstones and source mappings. Course removal can include only reviewed weekly sessions; lectures/materials block it. Session removal blocks linked historical lectures. No history or attachments cascade from management controls.
- Management messages are centralized; Phase 2 extends them with complete English UI translations.

## Implemented in Phase 2

- Saved-data dashboard: term selection, course/session/credit counters, local date, today's chronological sessions with live statuses, next-session countdown and weekly distribution.
- Weekly/day calendar with previous/next/Today navigation, a mobile day selector and links to the existing course management cards. Recurring sessions are never converted into Lecture records.
- Complete Arabic/English system UI catalogs, accessible persistent language selection, immediate RTL/LTR updates, localized dates/numbers and translated validation/errors. Academic names and source content retain their original language.
- No schema or dependency changes. Data reads occur on route mount, term selection or explicit refresh, not every timer tick. No recent-activity history is invented.

## Phase 2.5 — lecture attachments early beta

`/lectures` now supports explicit lecture creation for an existing course, a selected date and an optional same-course schedule session. Open a lecture to select multiple files, review per-file results, retry unsaved files, download originals, or confirm individual attachment removal. Active files block lecture deletion; course management also blocks historical lecture dependencies. No recurring lectures are generated.

Attachments are IndexedDB Blobs, local to the current browser/origin and not synchronized. The new upload path accepts MP3/WAV/M4A/AAC/OGG/FLAC/Opus audio, MP4/WebM/MOV video, JPG/JPEG/PNG/WebP images, PDF/Office/text/CSV/OpenDocument files, up to **100 MiB per nonempty file**. Extension and MIME compatibility are checked; missing/generic MIME is allowed only for known extensions. These checks are not malware scanning. Files are downloaded as binary, never rendered or executed inside UniCore. No previews/player/editor are included.

Each file has an independent transaction: failures do not discard successful siblings. Retry IDs are retained while the selection remains mounted, and existing IDs are skipped without replacing bytes. Picking a file again intentionally creates a new upload identity; content deduplication is not implemented. Soft deletion retains Blob bytes and does not reclaim quota. Browser eviction/clearing may lose files; no backup or permanence guarantee exists. Schema remains v3 and dependencies are unchanged.

## Master roadmap — Phase A foundations

First-run introduction uses actual persisted record presence across all stores, including partial history/tombstones, rather than trusting a preference alone. A short skippable four-stop tour offers Import / Manual / Later. Returning users bypass the automatic introduction. Local-only completion is separate from academic records. Storage-read errors do not trigger a clean-install assumption.

`/courses/setup` creates a real user-entered term through the repository and opens that exact term in Courses, making manual course entry usable without import. Empty dashboard/calendar/course views provide setup actions. Confirmed import returns to the Dashboard with feedback and the imported term selected. `/settings` is deliberately limited to language/local-mode information and replaying the introduction; profiles/accounts remain later work.

`/courses/import` discovers saved sources from existing mappings. Choose a source to reopen its current saved values with original source/row identities, or explicitly start a new source. The source query survives reload. Unmatched rows alongside existing history require an explicit saved-record or new-row decision; matching never uses fuzzy similarity. Differences still require keep-existing approval. Missing/deleted mapped targets block reopening rather than resurrecting history. File ingestion, parsing and OCR remain Phase B work. See [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

Open course/session editors stay bound to their opening term. Save or cancel before switching terms; browser Back/Forward offers keep/discard choices. Term selections and course links retain term query context. Manual term creation disables cancellation while pending, rejects repeated submits and never redirects after unmount; leaving does not cancel an already running transaction. Introduction replay preserves completion and tour steps announce progress/focus. Import success state is consumed once.

The tracked timetable fixture is synthetic and excluded from production modules. Earlier personal-looking fixture values remain in Git history; this correction does not rewrite history. No academic records, mappings or attachment identities are purged/rekeyed.

## Planned, not implemented

Term editing, advanced lecture/material workspaces, monthly calendar, calendar events/holidays, authentication, Supabase, cloud sync, Google Calendar integration, backup/restore, service worker, offline application loading, and PWA installation. AI belongs to V2. Unsaved import/editor drafts are lost on reload. Cross-tab updates require explicit refresh; revision checks prevent stale saves. The selected term defaults to the latest stored academic year/semester, not inferred active dates; select the appropriate term explicitly. Stored start/end dates restrict recurrence when supplied. Without dates, weekly recurrence is projected indefinitely and labeled accordingly.

Placeholder pages show planned labels and contain no fake feature controls. Dashboard cards are real navigation links. The toast API is available to developers but has no demonstration button in the product.

## Development

Use Node.js 22.12+ (Node.js 24 LTS recommended) and npm.

```sh
npm ci
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

No environment variables or credentials are required. Keep `.env` files untracked. All `VITE_` variables are publicly exposed to browsers.

## Deployment

Deploy `dist/` after `npm run build`. This application uses browser history routing: configure the host to serve `index.html` for unknown application paths, including direct visits to `/courses`. Hosting setup is not included in Phase 0. Vite development/preview servers provide local SPA fallback. Production assets are bundled locally; no external fonts or runtime API calls are required.

See [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE.md](DATABASE.md), [SECURITY.md](SECURITY.md), and [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md).
