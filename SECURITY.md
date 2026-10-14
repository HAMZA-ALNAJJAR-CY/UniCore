# Security

## Phase 0

No authentication, server, API keys, cloud storage, analytics, or external runtime requests are implemented. The Phase 0 UI neither collects nor stores academic data. React text rendering is used; no raw HTML injection is required.

## Phase 1A local storage

The service can retain academic records and attachment Blobs in origin-scoped IndexedDB. The UI is not connected to it yet. Data is not application-encrypted; scripts on the same origin can access it. There is no backup or authenticated authorization. Stored filenames, MIME types and bytes are untrusted; MIME metadata does not establish content safety. Future preview/download screens need content-specific protections.

Relationship validation, revision checks, reviewed cascades and tombstones protect supported service operations. Quota errors roll back rather than clearing data. No arbitrary file-size limit, auto-purge, or user/timetable seed is introduced. Browser eviction and quota limits still apply.

`.env`, `.env.*`, local overrides, build output, and dependencies are ignored; `.env.example` is an intentionally tracked, comment-only template. Never commit credentials. Browser code and all Vite `VITE_` environment values are public. Secret operations must eventually run in a trusted backend.

The lockfile fixes dependency resolution. Run the TypeScript check, lint, tests, and build before each delivery. Review staged paths and diffs for secrets before committing. Never force push. Treat dependency audit findings as maintenance work; do not blindly apply breaking upgrades.

## Planned

Authentication, authorization, database rules, file validation, upload limits, offline data protection, synchronization trust boundaries, and deployment security headers require later-phase threat modeling. There are no claims of production security certification or data encryption in this foundation.

Report suspected vulnerabilities privately to the repository owner. Do not post credentials or sensitive academic data in public issues.
