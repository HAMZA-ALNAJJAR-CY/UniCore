import type { UniCoreDatabase } from "./database";
import { DataError } from "./errors";
import { uuid, validate } from "./validation";
import type {
  ImportMapping,
  SavedImportSource,
  TimetableDraft,
} from "./timetable-types";
import { introductionText as t } from "../i18n/introduction";

/** Internal helpers: the public service holds one read transaction. Never repair mappings here. */
export async function listSources(
  db: UniCoreDatabase,
): Promise<SavedImportSource[]> {
  const mappings = await db.table<ImportMapping>("importMappings").toArray();
  const sourceIds = [...new Set(mappings.map(row => row.sourceId))].sort();
  return Promise.all(sourceIds.map(async sourceId => {
    const term = mappings.find(
      row => row.sourceId === sourceId && row.entity === "academicTerms",
    );
    const record = term
      ? await db.records("academicTerms").get(term.recordId)
      : undefined;
    return { sourceId, termName: record?.name ?? null };
  }));
}

export async function reopenSource(
  db: UniCoreDatabase,
  sourceId: string,
): Promise<TimetableDraft> {
  const mappings = await db.table<ImportMapping>("importMappings")
    .where("sourceId").equals(sourceId).toArray();
  if (mappings.some(row =>
    row.key !== JSON.stringify([sourceId, row.entity, row.sourceKey]) ||
    !["academicTerms", "courses", "scheduleSessions"].includes(row.entity),
  ))
    throw new DataError("CONFLICT", t.brokenSource);
  // Aliases are many source keys -> one UUID. Present one deterministic row per
  // UUID; retain every original mapping in storage for subsequent re-imports.
  // Validate keys before grouping so damaged metadata cannot be hidden by it.
  for (const kind of ["academicTerms", "courses", "scheduleSessions"] as const) {
    const rows = mappings.filter(row => row.entity === kind);
    if (new Set(rows.map(row => row.sourceKey)).size !== rows.length)
      throw new DataError("CONFLICT", t.brokenSource);
  }
  const representatives = [...mappings]
    .sort((a, b) => a.createdAt - b.createdAt || a.sourceKey.localeCompare(b.sourceKey))
    .filter((row, index, rows) => rows.findIndex(other =>
      other.entity === row.entity && other.recordId === row.recordId) === index)
    // Conservatively recover disagreement in legacy aliases. saveTimetable
    // broadcasts the next explicit confirmation to every alias of this record
    // within this source; independently reviewed sources keep their own flags.
    .map(row => ({ ...row, unconfirmed: [...new Set(mappings.filter(alias =>
      alias.entity === row.entity && alias.recordId === row.recordId)
      .flatMap(alias => alias.unconfirmed))] }));
  const terms = representatives.filter(row => row.entity === "academicTerms");
  if (terms.length !== 1) throw new DataError("CONFLICT", t.brokenSource);
  async function read<K extends ImportMapping["entity"]>(
    kind: K,
    mapping: ImportMapping,
  ) {
    const record = await db.records(kind).get(mapping.recordId);
    if (!record) throw new DataError("CONFLICT", t.brokenSource);
    if (record.deletedAt !== null) {
      // Deletion uses Date.now(): a positive integer epoch-millisecond timestamp.
      if (!Number.isSafeInteger(record.deletedAt) || record.deletedAt <= 0 ||
        !Number.isFinite(new Date(record.deletedAt).getTime()))
        throw new DataError("CONFLICT", t.brokenSource);
      try {
        // Validate persisted values directly; never run the normalizing write path.
        uuid(record.id);
        validate(kind, record);
      } catch (error) {
        if (error instanceof DataError && error.code === "VALIDATION")
          throw new DataError("CONFLICT", t.brokenSource, { cause: error });
        throw error;
      }
    }
    const { createdAt, updatedAt, deletedAt, revision, ...values } = record;
    void createdAt;
    void updatedAt;
    void revision;
    return {
      values: { ...values, key: mapping.sourceKey, unconfirmed: [...mapping.unconfirmed] },
      deleted: deletedAt !== null,
    };
  }
  const savedTerm = await read("academicTerms", terms[0]);
  if (savedTerm.deleted) throw new DataError("CONFLICT", t.brokenSource);
  const term = savedTerm.values;
  const omittedDeletedRows: NonNullable<TimetableDraft["omittedDeletedRows"]> = [];
  const courseMappings = representatives.filter(row => row.entity === "courses");
  const savedCourses = await Promise.all(courseMappings.map(async mapping => {
    const { values: row, deleted } = await read("courses", mapping);
    if (row.academicTermId !== term.id) throw new DataError("CONFLICT", t.brokenSource);
    const { academicTermId, ...course } = row;
    void academicTermId;
    return { course, deleted };
  }));
  // Check the entire retained graph, including deleted rows, before omitting any.
  // Tombstones are complete deletion history; absent targets are damaged sources.
  const savedSessions = await Promise.all(representatives.filter(row => row.entity === "scheduleSessions").map(async mapping => {
    const { values: row, deleted } = await read("scheduleSessions", mapping);
    const parent = savedCourses.find(saved => saved.course.id === row.courseId);
    if (!parent || row.academicTermId !== term.id || (!deleted && parent.deleted))
      throw new DataError("CONFLICT", t.brokenSource);
    const { academicTermId, courseId, ...session } = row;
    void academicTermId;
    void courseId;
    return { session: { ...session, courseKey: parent.course.key }, deleted, course: parent.course };
  }));
  for (const { course, deleted } of savedCourses) {
    if (deleted) omittedDeletedRows.push({ entity: "courses", id: course.id, key: course.key, label: course.name });
  }
  for (const { session, deleted, course } of savedSessions) {
    if (deleted) omittedDeletedRows.push({ entity: "scheduleSessions", id: session.id, key: session.key,
      label: `${course.name} (${session.startTime}–${session.endTime})` });
  }
  return {
    sourceId, term,
    courses: savedCourses.filter(row => !row.deleted).map(row => row.course),
    sessions: savedSessions.filter(row => !row.deleted).map(row => row.session),
    ...(omittedDeletedRows.length ? { omittedDeletedRows } : {}),
  };
}
