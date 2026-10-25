import type { UniCoreDatabase } from "./database";
import type { AcademicTerm, Course, Entities, EntityName, ScheduleSession } from "./models";
import { canonicalUuid } from "./identity";
import { validate } from "./validation";
import { DataError } from "./errors";
import { restorationText as t } from "../i18n/restoration";

export interface CourseRestorePreview {
  course: Course;
  term: AcademicTerm;
  /** Every session stays removed: v3 has no durable deletion-operation identity. */
  sessionsRemainingDeleted: ScheduleSession[];
  /** Opaque confirmation of the full course/term/session snapshot, rechecked in the write transaction. */
  snapshot: string;
}

function timestamp(value: number) {
  return Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime());
}
/** Validate as persisted, without normalizing or repairing a field. */
function persisted<K extends EntityName>(kind: K, record: Entities[K]) {
  try {
    if (record.id !== canonicalUuid(record.id) || !timestamp(record.createdAt) ||
      !timestamp(record.updatedAt) || record.updatedAt < record.createdAt ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || record.revision >= Number.MAX_SAFE_INTEGER ||
      (record.deletedAt !== null && !timestamp(record.deletedAt)))
      throw new DataError("VALIDATION", t.invalidRecord);
    validate(kind, record);
  } catch (error) {
    if (error instanceof DataError && error.code === "VALIDATION")
      throw new DataError("VALIDATION", t.invalidRecord, { cause: error });
    throw error;
  }
}
async function activeTerm(db: UniCoreDatabase, id: string) {
  const term = await db.records("academicTerms").get(canonicalUuid(id));
  if (!term) throw new DataError("NOT_FOUND", t.missingTerm);
  if (term.deletedAt !== null) throw new DataError("NOT_FOUND", t.deletedTerm);
  persisted("academicTerms", term);
  return term;
}
function validCourse(course: Course) {
  persisted("courses", course);
  if (course.code !== course.code.trim().toUpperCase()) throw new DataError("VALIDATION", t.invalidRecord);
}

export function courseRestorationCandidate(course: Course): Course {
  const restored = { ...course, deletedAt: null,
    updatedAt: Math.max(Date.now(), course.updatedAt + 1), revision: course.revision + 1 };
  validCourse(restored);
  return restored;
}

/** Internal: caller holds the service read/write transaction. No repair or mutation. */
export async function removedCourses(db: UniCoreDatabase, termId: string) {
  const term = await activeTerm(db, termId);
  const courses = (await db.records("courses").where("academicTermId").equals(term.id).toArray())
    .filter(course => course.deletedAt !== null);
  courses.forEach(validCourse);
  courses.sort((a, b) => a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  return { term, courses };
}

export async function courseRestorePreview(db: UniCoreDatabase, id: string): Promise<CourseRestorePreview> {
  const course = await db.records("courses").get(canonicalUuid(id));
  if (!course) throw new DataError("NOT_FOUND", t.missingCourse);
  if (course.deletedAt === null) throw new DataError("CONFLICT", t.alreadyActive);
  validCourse(course);
  const term = await activeTerm(db, course.academicTermId);
  const owner = await db.records("courses").where("[academicTermId+code]").equals([term.id, course.code]).first();
  if (!owner || owner.id !== course.id) throw new DataError("DUPLICATE", t.codeConflict);
  const sessions = await db.records("scheduleSessions").where("courseId").equals(course.id).toArray();
  for (const session of sessions) {
    try { persisted("scheduleSessions", session); }
    catch (error) {
      if (error instanceof DataError && error.code === "VALIDATION")
        throw new DataError("RELATIONSHIP", t.invalidSessions, { cause: error });
      throw error;
    }
    if (session.deletedAt === null || session.academicTermId !== term.id || session.courseId !== course.id)
      throw new DataError("RELATIONSHIP", t.invalidSessions);
  }
  sessions.sort((a, b) => a.id.localeCompare(b.id));
  return { course, term, sessionsRemainingDeleted: sessions, snapshot: JSON.stringify({ course, term, sessions }) };
}
