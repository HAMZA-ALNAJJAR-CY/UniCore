import type { TransactionMode } from "dexie";
import { UniCoreDatabase } from "./database";
import { DataError, translateStorageError } from "./errors";
import type {
  BulkInput,
  CreateInput,
  Entities,
  EntityName,
  ListFilter,
  UpdateInput,
} from "./models";
import { assertInput, invalid, uuid, validate } from "./validation";

type DeleteOptions = {
  expectedRevision: number;
  cascade?: boolean;
  confirmation?: readonly DeletionEntry[];
};
type ReadOptions = { includeDeleted?: boolean };
export type DeletionEntry = { kind: EntityName; id: string; revision: number };
export interface BulkResult {
  created: string[];
  skipped: {
    requestedId: string;
    existingId: string;
    reason: "existing-id" | "course-code";
  }[];
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
    uuid(id);
    const record = await this.database.records(kind).get(id);
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
    uuid(id);
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
          uuid(id);
          const record = await this.database.records(kind).get(id);
          return record && (options.includeDeleted || record.deletedAt === null)
            ? record
            : undefined;
        }),
      list: (filter: ListFilter<K> = {}, options: ReadOptions = {}) =>
        this.run("r", async () => {
          // Exact filters are intentionally simple; indexed relationship queries are
          // used internally. No query-builder abstraction is needed in Phase 1A.
          const records = await this.database.records(kind).toArray();
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
          const current = await this.active(kind, id);
          this.revision(current.revision, options.expectedRevision);
          const graph = await this.deletionGraph(kind, id);
          if (graph.length > 1 && options.cascade !== true)
            throw new DataError(
              "DEPENDENTS",
              "Related records exist. Review the deletion preview and explicitly request cascade to soft-delete them together.",
            );
          if (graph.length > 1) {
            const confirmation = options.confirmation;
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
      bulkUpsert: (inputs: readonly BulkInput<K>[]): Promise<BulkResult> =>
        this.run("rw", async () => {
          const result: BulkResult = { created: [], skipped: [] };
          for (const entry of inputs) {
            const { id, ...data } = entry;
            uuid(id);
            assertInput(kind, data);
            const existing = await this.database.records(kind).get(id);
            if (existing) {
              result.skipped.push({
                requestedId: id,
                existingId: id,
                reason: "existing-id",
              });
              continue;
            }
            // Preparing validates before the natural-key lookup. A different ID
            // using the same course key is reported rather than merged by name.
            const record = this.prepare(kind, {
              ...data,
              id,
              createdAt: 0,
              updatedAt: 0,
              deletedAt: null,
              revision: 1,
            } as Entities[K]);
            const owner = await this.codeOwner(kind, record);
            if (owner) {
              result.skipped.push({
                requestedId: id,
                existingId: owner.id,
                reason: "course-code",
              });
              continue;
            }
            await this.insert(kind, data as CreateInput<K>, id);
            result.created.push(id);
          }
          return result;
        }),
    };
  }
}
