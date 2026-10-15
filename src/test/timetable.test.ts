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
      draft.courses.find((row) => row.code === "SYN104")?.instructor,
    ).toBeNull();
    expect(
      draft.courses.find((row) => row.code === "SYN102")?.instructor,
    ).toBeNull();
    expect(draft.courses.find((row) => row.code === "SYN106")).toMatchObject({
      activityType: "practical",
      registeredHours: 1,
    });
    expect(draft.courses.find((row) => row.code === "SYN105")?.key).not.toBe(
      draft.courses.find((row) => row.code === "SYN106")?.key,
    );
    expect(draft.sessions.filter((row) => row.room === "TEST-R1")).toHaveLength(5);
    expect(
      draft.sessions
        .filter((row) => row.room === "TEST-R1")
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
      college: "كلية تجريبية",
      program: "برنامج تجريبي",
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
    const term = { name: "Existing", academicYear: "2038/2039", semester: 1 };
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
      (await store.courses.list({ code: "SYN104" }))[0].instructor,
    ).toBeNull();
    expect(
      (await store.courses.list({ code: "SYN102" }))[0].instructor,
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
      academicYear: "2038/2039",
      semester: 1,
    });
    const course = await store.courses.create({
      academicTermId: term.id,
      code: "SYN105",
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
    const incoming = sourceDraft();
    incoming.courses.forEach(row => { if (row.code !== course.code) row.identity = "new"; });
    incoming.sessions.forEach((row, index) => { if (index !== 0) row.identity = "new"; });
    const review = await store.reviewTimetable(incoming);
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
      identity: "new",
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

describe("corrective source identity recovery", () => {
  it.each(["courses", "sessions"] as const)("rejects explicitly-new %s with exact candidates in a different source", async kind => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const before = await db.table("importMappings").toArray();
    const incoming = sourceDraft();
    incoming.sourceId = "explicitly-new-synthetic-source";
    incoming[kind][0].identity = "new";
    incoming[kind][0].id = crypto.randomUUID();
    await expect(store.reviewTimetable(incoming)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.courses.list()).toHaveLength(7);
    expect(await store.scheduleSessions.list()).toHaveLength(15);
    expect(await db.table("importMappings").toArray()).toEqual(before);
  });

  it("rejects a new choice on a mapped key or a selected saved UUID, including tombstones", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const mapped = structuredClone(first.draft);
    mapped.sessions[0].identity = "new";
    mapped.sessions[0].id = crypto.randomUUID();
    mapped.sessions[0].startTime = "07:10";
    await expect(store.reviewTimetable(mapped)).rejects.toMatchObject({ code: "CONFLICT" });
    const explicit = structuredClone(first.draft);
    explicit.sourceId = "different-explicit-source";
    explicit.sessions[0].identity = "new";
    explicit.sessions[0].startTime = "07:10";
    await expect(store.reviewTimetable(explicit)).rejects.toMatchObject({ code: "CONFLICT" });
    await store.scheduleSessions.delete(first.draft.sessions[0].id!, { expectedRevision: 1 });
    const deleted = sourceDraft(); deleted.sourceId = "deleted-candidate-source";
    deleted.sessions[0].identity = "new";
    await expect(store.reviewTimetable(deleted)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("preserves aliases for courses and sessions and reopens one deterministic row per UUID", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const originalMappings = await db.table<ImportMapping>("importMappings").toArray();
    const courses = await store.courses.list(), sessions = await store.scheduleSessions.list();
    const alias = structuredClone(first.draft);
    const oldKey = alias.courses[0].key;
    alias.courses[0].key = "synthetic-course-alias";
    alias.sessions.forEach(row => { if (row.courseKey === oldKey) row.courseKey = alias.courses[0].key; });
    alias.sessions[0].key = "synthetic-session-alias";
    alias.sessions[0].unconfirmed.push("room");
    const review = await store.reviewTimetable(alias);
    expect((await store.saveTimetable(review, confirm(review))).committed).toBe(true);
    for (const mapping of originalMappings)
      expect(await db.table("importMappings").get(mapping.key)).toEqual(mapping);
    expect(await db.table("importMappings").count()).toBe(25);
    store.close(); db = new UniCoreDatabase(db.name); store = new AcademicStore(db);
    const reopened = await store.reopenImportSource(alias.sourceId);
    expect(reopened.courses).toHaveLength(7);
    expect(reopened.sessions).toHaveLength(15);
    expect(reopened.courses.find(row => row.id === alias.courses[0].id)?.key).toBe(oldKey);
    expect(reopened.sessions.find(row => row.id === alias.sessions[0].id)?.unconfirmed).toContain("room");
    const again = await store.reviewTimetable(reopened);
    expect((await store.saveTimetable(again, confirm(again))).created).toEqual([]);
    // Old alias keys also remain usable; one key cannot switch to another UUID.
    const conflict = structuredClone(alias);
    conflict.courses[0].id = alias.courses[1].id;
    await expect(store.reviewTimetable(conflict)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.courses.list()).toEqual(courses);
    expect(await store.scheduleSessions.list()).toEqual(sessions);
    expect(await db.table("importMappings").count()).toBe(25);
  });

  it("reopens mappings across connections and reviews edited session times without replacing history or Blobs", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const original = first.draft.sessions[0];
    const edited = await store.scheduleSessions.update(original.id!, { startTime: "07:30" }, 1);
    const lecture = await store.lectures.create({ courseId: edited.courseId, scheduleSessionId: edited.id, date: "2038-10-10" });
    const bytes = new Blob(["synthetic lecture bytes"]);
    const file = await store.lectureFiles.create({ lectureId: lecture.id, fileName: "synthetic.txt", blob: bytes });
    const material = await store.materials.create({ courseId: edited.courseId, title: "Synthetic material" });
    const materialFile = await store.materialFiles.create({ materialId: material.id, fileName: "resource.txt", blob: bytes });
    const mappings = await db.table("importMappings").toArray();
    store.close();
    db = new UniCoreDatabase(db.name);
    store = new AcademicStore(db);
    expect(await store.listImportSources()).toEqual([{ sourceId: first.draft.sourceId, termName: first.draft.term.name }]);
    const resumed = await store.reopenImportSource(first.draft.sourceId);
    expect(resumed.courses.map(row => row.id).sort()).toEqual(first.draft.courses.map(row => row.id).sort());
    const row = resumed.sessions.find(row => row.id === original.id)!;
    expect(row.key).toBe(original.key);
    expect(row.startTime).toBe("07:30");
    row.startTime = original.startTime;
    const review = await store.reviewTimetable(resumed);
    expect(review.differences.some(diff => diff.key === `scheduleSessions:${original.key}` && diff.fields.some(field => field.incoming === original.startTime && field.existing === "07:30"))).toBe(true);
    expect((await store.saveTimetable(review, { confirmed: true, keepExistingKeys: [] })).committed).toBe(false);
    expect((await store.saveTimetable(review, confirm(review))).created).toEqual([]);
    expect(await store.scheduleSessions.get(edited.id)).toEqual(edited);
    expect(await store.scheduleSessions.list()).toHaveLength(15);
    expect(await db.table("importMappings").toArray()).toEqual(mappings);
    expect(await (await store.lectureFiles.get(file.id))!.blob.text()).toBe(await bytes.text());
    expect(await (await store.materialFiles.get(materialFile.id))!.blob.text()).toBe(await bytes.text());
    expect(await store.lectures.get(lecture.id)).toEqual(lecture);
  });

  it("rejects lost row identity until an existing identity or separate new row is explicitly selected", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const saved = first.draft.sessions[0];
    await store.scheduleSessions.update(saved.id!, { startTime: "07:30" }, 1);
    const incoming = sourceDraft();
    incoming.sourceId = "explicit-different-source";
    incoming.sessions[0].key = "unrecognized-key";
    incoming.sessions[0].id = crypto.randomUUID(); // A minted UUID is not a user resolution.
    await expect(store.reviewTimetable(incoming)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await store.scheduleSessions.list()).toHaveLength(15);
    incoming.sessions[0].id = saved.id;
    const resolved = await store.reviewTimetable(incoming);
    expect(resolved.differences.some(row => row.key === "scheduleSessions:unrecognized-key")).toBe(true);
    incoming.sessions[0].id = undefined;
    incoming.sessions[0].identity = "new";
    const separate = await store.reviewTimetable(incoming);
    expect(separate.draft.sessions[0].id).not.toBe(saved.id);
    expect((await store.saveTimetable(separate, confirm(separate))).committed).toBe(true);
    expect(await store.scheduleSessions.list()).toHaveLength(16);
    expect(await store.scheduleSessions.get(separate.draft.sessions[0].id!)).not.toHaveProperty("identity");
  });

  it("keeps tombstoned and partial sources discoverable but refuses to reconstruct or resurrect them", async () => {
    const first = await store.reviewTimetable(sourceDraft());
    await store.saveTimetable(first, confirm(first));
    const id = first.draft.sessions[0].id!;
    await store.scheduleSessions.delete(id, { expectedRevision: 1 });
    expect(await store.listImportSources()).toHaveLength(1);
    await expect(store.reopenImportSource(first.draft.sourceId)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await store.scheduleSessions.get(id, { includeDeleted: true }))?.deletedAt).not.toBeNull();
    await db.table("importMappings").add({ key: "partial", sourceId: "partial", entity: "courses", sourceKey: "missing", recordId: crypto.randomUUID(), unconfirmed: [], createdAt: 1 });
    expect(await store.listImportSources()).toHaveLength(2);
    await expect(store.reopenImportSource("partial")).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
