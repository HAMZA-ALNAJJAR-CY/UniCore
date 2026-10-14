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
