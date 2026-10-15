// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { UniCoreDatabase, SCHEMA_V1 } from "../data/database";
import { AcademicStore } from "../data/store";
import { analyzeDraft } from "../features/timetable/draft";
import { sourceDraft } from "./fixtures/timetable";
import type { ImportMapping, TimetableReview } from "../data";

let db: UniCoreDatabase, store: AcademicStore;
beforeEach(() => {
  db = new UniCoreDatabase(`UniCore-import-test-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await db.delete();
});
const confirm = (review: TimetableReview) => ({
  confirmed: true,
  keepExistingKeys: review.differences.map((row) => row.key),
});

describe("Extracted draft and review", () => {
  it("retains seven distinct courses, fifteen sessions, ISO days and uncertainty", () => {
    const draft = sourceDraft(),
      stats = analyzeDraft(draft);
    expect(stats).toMatchObject({
      courseCount: 7,
      sessionCount: 15,
      hours: 15,
      errors: [],
      overlaps: [],
    });
    expect(draft.sessions.filter((row) => row.dayOfWeek === 7)).toHaveLength(5);
    expect(draft.sessions.filter((row) => row.dayOfWeek === 2)).toHaveLength(7);
    expect(draft.sessions.filter((row) => row.dayOfWeek === 4)).toHaveLength(3);
    expect(
      draft.courses.find((row) => row.code === "A0181105")?.instructor,
    ).toBeNull();
    expect(
      draft.courses.find((row) => row.code === "A0161503")?.instructor,
    ).toBeNull();
    expect(draft.courses.find((row) => row.code === "A0181505")).toMatchObject({
      activityType: "practical",
      registeredHours: 1,
    });
    expect(draft.courses.find((row) => row.code === "A0181504")?.key).not.toBe(
      draft.courses.find((row) => row.code === "A0181505")?.key,
    );
    expect(draft.sessions.filter((row) => row.room === "B203")).toHaveLength(5);
    expect(
      draft.sessions
        .filter((row) => row.room === "B203")
        .every(
          (row) =>
            row.notes?.includes("*") && row.unconfirmed.includes("notes"),
        ),
    ).toBe(true);
    expect(
      draft.sessions.every((row) =>
        draft.courses.some((course) => course.key === row.courseKey),
      ),
    ).toBe(true);
    expect(draft.term).toMatchObject({
      startDate: null,
      endDate: null,
      college: "تكنولوجيا المعلومات",
      program: "الأمن السيبراني / البكالوريوس",
    });
    expect(stats.transitions).toHaveLength(11);
  });
  it("distinguishes zero-minute transitions from actual overlaps", () => {
    const draft = sourceDraft();
    expect(analyzeDraft(draft).overlaps).toEqual([]);
    draft.sessions[4].startTime = "09:30";
    draft.sessions[4].endTime = "10:30";
    expect(analyzeDraft(draft).overlaps).toHaveLength(2);
  });
  it("flags invalid times, duplicate codes and dangling relationships", () => {
    const draft = sourceDraft();
    draft.courses[1].code = draft.courses[0].code;
    draft.sessions[0].courseKey = "missing";
    draft.sessions[1].startTime = "25:00";
    const issues = analyzeDraft(draft).errors;
    expect(issues.some((row) => row.includes("مكرر"))).toBe(true);
    expect(issues.some((row) => row.includes("اختر مقرراً"))).toBe(true);
    expect(issues.some((row) => row.includes("الوقت"))).toBe(true);
  });
  it("review does not save academic records or source bindings", async () => {
    const review = await store.reviewTimetable(sourceDraft());
    expect(review.draft.courses.every((row) => row.id)).toBe(true);
    expect(await store.courses.list()).toEqual([]);
    expect(await store.academicTerms.list()).toEqual([]);
    expect(await db.table("importMappings").count()).toBe(0);
    await expect(
      store.saveTimetable(review, { confirmed: false, keepExistingKeys: [] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await store.scheduleSessions.list()).toEqual([]);
  });
});

describe("Atomic confirmed import and re-import", () => {
  it("serializes concurrent imports without duplicate records or bindings", async () => {
    const a = await store.reviewTimetable(sourceDraft()),
      b = await store.reviewTimetable(sourceDraft());
    const results = await Promise.all([
      store.saveTimetable(a, confirm(a)),
      store.saveTimetable(b, confirm(b)),
    ]);
    expect(results.filter((result) => result.committed)).toHaveLength(1);
    expect(await store.academicTerms.list()).toHaveLength(1);
    expect(await store.courses.list()).toHaveLength(7);
    expect(await store.scheduleSessions.list()).toHaveLength(15);
    expect(await db.table("importMappings").count()).toBe(23);
  });
  it("does not resurrect a deleted import identity", async () => {
    const review = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(review, confirm(review));
    const id = review.draft.term.id!;
    await store.academicTerms.delete(id, {
      expectedRevision: 1,
      cascade: true,
      confirmation: await store.academicTerms.previewDelete(id),
    });
    await expect(store.reviewTimetable(sourceDraft())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await store.academicTerms.list()).toEqual([]);
    expect(
      await store.academicTerms.list({}, { includeDeleted: true }),
    ).toHaveLength(1);
  });
  it("requires an explicit existing term identity when matching terms are ambiguous", async () => {
    const term = { name: "Existing", academicYear: "2026/2027", semester: 1 };
    const first = await store.academicTerms.create(term);
    await store.academicTerms.create({ ...term, name: "Another" });
    await expect(store.reviewTimetable(sourceDraft())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const draft = sourceDraft();
    draft.term.id = first.id;
    const review = await store.reviewTimetable(draft);
    expect(review.draft.term.id).toBe(first.id);
    expect((await store.saveTimetable(review, confirm(review))).committed).toBe(
      true,
    );
    expect(await store.academicTerms.list()).toHaveLength(2);
  });
  it("saves user edits, nullable instructors, activities and uncertainty without lectures", async () => {
    const initial = await store.reviewTimetable(sourceDraft());
    const ids = initial.draft.courses.map((row) => row.id);
    initial.draft.courses[0].name = "اسم راجعه المستخدم";
    initial.draft.courses[0].code = "REVIEWED";
    initial.draft.courses[0].section = "03";
    initial.draft.sessions[0].room = "ReviewedRoom";
    const review = await store.reviewTimetable(initial.draft);
    expect(review.draft.courses.map((row) => row.id)).toEqual(ids);
    const result = await store.saveTimetable(review, confirm(review));
    expect(result.committed).toBe(true);
    expect(result.created).toHaveLength(23);
    expect(await store.courses.list()).toHaveLength(7);
    expect(await store.scheduleSessions.list()).toHaveLength(15);
    expect(await store.courses.get(ids[0]!)).toMatchObject({
      name: "اسم راجعه المستخدم",
      code: "REVIEWED",
      section: "03",
    });
    expect(
      (await store.courses.list({ code: "A0181105" }))[0].instructor,
    ).toBeNull();
    expect(
      (await store.courses.list({ code: "A0161503" }))[0].instructor,
    ).toBeNull();
    const mappings = await db.table<ImportMapping>("importMappings").toArray();
    expect(mappings).toHaveLength(23);
    expect(
      mappings.filter(
        (row) =>
          row.entity === "scheduleSessions" &&
          row.unconfirmed.includes("notes"),
      ),
    ).toHaveLength(5);
    expect(await store.lectures.list()).toEqual([]);
    expect(await store.materials.list()).toEqual([]);
  });
  it("rolls back records and all mappings if metadata storage fails", async () => {
    const review = await store.reviewTimetable(sourceDraft());
    vi.spyOn(db.table("importMappings"), "put").mockRejectedValueOnce(
      new DOMException("Quota", "QuotaExceededError"),
    );
    const result = await store.saveTimetable(review, confirm(review));
    expect(result.committed).toBe(false);
    expect(await store.academicTerms.list()).toEqual([]);
    expect(await store.courses.list()).toEqual([]);
    expect(await store.scheduleSessions.list()).toEqual([]);
    expect(await db.table("importMappings").count()).toBe(0);
  });
  it("rejects an invalid edited relationship without leaving a partial term", async () => {
    const review = await store.reviewTimetable(sourceDraft());
    review.draft.sessions[0].courseKey = "missing";
    const result = await store.saveTimetable(review, confirm(review));
    expect(result.committed).toBe(false);
    expect(await store.academicTerms.list()).toEqual([]);
  });
  it("re-import preserves edited identities and values and requires a difference decision", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const courseId = first.draft.courses[0].id!,
      sessionId = first.draft.sessions[0].id!;
    const editedCourse = await store.courses.update(
      courseId,
      {
        name: "تعديل محفوظ",
        code: "NEW-CODE",
        instructor: "اسم مصحح",
        registeredHours: 2,
      },
      1,
    );
    const editedSession = await store.scheduleSessions.update(
      sessionId,
      { startTime: "07:00", room: "UserRoom" },
      1,
    );
    const repeated = await store.reviewTimetable(sourceDraft());
    expect(repeated.draft.courses[0].id).toBe(courseId);
    expect(repeated.draft.sessions[0].id).toBe(sessionId);
    expect(repeated.differences).toHaveLength(2);
    expect(repeated.savedSummary.hours).toBe(16);
    expect(
      (
        await store.saveTimetable(repeated, {
          confirmed: true,
          keepExistingKeys: [],
        })
      ).committed,
    ).toBe(false);
    const result = await store.saveTimetable(repeated, confirm(repeated));
    expect(result.committed).toBe(true);
    expect(result.created).toEqual([]);
    expect(result.skipped).toHaveLength(23);
    expect(await store.courses.get(courseId)).toEqual(editedCourse);
    expect(await store.scheduleSessions.get(sessionId)).toEqual(editedSession);
    expect(await store.courses.list()).toHaveLength(7);
    expect(await store.scheduleSessions.list()).toHaveLength(15);
  });
  it("rejects stale reviews after a concurrent saved edit", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const reviewed = await store.reviewTimetable(sourceDraft());
    await store.courses.update(
      first.draft.courses[0].id!,
      { name: "Changed elsewhere" },
      1,
    );
    const result = await store.saveTimetable(reviewed, confirm(reviewed));
    expect(result.committed).toBe(false);
    expect(result.rejected[0].code).toBe("CONFLICT");
    expect((await store.courses.get(first.draft.courses[0].id!))?.name).toBe(
      "Changed elsewhere",
    );
  });
  it("reuses unmapped existing course codes and matching session identities", async () => {
    const term = await store.academicTerms.create({
      name: "Existing term",
      academicYear: "2026/2027",
      semester: 1,
    });
    const course = await store.courses.create({
      academicTermId: term.id,
      code: "A0181504",
      name: "Existing programming",
      registeredHours: 2,
    });
    const session = await store.scheduleSessions.create({
      academicTermId: term.id,
      courseId: course.id,
      dayOfWeek: 7,
      startTime: "08:00",
      endTime: "09:00",
      room: "Existing",
      deliveryMode: "in-person",
    });
    const review = await store.reviewTimetable(sourceDraft());
    expect(review.draft.term.id).toBe(term.id);
    expect(
      review.draft.courses.find((row) => row.code === course.code)?.id,
    ).toBe(course.id);
    expect(review.draft.sessions[0].id).toBe(session.id);
    expect((await store.saveTimetable(review, confirm(review))).committed).toBe(
      true,
    );
    expect(await store.courses.get(course.id)).toEqual(course);
    expect(await store.scheduleSessions.get(session.id)).toEqual(session);
    expect(await store.courses.list()).toHaveLength(7);
  });
  it("adds and excludes draft rows without deleting existing academic records", async () => {
    const initial = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(initial, confirm(initial));
    const draft = sourceDraft();
    const removed = draft.courses[0].key;
    draft.courses = draft.courses.filter((row) => row.key !== removed);
    draft.sessions = draft.sessions.filter((row) => row.courseKey !== removed);
    draft.courses.push({
      key: "added",
      code: "USER101",
      name: "مقرر أضافه المستخدم",
      registeredHours: 1,
      unconfirmed: [],
      instructor: null,
    });
    draft.sessions.push({
      key: "added-session",
      courseKey: "added",
      dayOfWeek: 1,
      startTime: "12:00",
      endTime: "13:00",
      room: null,
      deliveryMode: "online",
      unconfirmed: ["room"],
    });
    const review = await store.reviewTimetable(draft);
    expect(analyzeDraft(review.draft).errors).toEqual([]);
    expect((await store.saveTimetable(review, confirm(review))).committed).toBe(
      true,
    );
    expect(await store.courses.list()).toHaveLength(8);
    expect(await store.scheduleSessions.list()).toHaveLength(16);
    expect(await store.courses.get(initial.draft.courses[0].id!)).toBeDefined();
  });
  it("v3 migration preserves v2 metadata and Blob content without inventing activities", async () => {
    const legacy = new Dexie(db.name);
    legacy.version(1).stores(SCHEMA_V1);
    legacy.version(2).stores(SCHEMA_V1);
    const meta = { createdAt: 10, updatedAt: 20, deletedAt: null, revision: 2 };
    const termId = crypto.randomUUID(),
      courseId = crypto.randomUUID(),
      materialId = crypto.randomUUID(),
      fileId = crypto.randomUUID();
    await legacy.table("academicTerms").add({
      ...meta,
      id: termId,
      name: "Legacy",
      academicYear: "2030/2031",
      semester: 1,
    });
    await legacy.table("courses").add({
      ...meta,
      id: courseId,
      academicTermId: termId,
      code: "OLD",
      name: "Legacy course",
      registeredHours: 1,
    });
    await legacy
      .table("materials")
      .add({ ...meta, id: materialId, courseId, title: "Legacy resource" });
    await legacy.table("materialFiles").add({
      ...meta,
      id: fileId,
      materialId,
      fileName: "bytes",
      fileSize: 6,
      mimeType: "",
      blob: new Blob(["legacy"]),
    });
    legacy.close();
    await store.open();
    expect(db.verno).toBe(3);
    expect((await store.courses.get(courseId))?.activityType).toBeUndefined();
    expect(await store.materialFiles.get(fileId)).toMatchObject({
      ...meta,
      id: fileId,
    });
    expect(await (await store.materialFiles.get(fileId))?.blob.text()).toBe(
      "legacy",
    );
    expect(await db.table("importMappings").count()).toBe(0);
  });
});
