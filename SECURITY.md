# Security

## Phase 0

No authentication, server, API keys, cloud storage, analytics, or external runtime requests are implemented. Academic data is neither collected nor stored. React text rendering is used; no raw HTML injection is required.

`.env`, `.env.*`, local overrides, build output, and dependencies are ignored; `.env.example` is an intentionally tracked, comment-only template. Never commit credentials. Browser code and all Vite `VITE_` environment values are public. Secret operations must eventually run in a trusted backend.

The lockfile fixes dependency resolution. Run the TypeScript check, lint, tests, and build before each delivery. Review staged paths and diffs for secrets before committing. Never force push. Treat dependency audit findings as maintenance work; do not blindly apply breaking upgrades.

## Planned

Authentication, authorization, database rules, file validation, upload limits, offline data protection, synchronization trust boundaries, and deployment security headers require later-phase threat modeling. There are no claims of production security certification or data encryption in this foundation.

Report suspected vulnerabilities privately to the repository owner. Do not post credentials or sensitive academic data in public issues.
