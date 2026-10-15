import type { UniCoreDatabase } from "./database";
import { DataError } from "./errors";
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
    if (!record || record.deletedAt !== null) throw new DataError("CONFLICT", t.brokenSource);
    const { createdAt, updatedAt, deletedAt, revision, ...values } = record;
    void createdAt;
    void updatedAt;
    void deletedAt;
    void revision;
    return { ...values, key: mapping.sourceKey, unconfirmed: [...mapping.unconfirmed] };
  }
  const term = await read("academicTerms", terms[0]);
  const courseMappings = representatives.filter(row => row.entity === "courses");
  const courses = await Promise.all(courseMappings.map(async mapping => {
    const row = await read("courses", mapping);
    if (row.academicTermId !== term.id) throw new DataError("CONFLICT", t.brokenSource);
    const { academicTermId, ...course } = row;
    void academicTermId;
    return course;
  }));
  const sessions = await Promise.all(representatives.filter(row => row.entity === "scheduleSessions").map(async mapping => {
    const row = await read("scheduleSessions", mapping);
    const course = courses.find(course => course.id === row.courseId);
    if (!course || row.academicTermId !== term.id) throw new DataError("CONFLICT", t.brokenSource);
    const { academicTermId, courseId, ...session } = row;
    void academicTermId;
    void courseId;
    return { ...session, courseKey: course.key };
  }));
  return { sourceId, term, courses, sessions };
}
