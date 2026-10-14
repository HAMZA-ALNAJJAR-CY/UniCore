# UniCore architecture

## Implemented

Phase 0 is a client-rendered React/TypeScript SPA. `src/main.tsx` mounts the router and imports global styles. `src/app/App.tsx` defines routes and the persistent responsive shell. `src/app/navigation.ts` is the shared desktop/mobile navigation source.

`src/pages/` holds a dashboard, a data-driven placeholder page for each planned academic area, and a 404 page. `src/components/` contains PageHeader, EmptyState, and ToastProvider. `src/test/` contains integration tests and DOM test setup. `src/styles.css` owns Tailwind 4 theme tokens and shell/component styles. The layout switches at 768px; cards adapt at 1100px and 360px. No persisted data or network service layer exists.

The six supplied colors are exposed as Tailwind tokens. Derived colors improve active state, border, and small-text readability. System fonts avoid a runtime font dependency. Motion is intentionally omitted. Semantic navigation, active link states, visible keyboard focus, safe-area padding, a skip link, and focus movement after route changes support accessibility. Toast announcements use a polite live region and a dismiss button; timers are cleaned up on unmount. Components must call `useToast()` within ToastProvider.

React Router handles navigation. date-fns formats the local dashboard date; it does not drive a countdown. Vite uses the React and official Tailwind plugins. TypeScript is strict; ESLint checks React hooks; Vitest uses jsdom and Testing Library to verify routing, placeholder behavior, and toast lifecycle.

## Planned

Offline-first persistence, service worker caching, installable PWA manifest, cloud sync, authentication, academic domain models, storage adapters, and integrations need separate requirements and later-phase implementation. No database or vendor has been configured. AI belongs to V2.

Production hosts must provide history fallback to `index.html`. The shell is not evidence of offline access or storage support.
