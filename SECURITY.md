# Security

## Phase 0

No authentication, server, API keys, cloud storage, analytics, or external runtime requests are implemented. The Phase 0 UI neither collects nor stores academic data. React text rendering is used; no raw HTML injection is required.

## Phase 1A local storage

The service can retain academic records and attachment Blobs in origin-scoped IndexedDB. Phase 1B connects the timetable review page to this service and writes only after explicit confirmation. Data is not application-encrypted; scripts on the same origin can access it. There is no backup or authenticated authorization. Stored filenames, MIME types and bytes are untrusted; MIME metadata does not establish content safety. Future preview/download screens need content-specific protections.

The bundled timetable draft contains course/session information supplied for this feature; frontend source and bundle contents are public. It excludes the image, student name and student number. No OCR, upload or external API is involved. Re-import never overwrites academic edits. Record revisions, review snapshots and atomic mapping writes guard against stale confirmation and partial saves. UUID collision recovery requires an explicit reviewed maintenance procedure; see RECOVERY.md. No recovery action runs automatically.

Phase 1C adds local course/session management through the same service boundary. No user ID or personal timetable is embedded in management logic. Stale revisions reject rather than overwriting; overlap acknowledgment is checked against current records in the save transaction. Course deletion blocks historical lecture/material dependencies, while session deletion blocks linked lectures. Destructive controls require a reviewed confirmation and preserve tombstones, mappings and attachment bytes. No authentication or multi-user isolation is claimed: future shared-device/cloud support needs explicit ownership and authorization design.

Relationship validation, revision checks, reviewed cascades and tombstones protect supported service operations. Quota errors roll back rather than clearing data. No arbitrary file-size limit, auto-purge, or user/timetable seed is introduced. Browser eviction and quota limits still apply.

`.env`, `.env.*`, local overrides, build output, and dependencies are ignored; `.env.example` is an intentionally tracked, comment-only template. Never commit credentials. Browser code and all Vite `VITE_` environment values are public. Secret operations must eventually run in a trusted backend.

The lockfile fixes dependency resolution. Run the TypeScript check, lint, tests, and build before each delivery. Review staged paths and diffs for secrets before committing. Never force push. Treat dependency audit findings as maintenance work; do not blindly apply breaking upgrades.

## Planned

Phase 2 adds only read-only dashboard/calendar consumers and a local language preference. No external translation service, analytics, API requests, notification permission or new dependency is introduced. Translation catalogs contain system text; source/user academic values remain unchanged. The browser clock and stored schedules cannot establish actual lecture attendance.

Authentication, authorization, database rules, file validation, upload limits, offline data protection, synchronization trust boundaries, and deployment security headers require later-phase threat modeling. There are no claims of production security certification or data encryption in this foundation.

Report suspected vulnerabilities privately to the repository owner. Do not post credentials or sensitive academic data in public issues.

Phase 2.5 uses an allowlist of extensions plus compatible MIME values, a nonempty-file requirement and a 100 MiB per-file cap. Missing/application-octet-stream MIME is allowed only for recognized extensions because browser MIME reporting varies. SVG, HTML, executables and unlisted types are rejected by the managed upload API. No file-signature inspection, antivirus scanning, macro removal or sanitization is claimed; renamed/malicious content can still pass metadata checks.

The app never executes or previews attachments. Downloads use a binary Blob URL and a download attribute; opening downloaded Office/PDF/media files in external software is outside the app's trust boundary. Object URLs are revoked after initiation or unmount. Attachment/lecture deletion uses explicit confirmations and restricted revision-checked transactions, never silent cascades. Soft-deleted files retain bytes. Browser storage remains unencrypted, origin-specific and subject to eviction; users should retain original files elsewhere. No external upload, cloud storage or dependency was added.
