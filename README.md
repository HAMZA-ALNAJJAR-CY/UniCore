# UniCore

**Your Academic Life, Under Control.**

UniCore is a university management application with an offline-first PWA vision. Phase 0 implements the frontend foundation only; it is not yet an installable or offline-capable PWA.

## Implemented in Phase 0

- React + TypeScript application with Vite and Tailwind CSS 4.
- Responsive desktop sidebar and mobile bottom navigation.
- Dashboard, Courses, Calendar, Lectures, Materials, and 404 routes.
- Shared page header, planned-feature empty states, and toast foundation.
- Dark design tokens, keyboard focus, skip link, route announcements through document titles, and accessible navigation labels.
- TypeScript, ESLint, Vitest, and production build scripts.

## Planned, not implemented

Course management, lecture notes, photos, attachments, study documents, timetable, real countdowns, calendar events, persistence, authentication, Supabase, cloud sync, Google Calendar integration, service worker, offline access, and PWA installation. AI is planned for V2 only.

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
