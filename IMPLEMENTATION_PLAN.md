# Master brief assessment and dependency plan

Audited main at `8ed9bc3`, initially clean. Inspected repository inventory, package manifest, v1–v3 migration declarations, models/validation/identity, repositories/service operations, hooks, routes/components, localization, tests and development documentation. Existing stack is React/TypeScript/Vite/Tailwind/Router/Dexie with Lucide/date-fns; Vitest/fake-indexeddb/Testing Library provide validation. No new dependency is needed for Phase A.

## What exists

Stable UUIDs, normalized references, revisions, tombstones, reviewed dependency snapshots, atomic related-record/import writes and separate Blob tables. Public data APIs isolate UI from Dexie. Courses support individual weekly sessions, safe edits/removal and conflict acknowledgment. Dashboard/calendar derive local-time recurrence from selected saved data. Arabic/English direction/preference and local lecture creation/multi-file upload/download/retry are implemented. The suite starts at 169 tests. Source counts are not seeds: records are not automatically written, but the production review page exposes one student's personal-looking draft by default.

## Gaps and risks

- No first-run gate or tour; empty users can only import before adding courses because term creation has no UI.
- Import is an editable hardcoded extraction, not a file parser/OCR pipeline. Personal draft data must leave the production graph. Existing review/confirmation and service identity semantics must survive.
- Lectures lack term selection, title numbering/editing and scheduled occurrence selection; materials are a placeholder. Files download only; no safe in-app viewers.
- No backup/restore, sync, accounts/institution directory/journeys, unified search, notification preferences or recognition verification.
- No PWA/service worker: local IndexedDB data is available to an already loaded app, but offline application loading is not guaranteed.
- Soft-deleted Blobs retain quota; opening a lecture loads its entire file collection internally. Large libraries need metadata/pagination/lifecycle review.
- Localization uses mutable language selection, lazy catalogs and some formatted system-message matching. Preserve source values and form state; future new messages should use semantic keys.

## Phase A boundary

Implement first-run detection from the existence of persisted records across all stores (including tombstones/partial metadata), independently of onboarding preference. Failure to read storage must not be treated as a clean installation. Returning/partial-data users bypass automatic introduction. New users get an optional four-stop tour and Import / Manual / Later choices. Add minimal term setup so Manual leads to working course management; reuse repository validation and do not create example terms. Add replay/preferences entry only, not a fake account/profile. Move original source DTO into test fixtures and start production review empty; clearly disclose extraction limitations. Redirect confirmed import to dashboard with concise feedback.

No schema change or data rewrite/purge is needed for Phase A. Onboarding preferences use localStorage separately from academic records; a refused preference write must not prevent local academic work. Do not migrate/delete previously imported sample-like records because they may contain user edits/history.

## Recommended order and dependencies

1. **A, now:** audit, onboarding, clean defaults and setup/navigation foundations. Validate all earlier features and local persistence.
2. **B:** separate source ingestion from typed draft review. Begin with documented, testable TXT/CSV/structured data; evaluate XLSX/DOCX/text-PDF parsers for size/security before adding packages. Images/scanned PDFs require a real OCR solution and must remain explicitly unsupported until verified. Add legends, grouped/table course presentation and versioned draft persistence. Never reinterpret additional delivery modes silently as current two-mode values.
3. **C:** term-aware lecture/material selectors, transactional course-scoped numbering (including concurrent creation), editable titles and plain notes if approved in that phase. Add lifecycle-managed image/audio/video viewers; assess isolated PDF rendering and safe download fallback for Office documents. Preserve historical session links and files.
4. **D:** versioned manifests plus original Blob bytes, hashes/integrity limits, preview/conflict detection and transactional restore with explicit choices. Test real attachments and old schema upgrades before calling this backup reliable. Address quota/tombstone lifecycle and metadata paging.
5. **E:** expand the minimal replay/preferences entry into cohesive settings/profile, database-backed scoped search and notification preferences. No browser notifications without explicit permission; no invented background guarantees.
6. **F:** design identity/ownership, approved institution directory, review statuses, academic journeys and evidence retention before remote writes. Supported university email ownership is not proof of enrollment. No fake login/SSO/verification badges.
7. **G:** requires a real configured backend, authentication/RLS and account-link conflict review first. Then implement idempotent offline operations, separate Blob queues, conflict resolution and verified PWA caching. Local functionality must survive remote outages.
8. **H:** privacy-minimal meaningful event design and independently reviewed graduation evidence; defer numeric recognition thresholds and certificates until real criteria/verification exist.
9. **I:** comprehensive bilingual/accessibility/mobile (360/390/430), migration, backup, security and performance acceptance across completed phases.

## Future migration risks

Ownership/institution/enrollment links must be additive and scoped without assigning old academic history to a guessed institution. Existing course term ownership, UUIDs, import source mappings, revisions, tombstones and both Blob stores must remain intact. Backups must include import metadata as well as seven domain stores. New lecture numbering cannot renumber old history or reuse numbers merely because records were deleted. New delivery modes need explicit validation/model expansion. Account linking cannot equate synchronization with backup or silently overwrite either local/cloud data.

Only Phase A is authorized for implementation in this pass. Backend services, verification costs, irreversible retention/purge policy and account linking decisions remain explicit later work.
