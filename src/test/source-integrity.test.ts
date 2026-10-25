// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import type { ImportMapping, TimetableReview } from "../data";
import { sourceDraft } from "./fixtures/timetable";
import { introductionText } from "../i18n/introduction";

let db: UniCoreDatabase, store: AcademicStore;
beforeEach(() => {
  db = new UniCoreDatabase(`source-integrity-${crypto.randomUUID()}`);
  store = new AcademicStore(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await db.delete();
});
const confirm = (review: TimetableReview) => ({
  confirmed: true,
  keepExistingKeys: review.differences.map(row => row.key),
});
async function seed() {
  const review = await store.reviewTimetable(sourceDraft());
  expect((await store.saveTimetable(review, confirm(review))).committed).toBe(true);
  return review.draft;
}

async function expectCorruptSourceUnchanged(sourceId: string) {
  const before = await Promise.all(db.tables.map(table => table.toArray()));
  await expect(store.reopenImportSource(sourceId)).rejects.toMatchObject({
    code: "CONFLICT", message: introductionText.brokenSource,
  });
  expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
}

it.each([
  { field: "dayOfWeek", value: 99 },
  { field: "startTime", value: "25:00" },
  { field: "endTime", value: "00:00" },
  { field: "deliveryMode", value: "unsupported" },
])("rejects a tombstoned session with corrupt $field without repairing any records or mappings", async ({ field, value }) => {
  const original = await seed(), removed = original.sessions[0];
  await store.scheduleSessions.delete(removed.id!, { expectedRevision: 1 });
  await db.table("scheduleSessions").update(removed.id!, { [field]: value });
  await expectCorruptSourceUnchanged(original.sourceId);
});

it.each([
  { field: "name", value: "" },
  { field: "code", value: " " },
  { field: "registeredHours", value: -1 },
  { field: "activityType", value: "unsupported" },
])("rejects a tombstoned course with corrupt $field without repairing any records or mappings", async ({ field, value }) => {
  const original = await seed(), removed = original.courses[0];
  await store.deleteManagedCourse(removed.id!, 1, await store.courses.previewDelete(removed.id!));
  await db.table("courses").update(removed.id!, { [field]: value });
  await expectCorruptSourceUnchanged(original.sourceId);
});

it("rejects a tombstoned session with a malformed persisted UUID even when its mapping points to that record", async () => {
  const original = await seed(), removed = original.sessions[0];
  await store.scheduleSessions.delete(removed.id!, { expectedRevision: 1 });
  const tombstone = await db.records("scheduleSessions").get(removed.id!);
  await db.table("scheduleSessions").put({ ...tombstone, id: "not-a-uuid" });
  await db.records("scheduleSessions").delete(removed.id!);
  await db.table<ImportMapping>("importMappings").where("recordId").equals(removed.id!).modify({ recordId: "not-a-uuid" });
  await expectCorruptSourceUnchanged(original.sourceId);
});

it.each([0, -1, NaN, Infinity, -Infinity, 0.5, 8_640_000_000_000_001])(
  "rejects invalid persisted deletion timestamp %s on courses and sessions without any repair writes",
  async deletedAt => {
    const original = await seed(), removed = original.courses[0];
    const session = original.sessions.find(row => row.courseKey === removed.key)!;
    await store.deleteManagedCourse(removed.id!, 1, await store.courses.previewDelete(removed.id!));
    for (const [kind, id] of [["courses", removed.id!], ["scheduleSessions", session.id!]] as const) {
      const tombstone = (await db.table(kind).get(id))!;
      await db.table(kind).update(id, { deletedAt });
      await expectCorruptSourceUnchanged(original.sourceId);
      // Restore only the deliberate test corruption before checking the other store.
      await db.table(kind).put(tombstone);
    }
  },
);

it("reopens and saves the same source repeatedly after managed course removal without changing retained identities or history", async () => {
  const original = await seed(), removed = original.courses[0], kept = original.courses[1];
  const edited = await store.courses.update(kept.id!, { name: "User-edited survivor", code: "USER-KEPT" }, 1);
  const session = original.sessions.find(row => row.courseKey === kept.key)!;
  const lecture = await store.lectures.create({ courseId: kept.id!, scheduleSessionId: session.id, date: "2038-10-10" });
  const lectureFile = await store.lectureFiles.create({ lectureId: lecture.id, fileName: "lecture.txt", blob: new Blob(["lecture bytes"]) });
  const material = await store.materials.create({ courseId: kept.id!, title: "Kept material" });
  const materialFile = await store.materialFiles.create({ materialId: material.id, fileName: "material.txt", blob: new Blob(["material bytes"]) });
  // Alias keys must survive, including aliases of the removed course/session.
  const table = db.table<ImportMapping>("importMappings");
  for (const mapping of await table.toArray()) {
    if (mapping.entity === "academicTerms") continue;
    const sourceKey = `alias-${mapping.sourceKey}`;
    await table.add({ ...mapping, key: JSON.stringify([mapping.sourceId, mapping.entity, sourceKey]), sourceKey, createdAt: mapping.createdAt + 1 });
  }
  const mappings = await table.toArray();
  await store.deleteManagedCourse(removed.id!, 1, await store.courses.previewDelete(removed.id!));
  const courses = await store.courses.list({}, { includeDeleted: true });
  const sessions = await store.scheduleSessions.list({}, { includeDeleted: true });
  const removedSessions = original.sessions.filter(row => row.courseKey === removed.key);
  expect(removedSessions.length).toBeGreaterThan(0);
  for (let cycle = 0; cycle < 2; cycle++) {
    store.close(); db = new UniCoreDatabase(db.name); store = new AcademicStore(db);
    const reopened = await store.reopenImportSource(original.sourceId);
    expect(reopened.courses.map(row => row.id).sort()).toEqual(original.courses.filter(row => row.id !== removed.id).map(row => row.id).sort());
    expect(reopened.sessions.map(row => row.id).sort()).toEqual(original.sessions.filter(row => row.courseKey !== removed.key).map(row => row.id).sort());
    expect(reopened.omittedDeletedRows?.map(row => row.id).sort()).toEqual([removed.id, ...removedSessions.map(row => row.id)].sort());
    expect(reopened.courses.find(row => row.id === kept.id)?.name).toBe(edited.name);
    const review = await store.reviewTimetable(reopened);
    expect(await store.saveTimetable(review, confirm(review))).toMatchObject({ committed: true, created: [], rejected: [] });
  }
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
  expect(await store.courses.list({}, { includeDeleted: true })).toEqual(courses);
  expect(await store.scheduleSessions.list({}, { includeDeleted: true })).toEqual(sessions);
  expect(await store.lectures.get(lecture.id)).toEqual(lecture);
  expect(await store.materials.get(material.id)).toEqual(material);
  expect(await (await store.lectureFiles.get(lectureFile.id))!.blob.text()).toBe("lecture bytes");
  expect(await (await store.materialFiles.get(materialFile.id))!.blob.text()).toBe("material bytes");
  // The original incoming row still cannot resurrect the deleted identity.
  await expect(store.reviewTimetable(original)).rejects.toMatchObject({ code: "CONFLICT" });
});

it("discloses a separately removed session, keeps its parent, and never resurrects the session on save", async () => {
  const original = await seed(), removed = original.sessions[0];
  const mappings = await db.table("importMappings").toArray();
  await store.scheduleSessions.delete(removed.id!, { expectedRevision: 1 });
  const tombstone = await store.scheduleSessions.get(removed.id!, { includeDeleted: true });
  const reopened = await store.reopenImportSource(original.sourceId);
  expect(reopened.courses).toHaveLength(7);
  expect(reopened.sessions).toHaveLength(14);
  expect(reopened.omittedDeletedRows).toEqual([expect.objectContaining({ entity: "scheduleSessions", id: removed.id })]);
  const review = await store.reviewTimetable(reopened);
  expect((await store.saveTimetable(review, confirm(review))).committed).toBe(true);
  expect(await store.scheduleSessions.get(removed.id!, { includeDeleted: true })).toEqual(tombstone);
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
});

it("can reopen an entirely removed course set with an explicit notice, without treating it as a new source", async () => {
  const original = await seed();
  for (const course of original.courses) {
    await store.deleteManagedCourse(course.id!, 1, await store.courses.previewDelete(course.id!));
  }
  const mappings = await db.table("importMappings").toArray();
  const reopened = await store.reopenImportSource(original.sourceId);
  expect(reopened).toMatchObject({ sourceId: original.sourceId, term: original.term, courses: [], sessions: [] });
  expect(reopened.omittedDeletedRows).toHaveLength(22);
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
  expect(await store.courses.list({}, { includeDeleted: true })).toHaveLength(7);
});

it.each([
  "missing course", "missing session", "wrong course term", "wrong session term",
  "missing session parent", "active session under deleted course", "deleted term", "damaged alias", "invalid deletion timestamp",
] as const)("still rejects a source with %s even when other rows were deliberately deleted", async problem => {
  const original = await seed(), removed = original.courses[0];
  await store.deleteManagedCourse(removed.id!, 1, await store.courses.previewDelete(removed.id!));
  const removedSession = original.sessions.find(row => row.courseKey === removed.key)!;
  if (problem === "missing course") await db.records("courses").delete(removed.id!);
  if (problem === "missing session") await db.records("scheduleSessions").delete(removedSession.id!);
  if (problem === "wrong course term") await db.records("courses").update(removed.id!, { academicTermId: crypto.randomUUID() });
  if (problem === "wrong session term") await db.records("scheduleSessions").update(removedSession.id!, { academicTermId: crypto.randomUUID() });
  if (problem === "missing session parent") await db.records("scheduleSessions").update(removedSession.id!, { courseId: crypto.randomUUID() });
  if (problem === "active session under deleted course") await db.records("scheduleSessions").update(removedSession.id!, { deletedAt: null });
  if (problem === "deleted term") await db.records("academicTerms").update(original.term.id!, { deletedAt: Date.now() });
  if (problem === "invalid deletion timestamp") await db.records("courses").update(removed.id!, { deletedAt: NaN });
  if (problem === "damaged alias") {
    await db.table("importMappings").add({ key: "damaged", sourceId: original.sourceId, entity: "courses", sourceKey: "alias", recordId: removed.id, unconfirmed: [], createdAt: 1 });
  }
  const mappings = await db.table("importMappings").toArray();
  const courses = await db.records("courses").toArray();
  const sessions = await db.records("scheduleSessions").toArray();
  await expect(store.reopenImportSource(original.sourceId)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
  expect(await db.records("courses").toArray()).toEqual(courses);
  expect(await db.records("scheduleSessions").toArray()).toEqual(sessions);
});

it.each(["missing tombstone", "broken tombstone relationship", "invalid tombstone field", "invalid tombstone timestamp"] as const)("rolls back all new records and mappings on %s during final source validation", async problem => {
  const original = await seed(), removed = original.courses[0];
  await store.deleteManagedCourse(removed.id!, 1, await store.courses.previewDelete(removed.id!));
  const incoming = await store.reopenImportSource(original.sourceId);
  incoming.courses.push({ ...incoming.courses[0], key: "new-course", id: crypto.randomUUID(), identity: "new", code: "NEW-COURSE" });
  incoming.sessions.push({ ...incoming.sessions[0], key: "new-session", id: crypto.randomUUID(), identity: "new", courseKey: "new-course" });
  const review = await store.reviewTimetable(incoming);
  if (problem === "missing tombstone") await db.records("courses").delete(removed.id!);
  if (problem === "broken tombstone relationship") await db.records("courses").update(removed.id!, { academicTermId: crypto.randomUUID() });
  if (problem === "invalid tombstone field") await db.records("courses").update(removed.id!, { registeredHours: -1 });
  if (problem === "invalid tombstone timestamp") await db.records("courses").update(removed.id!, { deletedAt: 0 });
  const courses = await db.records("courses").toArray(), sessions = await db.records("scheduleSessions").toArray();
  const mappings = await db.table("importMappings").toArray();
  expect((await store.saveTimetable(review, confirm(review))).committed).toBe(false);
  expect(await db.records("courses").toArray()).toEqual(courses);
  expect(await db.records("scheduleSessions").toArray()).toEqual(sessions);
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
});

it("does not turn a storage read failure into successful recovery", async () => {
  const original = await seed();
  vi.spyOn(db.records("courses"), "get").mockRejectedValueOnce(new Error("Synthetic unavailable read"));
  await expect(store.reopenImportSource(original.sourceId)).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
