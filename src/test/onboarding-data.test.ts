// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
let db: UniCoreDatabase, store: AcademicStore;
beforeEach(() => {
  db = new UniCoreDatabase("onboarding-" + crypto.randomUUID());
  store = new AcademicStore(db);
});
afterEach(async () => {
  store.close();
  await db.delete();
});
it("detects a genuinely empty database without creating academic rows", async () => {
  expect(await store.getAcademicPresence()).toEqual({ hasRecords: false });
  expect(await store.academicTerms.list()).toEqual([]);
  expect(await store.courses.list()).toEqual([]);
});
it("treats a partial term and retained tombstone as existing history across reopen", async () => {
  const term = await store.academicTerms.create({
    name: "User term",
    academicYear: "2030/2031",
    semester: 1,
  });
  expect((await store.getAcademicPresence()).hasRecords).toBe(true);
  await store.academicTerms.delete(term.id, { expectedRevision: 1 });
  store.close();
  store = new AcademicStore(new UniCoreDatabase(db.name));
  expect((await store.getAcademicPresence()).hasRecords).toBe(true);
  expect(
    (await store.academicTerms.get(term.id, { includeDeleted: true }))?.id,
  ).toBe(term.id);
});
it("recognizes partial import metadata without guessing the storage is new", async () => {
  await db
    .table("importMappings")
    .add({
      key: "partial",
      sourceId: "source",
      entity: "courses",
      sourceKey: "course",
      recordId: crypto.randomUUID(),
      unconfirmed: [],
      createdAt: 1,
    });
  expect((await store.getAcademicPresence()).hasRecords).toBe(true);
  expect(await db.table("importMappings").count()).toBe(1);
});
