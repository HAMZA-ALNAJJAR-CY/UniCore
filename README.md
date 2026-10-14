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
- The supplied timetable is an editable draft: seven courses, 15 weekly sessions, 15 registered hours. Opening/reviewing it does not save academic records.
- Missing instructors remain null; uncertain B203 notes remain flagged. Optional unknowns do not block saving. Overlaps and zero-minute transitions are reported separately.
- Atomic save of term/courses/sessions and separate source mappings. Re-import shows existing records and differences; users must explicitly keep differing saved values or return to edit/exclude draft rows. Existing academic fields are never overwritten by import.
- Additive schema v3 retains seven domain stores and adds one import-metadata store. See [RECOVERY.md](RECOVERY.md) for UUID migration recovery.

Developers use `createAcademicStore()` from `src/data`, never direct Dexie tables. See DATABASE.md for contracts and migration rules.

## Planned, not implemented

General academic record editing screens, dashboard/calendar data integration, real countdowns, calendar events, authentication, Supabase, cloud sync, Google Calendar integration, backup/restore, service worker, offline application loading, and PWA installation. AI belongs to V2. Recurring sessions do not generate actual lectures. Unsaved import drafts are lost on reload; source images are not processed or uploaded.

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
