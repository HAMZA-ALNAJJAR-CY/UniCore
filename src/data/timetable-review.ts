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
    throw new DataError("VALIDATION", "هوية مصدر المسودة مطلوبة.");
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
  ) {
    const binding = bindings.find(
      (row) => row.key === keyFor(draft.sourceId, kind, key),
    );
    let id = binding?.recordId ?? requestedId;
    if (
      binding &&
      requestedId &&
      canonicalUuid(requestedId) !== binding.recordId
    )
      fail(
        "المصدر مرتبط بهوية محفوظة أخرى. لا يمكن إعادة ربطه بسجل مختلف تلقائياً.",
      );
    if (!binding) {
      const explicit = requestedId
        ? await db.records(kind).get(canonicalUuid(requestedId))
        : undefined;
      if (explicit) id = explicit.id;
      else if (candidates.length > 1)
        fail(
          "توجد عدة سجلات محفوظة مطابقة. حدد هوية الفصل أو صحح المسودة؛ لن يتم اختيار سجل تلقائياً.",
        );
      else if (candidates.length === 1) id = candidates[0].id;
    }
    id = id ? canonicalUuid(id) : crypto.randomUUID();
    const existing = await db.records(kind).get(id);
    if (binding && !existing)
      fail(
        "ارتباط الاستيراد يشير إلى سجل مفقود. أوقف الحفظ وراجع البيانات؛ لن يتم إنشاء هوية بديلة.",
      );
    if (existing?.deletedAt != null)
      fail(
        "أحد السجلات المرتبطة محذوف سابقاً. استبعده من المسودة؛ الاستيراد لا يستعيد السجلات المحذوفة.",
      );
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
      if (value == null) return "غير معروف";
      if (field === "courseId")
        return courseLabels.get(String(value)) ?? String(value);
      if (field === "dayOfWeek") return DAYS[Number(value)] ?? String(value);
      return (
        (
          {
            theory: "نظري",
            practical: "عملي",
            online: "إلكتروني",
            "in-person": "وجاهي",
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
          FIELD_LABELS[field] ??
          (field === "courseId" ? "المقرر المرتبط" : field),
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
  );
  draft.term.id = termMatch.id;
  const { key: termKey, unconfirmed: termUnknown, ...termInput } = draft.term;
  void termKey;
  void termUnknown;
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
    );
    if (match.existing && match.existing.academicTermId !== termMatch.id)
      fail(
        "مقرر مرتبط بالمصدر نُقل إلى فصل آخر. استبعده وجلساته أو راجع الربط؛ لن يتغير السجل المحفوظ.",
      );
    if (selectedCourseIds.has(match.id))
      fail(
        "أكثر من مقرر في المسودة يشير إلى الهوية المحفوظة نفسها. استبعد التكرار قبل الحفظ.",
      );
    selectedCourseIds.add(match.id);
    course.id = match.id;
    if (!courseLabels.has(match.id))
      courseLabels.set(match.id, `${course.name} (${code})`);
    const { key, unconfirmed, ...data } = course;
    void key;
    void unconfirmed;
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
    );
    if (match.existing && match.existing.academicTermId !== termMatch.id)
      fail("جلسة مرتبطة بالمصدر موجودة في فصل آخر. راجع الربط قبل الحفظ.");
    if (selectedSessionIds.has(match.id))
      fail(
        "جلسات مسودة متعددة تشير إلى الجلسة المحفوظة نفسها. استبعد التكرار قبل الحفظ.",
      );
    selectedSessionIds.add(match.id);
    session.id = match.id;
    const { key, unconfirmed, courseKey, ...data } = session;
    void key;
    void unconfirmed;
    void courseKey;
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
