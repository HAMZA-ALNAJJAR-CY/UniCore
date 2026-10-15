# Local academic database — Phases 1A and 1B

## Version 3 schema

Dexie owns IndexedDB database `UniCore`. Each of the seven domain tables uses a stable UUID primary key and contains `createdAt` / `updatedAt` epoch-millisecond timestamps, nullable `deletedAt`, and local integer `revision` starting at 1. The timetable UI opens it for review, but never seeds academic records without confirmation. Dates are `YYYY-MM-DD`; times are local wall-clock `HH:mm`, without a guessed timezone. Version 2 keeps the seven v1 store/index definitions and safely canonicalizes legacy identity casing. Additive version 3 introduces a separate import-metadata table; no existing record or Blob is rewritten.

Valid UUIDs are accepted in any letter case and stored/looked up in lowercase. The same rule applies to all foreign keys, ID filters, deletion roots and confirmation IDs. Only known identity fields are normalized as UUIDs; names, room codes and notes are untouched. Course-code normalization remains its separate existing trim/uppercase policy. Identity is scoped by table and canonical UUID. Input objects are copied rather than mutated.

| Table | Academic fields | Indexed lookups |
| --- | --- | --- |
| academicTerms | name, academicYear, semester, optional dates/college/program | academicYear |
| courses | academicTermId, code, name, optional instructor/section/description/activityType, registeredHours | academicTermId, unique [academicTermId+code] |
| scheduleSessions | academicTermId, courseId, dayOfWeek, times, optional room/location/notes, deliveryMode | academicTermId, courseId, dayOfWeek |
| lectures | courseId, optional scheduleSessionId, date, optional paired times/title/notes | courseId, scheduleSessionId, date |
| lectureFiles | lectureId, fileName, mimeType, fileSize, Blob | lectureId |
| materials | courseId, title, optional description/category | courseId, category |
| materialFiles | materialId, fileName, mimeType, fileSize, Blob | materialId |
| importMappings (metadata) | key, sourceId, entity, sourceKey, recordId, unconfirmed, createdAt | primary key, sourceId, [sourceId+entity], recordId |

Import mapping keys serialize `[sourceId, entity, sourceKey]`; they are not UUIDs or domain records and do not carry domain revision/tombstone fields. `recordId` references a canonical domain UUID. Source keys are stable independently of editable course codes/names/times. Unconfirmed field names stay in metadata. Mapping writes share the academic save transaction; exclusions leave previous mappings intact. Missing/deleted mapped targets block re-import instead of resurrecting data. Optional `activityType` is `theory`, `practical`, null or omitted; old courses remain unchanged without backfill.

Optional fields accept null or omission. Required names/codes must be nonblank; registeredHours must be finite and non-negative; semester is a positive integer. Course codes are trimmed and uppercased for identity. Names and other text are retained; similar names never merge courses. Codes remain reserved within a term even by tombstones, so future restore/sync can retain identity.

Weekdays use ISO numbering: Monday=1, Sunday=7. Dates must exist; sessions require start before end on the same day. Overnight ranges are not supported. Lecture times are either both absent or both valid. ScheduleSessions are weekly templates, not actual lectures; no automatic generation occurs.

## Service contracts

UI consumers import `createAcademicStore`, types and `DataError` from `src/data/index.ts`, never direct Dexie tables. The factory neither opens nor writes until used. Each of the seven repositories supports create/get/list/update/previewDelete/delete/bulkUpsert. Get returns undefined for absent/deleted records; list offers exact filters. Both support `includeDeleted: true`. Updates require expectedRevision and cannot change identity or creation metadata. Conflicting revisions reject rather than replacing newer edits.

```ts
const store = createAcademicStore();
const term = await store.academicTerms.create({
  name: 'Example', academicYear: '2030/2031', semester: 1,
});
const course = await store.courses.create({
  academicTermId: term.id, code: 'EXAMPLE', name: 'Example course',
  registeredHours: 1, instructor: null,
});
await store.courses.update(course.id, { name: 'Corrected' }, course.revision);
const preview = await store.academicTerms.previewDelete(term.id);
// Only following review and explicit user intent:
await store.academicTerms.delete(term.id, {
  expectedRevision: term.revision, cascade: true, confirmation: preview,
});
store.close();
```

Examples are illustrative, not seed code. File repositories accept actual Blobs; fileSize/mimeType are derived from the Blob. Empty MIME type remains empty. File content replacement and filename/parent edits are supported. No arbitrary file-size cap exists. QUOTA errors roll back failed writes while retaining existing content. The future UI must present storage failures and retry options; never reset the database to recover space automatically.

Writes and relationship checks transact across all seven stores. Parents must exist and be active; sessions must match their course term; linked lectures must match their session course. Parent reassignment is rejected if it would invalidate active children. Relationships are enforced by the service because IndexedDB has no foreign-key constraint. Bypassing the service is unsupported.

`bulkUpsert` deliberately means insert-if-absent, NOT replacement upsert. Callers supply full candidate records with stable UUIDs. Structure, values and relationships are validated even for existing IDs. Both occurrences of a duplicate ID within an entity batch (including letter-case variants) are rejected. Course-code ownership by a different UUID is rejected rather than merged or remapped. Existing valid identities are skipped unchanged; existing tombstones are skipped only if the incoming relationships are valid/active. A candidate referencing a deleted parent is rejected even when the candidate ID is already tombstoned. No field or attachment Blob is overwritten, and no tombstone is restored.

Both repository `bulkUpsert` and service `createRelated` return a `BulkResult`:

- `committed`: whether all candidates were acceptable and the transaction completed.
- `outcomes`: one result per candidate with `kind`, zero-based index within that entity array, original `requestedId`, canonical `id` (null if invalid), status (`inserted`, `skipped`, `rejected`), reason, optional error code and conflicting/existing ID.
- `created`: canonical inserted IDs, retained for compatibility; empty after rollback.
- `skipped`: existing-ID/tombstone summaries, retained for compatibility.
- `rejected`: rejected candidate outcomes, including provisional inserts rolled back because another candidate failed.

Validation rejection is returned, not thrown as in the initial Phase 1A bulk contract. If any candidate is rejected, all new writes are rolled back and no outcome claims insertion. Existing valid candidates can remain skipped even when `committed` is false because they were never changed. Storage failures also return rolled-back outcomes with a reason/code. Malformed batch envelopes or legacy migration identity collisions can throw `DataError`; handle them explicitly. A conflicting ID from an in-batch code collision may identify a provisional candidate that was rolled back, not a persisted parent. Consumers must inspect `committed` and every outcome before treating a batch as saved.

`createRelated(batch: RelatedBatch)` accepts optional typed arrays keyed by the seven store names and returns the same result. The service processes them parent-first in one transaction; references can target earlier candidates or existing active parents. Unknown/mismatched references reject. Existing identities retain their original fields and IDs. There is no implicit reference remapping when a different UUID owns a course code. No automatic seed process, backup/restore or synchronization is implemented.

### Timetable review and confirmed save

`reviewTimetable(draft: TimetableDraft): Promise<TimetableReview>` reads terms, courses, sessions and source mappings consistently. It validates the draft, allocates pending UUIDs only for unresolved identities, and returns a copied draft, existing row keys, field differences, effective saved counts/hours and a review snapshot. Callers must retain the returned IDs/snapshot for confirmation. Review alone never writes academic records or import mappings.

`saveTimetable(review, { confirmed: true, keepExistingKeys: string[] }): Promise<BulkResult>` requires explicit confirmation and acknowledgment of every differing existing row. The operation rebuilds/revalidates the plan in one transaction over all stores; a changed revision, binding or identity resolution rejects the stale plan. Existing fields and UUIDs are always kept, even if extracted values differ. Missing records are inserted parent-first using the hardened bulk machinery; mappings are written only if all candidates are acceptable. Any rejected write, mapping failure or storage error rolls back all new records and mappings. Some review/confirmation failures throw DataError; bulk/storage failures return an uncommitted BulkResult. Consumers handle both.

Resolution uses stable source mapping first, then an explicitly selected existing identity, then an unambiguous term year/semester, course term/code or session course/day/start/end match. Multiple matches require manual selection/correction. Existing rows display skipped status; differences must be explicitly accepted as keep-existing or removed from the draft. This is not a general record-editing API. Source IDs and row keys must remain stable across revisions of the same supplied timetable. A different source without mappings cannot reliably identify a session whose times were changed; do not arbitrarily mint source IDs for retries.

The final review reports draft overlaps separately from adjacent sessions; neither is an automatic rejection. Required-field/relationship errors block saving; optional missing instructors/dates do not. It shows effective saved hours when keeping existing course hours changes the draft total. No actual lecture or attachment records are created. No timezone is inferred.

```ts
import { createAcademicStore, type RelatedBatch } from './src/data';
const store = createAcademicStore();
const termId = crypto.randomUUID();
const courseId = crypto.randomUUID();
const candidates: RelatedBatch = {
  academicTerms: [{ id: termId, name: 'Example', academicYear: '2030/2031', semester: 1 }],
  courses: [{ id: courseId, academicTermId: termId, code: 'EXAMPLE', name: 'Example course', registeredHours: 1 }],
};
const result = await store.createRelated(candidates);
// Inspect result.committed and result.outcomes. Retain these IDs for subsequent calls.
```

`DataError` codes: VALIDATION, NOT_FOUND, RELATIONSHIP, DUPLICATE, CONFLICT, IDENTITY_COLLISION, DEPENDENTS, QUOTA, UNAVAILABLE. LectureFiles lists filtered by lectureId and MaterialFiles lists filtered by materialId use their corresponding indexes before applying other exact filters. Lists without a parent filter still scan the store. Pagination/streaming are not implemented; large Blob libraries need later performance work.

## Phase 1C management contracts (no schema change)

Phase 2 consumes getTimetable without changing v3. Dashboard/calendar reads exclude tombstones through this contract and never create lectures or update academic records. Language preference lives in localStorage, outside academic storage. Localized validation and difference labels do not change IDs, import snapshots, source values or stored Blobs.

`getTimetable(termId?)` returns `{ terms, termId, courses, sessions }` from a consistent read transaction. It excludes tombstones and uses the academicTermId indexes for the selected term. It neither reads Blob stores nor seeds records. Without a selected ID, the latest academicYear/semester is selected, with UUID as deterministic tie-breaker; the UI exposes explicit term selection.

Course management uses existing create/update methods. Updates send only editable fields and captured expectedRevision, preserving UUID, createdAt, unedited description, mapping rows and attachment relationships. Session edits preserve notes/location similarly. Unknown instructors may be null. Parent course/term IDs are fixed in the editor.

`saveManagedSession(input, editing?, confirmedOverlaps = [])` creates or patches a session in one transaction. `editing` contains the existing ID and revision; confirmations contain exactly the IDs/revisions of overlapping active sessions in the same term. The service validates required fields, references and times, rejects reassignment of an existing session and identical course/day/start/end duplicates, then rechecks overlap confirmations before writing. Changed/new overlaps cause CONFLICT. Zero-minute transitions need no acknowledgment. This policy applies to management; existing import/repository contracts remain unchanged.

`deleteManagedCourse(id, expectedRevision, confirmation)` rejects any active dependency beyond weekly sessions. It then invokes the existing reviewed transactional soft deletion. Course/session confirmation protects against concurrent edits/dependencies; neither import mappings nor Blob bytes are changed. Session controls use default restricted deletion, so linked lectures block removal. Historical detachment remains an explicit developer service operation, not an automatic management action. Deleted source mappings continue pointing to tombstones and prevent re-import resurrection.

## Deletion integrity

Default deletion is restricted when active dependents exist. A preview returns the transitive graph of IDs/table names/revisions. Explicit cascade requires that graph as confirmation. Changed/added dependencies cause rejection and require a fresh reviewed preview. Deletion is atomic, soft only, increments revisions and retains Blob bytes.

Term → courses/sessions; course → sessions/lectures/materials; session → linked lectures; lecture → lectureFiles; material → materialFiles. Shared graph nodes are visited once. Lecture deletion leaves course materials intact. Session deletion with historical lectures still defaults to DEPENDENTS and does not automatically cascade. An explicitly confirmed cascade retains its original behavior: it tombstones linked lectures/files too, so the future UI must show those consequences before confirmation. To keep historical lectures active, call `store.detachLectureFromSchedule(lectureId, expectedRevision)` for each linked lecture (or update scheduleSessionId to null) before deleting the session. Detachment increments the lecture revision while retaining ID, date, notes, and files. A concurrently added lecture causes the later default session deletion to reject rather than removing history. No data-removal/purge, reset, restore, or Blob garbage collection API exists. The only internal physical key deletions are transactional identity renames in migration. Tombstones continue to consume storage pending a reviewed future retention policy.

## Migration strategy

Versions 1 and 2 are retained in code. Version 2 scans and preflights all seven stores before writing: duplicate canonical UUIDs within a table and term/code ownership collisions abort with actionable IDENTITY_COLLISION. It never chooses a winner or merges records. The upgrade transaction leaves the original v1 database unchanged on failure. Resolve collisions explicitly through a separately reviewed repair process; do not clear the database or silently retry a merge. No collision-repair UI/API is implemented in this task.

For collision-free records, v2 atomically renames noncanonical primary keys and updates foreign-key casing, preserving every other field, timestamp, revision, tombstone and Blob byte. This preserves UUID identity while standardizing its textual representation. Fresh databases initialize at v3. Versions 1 and 2 remain unchanged; v3 adds only importMappings and inherits the seven domain stores. Future changes must append version 4 or later. Never reset/clear on an app version bump or discard records on uniqueness collisions. Upgrade callbacks must be deterministic and transactional. Tests cover v1 casing migration/collision rollback, v2-to-v3 preservation of metadata/Blobs, and an additive test-only v4 index upgrade. See [RECOVERY.md](RECOVERY.md) for the practical, developer-assisted v1 collision recovery path.

Reference: [Dexie versioning](https://dexie.org/docs/Version/Version.stores()) and [transactions](https://dexie.org/docs/Dexie/Dexie.transaction()).

## Future sync and timetable review

Stable IDs, timestamps and tombstones prepare for later synchronization. Local revisions detect stale local updates across connections; they are NOT a multi-device causal clock. Future sync must retain a last-synced base/version, compare local and remote changes against it, preserve both candidates when both changed, and obtain explicit user resolution. Deletes versus edits also conflict. Never pick a winner using timestamps. No sync protocol or last-write-wins merge is implemented.

The review accepts editable in-memory timetable DTOs, never automatic seeds. Tests use a fully synthetic seven-course/fifteen-session scenario with null instructors and uncertain room notes. Users can correct/add/exclude draft rows before confirming. Existing saved data can only be kept or excluded during re-import, not overwritten. Unsaved drafts do not survive page reload.

Browser storage is origin-specific and may be cleared or evicted. Persistence is not a backup or offline application loading guarantee. No PWA/service worker, Supabase, authentication, cloud sync or general academic management screens are implemented here.

## Phase 2.5 attachments (v3 unchanged)

Master roadmap Phase A also leaves v3 unchanged. getAcademicPresence counts records in a consistent read transaction across every store, including tombstones/importMappings; it does not load Blob content. Onboarding completion lives separately in localStorage and is not an academic record. No sample-like persisted record is deleted automatically. Manual setup calls the existing academicTerms.create API and preserves all repository validation/metadata behavior. The production personal draft fixture has been removed; imported existing records and identities are preserved.

Phase A correction adds read-only `listImportSources(): Promise<SavedImportSource[]>` and `reopenImportSource(sourceId): Promise<TimetableDraft>`. Reopen returns current saved values using original mapping keys and UUIDs. Incomplete sources, tombstones, parent mismatches and duplicate mapping identities reject without repair or resurrection. Both methods use a single service read transaction and never read Blob stores into memory.

Draft rows can carry `identity: "new"` to explicitly approve an unmatched new row alongside existing parent history, or an existing UUID to resolve identity. These DTO-only fields are excluded from domain writes. Stored mapping keys remain authoritative and conflicts reject. Preview and commit both enforce the same resolution policy, revisions, snapshot checks, keep-existing decisions and transaction rollback. Reopening does not reproduce the original document's values because v3 never stored that document; enter incoming differences for review. No schema or existing records are rewritten.

The existing lectureFiles store persists actual Blob bytes plus parent UUID, filename, derived MIME/size, timestamps, revision and tombstone. Managed uploads now enforce a 100 MiB per-file beta cap and format policy; existing low-level Blob APIs/data remain backward compatible. The cap bounds each clone/write and excludes empty files, but is not a device quota estimate or capacity promise. No aggregate library limit, pagination, streaming or file purging is added.

Each managed upload candidate contains a stable UUID, filename and Blob. Its independent transaction checks the active lecture, validates the file and inserts only if its ID is absent. Existing active IDs for that parent return skipped unchanged, regardless of incoming bytes. Cross-parent or tombstoned IDs reject. Every candidate reports saved/skipped/failed and a reason code; quota failure retains already committed siblings. Retry only unsaved candidates using their original IDs. If an entire browser reload loses the pending selection, users must reselect; content-level deduplication is unavailable.

Lecture removal is blocked while active files exist. Individual file deletion requires confirmation/revision and retains its Blob tombstone, so deletion does not free storage. No automatic cascade or reset is used to address quota. Downloads preserve the original bytes with a binary download MIME wrapper and release temporary object URLs. Files are not synchronized or backed up across devices.
