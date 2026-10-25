// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import { sourceDraft } from "./fixtures/timetable";
import { restorationText as t } from "../i18n/restoration";

let db: UniCoreDatabase, store: AcademicStore;
beforeEach(() => {
  db = new UniCoreDatabase(`restore-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
});
afterEach(async () => { vi.restoreAllMocks(); store.close(); await db.delete(); });

async function removedFixture() {
  const term = await store.academicTerms.create({ name: "Synthetic term", academicYear: "2038/2039", semester: 1 });
  const course = await store.courses.create({ academicTermId: term.id, name: "Synthetic course", code: "SYN-RESTORE", registeredHours: 3 });
  const input = { academicTermId: term.id, courseId: course.id, dayOfWeek: 1, startTime: "09:00", endTime: "10:00", deliveryMode: "in-person" as const };
  const independent = await store.scheduleSessions.create({ ...input, dayOfWeek: 2 });
  await store.scheduleSessions.delete(independent.id, { expectedRevision: independent.revision });
  const session = await store.scheduleSessions.create(input);
  await store.deleteManagedCourse(course.id, course.revision, await store.courses.previewDelete(course.id));
  return { term, course, independent, session };
}
const allRecords = () => Promise.all(db.tables.map(table => table.toArray()));

it("discovers and explicitly restores the original course while every removed session remains removed", async () => {
  const term = await store.academicTerms.create({ name: "Synthetic term", academicYear: "2038/2039", semester: 1 });
  const course = await store.courses.create({ academicTermId: term.id, name: "Synthetic course", code: "SYN-RESTORE", registeredHours: 3 });
  const session = await store.scheduleSessions.create({ academicTermId: term.id, courseId: course.id, dayOfWeek: 1, startTime: "09:00", endTime: "10:00", deliveryMode: "in-person" });
  await store.deleteManagedCourse(course.id, course.revision, await store.courses.previewDelete(course.id));
  await expect(store.courses.create({ academicTermId: term.id, name: "Duplicate", code: course.code, registeredHours: 3 })).rejects.toMatchObject({ code: "DUPLICATE" });
  const removed = await store.getRemovedCourses(term.id);
  expect(removed.courses.map(row => row.id)).toEqual([course.id]);
  expect(removed.term).toEqual(term);
  const preview = await store.previewCourseRestore(course.id);
  expect(preview.sessionsRemainingDeleted).toEqual([await store.scheduleSessions.get(session.id, { includeDeleted: true })]);
  const restored = await store.restoreCourse(course.id, preview.course.revision, preview.snapshot);
  expect(restored).toMatchObject({ id: course.id, code: course.code, academicTermId: term.id, createdAt: course.createdAt, deletedAt: null, revision: 3 });
  expect(restored.updatedAt).toBeGreaterThan(preview.course.updatedAt);
  expect(await store.scheduleSessions.get(session.id)).toBeUndefined();
  expect((await store.getRemovedCourses(term.id)).courses).toEqual([]);
  expect(await store.courses.list()).toEqual([restored]);
});

it("does not infer a deletion batch from equal timestamps or restore independently removed sessions", async () => {
  const { course, session, independent } = await removedFixture();
  const tombstone = (await store.courses.get(course.id, { includeDeleted: true }))!;
  // Equal timestamps can occur in distinct operations, so equality is not provenance.
  await db.records("scheduleSessions").update(independent.id, { deletedAt: tombstone.deletedAt });
  const before = await store.scheduleSessions.list({}, { includeDeleted: true });
  const preview = await store.previewCourseRestore(course.id.toUpperCase());
  expect(preview.sessionsRemainingDeleted.map(row => row.id).sort()).toEqual([session.id, independent.id].sort());
  await store.restoreCourse(course.id.toUpperCase(), preview.course.revision, preview.snapshot);
  expect(await store.scheduleSessions.list({}, { includeDeleted: true })).toEqual(before);
  expect(await store.scheduleSessions.list()).toEqual([]);
});

it("rejects double restoration and serializes competing connections so at most one succeeds", async () => {
  const { course } = await removedFixture();
  const preview = await store.previewCourseRestore(course.id);
  const otherDb = new UniCoreDatabase(db.name), other = new AcademicStore(otherDb);
  try {
    const outcomes = await Promise.allSettled([
      store.restoreCourse(course.id, preview.course.revision, preview.snapshot),
      other.restoreCourse(course.id, preview.course.revision, preview.snapshot),
    ]);
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(1);
    const failure = outcomes.find(row => row.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toMatchObject({ code: "CONFLICT", message: t.alreadyActive });
    await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject({ code: "CONFLICT", message: t.alreadyActive });
    expect(await store.courses.list()).toHaveLength(1);
  } finally { other.close(); }
});

it.each(["revision", "course", "term", "session", "new session"] as const)("rejects a stale %s confirmation without changing any records", async change => {
  const { course, term, session } = await removedFixture();
  const preview = await store.previewCourseRestore(course.id);
  let expectedRevision = preview.course.revision;
  if (change === "revision") expectedRevision--;
  if (change === "course") await db.records("courses").update(course.id, { description: "Changed after preview" });
  if (change === "term") await store.academicTerms.update(term.id, { name: "Changed term" }, term.revision);
  if (change === "session") await db.records("scheduleSessions").update(session.id, { room: "Changed after preview" });
  if (change === "new session") {
    const original = (await db.records("scheduleSessions").get(session.id))!;
    await db.records("scheduleSessions").add({ ...original, id: crypto.randomUUID() });
  }
  const before = await allRecords();
  await expect(store.restoreCourse(course.id, expectedRevision, preview.snapshot)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await allRecords()).toEqual(before);
});

it.each(["missing", "deleted"] as const)("rejects a %s parent term at preview and commit", async kind => {
  const { course, term } = await removedFixture();
  const preview = await store.previewCourseRestore(course.id);
  if (kind === "missing") await db.records("academicTerms").delete(term.id);
  else await store.academicTerms.delete(term.id, { expectedRevision: term.revision });
  const before = await allRecords();
  const expected = { code: "NOT_FOUND", message: kind === "missing" ? t.missingTerm : t.deletedTerm };
  await expect(store.previewCourseRestore(course.id)).rejects.toMatchObject(expected);
  await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject(expected);
  expect(await allRecords()).toEqual(before);
});

it("distinguishes a missing course from a missing term", async () => {
  await expect(store.previewCourseRestore(crypto.randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND", message: t.missingCourse });
});

it.each([
  { name: "name", patch: { name: "" } },
  { name: "code", patch: { code: " lower-case " } },
  { name: "hours", patch: { registeredHours: -1 } },
  { name: "term reference", patch: { academicTermId: "invalid" } },
  { name: "timestamp", patch: { deletedAt: 0 } },
  { name: "revision", patch: { revision: NaN } },
])("rejects a corrupt persisted course $name without repair", async ({ patch }) => {
  const { course } = await removedFixture();
  const preview = await store.previewCourseRestore(course.id);
  await db.table("courses").update(course.id, patch);
  const before = await allRecords();
  await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await allRecords()).toEqual(before);
});

it("rejects a malformed primary identity without allocating or repairing a UUID", async () => {
  const { course } = await removedFixture();
  const original = await db.records("courses").get(course.id);
  await db.records("courses").delete(course.id);
  await db.table("courses").put({ ...original, id: "invalid" });
  const before = await allRecords();
  await expect(store.previewCourseRestore("invalid")).rejects.toMatchObject({ code: "VALIDATION" });
  await expect(store.getRemovedCourses(course.academicTermId)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await allRecords()).toEqual(before);
});

it.each(["active", "cross-term", "corrupt"] as const)("blocks an unsafe %s dependent session without restoring any part of the graph", async kind => {
  const { course, session } = await removedFixture();
  const preview = await store.previewCourseRestore(course.id);
  await db.records("scheduleSessions").update(session.id, kind === "active" ? { deletedAt: null } : kind === "cross-term" ? { academicTermId: crypto.randomUUID() } : { dayOfWeek: 99 });
  const before = await allRecords();
  await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject({ code: "RELATIONSHIP", message: t.invalidSessions });
  expect(await allRecords()).toEqual(before);
});

it("rolls back a write that fails after putting the restored course", async () => {
  const { course } = await removedFixture(), preview = await store.previewCourseRestore(course.id);
  const before = await allRecords(), table = db.records("courses"), put = table.put.bind(table);
  const write = vi.spyOn(table, "put").mockImplementationOnce(record => put(record).then(() => {
    throw new DOMException("Synthetic full storage", "QuotaExceededError");
  }));
  await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject({ code: "QUOTA" });
  expect(write).toHaveBeenCalledOnce();
  write.mockRestore();
  expect(await allRecords()).toEqual(before);
});

it("rejects an update timestamp that cannot advance without becoming invalid", async () => {
  const { course } = await removedFixture();
  await db.records("courses").update(course.id, { updatedAt: 8_640_000_000_000_000 });
  const preview = await store.previewCourseRestore(course.id), before = await allRecords();
  await expect(store.restoreCourse(course.id, preview.course.revision, preview.snapshot)).rejects.toMatchObject({ code: "VALIDATION" });
  expect(await allRecords()).toEqual(before);
});

it("preserves import aliases and F-02 recovery across repeated remove/restore cycles without resurrecting sessions", async () => {
  const review = await store.reviewTimetable(sourceDraft());
  expect((await store.saveTimetable(review, { confirmed: true, keepExistingKeys: [] })).committed).toBe(true);
  const course = review.draft.courses[0], removedSessions = review.draft.sessions.filter(row => row.courseKey === course.key);
  const mapping = (await db.table("importMappings").toArray()).find(row => row.recordId === course.id)!;
  const sourceKey = "another-course-alias";
  await db.table("importMappings").add({ ...mapping, key: JSON.stringify([mapping.sourceId, mapping.entity, sourceKey]), sourceKey });
  const mappings = await db.table("importMappings").toArray();
  expect((await store.reopenImportSource(review.draft.sourceId)).courses.some(row => row.id === course.id)).toBe(true);
  for (let cycle = 0; cycle < 2; cycle++) {
    const active = (await store.courses.get(course.id!))!;
    await store.deleteManagedCourse(active.id, active.revision, await store.courses.previewDelete(active.id));
    const removed = await store.reopenImportSource(review.draft.sourceId);
    expect(removed.courses.some(row => row.id === active.id)).toBe(false);
    expect(removed.omittedDeletedRows?.some(row => row.id === active.id)).toBe(true);
    await expect(store.reviewTimetable(review.draft)).rejects.toMatchObject({ code: "CONFLICT" });
    const preview = await store.previewCourseRestore(active.id);
    await store.restoreCourse(active.id, preview.course.revision, preview.snapshot);
    const reopened = await store.reopenImportSource(review.draft.sourceId);
    expect(reopened.courses.filter(row => row.id === active.id)).toHaveLength(1);
    expect(reopened.omittedDeletedRows?.map(row => row.id).sort()).toEqual(removedSessions.map(row => row.id).sort());
    const again = await store.reviewTimetable(reopened);
    expect((await store.saveTimetable(again, { confirmed: true, keepExistingKeys: [] })).committed).toBe(true);
    await expect(store.reviewTimetable(review.draft)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.table("importMappings").toArray()).toEqual(mappings);
    expect(await store.courses.list({}, { includeDeleted: true })).toHaveLength(7);
    expect(await store.scheduleSessions.list({}, { includeDeleted: true })).toHaveLength(15);
  }
});

it("preserves historical lectures, materials, attachment identities and exact Blob bytes after explicit generic cascade history", async () => {
  const { course, session, term } = await removedFixture();
  // Reactivate only through the explicit course-only API, then add actual academic history.
  const preview = await store.previewCourseRestore(course.id);
  await store.restoreCourse(course.id, preview.course.revision, preview.snapshot);
  const historicalSession = await store.scheduleSessions.create({ academicTermId: term.id, courseId: course.id, dayOfWeek: 5, startTime: "14:00", endTime: "15:00", deliveryMode: "online" });
  const lecture = await store.lectures.create({ courseId: course.id, scheduleSessionId: historicalSession.id, date: "2038-10-10" });
  const material = await store.materials.create({ courseId: course.id, title: "Synthetic material" });
  const file = await store.lectureFiles.create({ lectureId: lecture.id, fileName: "lecture.txt", blob: new Blob(["lecture bytes"]) });
  const resource = await store.materialFiles.create({ materialId: material.id, fileName: "material.txt", blob: new Blob(["material bytes"]) });
  const other = await store.courses.create({ academicTermId: term.id, name: "Other", code: "OTHER", registeredHours: 1 });
  const current = (await store.courses.get(course.id))!;
  await expect(store.deleteManagedCourse(course.id, current.revision, await store.courses.previewDelete(course.id))).rejects.toMatchObject({ code: "DEPENDENTS" });
  await store.courses.delete(course.id, { expectedRevision: current.revision, cascade: true, confirmation: await store.courses.previewDelete(course.id) });
  const history = await allRecords();
  const confirmed = await store.previewCourseRestore(course.id);
  await store.restoreCourse(course.id, confirmed.course.revision, confirmed.snapshot);
  for (let i = 0; i < db.tables.length; i++) {
    if (db.tables[i].name !== "courses") expect(await db.tables[i].toArray()).toEqual(history[i]);
  }
  expect(await store.courses.get(other.id)).toEqual(other);
  expect(await store.scheduleSessions.get(session.id)).toBeUndefined();
  expect((await store.lectures.get(lecture.id, { includeDeleted: true }))?.deletedAt).not.toBeNull();
  expect((await store.lectures.get(lecture.id, { includeDeleted: true }))?.scheduleSessionId).toBe(historicalSession.id);
  expect(await (await store.lectureFiles.get(file.id, { includeDeleted: true }))!.blob.text()).toBe("lecture bytes");
  expect(await (await store.materialFiles.get(resource.id, { includeDeleted: true }))!.blob.text()).toBe("material bytes");
  expect(await store.lectures.list()).toEqual([]);
  expect(await store.materials.list()).toEqual([]);
});
