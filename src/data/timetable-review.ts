import { tr } from "../i18n/locale";
import { introductionText as t } from "../i18n/introduction";
import { analyzeDraft, FIELD_LABELS, DAYS } from "../features/timetable/draft";
import { UniCoreDatabase } from "./database";
import { DataError } from "./errors";
import { canonicalUuid } from "./identity";
import type { Entities, EntityName, RecordMetadata, BulkInput } from "./models";
import type {
  ImportMapping,
  TimetableDraft,
  TimetableReview,
} from "./timetable-types";

type ImportEntity = ImportMapping["entity"];
const fail = (message: string): never => {
  throw new DataError("CONFLICT", message);
};
const keyFor = (sourceId: string, entity: ImportEntity, key: string) =>
  JSON.stringify([sourceId, entity, key]);
function withoutMetadata<T extends RecordMetadata>(row: T) {
  const { createdAt, updatedAt, deletedAt, revision, ...input } = row;
  void createdAt;
  void updatedAt;
  void deletedAt;
  void revision;
  return input;
}

/** Internal: caller holds a transaction covering records and import mappings. */
export async function buildTimetableReview(
  db: UniCoreDatabase,
  source: TimetableDraft,
) {
  const validation = analyzeDraft(source);
  if (validation.errors.length)
    throw new DataError("VALIDATION", validation.errors.join(" "));
  if (!source.sourceId.trim())
    throw new DataError("VALIDATION", tr("text_213"));
  const draft: TimetableDraft = {
    ...source,
    term: { ...source.term, unconfirmed: [...source.term.unconfirmed] },
    courses: source.courses.map((row) => ({
      ...row,
      unconfirmed: [...row.unconfirmed],
    })),
    sessions: source.sessions.map((row) => ({
      ...row,
      unconfirmed: [...row.unconfirmed],
    })),
  };
  const bindings = await db
    .table<ImportMapping, string>("importMappings")
    .where("sourceId")
    .equals(draft.sourceId)
    .toArray();
  const pendingMappings: ImportMapping[] = [];
  const differences: TimetableReview["differences"] = [];
  const existingKeys: string[] = [];
  const expected: { kind: EntityName; id: string; revision: number }[] = [];
  const courseLabels = new Map<string, string>();
  const batch: {
    academicTerms: BulkInput<"academicTerms">[];
    courses: BulkInput<"courses">[];
    scheduleSessions: BulkInput<"scheduleSessions">[];
  } = { academicTerms: [], courses: [], scheduleSessions: [] };

  async function resolve<K extends ImportEntity>(
    kind: K,
    key: string,
    requestedId: string | undefined,
    candidates: Entities[K][],
    unconfirmed: string[],
    identity?: "new",
    hasHistory = false,
  ) {
    const binding = bindings.find(
      (row) => row.key === keyFor(draft.sourceId, kind, key),
    );
    const explicit = requestedId
      ? await db.records(kind).get(canonicalUuid(requestedId))
      : undefined;
    // "New" is a decision, not a fallback. Never reinterpret it as reuse.
    if (identity === "new" && (binding || explicit || candidates.length))
      fail(t.newIdentityConflict);
    let id = binding?.recordId ?? requestedId;
    if (
      binding &&
      requestedId &&
      canonicalUuid(requestedId) !== binding.recordId
    )
      fail(tr("text_214"));
    if (!binding) {
      if (explicit) id = explicit.id;
      else if (candidates.length > 1) fail(tr("text_215"));
      else if (candidates.length === 1) id = candidates[0].id;
      else if (hasHistory && identity !== "new") fail(t.resolveIdentity);
    }
    id = id ? canonicalUuid(id) : crypto.randomUUID();
    const existing = await db.records(kind).get(id);
    if (binding && !existing) fail(tr("text_216"));
    if (existing?.deletedAt != null) fail(tr("text_217"));
    if (existing) {
      existingKeys.push(`${kind}:${key}`);
      expected.push({ kind, id, revision: existing.revision });
    }
    pendingMappings.push({
      key: keyFor(draft.sourceId, kind, key),
      sourceId: draft.sourceId,
      sourceKey: key,
      entity: kind,
      recordId: id,
      unconfirmed: [...unconfirmed],
      createdAt: binding?.createdAt ?? Date.now(),
    });
    return { id, existing };
  }

  function compare(
    kind: ImportEntity,
    key: string,
    label: string,
    incoming: object,
    existing?: object,
  ) {
    if (!existing) return;
    const stored = existing as Record<string, unknown>;
    const display = (field: string, value: unknown): string => {
      if (value == null) return tr("text_51");
      if (field === "courseId")
        return courseLabels.get(String(value)) ?? String(value);
      if (field === "dayOfWeek") return DAYS[Number(value)] ?? String(value);
      return (
        (
          {
            theory: tr("text_84"),
            practical: tr("text_85"),
            online: tr("text_52"),
            "in-person": tr("text_53"),
          } as Record<string, string>
        )[String(value)] ?? String(value)
      );
    };
    const fields = Object.entries(incoming)
      .filter(
        ([field, value]) =>
          field !== "id" && (value ?? null) !== (stored[field] ?? null),
      )
      .map(([field, value]) => ({
        field:
          FIELD_LABELS[field] ?? (field === "courseId" ? tr("text_91") : field),
        incoming: display(field, value),
        existing: display(field, stored[field]),
      }));
    if (fields.length)
      differences.push({ key: `${kind}:${key}`, label, fields });
  }

  const terms = await db
    .records("academicTerms")
    .where("academicYear")
    .equals(draft.term.academicYear)
    .toArray();
  const termMatch = await resolve(
    "academicTerms",
    draft.term.key,
    draft.term.id,
    terms.filter((row) => row.semester === draft.term.semester),
    draft.term.unconfirmed,
    draft.term.identity,
  );
  draft.term.id = termMatch.id;
  const { key: termKey, unconfirmed: termUnknown, identity: termIdentity, ...termInput } = draft.term;
  void termKey;
  void termUnknown;
  void termIdentity;
  compare(
    "academicTerms",
    draft.term.key,
    draft.term.name,
    termInput,
    termMatch.existing,
  );
  batch.academicTerms = [
    termMatch.existing
      ? withoutMetadata(termMatch.existing)
      : { ...termInput, id: termMatch.id },
  ];
  const storedCourses = await db
    .records("courses")
    .where("academicTermId")
    .equals(termMatch.id)
    .toArray();
  storedCourses.forEach((course) =>
    courseLabels.set(course.id, `${course.name} (${course.code})`),
  );
  const selectedCourseIds = new Set<string>();
  for (const course of draft.courses) {
    const code = course.code.trim().toUpperCase();
    const match = await resolve(
      "courses",
      course.key,
      course.id,
      storedCourses.filter((row) => row.code === code),
      course.unconfirmed,
      course.identity,
      storedCourses.length > 0,
    );
    if (match.existing && match.existing.academicTermId !== termMatch.id)
      fail(tr("text_218"));
    if (selectedCourseIds.has(match.id)) fail(tr("text_219"));
    selectedCourseIds.add(match.id);
    course.id = match.id;
    if (!courseLabels.has(match.id))
      courseLabels.set(match.id, `${course.name} (${code})`);
    const { key, unconfirmed, identity, ...data } = course;
    void key;
    void unconfirmed;
    void identity;
    const input = { ...data, id: match.id, academicTermId: termMatch.id, code };
    compare("courses", course.key, course.name, input, match.existing);
    batch.courses!.push(
      match.existing ? withoutMetadata(match.existing) : input,
    );
  }
  const storedSessions = await db
    .records("scheduleSessions")
    .where("academicTermId")
    .equals(termMatch.id)
    .toArray();
  const selectedSessionIds = new Set<string>();
  // Excluded draft rows retain their saved source mappings. Validate the
  // session that keep-existing will actually retain against that final source.
  const mappedCourseIds = new Set([
    ...bindings.filter(row => row.entity === "courses").map(row => row.recordId),
    ...pendingMappings.filter(row => row.entity === "courses").map(row => row.recordId),
  ]);
  for (const session of draft.sessions) {
    const course = draft.courses.find((row) => row.key === session.courseKey)!;
    const match = await resolve(
      "scheduleSessions",
      session.key,
      session.id,
      storedSessions.filter(
        (row) =>
          row.courseId === course.id &&
          row.dayOfWeek === session.dayOfWeek &&
          row.startTime === session.startTime &&
          row.endTime === session.endTime,
      ),
      session.unconfirmed,
      session.identity,
      storedSessions.some(row => row.courseId === course.id),
    );
    if (match.existing && match.existing.academicTermId !== termMatch.id)
      fail(tr("text_220"));
    if (match.existing && !mappedCourseIds.has(match.existing.courseId))
      fail(t.retainedParentExcluded);
    if (selectedSessionIds.has(match.id)) fail(tr("text_221"));
    selectedSessionIds.add(match.id);
    session.id = match.id;
    const { key, unconfirmed, courseKey, identity, ...data } = session;
    void key;
    void unconfirmed;
    void courseKey;
    void identity;
    const input = {
      ...data,
      id: match.id,
      academicTermId: termMatch.id,
      courseId: course.id!,
    };
    compare(
      "scheduleSessions",
      session.key,
      `${course.name} ${session.startTime}`,
      input,
      match.existing,
    );
    batch.scheduleSessions!.push(
      match.existing ? withoutMetadata(match.existing) : input,
    );
  }
  // Bindings use existing metadata only: fresh createdAt values never destabilize preview.
  const snapshot = JSON.stringify({ draft, expected, bindings });
  const review: TimetableReview = {
    draft,
    differences,
    existingKeys,
    snapshot,
    savedSummary: {
      courses: batch.courses.length,
      sessions: batch.scheduleSessions.length,
      hours: batch.courses.reduce(
        (total, course) => total + course.registeredHours,
        0,
      ),
    },
  };
  return { review, batch, mappings: pendingMappings };
}
