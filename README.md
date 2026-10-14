# UniCore

**Your Academic Life, Under Control.**

UniCore is a university management application with an offline-first PWA vision. Phase 0 provides the frontend shell; Phase 1A adds a local data-access foundation. It is not yet an installable or offline-capable PWA.

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
- Version 1 schema, reviewed cascade deletion, and idempotent insert-if-absent bulk operations that preserve user corrections.
- No timetable seeds or imports. The Phase 0 shell does not access the database yet.

Developers use `createAcademicStore()` from `src/data`, never direct Dexie tables. See DATABASE.md for contracts and migration rules.

## Planned, not implemented

Academic management screens, Arabic interface and RTL layout, timetable review/import, real countdowns, calendar events, authentication, Supabase, cloud sync, Google Calendar integration, service worker, offline application loading, and PWA installation. AI belongs to V2. Local persistence exists through the service; no academic UI workflow is implemented.

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
