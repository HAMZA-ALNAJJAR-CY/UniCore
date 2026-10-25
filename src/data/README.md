# Service boundary

UI consumers import `createAcademicStore`, models, and `DataError` from `src/data/index.ts`. Database/validation/store modules are internals. Do not import Dexie or direct tables in pages/components. Tests may use internals for migration verification and failure injection. See root DATABASE.md for the schema, API contracts, deletion rules and limitations.
