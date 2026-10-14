import { DataError } from "./errors";
import type { EntityName } from "./models";

export const ID_FIELDS: Record<EntityName, readonly string[]> = {
  academicTerms: ["id"],
  courses: ["id", "academicTermId"],
  scheduleSessions: ["id", "academicTermId", "courseId"],
  lectures: ["id", "courseId", "scheduleSessionId"],
  lectureFiles: ["id", "lectureId"],
  materials: ["id", "courseId"],
  materialFiles: ["id", "materialId"],
};

export function canonicalUuid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new DataError("VALIDATION", "A valid stable UUID is required.");
  }
  return value.toLowerCase();
}

/** Copy, never mutate caller-owned input; only known identity fields are changed. */
export function normalizeIds<T extends object>(kind: EntityName, input: T): T {
  const copy = { ...input };
  const fields = copy as Record<string, unknown>;
  for (const field of ID_FIELDS[kind]) {
    if (fields[field] != null) fields[field] = canonicalUuid(fields[field]);
  }
  return copy;
}
