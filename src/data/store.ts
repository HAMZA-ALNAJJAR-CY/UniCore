import { tr } from "../i18n/locale";
import type { TransactionMode } from "dexie";
import { UniCoreDatabase } from "./database";
import { DataError, translateStorageError, type DataErrorCode } from "./errors";
import { canonicalUuid, normalizeIds } from "./identity";
import type {
  BulkInput,
  CreateInput,
  Entities,
  EntityName,
  ListFilter,
  UpdateInput,
} from "./models";
import { assertInput, invalid, validate } from "./validation";
import { buildTimetableReview } from "./timetable-review";
import { listSources, reopenSource } from "./import-sources";
import { courseRestorationCandidate, courseRestorePreview, removedCourses } from "./course-restoration";
import { restorationText } from "../i18n/restoration";
import { fileProblem } from "../features/lectures/files";
import { overlappingSessions } from "../features/timetable/schedule";
import type {
  ImportMapping,
  TimetableDraft,
  TimetableReview,
} from "./timetable-types";

type DeleteOptions = {
  expectedRevision: number;
  cascade?: boolean;
  confirmation?: readonly DeletionEntry[];
};
type ReadOptions = { includeDeleted?: boolean };
export type DeletionEntry = { kind: EntityName; id: string; revision: number };
export interface RecordOutcome {
  kind: EntityName;
  index: number;
  requestedId: string | null;
  id: string | null;
  status: "inserted" | "skipped" | "rejected";
  reason: string;
  code?: DataErrorCode;
  existingId?: string;
}
export type RelatedBatch = { [K in EntityName]?: readonly BulkInput<K>[] };
export interface BulkResult {
  committed: boolean;
  outcomes: RecordOutcome[];
  created: string[];
  rejected: RecordOutcome[];
  skipped: {
    requestedId: string;
    existingId: string;
    reason: "existing-id" | "tombstone";
  }[];
}

class RejectedBatch extends DataError {
  constructor(readonly result: BulkResult) {
    super("VALIDATION", "Batch rejected; every new write was rolled back.");
  }
}

export class AcademicStore {
  readonly academicTerms = this.repository("academicTerms");
  readonly courses = this.repository("courses");
  readonly scheduleSessions = this.repository("scheduleSessions");
  readonly lectures = this.repository("lectures");
  readonly lectureFiles = this.repository("lectureFiles");
  readonly materials = this.repository("materials");
  readonly materialFiles = this.repository("materialFiles");

  constructor(private readonly database: UniCoreDatabase) {}

  async open(): Promise<void> {
    try {
      await this.database.open();
    } catch (error) {
      translateStorageError(error);
    }
  }
  close() {
    this.database.close();
  }

  /** Presence, not completeness: any persisted history/partial record prevents first-run classification. */
  getAcademicPresence() {
    return this.run("r", async () => ({
      hasRecords: (
        await Promise.all(this.database.tables.map((table) => table.count()))
      ).some((count) => count > 0),
    }));
  }

  /** Indexed lecture workspace read. Attachment bytes are loaded only for an opened lecture. */
  getLectureWorkspace(lectureId?: string) {
    return this.run("r", async () => {
      const courses = (await this.database.records("courses").toArray()).filter(
        (row) => row.deletedAt === null,
      );
      const lectures = (await this.database.records("lectures").toArray())
        .filter((row) => row.deletedAt === null)
        .sort(
          (a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt,
        );
      const sessions = (
        await this.database.records("scheduleSessions").toArray()
      ).filter((row) => row.deletedAt === null);
      const lecture = lectureId
        ? await this.active("lectures", lectureId)
        : undefined;
      const files = lecture
        ? (
            await this.database
              .records("lectureFiles")
              .where("lectureId")
              .equals(lecture.id)
              .toArray()
          )
            .filter((row) => row.deletedAt === null)
            .map(({ blob, ...metadata }) => {
              void blob;
              return metadata;
            })
        : [];
      return { courses, lectures, sessions, lecture, files };
    });
  }

  /** Independent per-file transactions: partial successes are retained, retries use stable caller IDs. */
  async attachLectureFiles(
    lectureId: string,
    inputs: readonly { id: string; fileName: string; blob: Blob }[],
  ) {
    const outcomes: {
      id: string;
      status: "saved" | "skipped" | "failed";
      problem?: ReturnType<typeof fileProblem>;
      code?: DataErrorCode;
    }[] = [];
    for (const input of inputs) {
      try {
        const id = canonicalUuid(input.id),
          parent = canonicalUuid(lectureId);
        const problem = fileProblem(input.fileName, input.blob);
        if (problem) {
          outcomes.push({ id, status: "failed", problem });
          continue;
        }
        const status = await this.run("rw", async () => {
          await this.active("lectures", parent);
          const existing = await this.database.records("lectureFiles").get(id);
          if (existing) {
            if (existing.lectureId !== parent || existing.deletedAt !== null)
              throw new DataError(
                "CONFLICT",
                "Upload identity is reserved or was removed.",
              );
            return "skipped" as const;
          }
          await this.insert(
            "lectureFiles",
            { lectureId: parent, fileName: input.fileName, blob: input.blob },
            id,
          );
          return "saved" as const;
        });
        outcomes.push({ id, status });
      } catch (error) {
        outcomes.push({
          id: input.id,
          status: "failed",
          code: error instanceof DataError ? error.code : "UNAVAILABLE",
        });
      }
    }
    return outcomes;
  }

  /** Consistent management read, without seeding or fetching attachment bytes. */
  getTimetable(termId?: string) {
    return this.run("r", async () => {
      const terms = (await this.database.records("academicTerms").toArray())
        .filter((row) => row.deletedAt === null)
        .sort(
          (a, b) =>
            b.academicYear.localeCompare(a.academicYear) ||
            b.semester - a.semester ||
            a.id.localeCompare(b.id),
        );
      const selectedId = termId ? canonicalUuid(termId) : terms[0]?.id;
      if (selectedId) await this.active("academicTerms", selectedId);
      const courses = selectedId
        ? (
            await this.database
              .records("courses")
              .where("academicTermId")
              .equals(selectedId)
              .toArray()
          ).filter((row) => row.deletedAt === null)
        : [];
      const sessions = selectedId
        ? (
            await this.database
              .records("scheduleSessions")
              .where("academicTermId")
              .equals(selectedId)
              .toArray()
          ).filter((row) => row.deletedAt === null)
        : [];
      return { terms, termId: selectedId, courses, sessions };
    });
  }

  /** Management-only write: exact current overlap IDs/revisions must be acknowledged.
   * Existing importer/bulk contracts remain unchanged. All checks and the write share a transaction.
   */
  saveManagedSession(
    input: CreateInput<"scheduleSessions">,
    editing?: { id: string; revision: number },
    confirmedOverlaps: readonly { id: string; revision: number }[] = [],
  ) {
    return this.run("rw", async () => {
      assertInput("scheduleSessions", input);
      const id = editing ? canonicalUuid(editing.id) : crypto.randomUUID();
      const candidate = this.prepare("scheduleSessions", {
        ...input,
        id,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
        revision: 1,
      });
      await this.relationships("scheduleSessions", candidate);
      if (editing) {
        const existing = await this.active("scheduleSessions", id);
        this.revision(existing.revision, editing.revision);
        if (
          existing.courseId !== candidate.courseId ||
          existing.academicTermId !== candidate.academicTermId
        )
          throw new DataError(
            "RELATIONSHIP",
            "Management edits cannot reassign a session to a different course or term.",
          );
      }
      const sessions = (
        await this.database
          .records("scheduleSessions")
          .where("academicTermId")
          .equals(candidate.academicTermId)
          .toArray()
      ).filter((row) => row.deletedAt === null);
      if (
        sessions.some(
          (row) =>
            row.id !== id &&
            row.courseId === candidate.courseId &&
            row.dayOfWeek === candidate.dayOfWeek &&
            row.startTime === candidate.startTime &&
            row.endTime === candidate.endTime,
        )
      )
        throw new DataError(
          "DUPLICATE",
          "An identical weekly session already exists.",
        );
      const overlaps = overlappingSessions(candidate, sessions, id);
      const confirmations = confirmedOverlaps.map((row) => ({
        ...row,
        id: canonicalUuid(row.id),
      }));
      if (
        overlaps.length !== confirmations.length ||
        overlaps.some(
          (row) =>
            !confirmations.some(
              (other) => other.id === row.id && other.revision === row.revision,
            ),
        )
      )
        throw new DataError(
          "CONFLICT",
          "Review and explicitly acknowledge the current overlapping sessions before saving.",
        );
      return editing
        ? this.scheduleSessions.update(id, input, editing.revision)
        : this.insert("scheduleSessions", input, id);
    });
  }

  /** Only weekly sessions may accompany a managed course deletion. Never cascade academic history. */
  deleteManagedCourse(
    id: string,
    expectedRevision: number,
    confirmation: readonly DeletionEntry[],
  ) {
    return this.run("rw", async () => {
      const graph = await this.deletionGraph("courses", id);
      if (
        graph.some(
          (row) => row.kind !== "courses" && row.kind !== "scheduleSessions",
        )
      )
        throw new DataError(
          "DEPENDENTS",
          "Historical lectures or materials prevent timetable course deletion.",
        );
      return this.courses.delete(id, {
        expectedRevision,
        cascade: true,
        confirmation,
      });
    });
  }

  /** Selected-term discovery, without loading history or attachment bytes. */
  getRemovedCourses(termId: string) {
    return this.run("r", () => removedCourses(this.database, termId));
  }

  previewCourseRestore(id: string) {
    return this.run("r", () => courseRestorePreview(this.database, id));
  }

  /** Explicit course-only restoration. Sessions/history/mappings are never written.
   * Rebuild the preview and check its full snapshot and revision in one transaction.
   */
  restoreCourse(id: string, expectedRevision: number, snapshot: string) {
    return this.run("rw", async () => {
      const fresh = await courseRestorePreview(this.database, id);
      this.revision(fresh.course.revision, expectedRevision);
      if (fresh.snapshot !== snapshot) throw new DataError("CONFLICT", restorationText.stale);
      const course = courseRestorationCandidate(fresh.course);
      await this.database.records("courses").put(course);
      return course;
    });
  }

  reviewTimetable(draft: TimetableDraft): Promise<TimetableReview> {
    return this.run(
      "r",
      async () => (await buildTimetableReview(this.database, draft)).review,
    );
  }

  /** Discover retained mappings, including sources that require manual repair. */
  listImportSources() {
    return this.run("r", () => listSources(this.database));
  }

  /** Resume active values with original IDs and explicit notices for validated
   * course/session tombstones. Missing targets or inconsistent graphs fail closed. */
  reopenImportSource(sourceId: string): Promise<TimetableDraft> {
    return this.run("r", () => reopenSource(this.database, sourceId));
  }

  async saveTimetable(
    review: TimetableReview,
    confirmation: { confirmed: boolean; keepExistingKeys: readonly string[] },
  ): Promise<BulkResult> {
    if (confirmation.confirmed !== true)
      throw new DataError("VALIDATION", tr("text_222"));
    // Fresh resolution and validation also run inside the write transaction.
    return this.executeBatch(
      async (result) => {
        const fresh = await buildTimetableReview(this.database, review.draft);
        if (fresh.review.snapshot !== review.snapshot)
          throw new DataError("CONFLICT", tr("text_223"));
        if (
          fresh.review.differences.some(
            (row) => !confirmation.keepExistingKeys.includes(row.key),
          )
        )
          throw new DataError("CONFLICT", tr("text_224"));
        await this.processBulk(
          "academicTerms",
          fresh.batch.academicTerms ?? [],
          result,
        );
        await this.processBulk("courses", fresh.batch.courses ?? [], result);
        await this.processBulk(
          "scheduleSessions",
          fresh.batch.scheduleSessions ?? [],
          result,
        );
        if (!result.outcomes.some((row) => row.status === "rejected")) {
          const table = this.database.table<ImportMapping, string>("importMappings");
          const aliases = await table.where("sourceId").equals(review.draft.sourceId).toArray();
          // Confirmation belongs to an entity UUID within this source. Keep
          // every historical key/UUID/createdAt, updating only reviewed flags.
          for (const alias of aliases) {
            const reviewed = fresh.mappings.find(row => row.entity === alias.entity && row.recordId === alias.recordId);
            if (reviewed && (alias.unconfirmed.length !== reviewed.unconfirmed.length ||
              alias.unconfirmed.some((field, index) => field !== reviewed.unconfirmed[index])))
              await table.put({ ...alias, unconfirmed: [...reviewed.unconfirmed] });
          }
          for (const mapping of fresh.mappings)
            await table.put(mapping);
          // Validate the complete persisted graph, including excluded historical
          // mappings, before committing. Failure rolls back records AND metadata.
          await reopenSource(this.database, review.draft.sourceId);
        }
      },
      {
        academicTerms: [
          {
            id: review.draft.term.id!,
            name: review.draft.term.name,
            academicYear: review.draft.term.academicYear,
            semester: review.draft.term.semester,
          },
        ],
        courses: review.draft.courses.map((row) => ({
          id: row.id!,
          academicTermId: review.draft.term.id!,
          code: row.code,
          name: row.name,
          registeredHours: row.registeredHours,
        })),
        scheduleSessions: review.draft.sessions.map((row) => ({
          id: row.id!,
          academicTermId: review.draft.term.id!,
          courseId:
            review.draft.courses.find((course) => course.key === row.courseKey)
              ?.id ?? "",
          dayOfWeek: row.dayOfWeek,
          startTime: row.startTime,
          endTime: row.endTime,
          deliveryMode: row.deliveryMode as Entities["scheduleSessions"]["deliveryMode"], // Error-reporting envelope only; review validates before any write.
        })),
      },
    );
  }

  detachLectureFromSchedule(id: string, expectedRevision: number) {
    return this.lectures.update(
      id,
      { scheduleSessionId: null },
      expectedRevision,
    );
  }

  /** Typed insert-if-absent orchestration; executes all entity batches atomically. */
  createRelated(batch: RelatedBatch): Promise<BulkResult> {
    if (typeof batch !== "object" || batch === null || Array.isArray(batch))
      invalid("Related batch must be an object of entity arrays.");
    const order: EntityName[] = [
      "academicTerms",
      "courses",
      "scheduleSessions",
      "lectures",
      "materials",
      "lectureFiles",
      "materialFiles",
    ];
    for (const key of Object.keys(batch)) {
      if (!order.includes(key as EntityName))
        invalid(`Unsupported entity batch: ${key}`);
      if (
        batch[key as EntityName] !== undefined &&
        !Array.isArray(batch[key as EntityName])
      )
        invalid(`Entity batch ${key} must be an array.`);
    }
    return this.executeBatch(async (result) => {
      for (const kind of order) {
        const inputs = batch[kind];
        if (inputs) await this.processBulk(kind, inputs, result);
      }
    }, batch);
  }

  private async run<T>(
    mode: TransactionMode,
    operation: () => Promise<T>,
  ): Promise<T> {
    try {
      // All seven tables participate so relationship checks and writes are atomic,
      // including across multiple tabs/connections to the same database.
      return await this.database.transaction(
        mode,
        this.database.tables,
        async () => await operation(),
      );
    } catch (error) {
      translateStorageError(error);
    }
  }

  private async active<K extends EntityName>(
    kind: K,
    id: string,
  ): Promise<Entities[K]> {
    const record = await this.database.records(kind).get(canonicalUuid(id));
    if (!record || record.deletedAt !== null)
      throw new DataError(
        "NOT_FOUND",
        `${kind} record does not exist or is deleted.`,
      );
    return record;
  }

  private revision(actual: number, expected: number) {
    if (!Number.isInteger(expected) || expected < 1)
      invalid("An expectedRevision is required.");
    if (actual !== expected)
      throw new DataError(
        "CONFLICT",
        "This record changed. Read the latest version and explicitly reconcile your edits before retrying.",
      );
  }

  private prepare<K extends EntityName>(
    kind: K,
    record: Entities[K],
  ): Entities[K] {
    record = normalizeIds(kind, record);
    validate(kind, record);
    if (kind === "courses") {
      const course = record as Entities["courses"];
      course.code = course.code.trim().toUpperCase();
    }
    if (kind === "lectureFiles" || kind === "materialFiles") {
      const file = record as
        Entities["lectureFiles"] | Entities["materialFiles"];
      file.fileSize = file.blob.size;
      file.mimeType = file.blob.type;
    }
    return record;
  }

  private async relationships<K extends EntityName>(
    kind: K,
    record: Entities[K],
  ) {
    switch (kind) {
      case "academicTerms":
        break;
      case "courses": {
        const course = record as Entities["courses"];
        await this.active("academicTerms", course.academicTermId);
        const sessions = await this.database
          .records("scheduleSessions")
          .where("courseId")
          .equals(course.id)
          .toArray();
        if (
          sessions.some(
            (session) =>
              session.deletedAt === null &&
              session.academicTermId !== course.academicTermId,
          )
        )
          throw new DataError(
            "RELATIONSHIP",
            "A course with weekly sessions cannot move to a different term. Resolve those sessions first.",
          );
        break;
      }
      case "scheduleSessions": {
        const session = record as Entities["scheduleSessions"];
        const course = await this.active("courses", session.courseId);
        await this.active("academicTerms", session.academicTermId);
        if (course.academicTermId !== session.academicTermId)
          throw new DataError(
            "RELATIONSHIP",
            "Session and course must belong to the same term.",
          );
        const lectures = await this.database
          .records("lectures")
          .where("scheduleSessionId")
          .equals(session.id)
          .toArray();
        if (
          lectures.some(
            (lecture) =>
              lecture.deletedAt === null &&
              lecture.courseId !== session.courseId,
          )
        )
          throw new DataError(
            "RELATIONSHIP",
            "Session reassignment would invalidate linked lectures.",
          );
        break;
      }
      case "lectures": {
        const lecture = record as Entities["lectures"];
        await this.active("courses", lecture.courseId);
        if (lecture.scheduleSessionId != null) {
          const session = await this.active(
            "scheduleSessions",
            lecture.scheduleSessionId,
          );
          if (session.courseId !== lecture.courseId)
            throw new DataError(
              "RELATIONSHIP",
              "Lecture and weekly session must belong to the same course.",
            );
        }
        break;
      }
      case "materials":
        await this.active(
          "courses",
          (record as Entities["materials"]).courseId,
        );
        break;
      case "lectureFiles":
        await this.active(
          "lectures",
          (record as Entities["lectureFiles"]).lectureId,
        );
        break;
      case "materialFiles":
        await this.active(
          "materials",
          (record as Entities["materialFiles"]).materialId,
        );
        break;
    }
  }

  private async codeOwner<K extends EntityName>(kind: K, record: Entities[K]) {
    if (kind !== "courses") return undefined;
    const course = record as Entities["courses"];
    // Tombstones retain code reservations to avoid confusing future restore/sync.
    return this.database
      .records("courses")
      .where("[academicTermId+code]")
      .equals([course.academicTermId, course.code])
      .first();
  }

  private async insert<K extends EntityName>(
    kind: K,
    input: CreateInput<K>,
    id: string,
  ) {
    assertInput(kind, input);
    id = canonicalUuid(id);
    const timestamp = Date.now();
    // Metadata is generated only here; caller fields have already been whitelisted.
    const record = this.prepare(kind, {
      ...input,
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      revision: 1,
    } as Entities[K]);
    await this.relationships(kind, record);
    await this.database.records(kind).add(record);
    return record;
  }

  /** Gather dependencies before deleting anything; never auto-purge data or Blobs. */
  private async deletionGraph(
    kind: EntityName,
    id: string,
    collected = new Map<string, DeletionEntry>(),
  ): Promise<DeletionEntry[]> {
    id = canonicalUuid(id);
    const key = `${kind}:${id}`;
    if (collected.has(key)) return [...collected.values()];
    const current = await this.active(kind, id);
    collected.set(key, { kind, id, revision: current.revision });
    const links: Partial<
      Record<EntityName, { child: EntityName; field: string }[]>
    > = {
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
    };
    for (const { child, field } of links[kind] ?? []) {
      const records = await this.database
        .records(child)
        .where(field)
        .equals(id)
        .toArray();
      for (const record of records) {
        if (record.deletedAt === null)
          await this.deletionGraph(child, record.id, collected);
      }
    }
    return [...collected.values()];
  }

  private repository<K extends EntityName>(kind: K) {
    return {
      create: (input: CreateInput<K>) =>
        this.run("rw", () => this.insert(kind, input, crypto.randomUUID())),
      get: (id: string, options: ReadOptions = {}) =>
        this.run("r", async () => {
          const record = await this.database
            .records(kind)
            .get(canonicalUuid(id));
          return record && (options.includeDeleted || record.deletedAt === null)
            ? record
            : undefined;
        }),
      list: (filter: ListFilter<K> = {}, options: ReadOptions = {}) =>
        this.run("r", async () => {
          filter = normalizeIds(kind, filter);
          const table = this.database.records(kind);
          const parentField =
            kind === "lectureFiles"
              ? "lectureId"
              : kind === "materialFiles"
                ? "materialId"
                : undefined;
          const parentId = parentField
            ? filter[parentField as keyof typeof filter]
            : undefined;
          const records =
            parentField && typeof parentId === "string"
              ? await table.where(parentField).equals(parentId).toArray()
              : await table.toArray();
          return records.filter(
            (record) =>
              (options.includeDeleted || record.deletedAt === null) &&
              Object.entries(filter).every(
                ([key, value]) => record[key as keyof Entities[K]] === value,
              ),
          );
        }),
      update: (id: string, patch: UpdateInput<K>, expectedRevision: number) =>
        this.run("rw", async () => {
          id = canonicalUuid(id);
          assertInput(kind, patch);
          const current = await this.active(kind, id);
          this.revision(current.revision, expectedRevision);
          const record = this.prepare(kind, {
            ...current,
            ...patch,
            updatedAt: Math.max(Date.now(), current.updatedAt + 1),
            revision: current.revision + 1,
          });
          await this.relationships(kind, record);
          const duplicate = await this.codeOwner(kind, record);
          if (duplicate && duplicate.id !== id)
            throw new DataError(
              "DUPLICATE",
              "Course code already exists within this term, including deleted courses.",
            );
          // put is safe only after existence/revision checks in the same transaction.
          await this.database.records(kind).put(record);
          return record;
        }),
      delete: (id: string, options: DeleteOptions) =>
        this.run("rw", async () => {
          id = canonicalUuid(id);
          const current = await this.active(kind, id);
          this.revision(current.revision, options.expectedRevision);
          const graph = await this.deletionGraph(kind, id);
          if (graph.length > 1 && options.cascade !== true)
            throw new DataError(
              "DEPENDENTS",
              "Related records exist. Review the deletion preview and explicitly request cascade to soft-delete them together.",
            );
          if (graph.length > 1) {
            const confirmation = options.confirmation?.map((entry) => ({
              ...entry,
              id: canonicalUuid(entry.id),
            }));
            if (
              !confirmation ||
              confirmation.length !== graph.length ||
              !graph.every((entry) =>
                confirmation.some(
                  (confirmed) =>
                    confirmed.kind === entry.kind &&
                    confirmed.id === entry.id &&
                    confirmed.revision === entry.revision,
                ),
              )
            ) {
              throw new DataError(
                "CONFLICT",
                "Deletion dependencies changed or were not confirmed. Review a fresh deletion preview before retrying.",
              );
            }
          }
          const timestamp = Date.now();
          for (const reference of graph) {
            const table = this.database.records(reference.kind);
            const record = await this.active(reference.kind, reference.id);
            await table.put({
              ...record,
              deletedAt: timestamp,
              updatedAt: Math.max(timestamp, record.updatedAt + 1),
              revision: record.revision + 1,
            });
          }
          return graph;
        }),
      previewDelete: (id: string) =>
        this.run("r", async () => {
          await this.active(kind, id);
          return this.deletionGraph(kind, id);
        }),
      /** Insert missing stable IDs only; existing records are reported, never overwritten. */
      bulkUpsert: (inputs: readonly BulkInput<K>[]): Promise<BulkResult> => {
        if (!Array.isArray(inputs))
          invalid("Bulk candidates must be an array.");
        return this.executeBatch(
          (result) => this.processBulk(kind, inputs, result),
          { [kind]: inputs } as RelatedBatch,
        );
      },
    };
  }

  private async executeBatch(
    operation: (result: BulkResult) => Promise<void>,
    batch: RelatedBatch,
  ): Promise<BulkResult> {
    const result: BulkResult = {
      committed: false,
      outcomes: [],
      created: [],
      skipped: [],
      rejected: [],
    };
    try {
      return await this.run("rw", async () => {
        await operation(result);
        if (result.outcomes.some((outcome) => outcome.status === "rejected")) {
          for (const outcome of result.outcomes) {
            if (outcome.status === "inserted") {
              outcome.status = "rejected";
              outcome.code = "CONFLICT";
              outcome.reason =
                "Batch rolled back because another candidate was rejected.";
            }
          }
          result.created = [];
          result.rejected = result.outcomes.filter(
            (outcome) => outcome.status === "rejected",
          );
          throw new RejectedBatch(result);
        }
        result.committed = true;
        return result;
      });
    } catch (error) {
      if (error instanceof RejectedBatch) return error.result;
      // Legacy migration collisions require explicit repair, never a silent merge.
      if (!(error instanceof DataError) || error.code === "IDENTITY_COLLISION")
        throw error;
      result.committed = false;
      result.created = [];
      for (const kind of Object.keys(batch) as EntityName[]) {
        for (const [index, entry] of (batch[kind] ?? []).entries()) {
          let outcome = result.outcomes.find(
            (item) => item.kind === kind && item.index === index,
          );
          if (!outcome) {
            let id: string | null = null;
            try {
              id = canonicalUuid(entry?.id);
            } catch {
              /* Preserve invalid IDs in requestedId only. */
            }
            outcome = {
              kind,
              index,
              requestedId: typeof entry?.id === "string" ? entry.id : null,
              id,
              status: "rejected",
              reason: "",
            };
            result.outcomes.push(outcome);
          }
          if (outcome.status !== "skipped") {
            outcome.status = "rejected";
            outcome.code = error.code;
            outcome.reason = `Operation failed; all new writes were rolled back. ${error.message}`;
          }
        }
      }
      result.rejected = result.outcomes.filter(
        (outcome) => outcome.status === "rejected",
      );
      return result;
    }
  }

  private async processBulk<K extends EntityName>(
    kind: K,
    inputs: readonly BulkInput<K>[],
    result: BulkResult,
  ) {
    if (!Array.isArray(inputs)) invalid("Bulk candidates must be an array.");
    const counts = new Map<string, number>();
    for (const entry of inputs) {
      try {
        const id = canonicalUuid(entry?.id);
        counts.set(id, (counts.get(id) ?? 0) + 1);
      } catch {
        /* Invalid IDs are reported individually below. */
      }
    }
    for (const [index, entry] of inputs.entries()) {
      const outcome: RecordOutcome = {
        kind,
        index,
        requestedId: typeof entry?.id === "string" ? entry.id : null,
        id: null,
        status: "rejected",
        reason: "Candidate has not been validated.",
      };
      result.outcomes.push(outcome);
      try {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry))
          invalid("Each bulk candidate must be a record object.");
        const { id: suppliedId, ...data } = entry;
        assertInput(kind, data);
        const id = canonicalUuid(suppliedId);
        outcome.id = id;
        if (counts.get(id)! > 1)
          throw new DataError(
            "DUPLICATE",
            "Duplicate UUID in this entity batch (including case variants); all occurrences are rejected.",
          );
        const record = this.prepare(kind, {
          ...data,
          id,
          createdAt: 0,
          updatedAt: 0,
          deletedAt: null,
          revision: 1,
        } as Entities[K]);
        // Validate even candidates for existing IDs: no invalid FK is silently skipped.
        await this.relationships(kind, record);
        const owner = await this.codeOwner(kind, record);
        if (owner && owner.id !== id) {
          outcome.existingId = owner.id;
          throw new DataError(
            "DUPLICATE",
            "Course code is owned by a different UUID in this term (including tombstones). Resolve ownership explicitly; no identities were merged.",
          );
        }
        const existing = await this.database.records(kind).get(id);
        if (existing) {
          outcome.status = "skipped";
          outcome.existingId = existing.id;
          const reason =
            existing.deletedAt === null ? "existing-id" : "tombstone";
          outcome.reason =
            reason === "tombstone"
              ? "Existing tombstone retained; this operation does not restore records."
              : "Existing record and user edits retained; incoming values were not applied.";
          result.skipped.push({
            requestedId: suppliedId,
            existingId: id,
            reason,
          });
        } else {
          await this.insert(kind, data as CreateInput<K>, id);
          outcome.status = "inserted";
          outcome.reason =
            "New validated record inserted with the supplied canonical UUID.";
          result.created.push(id);
        }
      } catch (error) {
        if (!(error instanceof DataError)) throw error;
        outcome.status = "rejected";
        outcome.code = error.code;
        outcome.reason = error.message;
      }
    }
  }
}
