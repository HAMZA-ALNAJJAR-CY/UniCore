import { DataError } from "./errors";
import { ID_FIELDS } from "./identity";
import type { EntityName } from "./models";

/** Every entity needs an explicit insertion position, including independent roots.
 * Parent-before-child ordering is checked against DELETION_LINKS in tests. */
export const ENTITY_ORDER = {
  academicTerms: 0,
  courses: 1,
  scheduleSessions: 2,
  lectures: 3,
  materials: 4,
  lectureFiles: 5,
  materialFiles: 6,
} as const satisfies Record<EntityName, number>;

export const ENTITY_INSERT_ORDER: readonly EntityName[] =
  (Object.keys(ENTITY_ORDER) as EntityName[]).sort((a, b) => ENTITY_ORDER[a] - ENTITY_ORDER[b]);

/** Child fields must be registered UUID references on that child, never its ID. */
type ChildLink = {
  [K in EntityName]: { child: K; field: Exclude<(typeof ID_FIELDS)[K][number], "id"> }
}[EntityName];

/** Empty arrays explicitly declare leaves. Keep the existing deletion policy;
 * this registry discovers dependencies, it does not authorize cascading removal. */
export const DELETION_LINKS: Readonly<Record<EntityName, readonly ChildLink[]>> = {
  academicTerms: [
    { child: "courses", field: "academicTermId" },
    { child: "scheduleSessions", field: "academicTermId" },
  ],
  courses: [
    { child: "scheduleSessions", field: "courseId" },
    { child: "lectures", field: "courseId" },
    { child: "materials", field: "courseId" },
  ],
  scheduleSessions: [{ child: "lectures", field: "scheduleSessionId" }],
  lectures: [{ child: "lectureFiles", field: "lectureId" }],
  materials: [{ child: "materialFiles", field: "materialId" }],
  lectureFiles: [],
  materialFiles: [],
};

export function assertNever(value: never): never {
  throw new DataError("VALIDATION", "Unsupported academic entity: " + String(value));
}
