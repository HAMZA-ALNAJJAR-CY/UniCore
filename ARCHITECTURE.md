# UniCore architecture

## Implemented

Phase 0 is a client-rendered React/TypeScript SPA. `src/main.tsx` mounts the router and imports global styles. `src/app/App.tsx` defines routes and the persistent responsive shell. `src/app/navigation.ts` is the shared desktop/mobile navigation source.

`src/pages/` holds a dashboard, a data-driven placeholder page for each planned academic area, and a 404 page. `src/components/` contains PageHeader, EmptyState, and ToastProvider. `src/test/` contains shell integration tests, database tests, and DOM test setup. `src/styles.css` owns Tailwind 4 theme tokens and shell/component styles. The layout switches at 768px; cards adapt at 1100px and 360px. No network service layer exists.

Phase 1A adds `src/data/models.ts` (domain records), `database.ts` (internal versioned Dexie schema), `validation.ts` (runtime validation), `errors.ts` (typed storage failures), `store.ts` (transactional repositories), and `index.ts` (public factory/types). UI consumers use the public factory, never direct tables. Importing or constructing the service neither opens nor seeds a database. The existing UI remains unchanged and does not use the service yet.

All stores participate in write transactions to protect relationships across connections. Stable IDs and revision checks prevent stale replacement. Default reads hide tombstones. Cascade deletion requires a confirmed graph of dependency IDs/revisions. Actual file content lives in separate lecture/material Blob stores. No generic ORM, network adapters, or import workflow is introduced.

The six supplied colors are exposed as Tailwind tokens. Derived colors improve active state, border, and small-text readability. System fonts avoid a runtime font dependency. Motion is intentionally omitted. Semantic navigation, active link states, visible keyboard focus, safe-area padding, a skip link, and focus movement after route changes support accessibility. Toast announcements use a polite live region and a dismiss button; timers are cleaned up on unmount. Components must call `useToast()` within ToastProvider.

React Router handles navigation. date-fns formats the local dashboard date; it does not drive a countdown. Vite uses the React and official Tailwind plugins. TypeScript is strict; ESLint checks React hooks; Vitest uses jsdom and Testing Library to verify routing, placeholder behavior, and toast lifecycle.

## Planned

Service worker caching, installable PWA manifest, cloud sync, authentication, integrations, timetable review/import, and Arabic/RTL academic screens need later-phase implementation. Dexie local persistence exists; no cloud database is configured. AI belongs to V2.

Production hosts must provide history fallback to `index.html`. The shell is not evidence of offline access or storage support.
