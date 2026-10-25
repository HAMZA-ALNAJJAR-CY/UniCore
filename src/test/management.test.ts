// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import type { CreateInput, Course, ScheduleSession } from "../data";
import { sourceDraft } from "./fixtures/timetable";
import { overlappingSessions, validSlot } from "../features/timetable/schedule";

let db: UniCoreDatabase,
  store: AcademicStore,
  course: Course,
  session: ScheduleSession;
const slot = {
  dayOfWeek: 7,
  startTime: "09:00",
  endTime: "10:00",
  room: "R1",
  deliveryMode: "in-person" as const,
};
beforeEach(async () => {
  db = new UniCoreDatabase(`management-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
  const term = await store.academicTerms.create({
    name: "Test term",
    academicYear: "2030/2031",
    semester: 1,
  });
  course = await store.courses.create({
    academicTermId: term.id,
    name: "Sample course",
    code: "TEST1",
    registeredHours: 3,
    instructor: null,
  });
  session = await store.saveManagedSession({
    ...slot,
    academicTermId: term.id,
    courseId: course.id,
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await db.delete();
});
const input = (
  patch: Partial<CreateInput<"scheduleSessions">> = {},
): CreateInput<"scheduleSessions"> => ({
  ...slot,
  academicTermId: course.academicTermId,
  courseId: course.id,
  ...patch,
});

describe("persistent timetable management", () => {
  it("loads the selected term with correct course/session associations, excluding tombstones", async () => {
    const other = await store.academicTerms.create({
      name: "Other",
      academicYear: "2031/2032",
      semester: 1,
    });
    expect((await store.getTimetable()).termId).toBe(other.id);
    const snapshot = await store.getTimetable(course.academicTermId);
    expect(snapshot.courses).toEqual([course]);
    expect(snapshot.sessions).toEqual([session]);
    await store.scheduleSessions.delete(session.id, {
      expectedRevision: session.revision,
    });
    expect((await store.getTimetable(course.academicTermId)).sessions).toEqual(
      [],
    );
  });
  it("persists course and session edits across reopen without changing IDs, creation timestamps or notes", async () => {
    session = await store.scheduleSessions.update(
      session.id,
      { notes: "Retain notes", location: "Retain location" },
      session.revision,
    );
    const updated = await store.courses.update(
      course.id,
      {
        code: "NEWCODE",
        name: "Edited course",
        instructor: null,
        activityType: "practical",
      },
      course.revision,
    );
    const changed = await store.saveManagedSession(
      input({ dayOfWeek: 2, room: "R2", startTime: "12:00", endTime: "13:00" }),
      { id: session.id, revision: session.revision },
    );
    store.close();
    store = new AcademicStore(new UniCoreDatabase(db.name));
    const snapshot = await store.getTimetable();
    expect(snapshot.courses[0]).toMatchObject({
      id: course.id,
      createdAt: course.createdAt,
      code: "NEWCODE",
      revision: updated.revision,
      instructor: null,
    });
    expect(snapshot.sessions[0]).toMatchObject({
      id: session.id,
      createdAt: session.createdAt,
      revision: changed.revision,
      dayOfWeek: 2,
      notes: "Retain notes",
      location: "Retain location",
    });
    expect(changed.updatedAt).toBeGreaterThan(session.updatedAt);
  });
  it("adds a session and removes only the selected session with a retained tombstone", async () => {
    const added = await store.saveManagedSession(input({ dayOfWeek: 4 }));
    await store.scheduleSessions.delete(session.id, {
      expectedRevision: session.revision,
    });
    expect((await store.getTimetable()).sessions.map((row) => row.id)).toEqual([
      added.id,
    ]);
    expect(await store.courses.get(course.id)).toEqual(course);
    expect(
      (await store.scheduleSessions.get(session.id, { includeDeleted: true }))
        ?.deletedAt,
    ).not.toBeNull();
  });
  it("requires exact overlap acknowledgment and accepts back-to-back sessions without warning", async () => {
    const overlapping = input({ startTime: "09:30", endTime: "10:30" });
    expect(overlappingSessions(overlapping, [session])).toEqual([session]);
    await expect(store.saveManagedSession(overlapping)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await store.saveManagedSession(overlapping, undefined, [
      { id: session.id, revision: session.revision },
    ]);
    const adjacent = input({ startTime: "10:30", endTime: "11:00" });
    expect(
      overlappingSessions(adjacent, (await store.getTimetable()).sessions),
    ).toEqual([]);
    await expect(store.saveManagedSession(adjacent)).resolves.toMatchObject({
      startTime: "10:30",
    });
  });
  it("rechecks overlaps atomically when another writer adds or revises a session", async () => {
    const candidate = input({ startTime: "09:30", endTime: "10:30" });
    const confirmed = [{ id: session.id, revision: session.revision }];
    const writer = new AcademicStore(new UniCoreDatabase(db.name));
    await writer.scheduleSessions.update(
      session.id,
      { room: "Changed elsewhere" },
      session.revision,
    );
    writer.close();
    await expect(
      store.saveManagedSession(candidate, undefined, confirmed),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.getTimetable()).sessions).toHaveLength(1);
  });
  it.each([
    { startTime: "11:00", endTime: "10:00" },
    { startTime: "09:00", endTime: "09:00" },
    { startTime: "25:00" },
    { dayOfWeek: 0 },
    { dayOfWeek: 8 },
  ])("rejects invalid slot %j without writes", async (patch) => {
    expect(validSlot(input(patch))).toBe(false);
    await expect(store.saveManagedSession(input(patch))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await store.getTimetable()).sessions).toHaveLength(1);
  });
  it("rejects duplicate sessions, duplicate course codes and stale edits", async () => {
    await expect(
      store.saveManagedSession(input(), undefined, [
        { id: session.id, revision: 1 },
      ]),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    await expect(
      store.courses.create({
        academicTermId: course.academicTermId,
        code: course.code,
        name: "Duplicate",
        registeredHours: 1,
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE" });
    await store.saveManagedSession(input({ room: "New" }), {
      id: session.id,
      revision: session.revision,
    });
    await expect(
      store.saveManagedSession(input({ room: "Stale" }), {
        id: session.id,
        revision: session.revision,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects invalid or reassigned parent references", async () => {
    await expect(
      store.saveManagedSession(input({ courseId: crypto.randomUUID() })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const another = await store.courses.create({
      academicTermId: course.academicTermId,
      code: "OTHER",
      name: "Other",
      registeredHours: 1,
    });
    await expect(
      store.saveManagedSession(input({ courseId: another.id }), {
        id: session.id,
        revision: session.revision,
      }),
    ).rejects.toMatchObject({ code: "RELATIONSHIP" });
  });
  it("deletes only a reviewed course/session graph and retains unrelated records", async () => {
    const other = await store.courses.create({
      academicTermId: course.academicTermId,
      code: "OTHER",
      name: "Other",
      registeredHours: 1,
    });
    const graph = await store.courses.previewDelete(course.id);
    await store.deleteManagedCourse(course.id, course.revision, graph);
    expect(await store.courses.get(course.id)).toBeUndefined();
    expect(await store.scheduleSessions.get(session.id)).toBeUndefined();
    expect(await store.courses.get(other.id)).toEqual(other);
    expect(
      (await store.courses.get(course.id, { includeDeleted: true }))?.revision,
    ).toBe(2);
  });
  it("blocks changed deletion graphs and rolls back after a storage failure midway through deletion", async () => {
    const graph = await store.courses.previewDelete(course.id);
    const added = await store.saveManagedSession(input({ dayOfWeek: 2 }));
    await expect(
      store.deleteManagedCourse(course.id, course.revision, graph),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const fresh = await store.courses.previewDelete(course.id);
    vi.spyOn(db.records("scheduleSessions"), "put").mockRejectedValueOnce(
      new DOMException("No space", "QuotaExceededError"),
    );
    await expect(
      store.deleteManagedCourse(course.id, course.revision, fresh),
    ).rejects.toMatchObject({ code: "QUOTA" });
    expect(await store.courses.get(course.id)).toEqual(course);
    expect(await store.scheduleSessions.get(added.id)).toEqual(added);
  });
  it("preserves historical lectures, materials and attachment Blobs when deletions are blocked", async () => {
    const lecture = await store.lectures.create({
      courseId: course.id,
      scheduleSessionId: session.id,
      date: "2030-10-15",
      notes: "History",
    });
    const file = await store.lectureFiles.create({
      lectureId: lecture.id,
      fileName: "history",
      blob: new Blob(["lecture bytes"]),
    });
    const material = await store.materials.create({
      courseId: course.id,
      title: "Resource",
    });
    const resource = await store.materialFiles.create({
      materialId: material.id,
      fileName: "resource",
      blob: new Blob(["resource bytes"]),
    });
    const graph = await store.courses.previewDelete(course.id);
    await expect(
      store.deleteManagedCourse(course.id, course.revision, graph),
    ).rejects.toMatchObject({ code: "DEPENDENTS" });
    await expect(
      store.scheduleSessions.delete(session.id, {
        expectedRevision: session.revision,
      }),
    ).rejects.toMatchObject({ code: "DEPENDENTS" });
    await store.saveManagedSession(input({ room: "Edited" }), {
      id: session.id,
      revision: session.revision,
    });
    await store.courses.update(course.id, { name: "Edited" }, course.revision);
    expect(await store.lectures.get(lecture.id)).toEqual(lecture);
    expect(await (await store.lectureFiles.get(file.id))?.blob.text()).toBe(
      "lecture bytes",
    );
    expect(
      await (await store.materialFiles.get(resource.id))?.blob.text(),
    ).toBe("resource bytes");
  });
  it("keeps import mappings unchanged through edits/deletion and protects edits during re-import", async () => {
    const review = await store.reviewTimetable(sourceDraft());
    const confirm = {
      confirmed: true,
      keepExistingKeys: review.differences.map((row) => row.key),
    };
    expect((await store.saveTimetable(review, confirm)).committed).toBe(true);
    const mappings = await db.table("importMappings").toArray();
    const imported = (await store.courses.get(review.draft.courses[0].id!))!;
    const importedSession = (
      await store.scheduleSessions.list({ courseId: imported.id })
    )[0];
    await store.courses.update(
      imported.id,
      { name: "User correction", code: "MYCODE" },
      imported.revision,
    );
    await store.saveManagedSession(
      {
        academicTermId: imported.academicTermId,
        courseId: imported.id,
        dayOfWeek: 1,
        startTime: "17:00",
        endTime: "18:00",
        room: "USER",
        deliveryMode: "online",
      },
      { id: importedSession.id, revision: importedSession.revision },
    );
    expect(await db.table("importMappings").toArray()).toEqual(mappings);
    const again = await store.reviewTimetable(sourceDraft());
    expect(
      again.differences.some((row) => row.key.startsWith("courses:")),
    ).toBe(true);
    expect(
      (
        await store.saveTimetable(again, {
          confirmed: true,
          keepExistingKeys: again.differences.map((row) => row.key),
        })
      ).committed,
    ).toBe(true);
    expect((await store.courses.get(imported.id))?.name).toBe(
      "User correction",
    );
    expect(
      (await store.scheduleSessions.get(importedSession.id))?.dayOfWeek,
    ).toBe(1);
    const beforeDelete = await db.table("importMappings").toArray();
    const graph = await store.courses.previewDelete(imported.id);
    await store.deleteManagedCourse(imported.id, imported.revision + 1, graph);
    expect(await db.table("importMappings").toArray()).toEqual(beforeDelete);
    await expect(store.reviewTimetable(sourceDraft())).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
