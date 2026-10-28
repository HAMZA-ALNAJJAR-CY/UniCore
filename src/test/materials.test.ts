// @vitest-environment node
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import { MAX_FILE_BYTES } from "../features/lectures/files";

let db: UniCoreDatabase, store: AcademicStore, termId: string, courseId: string;
const file = (fileName = "notes.txt", bytes: BlobPart = "synthetic bytes", type = "text/plain"): { id: string; fileName: string; blob: Blob } => ({ id: crypto.randomUUID(), fileName, blob: new Blob([bytes], { type }) });
const candidate = (files: ReturnType<typeof file>[] = []) => ({ termId, id: crypto.randomUUID(), values: { courseId, title: "Synthetic resource", category: "Notes", description: "Local plain text" }, files });
async function snapshot() {
  return Promise.all(db.tables.map(async table => ({ name: table.name, records: await Promise.all((await table.toArray()).map(async row => ({ ...row, ...(row.blob ? { blob: Array.from(new Uint8Array(await row.blob.arrayBuffer())) } : {}) }))) })));
}
beforeEach(async () => {
  db = new UniCoreDatabase("materials-" + crypto.randomUUID()); store = new AcademicStore(db);
  termId = (await store.academicTerms.create({ name: "Synthetic term", academicYear: "2033/2034", semester: 1 })).id;
  courseId = (await store.courses.create({ academicTermId: termId, code: "SYN-1", name: "Synthetic course", registeredHours: 2 })).id;
});
afterEach(async () => { vi.restoreAllMocks(); store.close(); await db.delete(); });

describe("transactional local material library", () => {
  it("creates without files, edits with expected revision and leaves every unrelated record untouched", async () => {
    const lecture = await store.lectures.create({ courseId, date: "2033-04-05", notes: "Retain exact lecture" });
    const before = await snapshot(); const input = candidate();
    const saved = await store.saveMaterial(input);
    expect(saved).toMatchObject({ id: input.id, ...input.values, revision: 1 });
    const edited = await store.saveMaterial({ ...input, expectedRevision: 1, values: { ...input.values, title: "Edited title" } });
    expect(edited).toMatchObject({ id: input.id, revision: 2, title: "Edited title" });
    expect(await store.lectures.get(lecture.id)).toEqual(lecture);
    expect((await snapshot()).filter(row => !["materials", "materialFiles"].includes(row.name))).toEqual(before.filter(row => !["materials", "materialFiles"].includes(row.name)));
  });
  it("isolates terms and deleted courses, without reading any file store for library listing", async () => {
    const first = candidate(); await store.saveMaterial(first);
    const otherTerm = await store.academicTerms.create({ name: "Other synthetic term", academicYear: "2034/2035", semester: 1 });
    const otherCourse = await store.courses.create({ academicTermId: otherTerm.id, code: "SYN-2", name: "Other course", registeredHours: 1 });
    const second = { ...candidate(), termId: otherTerm.id, values: { ...first.values, courseId: otherCourse.id } }; await store.saveMaterial(second);
    const materialRead = vi.spyOn(db.records("materialFiles"), "where"); const lectureRead = vi.spyOn(db.records("lectureFiles"), "toArray");
    expect((await store.getMaterialLibrary(termId)).materials.map(row => row.id)).toEqual([first.id]);
    expect((await store.getMaterialLibrary(otherTerm.id)).materials.map(row => row.id)).toEqual([second.id]);
    expect(materialRead).not.toHaveBeenCalled(); expect(lectureRead).not.toHaveBeenCalled();
    await db.records("courses").update(courseId, { deletedAt: Date.now() });
    expect((await store.getMaterialLibrary(termId)).materials).toEqual([]);
  });
  it("retains duplicate filenames as distinct files and exact bytes after database reopen", async () => {
    const uploads = [file("same.txt", new Uint8Array([0, 1, 128, 255])), file("same.txt", "Different bytes")];
    const input = candidate(uploads); await store.saveMaterial(input);
    store.close(); store = new AcademicStore(new UniCoreDatabase(db.name));
    const details = await store.getMaterialDetails(termId, input.id);
    expect(details.files).toHaveLength(2); expect(details.files.every(row => !("blob" in row))).toBe(true);
    for (const upload of uploads) {
      const saved = await store.getMaterialFile(termId, input.id, upload.id);
      expect(saved.id).toBe(upload.id); expect(saved.fileName).toBe("same.txt");
      expect(await saved.blob.arrayBuffer()).toEqual(await upload.blob.arrayBuffer());
    }
  });
  it.each([
    ["unsafe.html", "text/html"], ["../notes.txt", "text/plain"], ["unsafe.svg", "image/svg+xml"], ["notes.pdf", "text/html"],
    [".constructor", "application/octet-stream"], [".CONSTRUCTOR", ""], [".toString", "application/octet-stream"], [".valueOf", "application/octet-stream"], [".__proto__", "application/octet-stream"],
  ])("rejects invalid name/type %s without any writes", async (name, type) => {
    const before = await snapshot(); await expect(store.saveMaterial(candidate([file(name, "bytes", type)]))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects a mixed valid/inherited-extension batch without changing existing materials or bytes", async () => {
    const original = file("original.pdf", new Uint8Array([0, 128, 255]), "application/pdf");
    const saved = candidate([original]); await store.saveMaterial(saved);
    const before = await snapshot();
    await expect(store.saveMaterial(candidate([file(), file(".constructor", "rejected bytes", "application/octet-stream")]))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await snapshot()).toEqual(before);
    const recovered = await store.getMaterialFile(termId, saved.id, original.id);
    expect(await recovered.blob.arrayBuffer()).toEqual(await original.blob.arrayBuffer());
  });
  it("rejects empty and oversized files without partial writes", async () => {
    const large = file(); vi.spyOn(large.blob, "size", "get").mockReturnValue(MAX_FILE_BYTES + 1);
    const before = await snapshot();
    for (const upload of [file("empty.txt", ""), large]) await expect(store.saveMaterial(candidate([upload]))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects duplicate file IDs including UUID letter case and preserves existing Blobs", async () => {
    const upload = file(), input = candidate([upload]); await store.saveMaterial(input); const before = await snapshot();
    await expect(store.saveMaterial({ ...candidate(), files: [{ ...upload, id: upload.id.toUpperCase(), blob: new Blob(["overwrite"]) }] })).rejects.toMatchObject({ code: "CONFLICT" });
    const next = file(); await expect(store.saveMaterial(candidate([next, { ...next, id: next.id.toUpperCase() }]))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects stale edits atomically including candidate files", async () => {
    const input = candidate([file()]); const saved = await store.saveMaterial(input);
    await store.materials.update(saved.id, { title: "Other editor" }, saved.revision); const before = await snapshot();
    await expect(store.saveMaterial({ ...input, expectedRevision: saved.revision, files: [file()] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await snapshot()).toEqual(before);
  });
  it("serializes repeated stable-ID submissions without duplicate materials or files", async () => {
    const input = candidate([file()]);
    const results = await Promise.allSettled([store.saveMaterial(input), store.saveMaterial(input)]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    expect(await store.materials.list()).toHaveLength(1); expect(await store.materialFiles.list()).toHaveLength(1);
  });
  it("rolls back the material and earlier file when a later file write fails", async () => {
    const before = await snapshot();
    const original = db.records("materialFiles").add.bind(db.records("materialFiles")); let calls = 0;
    vi.spyOn(db.records("materialFiles"), "add").mockImplementation((...args) => { if (++calls === 2) throw new DOMException("Synthetic quota", "QuotaExceededError"); return original(...args); });
    await expect(store.saveMaterial(candidate([file(), file()]))).rejects.toMatchObject({ code: "QUOTA" });
    expect(calls).toBe(2); expect(await snapshot()).toEqual(before);
  });
  it("validates full parent chain, rejects cross-term reads/writes and never reparents", async () => {
    const input = candidate([file()]); const saved = await store.saveMaterial(input);
    const otherTerm = await store.academicTerms.create({ name: "Another", academicYear: "2034/2035", semester: 1 });
    const otherCourse = await store.courses.create({ academicTermId: termId, code: "SYN-3", name: "Another course", registeredHours: 1 });
    const before = await snapshot();
    await expect(store.saveMaterial({ ...candidate(), termId: otherTerm.id })).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(store.getMaterialDetails(otherTerm.id, saved.id)).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(store.saveMaterial({ ...input, expectedRevision: 1, values: { ...input.values, courseId: otherCourse.id }, files: [] })).rejects.toMatchObject({ code: "RELATIONSHIP" });
    await expect(store.saveMaterial({ ...candidate(), values: { ...input.values, courseId: crypto.randomUUID() } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await snapshot()).toEqual(before);
  });
  it.each(["courses", "academicTerms"] as const)("rejects deleted %s for details, download, save and removal", async kind => {
    const upload = file(), input = candidate([upload]); await store.saveMaterial(input);
    await db.records(kind).update(kind === "courses" ? courseId : termId, { deletedAt: Date.now() }); const before = await snapshot();
    await expect(store.getMaterialDetails(termId, input.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.getMaterialFile(termId, input.id, upload.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.saveMaterial({ ...input, expectedRevision: 1, files: [] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.removeMaterialFile(termId, input.id, upload.id, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(store.removeMaterial(termId, input.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await snapshot()).toEqual(before);
  });
  it("rejects wrong file parent and stale deletion snapshots; explicit removal retains tombstones and bytes", async () => {
    const upload = file(), input = candidate([upload]); const saved = await store.saveMaterial(input);
    const other = await store.saveMaterial(candidate()); const before = await snapshot();
    await expect(store.getMaterialFile(termId, other.id, upload.id)).rejects.toMatchObject({ code: "RELATIONSHIP" });
    const graph = await store.previewMaterialRemoval(termId, saved.id);
    expect(await snapshot()).toEqual(before);
    await expect(store.removeMaterial(termId, saved.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: "DEPENDENTS" });
    await store.materialFiles.update(upload.id, { fileName: "renamed.txt" }, 1);
    await expect(store.removeMaterial(termId, saved.id, { expectedRevision: 1, cascade: true, confirmation: graph })).rejects.toMatchObject({ code: "CONFLICT" });
    const confirmed = await store.previewMaterialRemoval(termId, saved.id);
    await store.removeMaterial(termId, saved.id, { expectedRevision: 1, cascade: true, confirmation: confirmed });
    expect(await store.materials.get(saved.id)).toBeUndefined();
    const tombstone = await store.materialFiles.get(upload.id, { includeDeleted: true });
    expect(tombstone?.deletedAt).toBeGreaterThan(0); expect(tombstone?.revision).toBe(3);
    expect(await tombstone?.blob.arrayBuffer()).toEqual(await upload.blob.arrayBuffer());
    await expect(store.saveMaterial({ ...input, files: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    const removed = await snapshot();
    await expect(store.saveMaterial({ ...input, id: other.id, expectedRevision: other.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await snapshot()).toEqual(removed);
    expect(await store.materials.get(other.id)).toEqual(other);
  });
});
