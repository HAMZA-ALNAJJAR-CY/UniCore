# Service boundary

UI consumers import `createAcademicStore`, models, and `DataError` from `src/data/index.ts`. Database/validation/store modules are internals. Do not import Dexie or direct tables in pages/components. Tests may use internals for migration verification and failure injection. See root DATABASE.md for the schema, API contracts, deletion rules and limitations.

## Registering an entity

Adding a key to `Entities` requires explicit identity fields, input fields, domain validation, preparation, relationship validation, natural-key ownership, insertion order, deletion child links and a public repository. Exhaustive records and `assertNever` checks reject omitted decisions; use explicit no-op cases and empty child arrays when appropriate.

Persisted UUID properties follow the existing `id` / `*Id` convention. The identity contract requires `id` first and every such reference to be listed, including newly added references on existing entities.

Input registration covers every `CreateInput` field, including optional fields, with no additional exclusions. Immutable metadata and Blob-derived `mimeType` / `fileSize` are already excluded by `CreateInput`. Adding a permitted field without registering it fails compilation; this check does not replace domain validation.

`entity-integrity.ts` retains parent-first insertion order and child discovery only. It does not authorize cascades or change deletion policy. Child-link fields must be registered UUID references on the child. Structural tests check ordering, reference coverage, repositories and actual database stores; the compiler regression extends `Entities` in memory and checks each registration failure without writing a future entity.

Historical schema versions remain unchanged. A real new entity still needs a separately reviewed additive schema version, semantic relationship rules and fixtures/tests; registration completeness does not prove those rules correct.
