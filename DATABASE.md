# Local academic database — Phase 1A

## Version 1 schema

Dexie owns IndexedDB database `UniCore`. Every table uses a stable UUID primary key and contains `createdAt` / `updatedAt` epoch-millisecond timestamps, nullable `deletedAt`, and local integer `revision` starting at 1. No table is opened or seeded by the UI. Dates are `YYYY-MM-DD`; times are local wall-clock `HH:mm`, without a guessed timezone.

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

Weekdays use ISO numbering: Monday=1, Sunday=7. Dates must exist; sessions require start before end on the same day. Overnight ranges are not supported in v1. Lecture times are either both absent or both valid. ScheduleSessions are weekly templates, not actual lectures; no automatic generation occurs.

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

`bulkUpsert` deliberately means insert-if-absent, NOT replacement upsert. Callers supply reviewed data and stable UUIDs. Existing IDs (including tombstones) and matching course natural keys are reported in `skipped`, including their existing IDs. No existing field is modified regardless of incoming differences. Invalid new records/missing parents abort the entire batch. Entity batches run parent-first; cross-entity import orchestration is out of scope.

`DataError` codes: VALIDATION, NOT_FOUND, RELATIONSHIP, DUPLICATE, CONFLICT, DEPENDENTS, QUOTA, UNAVAILABLE. Listing is intentionally simple and not paginated; large Blob libraries require later performance work.

## Deletion integrity

Default deletion is restricted when active dependents exist. A preview returns the transitive graph of IDs/table names/revisions. Explicit cascade requires that graph as confirmation. Changed/added dependencies cause rejection and require a fresh reviewed preview. Deletion is atomic, soft only, increments revisions and retains Blob bytes.

Term → courses/sessions; course → sessions/lectures/materials; session → linked lectures; lecture → lectureFiles; material → materialFiles. Shared graph nodes are visited once. Lecture deletion leaves course materials intact. To keep historical lectures when deleting a session, explicitly unlink them through revision-checked edits first. No production hard-delete, reset, restore, or Blob garbage collection API exists. Tombstones continue to consume storage pending a reviewed future retention policy.

## Migration strategy

Keep version 1 declarations; append `version(2).stores({...}).upgrade(...)` for future changes. Dexie inherits unchanged stores. Never delete/reset/clear the database on an app version bump, change UUIDs, or discard records on uniqueness collisions. Upgrade callbacks must be deterministic and transactional, retain records/Blobs/timestamps/tombstones, and explicitly reconcile collisions. Test fresh databases and v1 databases with realistic records before release. A test-only additive v2 upgrade verifies preservation; production ships v1 only.

Reference: [Dexie versioning](https://dexie.org/docs/Version/Version.stores()) and [transactions](https://dexie.org/docs/Dexie/Dexie.transaction()).

## Future sync and timetable review

Stable IDs, timestamps and tombstones prepare for later synchronization. Local revisions detect stale local updates across connections; they are NOT a multi-device causal clock. Future sync must retain a last-synced base/version, compare local and remote changes against it, preserve both candidates when both changed, and obtain explicit user resolution. Deletes versus edits also conflict. Never pick a winner using timestamps. No sync protocol or last-write-wins merge is implemented.

The current timetable extraction is not approved for insertion. Discrete Mathematics OCR instructor is wrong; retain null until corrected. B203's asterisk is an unconfirmed source note only. Future import must support correction, missing fields, removals, confirmation before save and later edits retaining UUIDs. First semester 2026/2027 and Arabic/RTL are product context only; no timetable data is seeded.

Browser storage is origin-specific and may be cleared or evicted. Persistence is not a backup or offline application loading guarantee. No PWA/service worker, Supabase, authentication, cloud sync or academic screens are implemented here.
