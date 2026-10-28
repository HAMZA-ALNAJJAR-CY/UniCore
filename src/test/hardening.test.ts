// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SCHEMA_V1, UniCoreDatabase } from "../data/database";
import { AcademicStore, type RelatedBatch } from "../data/store";
import { canonicalUuid, ID_FIELDS } from "../data/identity";
import { DELETION_LINKS, ENTITY_INSERT_ORDER, ENTITY_ORDER } from "../data/entity-integrity";
import { INPUT_FIELDS, validate } from "../data/validation";
import { DataError } from "../data/errors";
import type { Entities, EntityName } from "../data/models";

let db: UniCoreDatabase;
let store: AcademicStore;
const kinds: EntityName[] = [
  "academicTerms",
  "courses",
  "scheduleSessions",
  "lectures",
  "materials",
  "lectureFiles",
  "materialFiles",
];
beforeEach(() => {
  db = new UniCoreDatabase(`UniCore-hardening-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await db.delete();
});

function graph() {
  const ids = Object.fromEntries(
    kinds.map((kind) => [kind, crypto.randomUUID()]),
  ) as Record<EntityName, string>;
  const batch = {
    academicTerms: [
      {
        id: ids.academicTerms,
        name: "Test term",
        academicYear: "2030/2031",
        semester: 1,
      },
    ],
    courses: [
      {
        id: ids.courses,
        academicTermId: ids.academicTerms,
        code: "TEST101",
        name: "Case Preserved Name",
        instructor: null,
        registeredHours: 1,
      },
    ],
    scheduleSessions: [
      {
        id: ids.scheduleSessions,
        academicTermId: ids.academicTerms,
        courseId: ids.courses,
        dayOfWeek: 2,
        startTime: "09:00",
        endTime: "10:00",
        deliveryMode: "in-person",
        room: "A1",
      },
    ],
    lectures: [
      {
        id: ids.lectures,
        courseId: ids.courses,
        scheduleSessionId: ids.scheduleSessions,
        date: "2030-10-15",
        notes: "Historical notes",
      },
    ],
    materials: [
      { id: ids.materials, courseId: ids.courses, title: "Resource" },
    ],
    lectureFiles: [
      {
        id: ids.lectureFiles,
        lectureId: ids.lectures,
        fileName: "lecture.txt",
        blob: new Blob(["original lecture bytes"], { type: "text/plain" }),
      },
    ],
    materialFiles: [
      {
        id: ids.materialFiles,
        materialId: ids.materials,
        fileName: "material.txt",
        blob: new Blob(["original material bytes"]),
      },
    ],
  } satisfies RelatedBatch;
  return { ids, batch };
}

function mixed(value: string) {
  return value.replace(/[a-f]/g, (letter, index: number) =>
    index % 2 ? letter.toUpperCase() : letter,
  );
}
function oldTerm(id: string): Entities["academicTerms"] {
  return {
    id,
    name: "Legacy",
    academicYear: "2030/2031",
    semester: 1,
    createdAt: 10,
    updatedAt: 20,
    deletedAt: null,
    revision: 4,
  };
}

describe("Canonical identity", () => {
  it.each([
    "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    "aAaAaAaA-BbBb-4cCc-8DdD-eEeEeEeEeEeE",
  ])("accepts and canonicalizes %s", (value) => {
    expect(canonicalUuid(value)).toBe("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
  });

  it("normalizes all primary/foreign IDs and lookups without changing other text", async () => {
    const { ids, batch } = graph();
    const upper = {
      academicTerms: batch.academicTerms.map((row) => ({
        ...row,
        id: row.id.toUpperCase(),
      })),
      courses: batch.courses.map((row) => ({
        ...row,
        id: mixed(row.id),
        academicTermId: row.academicTermId.toUpperCase(),
      })),
      scheduleSessions: batch.scheduleSessions.map((row) => ({
        ...row,
        id: row.id.toUpperCase(),
        academicTermId: mixed(row.academicTermId),
        courseId: row.courseId.toUpperCase(),
      })),
      lectures: batch.lectures.map((row) => ({
        ...row,
        id: mixed(row.id),
        courseId: mixed(row.courseId),
        scheduleSessionId: row.scheduleSessionId.toUpperCase(),
      })),
      materials: batch.materials.map((row) => ({
        ...row,
        id: row.id.toUpperCase(),
        courseId: mixed(row.courseId),
      })),
      lectureFiles: batch.lectureFiles.map((row) => ({
        ...row,
        id: mixed(row.id),
        lectureId: row.lectureId.toUpperCase(),
      })),
      materialFiles: batch.materialFiles.map((row) => ({
        ...row,
        id: row.id.toUpperCase(),
        materialId: mixed(row.materialId),
      })),
    };
    expect((await store.createRelated(upper)).committed).toBe(true);
    for (const kind of kinds)
      expect((await store[kind].get(ids[kind].toUpperCase()))?.id).toBe(
        ids[kind],
      );
    expect(await store.courses.get(ids.courses)).toMatchObject({
      academicTermId: ids.academicTerms,
      name: "Case Preserved Name",
      code: "TEST101",
    });
    expect(
      await store.scheduleSessions.get(ids.scheduleSessions),
    ).toMatchObject({
      academicTermId: ids.academicTerms,
      courseId: ids.courses,
      room: "A1",
    });
    expect(await store.lectures.get(ids.lectures)).toMatchObject({
      courseId: ids.courses,
      scheduleSessionId: ids.scheduleSessions,
    });
    expect(await store.materials.get(ids.materials)).toMatchObject({
      courseId: ids.courses,
    });
    expect(await store.lectureFiles.get(ids.lectureFiles)).toMatchObject({
      lectureId: ids.lectures,
    });
    expect(await store.materialFiles.get(ids.materialFiles)).toMatchObject({
      materialId: ids.materials,
    });
    expect(upper.academicTerms[0].id).toBe(ids.academicTerms.toUpperCase());
    expect(
      await store.courses.list({ academicTermId: mixed(ids.academicTerms) }),
    ).toHaveLength(1);
    const edited = await store.courses.update(
      ids.courses.toUpperCase(),
      { instructor: "Confirmed" },
      1,
    );
    expect(edited.id).toBe(ids.courses);
    const preview = await store.academicTerms.previewDelete(
      ids.academicTerms.toUpperCase(),
    );
    await store.academicTerms.delete(mixed(ids.academicTerms), {
      expectedRevision: 1,
      cascade: true,
      confirmation: preview.map((entry) => ({
        ...entry,
        id: entry.id.toUpperCase(),
      })),
    });
    expect(
      (
        await store.courses.get(ids.courses.toUpperCase(), {
          includeDeleted: true,
        })
      )?.deletedAt,
    ).not.toBeNull();
  });

  it("normalizes reference edits and generated-ID creates", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    const created = await store.materials.create({
      courseId: ids.courses.toUpperCase(),
      title: "Created",
    });
    expect(created.id).toBe(created.id.toLowerCase());
    expect(created.courseId).toBe(ids.courses);
    expect(
      await store.lectures.update(
        ids.lectures.toUpperCase(),
        {
          scheduleSessionId: mixed(ids.scheduleSessions),
          courseId: ids.courses.toUpperCase(),
        },
        1,
      ),
    ).toMatchObject({
      scheduleSessionId: ids.scheduleSessions,
      courseId: ids.courses,
    });
    expect(
      await store.materialFiles.update(
        ids.materialFiles.toUpperCase(),
        { materialId: created.id.toUpperCase() },
        1,
      ),
    ).toMatchObject({ materialId: created.id });
  });

  it("migrates legacy casing without losing metadata, tombstones or attachments", async () => {
    const { ids, batch } = graph();
    const legacy = new Dexie(db.name);
    legacy.version(1).stores(SCHEMA_V1);
    for (const kind of kinds) {
      const row = batch[kind][0];
      const old: Record<string, unknown> = {
        ...row,
        id: row.id.toUpperCase(),
        createdAt: 10,
        updatedAt: 20,
        deletedAt: kind === "materialFiles" ? 19 : null,
        revision: 4,
      };
      for (const field of [
        "academicTermId",
        "courseId",
        "scheduleSessionId",
        "lectureId",
        "materialId",
      ])
        if (typeof old[field] === "string")
          old[field] = old[field].toUpperCase();
      if ("blob" in row) {
        old.fileSize = row.blob.size;
        old.mimeType = row.blob.type;
      }
      await legacy.table(kind).add(old);
    }
    legacy.close();
    await store.open();
    expect(db.verno).toBe(3);
    expect(await store.courses.get(ids.courses)).toMatchObject({
      academicTermId: ids.academicTerms,
    });
    expect(await store.lectures.get(ids.lectures)).toMatchObject({
      courseId: ids.courses,
      scheduleSessionId: ids.scheduleSessions,
    });
    expect(
      await store.materialFiles.get(ids.materialFiles, {
        includeDeleted: true,
      }),
    ).toMatchObject({ materialId: ids.materials });
    for (const kind of kinds)
      expect(
        await store[kind].get(ids[kind], { includeDeleted: true }),
      ).toMatchObject({
        id: ids[kind],
        createdAt: 10,
        updatedAt: 20,
        revision: 4,
      });
    expect(
      await (await store.lectureFiles.get(ids.lectureFiles))?.blob.text(),
    ).toBe("original lecture bytes");
    expect(
      await (
        await store.materialFiles.get(ids.materialFiles, {
          includeDeleted: true,
        })
      )?.blob.text(),
    ).toBe("original material bytes");
    expect(
      (
        await store.materialFiles.get(ids.materialFiles, {
          includeDeleted: true,
        })
      )?.deletedAt,
    ).toBe(19);
  });

  it("aborts a legacy UUID collision without rewriting either record", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const legacy = new Dexie(db.name);
    legacy.version(1).stores(SCHEMA_V1);
    await legacy
      .table("academicTerms")
      .bulkAdd([
        oldTerm(id),
        { ...oldTerm(id.toUpperCase()), name: "Different user record" },
      ]);
    legacy.close();
    await expect(store.open()).rejects.toMatchObject({
      code: "IDENTITY_COLLISION",
    });
    const verify = new Dexie(db.name);
    verify.version(1).stores(SCHEMA_V1);
    try {
      await verify.open();
      expect(await verify.table("academicTerms").count()).toBe(2);
      expect(
        await verify.table("academicTerms").get(id.toUpperCase()),
      ).toMatchObject({ name: "Different user record", revision: 4 });
      expect(verify.verno).toBe(1);
    } finally {
      verify.close();
    }
  });

  it("aborts normalized term/code ownership collisions, including tombstones", async () => {
    const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const legacy = new Dexie(db.name);
    legacy.version(1).stores(SCHEMA_V1);
    await legacy.table("academicTerms").add(oldTerm(id));
    const base = {
      code: "TEST101",
      name: "Legacy course",
      registeredHours: 1,
      createdAt: 10,
      updatedAt: 20,
      revision: 1,
      deletedAt: null,
    };
    await legacy.table("courses").bulkAdd([
      { ...base, id: crypto.randomUUID(), academicTermId: id },
      {
        ...base,
        id: crypto.randomUUID(),
        academicTermId: id.toUpperCase(),
        deletedAt: 19,
      },
    ]);
    legacy.close();
    await expect(store.open()).rejects.toMatchObject({
      code: "IDENTITY_COLLISION",
    });
    const verify = new Dexie(db.name);
    verify.version(1).stores(SCHEMA_V1);
    try {
      expect(await verify.table("courses").count()).toBe(2);
      expect(verify.verno).toBe(1);
    } finally {
      verify.close();
    }
  });
});

describe("Bulk candidate outcomes and preservation", () => {
  it("rejects malformed candidate structures and reports every reason", async () => {
    const { batch } = graph();
    const arrayCandidate = Object.assign([], batch.academicTerms[0]);
    const result = await store.academicTerms.bulkUpsert([
      null,
      arrayCandidate,
      { ...batch.academicTerms[0], id: "not-a-uuid" },
      { ...batch.academicTerms[0], id: crypto.randomUUID(), createdAt: 10 },
    ] as never);
    expect(result.committed).toBe(false);
    expect(result.outcomes).toHaveLength(4);
    expect(
      result.outcomes.every(
        (row) =>
          row.status === "rejected" &&
          row.code === "VALIDATION" &&
          row.reason.length > 0,
      ),
    ).toBe(true);
    expect(await store.academicTerms.list()).toEqual([]);
    expect(() => store.createRelated({ courses: null } as never)).toThrow(
      /array/,
    );
    expect(() => store.academicTerms.bulkUpsert({} as never)).toThrow(/array/);
  });

  it("rejects identical lowercase IDs before inserting either candidate", async () => {
    const { batch } = graph();
    const result = await store.academicTerms.bulkUpsert([
      batch.academicTerms[0],
      batch.academicTerms[0],
    ]);
    expect(result.committed).toBe(false);
    expect(result.rejected).toHaveLength(2);
    expect(await store.academicTerms.list()).toEqual([]);
  });

  it("preserves user-edited attachment bytes, filenames and revisions on repeated bulk input", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    for (const kind of ["lectureFiles", "materialFiles"] as const) {
      const updated = await store[kind].update(
        ids[kind],
        {
          fileName: "User corrected filename",
          blob: new Blob(["User edited attachment"]),
        },
        1,
      );
      const result = await store[kind].bulkUpsert(batch[kind] as never);
      expect(result.outcomes[0].status).toBe("skipped");
      const retained = await store[kind].get(ids[kind]);
      expect(retained).toEqual(updated);
      expect(await retained?.blob.text()).toBe("User edited attachment");
      expect(retained?.revision).toBe(2);
    }
  });

  it.each(kinds)(
    "preserves existing %s records and Blob bytes",
    async (kind) => {
      const { ids, batch } = graph();
      expect(
        (await store.createRelated(batch)).outcomes.map((row) => row.status),
      ).toEqual(kinds.map(() => "inserted"));
      const before = await db.records(kind).get(ids[kind]);
      const candidate = { ...batch[kind][0], id: ids[kind].toUpperCase() };
      // Fixtures and repositories share the same union key; TS cannot correlate them.
      const result = await store[kind].bulkUpsert([candidate] as never);
      expect(result.committed).toBe(true);
      expect(result.outcomes).toHaveLength(1);
      expect(result.outcomes[0]).toMatchObject({
        status: "skipped",
        id: ids[kind],
        existingId: ids[kind],
      });
      expect(result.outcomes[0].reason).toMatch(/retained/);
      expect(await db.records(kind).get(ids[kind])).toEqual(before);
      if (kind === "lectureFiles" || kind === "materialFiles")
        expect(
          await (
            (await db.records(kind).get(ids[kind])) as Entities["lectureFiles"]
          ).blob.text(),
        ).toMatch(/original .* bytes/);
    },
  );

  it.each(kinds)(
    "rejects duplicate %s IDs, including casing variants",
    async (kind) => {
      const { ids, batch } = graph();
      await store.createRelated(batch);
      const candidate = batch[kind][0];
      const result = await store[kind].bulkUpsert([
        candidate,
        { ...candidate, id: ids[kind].toUpperCase() },
      ] as never);
      expect(result.committed).toBe(false);
      expect(result.outcomes.map((row) => row.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(
        result.outcomes.every(
          (row) =>
            row.code === "DUPLICATE" && row.reason.includes("Duplicate UUID"),
        ),
      ).toBe(true);
      expect(await db.records(kind).count()).toBe(1);
    },
  );

  it("validates existing candidates, preserves user edits and never replaces file bytes", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    const edited = await store.courses.update(
      ids.courses,
      { name: "User correction" },
      1,
    );
    expect(
      (await store.courses.bulkUpsert(batch.courses)).outcomes[0].status,
    ).toBe("skipped");
    expect(await store.courses.get(ids.courses)).toEqual(edited);
    for (const kind of ["lectureFiles", "materialFiles"] as const) {
      const candidate = {
        ...batch[kind][0],
        blob: new Blob(["incoming replacement"]),
      };
      expect(
        (await store[kind].bulkUpsert([candidate] as never)).outcomes[0].status,
      ).toBe("skipped");
      expect(
        await (await db.records(kind).get(ids[kind]))?.blob.text(),
      ).toMatch(/original .* bytes/);
    }
    const invalid = await store.lectureFiles.bulkUpsert([
      { ...batch.lectureFiles[0], lectureId: crypto.randomUUID() },
    ]);
    expect(invalid.outcomes[0]).toMatchObject({
      status: "rejected",
      code: "NOT_FOUND",
    });
    const malformed = await store.academicTerms.bulkUpsert([
      { ...batch.academicTerms[0], semester: 0 },
    ]);
    expect(malformed.outcomes[0]).toMatchObject({
      status: "rejected",
      code: "VALIDATION",
    });
  });

  it.each([
    "courses",
    "scheduleSessions",
    "lectures",
    "materials",
    "lectureFiles",
    "materialFiles",
  ] as const)(
    "rejects invalid %s relationships even for existing IDs",
    async (kind) => {
      const { batch } = graph();
      await store.createRelated(batch);
      const field =
        kind === "courses"
          ? "academicTermId"
          : kind === "lectureFiles"
            ? "lectureId"
            : kind === "materialFiles"
              ? "materialId"
              : "courseId";
      const candidate = { ...batch[kind][0], [field]: crypto.randomUUID() };
      const result = await store[kind].bulkUpsert([candidate] as never);
      expect(result.outcomes[0]).toMatchObject({
        status: "rejected",
        code: "NOT_FOUND",
      });
    },
  );

  it("rejects competing course-code owners in one batch and against existing data", async () => {
    const { ids, batch } = graph();
    await store.academicTerms.bulkUpsert(batch.academicTerms);
    const first = batch.courses[0];
    const result = await store.courses.bulkUpsert([
      first,
      { ...first, id: crypto.randomUUID(), code: " test101 " },
    ]);
    expect(result.committed).toBe(false);
    expect(result.rejected).toHaveLength(2);
    expect(result.created).toEqual([]);
    expect(await store.courses.list()).toEqual([]);
    await store.courses.bulkUpsert([first]);
    const collision = await store.courses.bulkUpsert([
      { ...first, id: crypto.randomUUID() },
    ]);
    expect(collision.outcomes[0]).toMatchObject({
      status: "rejected",
      code: "DUPLICATE",
      existingId: ids.courses,
    });
  });

  it("reports retained tombstones and rejects deleted relationships", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    await store.materialFiles.delete(ids.materialFiles, {
      expectedRevision: 1,
    });
    const before = await store.materialFiles.get(ids.materialFiles, {
      includeDeleted: true,
    });
    expect(
      (await store.materialFiles.bulkUpsert(batch.materialFiles)).outcomes[0],
    ).toMatchObject({ status: "skipped", existingId: ids.materialFiles });
    expect(
      (await store.materialFiles.bulkUpsert(batch.materialFiles)).skipped[0]
        .reason,
    ).toBe("tombstone");
    expect(
      await store.materialFiles.get(ids.materialFiles, {
        includeDeleted: true,
      }),
    ).toEqual(before);
    await store.materials.delete(ids.materials, { expectedRevision: 1 });
    expect(
      (await store.materialFiles.bulkUpsert(batch.materialFiles)).outcomes[0],
    ).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  });
});

describe("Atomic service operations and attachment queries", () => {
  it("retains skipped edited parents while rolling back every new child", async () => {
    const { ids, batch } = graph();
    await store.academicTerms.bulkUpsert(batch.academicTerms);
    const edited = await store.academicTerms.update(
      ids.academicTerms,
      { name: "User correction" },
      1,
    );
    batch.materialFiles[0].materialId = crypto.randomUUID();
    const result = await store.createRelated(batch);
    expect(result.committed).toBe(false);
    expect(result.outcomes[0].status).toBe("skipped");
    expect(
      result.outcomes.slice(1).every((row) => row.status === "rejected"),
    ).toBe(true);
    expect(result.created).toEqual([]);
    expect(await store.academicTerms.get(ids.academicTerms)).toEqual(edited);
    for (const kind of kinds.filter((kind) => kind !== "academicTerms"))
      expect(await store[kind].list()).toEqual([]);
  });

  it("rolls back a whole related graph on a late invalid FK with explicit outcomes", async () => {
    const { batch } = graph();
    batch.materialFiles[0].materialId = crypto.randomUUID();
    const result = await store.createRelated(batch);
    expect(result.committed).toBe(false);
    expect(result.created).toEqual([]);
    expect(result.outcomes).toHaveLength(7);
    expect(
      result.outcomes.every(
        (row) => row.status === "rejected" && row.reason.length > 0,
      ),
    ).toBe(true);
    for (const kind of kinds) expect(await store[kind].list()).toEqual([]);
  });

  it("returns outcomes for a late storage failure and rolls back all stores", async () => {
    const { batch } = graph();
    vi.spyOn(db.records("materialFiles"), "add").mockRejectedValueOnce(
      new DOMException("Full", "QuotaExceededError"),
    );
    const result = await store.createRelated(batch);
    expect(result.committed).toBe(false);
    expect(result.outcomes).toHaveLength(7);
    expect(
      result.outcomes.every(
        (row) => row.status === "rejected" && row.code === "QUOTA",
      ),
    ).toBe(true);
    for (const kind of kinds) expect(await store[kind].list()).toEqual([]);
  });

  it("supports existing parents across stores and rejects mismatched in-batch references", async () => {
    const { ids, batch } = graph();
    await store.academicTerms.bulkUpsert(batch.academicTerms);
    expect((await store.createRelated(batch)).outcomes[0].status).toBe(
      "skipped",
    );
    const repeat = await store.createRelated(batch);
    expect(repeat.committed).toBe(true);
    expect(repeat.created).toEqual([]);
    const invalid = await store.createRelated({
      lectures: [
        {
          ...batch.lectures[0],
          id: crypto.randomUUID(),
          courseId: crypto.randomUUID(),
        },
      ],
    });
    expect(invalid.outcomes[0]).toMatchObject({
      status: "rejected",
      code: "NOT_FOUND",
    });
    expect((await store.courses.get(ids.courses))?.revision).toBe(1);
  });

  it("retains historical lecture notes and attachments after explicit detach/session deletion", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    await expect(
      store.scheduleSessions.delete(ids.scheduleSessions, {
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENTS" });
    const detached = await store.detachLectureFromSchedule(
      ids.lectures.toUpperCase(),
      1,
    );
    expect(detached).toMatchObject({
      id: ids.lectures,
      scheduleSessionId: null,
      notes: "Historical notes",
      revision: 2,
    });
    await expect(
      store.detachLectureFromSchedule(ids.lectures, 1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await store.scheduleSessions.delete(ids.scheduleSessions.toUpperCase(), {
      expectedRevision: 1,
    });
    expect(await store.lectures.get(ids.lectures)).toEqual(detached);
    expect(
      await (await store.lectureFiles.get(ids.lectureFiles))?.blob.text(),
    ).toBe("original lecture bytes");
  });

  it("uses the correct parent indexes and never scans unrelated attachment stores", async () => {
    const { ids, batch } = graph();
    await store.createRelated(batch);
    const lectureTable = db.records("lectureFiles");
    const materialTable = db.records("materialFiles");
    const lectureWhere = vi.spyOn(lectureTable, "where");
    const materialWhere = vi.spyOn(materialTable, "where");
    const lectureScan = vi.spyOn(lectureTable, "toArray");
    const materialScan = vi.spyOn(materialTable, "toArray");
    expect(
      await store.lectureFiles.list({ lectureId: ids.lectures.toUpperCase() }),
    ).toHaveLength(1);
    expect(
      await store.materialFiles.list({ materialId: mixed(ids.materials) }),
    ).toHaveLength(1);
    expect(lectureWhere).toHaveBeenCalledWith("lectureId");
    expect(materialWhere).toHaveBeenCalledWith("materialId");
    expect(lectureScan).not.toHaveBeenCalled();
    expect(materialScan).not.toHaveBeenCalled();
    expect(await store.lectureFiles.list({ lectureId: ids.materials })).toEqual(
      [],
    );
    expect(
      await store.materialFiles.list({ materialId: ids.lectures }),
    ).toEqual([]);
  });
});

describe("Exhaustive entity registration", () => {
  it("registers every domain table, input contract, identity rule and public repository", async () => {
    await store.open();
    const expected = [...kinds].sort();
    expect([...ENTITY_INSERT_ORDER]).toEqual(kinds);
    expect(Object.keys(ENTITY_ORDER).sort()).toEqual(expected);
    expect(Object.keys(DELETION_LINKS).sort()).toEqual(expected);
    expect(Object.keys(ID_FIELDS).sort()).toEqual(expected);
    expect(Object.keys(INPUT_FIELDS).sort()).toEqual(expected);
    expect(db.tables.map(table => table.name).sort()).toEqual([...expected, "importMappings"].sort());
    expect(db.verno).toBe(3);
    for (const kind of kinds) {
      expect(store[kind]).toEqual(expect.objectContaining({
        create: expect.any(Function), get: expect.any(Function), list: expect.any(Function),
        update: expect.any(Function), delete: expect.any(Function),
        previewDelete: expect.any(Function), bulkUpsert: expect.any(Function),
      }));
      expect(ID_FIELDS[kind]).toContain("id");
      expect(new Set(ID_FIELDS[kind]).size).toBe(ID_FIELDS[kind].length);
      expect(new Set(INPUT_FIELDS[kind]).size).toBe(INPUT_FIELDS[kind].length);
    }
    expect(DELETION_LINKS.lectureFiles).toEqual([]);
    expect(DELETION_LINKS.materialFiles).toEqual([]);
  });

  it("orders every parent before its children and links every registered foreign UUID exactly once", () => {
    const ranks = Object.values(ENTITY_ORDER);
    expect(ranks.every(rank => Number.isInteger(rank) && rank >= 0)).toBe(true);
    expect(new Set(ranks).size).toBe(kinds.length);
    for (const child of kinds) {
      const references = (ID_FIELDS[child] as readonly string[]).filter(field => field !== "id").sort();
      const linked: string[] = [];
      for (const parent of kinds) {
        for (const link of DELETION_LINKS[parent]) {
          if (link.child !== child) continue;
          expect(ENTITY_ORDER[parent]).toBeLessThan(ENTITY_ORDER[child]);
          linked.push(link.field);
        }
      }
      expect(linked.sort()).toEqual(references);
    }
  });

  const invalidFields: { [K in EntityName]: { field: keyof Entities[K]; value: unknown } } = {
    academicTerms: { field: "name", value: "" },
    courses: { field: "registeredHours", value: -1 },
    scheduleSessions: { field: "dayOfWeek", value: 99 },
    lectures: { field: "date", value: "2030-02-30" },
    materials: { field: "title", value: "" },
    lectureFiles: { field: "blob", value: "not a Blob" },
    materialFiles: { field: "blob", value: "not a Blob" },
  };
  it.each(kinds)("rejects invalid domain data for registered %s", kind => {
    const { batch } = graph();
    const record = {
      ...batch[kind][0], createdAt: 1, updatedAt: 1, deletedAt: null, revision: 1,
      [invalidFields[kind].field]: invalidFields[kind].value,
    } as Entities[EntityName];
    expect(() => validate(kind, record)).toThrow(DataError);
  });

  it("traverses every declared persisted child without changing revisions, records or bytes", async () => {
    const { ids, batch } = graph();
    expect((await store.createRelated(batch)).committed).toBe(true);
    const before = await Promise.all(db.tables.map(table => table.toArray()));
    const whole = await store.academicTerms.previewDelete(ids.academicTerms);
    expect(whole.map(row => row.kind).sort()).toEqual([...kinds].sort());
    expect(new Set(whole.map(row => row.kind + ":" + row.id)).size).toBe(kinds.length);
    for (const kind of kinds) {
      const graph = await store[kind].previewDelete(ids[kind]);
      expect(graph).toContainEqual({ kind, id: ids[kind], revision: 1 });
      for (const link of DELETION_LINKS[kind])
        expect(graph).toContainEqual({ kind: link.child, id: ids[link.child], revision: 1 });
      if (!DELETION_LINKS[kind].length) expect(graph).toHaveLength(1);
    }
    expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
    expect(await (await store.lectureFiles.get(ids.lectureFiles))!.blob.text()).toBe("original lecture bytes");
    expect(await (await store.materialFiles.get(ids.materialFiles))!.blob.text()).toBe("original material bytes");
  });
});
