// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniCoreDatabase, SCHEMA_V1 } from "../data/database";
import { AcademicStore } from "../data/store";
import { createAcademicStore } from "../data";
import type { CreateInput, Entities } from "../data/models";

let db: UniCoreDatabase;
let store: AcademicStore;
beforeEach(() => {
  db = new UniCoreDatabase(`UniCore-test-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  // Destructive cleanup applies only to a randomly named test database.
  await db.delete();
});

async function fixtures() {
  const term = await store.academicTerms.create({
    name: "Test term",
    academicYear: "2030/2031",
    semester: 1,
  });
  const course = await store.courses.create({
    academicTermId: term.id,
    code: "TEST101",
    name: "مقرر تجريبي",
    instructor: null,
    registeredHours: 3,
  });
  const session = await store.scheduleSessions.create({
    academicTermId: term.id,
    courseId: course.id,
    dayOfWeek: 2,
    startTime: "09:00",
    endTime: "10:00",
    deliveryMode: "in-person",
    room: null,
    notes: "Unconfirmed source note",
  });
  const lecture = await store.lectures.create({
    courseId: course.id,
    scheduleSessionId: session.id,
    date: "2030-10-15",
    notes: null,
  });
  const material = await store.materials.create({
    courseId: course.id,
    title: "Test material",
  });
  return { term, course, session, lecture, material };
}

describe("Local academic records", () => {
  it("creates seven related entity types and retrieves independent Blob content", async () => {
    const { term, course, lecture, material } = await fixtures();
    const lectureFile = await store.lectureFiles.create({
      lectureId: lecture.id,
      fileName: "notes.txt",
      blob: new Blob(["lecture bytes"], { type: "text/plain" }),
    });
    const materialFile = await store.materialFiles.create({
      materialId: material.id,
      fileName: "notes.txt",
      blob: new Blob(["material bytes"], { type: "text/plain" }),
    });
    expect(await store.academicTerms.get(term.id)).toEqual(term);
    expect(await store.courses.list({ academicTermId: term.id })).toEqual([
      course,
    ]);
    const stored = await store.lectureFiles.get(lectureFile.id);
    expect(stored?.blob).toBeInstanceOf(Blob);
    expect(await stored?.blob.text()).toBe("lecture bytes");
    expect(stored?.fileSize).toBe(13);
    expect(stored?.mimeType).toBe("text/plain");
    expect(
      await (await store.materialFiles.get(materialFile.id))?.blob.text(),
    ).toBe("material bytes");
    expect(await store.lectureFiles.get(materialFile.id)).toBeUndefined();
    expect(await store.materialFiles.get(lectureFile.id)).toBeUndefined();
    expect(
      await store.lectureFiles.list({ lectureId: lecture.id }),
    ).toHaveLength(1);
  });

  it("preserves ID and creation time across edits and rejects stale updates", async () => {
    const { course } = await fixtures();
    const updated = await store.courses.update(
      course.id,
      {
        name: "Edited name",
        code: "corrected",
        instructor: "Confirmed name",
        section: "4",
      },
      course.revision,
    );
    expect(updated.id).toBe(course.id);
    expect(updated.createdAt).toBe(course.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(course.updatedAt);
    expect(updated.code).toBe("CORRECTED");
    expect(updated.revision).toBe(2);
    await expect(
      store.courses.update(course.id, { name: "Stale edit" }, 1),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.courses.get(course.id))?.name).toBe("Edited name");
  });

  it("persists metadata and Blob bytes across closing and reopening", async () => {
    const { course, material } = await fixtures();
    const file = await store.materialFiles.create({
      materialId: material.id,
      fileName: "persist.txt",
      blob: new Blob(["survives reopening"]),
    });
    const name = db.name;
    store.close();
    const reopened = createAcademicStore(name);
    try {
      await reopened.open();
      expect(await reopened.courses.get(course.id)).toEqual(course);
      expect(
        await (await reopened.materialFiles.get(file.id))?.blob.text(),
      ).toBe("survives reopening");
    } finally {
      reopened.close();
    }
  });

  it("enforces normalized course-code uniqueness per term, not course-name uniqueness", async () => {
    const { course, term } = await fixtures();
    const input = {
      academicTermId: term.id,
      code: " test101 ",
      name: "Different name",
      registeredHours: 2,
    };
    await expect(store.courses.create(input)).rejects.toMatchObject({
      code: "DUPLICATE",
    });
    const second = await store.courses.create({
      ...input,
      code: "TEST102",
      name: course.name,
    });
    await expect(
      store.courses.update(second.id, { code: course.code }, second.revision),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    const otherTerm = await store.academicTerms.create({
      name: "Another term",
      academicYear: "2030/2031",
      semester: 2,
    });
    expect(
      await store.courses.create({ ...input, academicTermId: otherTerm.id }),
    ).toMatchObject({ code: "TEST101" });
  });

  it("rejects references to missing or deleted parents and mismatched terms", async () => {
    await expect(
      store.materials.create({
        courseId: crypto.randomUUID(),
        title: "Orphan",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { term, course, session } = await fixtures();
    const otherTerm = await store.academicTerms.create({
      name: "Other",
      academicYear: "2030/2031",
      semester: 2,
    });
    await expect(
      store.scheduleSessions.update(
        session.id,
        { academicTermId: otherTerm.id },
        session.revision,
      ),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(
      store.courses.update(
        course.id,
        { academicTermId: otherTerm.id },
        course.revision,
      ),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await store.academicTerms.delete(term.id, {
      expectedRevision: term.revision,
      cascade: true,
      confirmation: await store.academicTerms.previewDelete(term.id),
    });
    await expect(
      store.materials.create({ courseId: course.id, title: "Deleted parent" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("validates lecture-session course consistency and session reassignment", async () => {
    const { term, course, session, lecture } = await fixtures();
    const other = await store.courses.create({
      academicTermId: term.id,
      code: "OTHER",
      name: "Other course",
      registeredHours: 1,
    });
    await expect(
      store.lectures.create({
        courseId: other.id,
        scheduleSessionId: session.id,
        date: "2030-10-15",
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(
      store.lectures.update(
        lecture.id,
        { courseId: other.id },
        lecture.revision,
      ),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(
      store.scheduleSessions.update(
        session.id,
        { courseId: other.id },
        session.revision,
      ),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
    expect((await store.scheduleSessions.get(session.id))?.courseId).toBe(
      course.id,
    );
  });

  it("does not automatically create lectures from weekly sessions", async () => {
    const term = await store.academicTerms.create({
      name: "Term",
      academicYear: "2030/2031",
      semester: 1,
    });
    const course = await store.courses.create({
      academicTermId: term.id,
      code: "A",
      name: "A",
      registeredHours: 1,
    });
    await store.scheduleSessions.create({
      academicTermId: term.id,
      courseId: course.id,
      dayOfWeek: 7,
      startTime: "08:00",
      endTime: "09:00",
      deliveryMode: "online",
    });
    expect(await store.lectures.list()).toEqual([]);
  });

  it("edits sessions, lectures, materials, terms, and attachment content", async () => {
    const { term, session, lecture, material } = await fixtures();
    expect(
      await store.academicTerms.update(
        term.id,
        { name: "Changed term", startDate: "2030-09-01" },
        1,
      ),
    ).toMatchObject({ id: term.id, name: "Changed term" });
    expect(
      await store.scheduleSessions.update(
        session.id,
        {
          dayOfWeek: 7,
          startTime: "12:00",
          endTime: "13:00",
          room: "Confirmed room",
        },
        1,
      ),
    ).toMatchObject({ id: session.id, dayOfWeek: 7 });
    expect(
      await store.lectures.update(
        lecture.id,
        { notes: "Corrected notes", scheduleSessionId: null },
        1,
      ),
    ).toMatchObject({ id: lecture.id, notes: "Corrected notes" });
    expect(
      await store.materials.update(
        material.id,
        { title: "Corrected title", category: "Reference" },
        1,
      ),
    ).toMatchObject({ id: material.id, title: "Corrected title" });
    const file = await store.lectureFiles.create({
      lectureId: lecture.id,
      fileName: "original",
      blob: new Blob(["old"]),
    });
    const edited = await store.lectureFiles.update(
      file.id,
      {
        fileName: "corrected",
        blob: new Blob(["new bytes"], { type: "text/plain" }),
      },
      1,
    );
    expect(edited.id).toBe(file.id);
    expect(edited.fileSize).toBe(9);
    expect(await (await store.lectureFiles.get(file.id))?.blob.text()).toBe(
      "new bytes",
    );
    const materialFile = await store.materialFiles.create({
      materialId: material.id,
      fileName: "resource",
      blob: new Blob(["data"]),
    });
    expect(
      await store.materialFiles.update(
        materialFile.id,
        { fileName: "renamed" },
        1,
      ),
    ).toMatchObject({ id: materialFile.id, fileName: "renamed" });
  });
});

describe("Validation and atomic writes", () => {
  it.each([
    { dayOfWeek: 0 },
    { dayOfWeek: 8 },
    { dayOfWeek: 1.5 },
    { startTime: "25:00" },
    { startTime: "10:00", endTime: "09:00" },
    { startTime: "09:00", endTime: "09:00" },
    { deliveryMode: "unknown" },
  ])("rejects invalid session data: %j", async (patch) => {
    const { session } = await fixtures();
    await expect(
      store.scheduleSessions.update(session.id, patch as never, 1),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await store.scheduleSessions.get(session.id)).toEqual(session);
  });

  it("rejects impossible dates, invalid hours, non-Blob files and metadata tampering", async () => {
    const { term, course, lecture } = await fixtures();
    await expect(
      store.lectures.create({ courseId: course.id, date: "2030-02-30" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.lectures.create({
        courseId: course.id,
        date: "2030-10-15",
        startTime: "10:00",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.courses.update(course.id, { registeredHours: -1 }, 1),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.courses.update(course.id, { registeredHours: NaN }, 1),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.academicTerms.update(
        term.id,
        { startDate: "2031-01-01", endDate: "2030-01-01" },
        1,
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.lectureFiles.create({
        lectureId: lecture.id,
        fileName: "bad",
        blob: "not bytes",
      } as unknown as CreateInput<"lectureFiles">),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.courses.update(course.id, { id: crypto.randomUUID() } as never, 1),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      store.courses.update(course.id, { name: " " }, 1),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("bulk insertion is idempotent and never overwrites user edits or resurrects tombstones", async () => {
    const term = await store.academicTerms.create({
      name: "Term",
      academicYear: "2030/2031",
      semester: 1,
    });
    const input = {
      id: crypto.randomUUID(),
      academicTermId: term.id,
      code: "BULK",
      name: "Initial extraction",
      registeredHours: 1,
      instructor: null,
    };
    expect((await store.courses.bulkUpsert([input])).created).toEqual([
      input.id,
    ]);
    const edited = await store.courses.update(
      input.id,
      { name: "User correction" },
      1,
    );
    expect((await store.courses.bulkUpsert([input])).skipped).toHaveLength(1);
    expect(await store.courses.get(input.id)).toEqual(edited);
    expect(
      (await store.courses.bulkUpsert([{ ...input, id: crypto.randomUUID() }]))
        .rejected[0],
    ).toMatchObject({ existingId: input.id, code: "DUPLICATE" });
    await store.courses.delete(input.id, { expectedRevision: 2 });
    await store.courses.bulkUpsert([input]);
    expect(await store.courses.get(input.id)).toBeUndefined();
    expect(
      (await store.courses.get(input.id, { includeDeleted: true }))?.deletedAt,
    ).not.toBeNull();
    await expect(
      store.courses.create({
        academicTermId: term.id,
        code: "BULK",
        name: "Replacement",
        registeredHours: 1,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("rolls back the entire bulk batch when any new record is invalid", async () => {
    const valid = {
      id: crypto.randomUUID(),
      name: "Valid",
      academicYear: "2030/2031",
      semester: 1,
    };
    const result = await store.academicTerms.bulkUpsert([
      valid,
      { ...valid, id: crypto.randomUUID(), semester: 0 },
    ]);
    expect(result.committed).toBe(false);
    expect(
      result.rejected.some((outcome) => outcome.code === "VALIDATION"),
    ).toBe(true);
    expect(await store.academicTerms.list()).toEqual([]);
  });

  it("rolls back a bulk batch with a missing relationship", async () => {
    const { term } = await fixtures();
    const base = {
      id: crypto.randomUUID(),
      academicTermId: term.id,
      code: "VALID",
      name: "Valid",
      registeredHours: 1,
    };
    const result = await store.courses.bulkUpsert([
      base,
      {
        ...base,
        id: crypto.randomUUID(),
        code: "BAD",
        academicTermId: crypto.randomUUID(),
      },
    ]);
    expect(result.committed).toBe(false);
    expect(
      result.rejected.some((outcome) => outcome.code === "NOT_FOUND"),
    ).toBe(true);
    expect(await store.courses.get(base.id)).toBeUndefined();
  });

  it("serializes competing connections and rejects one stale writer", async () => {
    const { course } = await fixtures();
    const other = createAcademicStore(db.name);
    try {
      const outcomes = await Promise.allSettled([
        store.courses.update(course.id, { name: "First" }, 1),
        other.courses.update(course.id, { name: "Second" }, 1),
      ]);
      expect(
        outcomes.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const rejected = outcomes.find((result) => result.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({
        code: "CONFLICT",
      });
    } finally {
      other.close();
    }
  });

  it("maps quota failures without losing an existing attachment", async () => {
    const { material } = await fixtures();
    const file = await store.materialFiles.create({
      materialId: material.id,
      fileName: "saved",
      blob: new Blob(["saved bytes"]),
    });
    const write = vi
      .spyOn(db.records("materialFiles"), "put")
      .mockRejectedValueOnce(
        new DOMException("Quota exceeded", "QuotaExceededError"),
      );
    await expect(
      store.materialFiles.update(
        file.id,
        { blob: new Blob(["replacement"]) },
        1,
      ),
    ).rejects.toMatchObject({ code: "QUOTA" });
    write.mockRestore();
    expect(await (await store.materialFiles.get(file.id))?.blob.text()).toBe(
      "saved bytes",
    );
    expect((await store.materialFiles.get(file.id))?.revision).toBe(1);
  });
});

describe("Safe deletion and migrations", () => {
  it("rejects a newly added dependent after deletion preview", async () => {
    const { course } = await fixtures();
    const preview = await store.courses.previewDelete(course.id);
    await store.materials.create({
      courseId: course.id,
      title: "Added after preview",
    });
    await expect(
      store.courses.delete(course.id, {
        expectedRevision: 1,
        cascade: true,
        confirmation: preview,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      store.courses.delete(course.id, { expectedRevision: 1, cascade: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.materials.list({ courseId: course.id })).toHaveLength(2);
  });

  it("rolls back all tombstones if any cascade write fails", async () => {
    const { term, course } = await fixtures();
    const preview = await store.academicTerms.previewDelete(term.id);
    const write = vi
      .spyOn(db.records("courses"), "put")
      .mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"));
    await expect(
      store.academicTerms.delete(term.id, {
        expectedRevision: 1,
        cascade: true,
        confirmation: preview,
      }),
    ).rejects.toMatchObject({ code: "QUOTA" });
    write.mockRestore();
    expect(await store.academicTerms.get(term.id)).toEqual(term);
    expect(await store.courses.get(course.id)).toEqual(course);
    expect(await store.academicTerms.previewDelete(term.id)).toEqual(preview);
  });

  it("rejects stale deletion revisions and orphaned attachment relationships", async () => {
    const { material, lecture } = await fixtures();
    await store.materials.update(material.id, { title: "Latest title" }, 1);
    await expect(
      store.materials.delete(material.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      store.materialFiles.create({
        materialId: crypto.randomUUID(),
        fileName: "orphan",
        blob: new Blob(["bytes"]),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.lectureFiles.create({
        lectureId: material.id,
        fileName: "wrong relationship",
        blob: new Blob(["bytes"]),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      store.materialFiles.create({
        materialId: lecture.id,
        fileName: "wrong relationship",
        blob: new Blob(["bytes"]),
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await store.lectureFiles.list()).toEqual([]);
    expect(await store.materialFiles.list()).toEqual([]);
  });

  it("restricts deletion by default and requires a current explicit cascade preview", async () => {
    const { course, lecture } = await fixtures();
    await expect(
      store.courses.delete(course.id, { expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "DEPENDENTS" });
    const preview = await store.courses.previewDelete(course.id);
    await store.lectures.update(
      lecture.id,
      { notes: "New edit after preview" },
      1,
    );
    await expect(
      store.courses.delete(course.id, {
        expectedRevision: 1,
        cascade: true,
        confirmation: preview,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.courses.get(course.id)).toBeDefined();
    expect((await store.lectures.get(lecture.id))?.notes).toBe(
      "New edit after preview",
    );
  });

  it("soft-deletes the complete term graph, keeping Blob bytes and stable IDs", async () => {
    const { term, lecture, material } = await fixtures();
    const lectureFile = await store.lectureFiles.create({
      lectureId: lecture.id,
      fileName: "lecture",
      blob: new Blob(["lecture retained"]),
    });
    const materialFile = await store.materialFiles.create({
      materialId: material.id,
      fileName: "material",
      blob: new Blob(["material retained"]),
    });
    const preview = await store.academicTerms.previewDelete(term.id);
    expect(preview).toHaveLength(7);
    const deleted = await store.academicTerms.delete(term.id, {
      expectedRevision: 1,
      cascade: true,
      confirmation: preview,
    });
    expect(deleted).toHaveLength(7);
    for (const entry of deleted) {
      const record = await db.records(entry.kind).get(entry.id);
      expect(record?.id).toBe(entry.id);
      expect(record?.deletedAt).toEqual(expect.any(Number));
      expect(record?.revision).toBe(2);
    }
    expect(await store.courses.list()).toEqual([]);
    expect(await store.courses.list({}, { includeDeleted: true })).toHaveLength(
      1,
    );
    expect(
      await (
        await store.lectureFiles.get(lectureFile.id, { includeDeleted: true })
      )?.blob.text(),
    ).toBe("lecture retained");
    expect(
      await (
        await store.materialFiles.get(materialFile.id, { includeDeleted: true })
      )?.blob.text(),
    ).toBe("material retained");
  });

  it("lecture deletion does not delete general course material files", async () => {
    const { lecture, material } = await fixtures();
    const lectureFile = await store.lectureFiles.create({
      lectureId: lecture.id,
      fileName: "a",
      blob: new Blob(["a"]),
    });
    const materialFile = await store.materialFiles.create({
      materialId: material.id,
      fileName: "b",
      blob: new Blob(["b"]),
    });
    await store.lectures.delete(lecture.id, {
      expectedRevision: 1,
      cascade: true,
      confirmation: await store.lectures.previewDelete(lecture.id),
    });
    expect(await store.lectureFiles.get(lectureFile.id)).toBeUndefined();
    expect(await store.materialFiles.get(materialFile.id)).toBeDefined();
    await store.materials.delete(material.id, {
      expectedRevision: 1,
      cascade: true,
      confirmation: await store.materials.previewDelete(material.id),
    });
    expect(await store.materialFiles.get(materialFile.id)).toBeUndefined();
  });

  it("preserves records during an additive test-only version upgrade", async () => {
    const { course, term, material } = await fixtures();
    const file = await store.materialFiles.create({
      materialId: material.id,
      fileName: "migration",
      blob: new Blob(["migration bytes"]),
    });
    store.close();
    // This v3 exists only in the test; production ships version 2.
    const upgraded = new Dexie(db.name);
    upgraded.version(1).stores(SCHEMA_V1);
    upgraded.version(2).stores(SCHEMA_V1);
    upgraded
      .version(3)
      .stores({ courses: "id, academicTermId, &[academicTermId+code], name" });
    try {
      await upgraded.open();
      expect(
        await upgraded.table<Entities["courses"]>("courses").get(course.id),
      ).toEqual(course);
      expect(
        await upgraded
          .table<Entities["academicTerms"]>("academicTerms")
          .get(term.id),
      ).toEqual(term);
      const migrated = await upgraded
        .table<Entities["materialFiles"]>("materialFiles")
        .get(file.id);
      expect(await migrated?.blob.text()).toBe("migration bytes");
      expect(upgraded.verno).toBe(3);
    } finally {
      upgraded.close();
    }
  });
});
