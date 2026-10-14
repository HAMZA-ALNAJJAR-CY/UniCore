import Dexie from "dexie";
import type { Entities, EntityName } from "./models";
import { DataError } from "./errors";
import { canonicalUuid, normalizeIds } from "./identity";

export const SCHEMA_V1 = {
  academicTerms: "id, academicYear",
  courses: "id, academicTermId, &[academicTermId+code]",
  scheduleSessions: "id, academicTermId, courseId, dayOfWeek",
  lectures: "id, courseId, scheduleSessionId, date",
  lectureFiles: "id, lectureId",
  materials: "id, courseId, category",
  materialFiles: "id, materialId",
};

/** Internal module. UI code must use the service exported by data/index.ts. */
export class UniCoreDatabase extends Dexie {
  constructor(name = "UniCore") {
    super(name);
    this.version(1).stores(SCHEMA_V1);
    this.version(2)
      .stores(SCHEMA_V1)
      .upgrade(async (transaction) => {
        const staged: {
          kind: EntityName;
          original: Entities[EntityName];
          normalized: Entities[EntityName];
        }[] = [];
        const courseKeys = new Set<string>();
        // Preflight every identity before any write. A failed upgrade retains v1.
        for (const kind of Object.keys(SCHEMA_V1) as EntityName[]) {
          const seen = new Set<string>();
          const records = await transaction
            .table<Entities[EntityName], string>(kind)
            .toArray();
          for (const original of records) {
            const id = canonicalUuid(original.id);
            if (seen.has(id))
              throw new DataError(
                "IDENTITY_COLLISION",
                `Cannot normalize ${kind}: multiple records identify UUID ${id}. No records were merged. Resolve the legacy identity conflict explicitly before retrying.`,
              );
            seen.add(id);
            const normalized = normalizeIds(kind, original);
            if (kind === "courses") {
              const course = normalized as Entities["courses"];
              const key = JSON.stringify([course.academicTermId, course.code]);
              if (courseKeys.has(key))
                throw new DataError(
                  "IDENTITY_COLLISION",
                  "UUID normalization would give multiple courses the same term/code ownership. No data was changed; resolve that ownership conflict explicitly before retrying.",
                );
              courseKeys.add(key);
            }
            staged.push({ kind, original, normalized });
          }
        }
        // Rekey only changed identities, preserving every field, revision and Blob.
        // The delete/add pair is an atomic rename, never a database reset or purge.
        for (const { kind, original, normalized } of staged) {
          if (original.id !== normalized.id)
            await transaction.table(kind).delete(original.id);
        }
        for (const { kind, original, normalized } of staged) {
          if (
            Object.keys(normalized).some(
              (key) =>
                normalized[key as keyof typeof normalized] !==
                original[key as keyof typeof original],
            )
          ) {
            await transaction.table(kind).put(normalized);
          }
        }
      });
  }

  records<K extends EntityName>(name: K) {
    return this.table<Entities[K], string>(name);
  }
}
