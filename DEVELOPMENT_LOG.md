# Development log

## 2026-10-14 — Phase 0 foundation

Starting repository: `HAMZA-ALNAJJAR-CY/UniCore`, branch `main`, initial commit `baa6d97`, README only. Existing history is preserved.

Implemented the strict TypeScript/Vite foundation, Tailwind 4 design tokens, responsive shell, five application routes, 404 recovery, shared page headers and empty states, and a toast provider. Academic features are explicitly labeled planned. Documentation distinguishes delivered code from the offline-first PWA product vision.

Validation covers navigation and current-link synchronization, missing-route recovery, planned scope, route focus and titles, toast dismissal, expiry, and timer cleanup. TypeScript and ESLint passed; all eight Vitest tests passed; the production build passed. The default fork worker timed out in this Windows environment; Vitest uses thread workers instead. Browser inspection verified mobile and desktop rendering, no mobile horizontal overflow, and navigation to Courses. The npm dependency audit reported zero vulnerabilities at installation. Tailwind 4 uses its official Vite plugin: https://tailwindcss.com/docs/installation/using-vite.

GitHub connector confirms owner write access. A local Git push dry run failed because the Windows credential helper cannot access credentials in this execution environment. No credentials are stored in source files. Normal push will be attempted at delivery; failure will be reported with the local commit preserved.

Phase 1 has not been started.
