# Local academic database — Phase 1A

## Version 2 schema

Dexie owns IndexedDB database `UniCore`. Every table uses a stable UUID primary key and contains `createdAt` / `updatedAt` epoch-millisecond timestamps, nullable `deletedAt`, and local integer `revision` starting at 1. No table is opened or seeded by the UI. Dates are `YYYY-MM-DD`; times are local wall-clock `HH:mm`, without a guessed timezone. Version 2 keeps the seven v1 store/index definitions and safely canonicalizes legacy identity casing.

Valid UUIDs are accepted in any letter case and stored/looked up in lowercase. The same rule applies to all foreign keys, ID filters, deletion roots and confirmation IDs. Only known identity fields are normalized as UUIDs; names, room codes and notes are untouched. Course-code normalization remains its separate existing trim/uppercase policy. Identity is scoped by table and canonical UUID. Input objects are copied rather than mutated.

| Table | Academic fields | Indexed lookups |
| --- | --- | --- |
| academicTerms | name, academicYear, semester, optional dates | academicYear |
| courses | academicTermId, code, name, optional instructor/section/description, registeredHours | academicTermId, unique [academicTermId+code] |
| scheduleSessions | academicTermId, courseId, dayOfWeek, times, optional room/location/notes, deliveryMode | academicTermId, courseId, dayOfWeek |
| lectures | courseId, optional scheduleSessionId, date, optional paired times/title/notes | courseId, scheduleSessionId, date |
| lectureFiles | lectureId, fileName, mimeType, fileSize, Blob | lectureId |
| materials | courseId, title, optional description/category | courseId, category |
| materialFiles | materialId, fileName, mimeType, fileSize, Blob | materialId |

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

`createRelated(batch: RelatedBatch)` accepts optional typed arrays keyed by the seven store names and returns the same result. The service processes them parent-first in one transaction; references can target earlier candidates or existing active parents. Unknown/mismatched references reject. Existing identities retain their original fields and IDs. There is no implicit reference remapping when a different UUID owns a course code. No timetable review/import UI, seed process, backup/restore, or synchronization is implemented.

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

## Deletion integrity

Default deletion is restricted when active dependents exist. A preview returns the transitive graph of IDs/table names/revisions. Explicit cascade requires that graph as confirmation. Changed/added dependencies cause rejection and require a fresh reviewed preview. Deletion is atomic, soft only, increments revisions and retains Blob bytes.

Term → courses/sessions; course → sessions/lectures/materials; session → linked lectures; lecture → lectureFiles; material → materialFiles. Shared graph nodes are visited once. Lecture deletion leaves course materials intact. Session deletion with historical lectures still defaults to DEPENDENTS and does not automatically cascade. An explicitly confirmed cascade retains its original behavior: it tombstones linked lectures/files too, so the future UI must show those consequences before confirmation. To keep historical lectures active, call `store.detachLectureFromSchedule(lectureId, expectedRevision)` for each linked lecture (or update scheduleSessionId to null) before deleting the session. Detachment increments the lecture revision while retaining ID, date, notes, and files. A concurrently added lecture causes the later default session deletion to reject rather than removing history. No data-removal/purge, reset, restore, or Blob garbage collection API exists. The only internal physical key deletions are transactional identity renames in migration. Tombstones continue to consume storage pending a reviewed future retention policy.

## Migration strategy

Versions 1 and 2 are retained in code. Version 2 scans and preflights all seven stores before writing: duplicate canonical UUIDs within a table and term/code ownership collisions abort with actionable IDENTITY_COLLISION. It never chooses a winner or merges records. The upgrade transaction leaves the original v1 database unchanged on failure. Resolve collisions explicitly through a separately reviewed repair process; do not clear the database or silently retry a merge. No collision-repair UI/API is implemented in this task.

For collision-free records, v2 atomically renames noncanonical primary keys and updates foreign-key casing, preserving every other field, timestamp, revision, tombstone and Blob byte. This preserves UUID identity while standardizing its textual representation. Fresh databases initialize v2 directly. Future changes must append version 3 or later without editing the previous migrations. Dexie inherits unchanged stores. Never reset/clear on an app version bump or discard records on uniqueness collisions. Upgrade callbacks must be deterministic and transactional. Tests cover v1 casing migration, collision rollback, and an additive test-only v3 index upgrade that preserves records/attachments.

Reference: [Dexie versioning](https://dexie.org/docs/Version/Version.stores()) and [transactions](https://dexie.org/docs/Dexie/Dexie.transaction()).

## Future sync and timetable review

Stable IDs, timestamps and tombstones prepare for later synchronization. Local revisions detect stale local updates across connections; they are NOT a multi-device causal clock. Future sync must retain a last-synced base/version, compare local and remote changes against it, preserve both candidates when both changed, and obtain explicit user resolution. Deletes versus edits also conflict. Never pick a winner using timestamps. No sync protocol or last-write-wins merge is implemented.

The current timetable extraction is not approved for insertion. Discrete Mathematics OCR instructor is wrong; retain null until corrected. B203's asterisk is an unconfirmed source note only. Future import must support correction, missing fields, removals, confirmation before save and later edits retaining UUIDs. First semester 2026/2027 and Arabic/RTL are product context only; no timetable data is seeded.

Browser storage is origin-specific and may be cleared or evicted. Persistence is not a backup or offline application loading guarantee. No PWA/service worker, Supabase, authentication, cloud sync or academic screens are implemented here.
