// @vitest-environment node
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import {
  FILE_ACCEPT,
  MAX_FILE_BYTES,
  fileProblem,
} from "../features/lectures/files";
let db: UniCoreDatabase,
  store: AcademicStore,
  courseId: string,
  lectureId: string;
const input = (
  name = "notes.txt",
  value = "original bytes",
  type = "text/plain",
) => ({
  id: crypto.randomUUID(),
  fileName: name,
  blob: new Blob([value], { type }),
});
beforeEach(async () => {
  db = new UniCoreDatabase("attachments-" + crypto.randomUUID());
  store = new AcademicStore(db);
  const term = await store.academicTerms.create({
    name: "Generic term",
    academicYear: "2030/2031",
    semester: 1,
  });
  const course = await store.courses.create({
    academicTermId: term.id,
    code: "GENERIC",
    name: "Generic course",
    registeredHours: 1,
  });
  courseId = course.id;
  lectureId = (await store.lectures.create({ courseId, date: "2030-10-15" }))
    .id;
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  await db.delete();
});
describe("lecture attachment storage", () => {
  it("creates only explicit lectures with valid parent references and session relationships", async () => {
    expect((await store.getLectureWorkspace()).lectures).toHaveLength(1);
    await expect(
      store.lectures.create({
        courseId: crypto.randomUUID(),
        date: "2030-10-15",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const session = await store.scheduleSessions.create({
      courseId,
      academicTermId: (await store.courses.get(courseId))!.academicTermId,
      dayOfWeek: 2,
      startTime: "09:00",
      endTime: "10:00",
      deliveryMode: "online",
    });
    const lecture = await store.lectures.create({
      courseId,
      date: "2030-10-15",
      scheduleSessionId: session.id,
    });
    expect(lecture.scheduleSessionId).toBe(session.id);
    await expect(
      store.lectures.create({ courseId, date: "2030-02-30" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
  it("persists multiple original Blobs and metadata through close/reopen, retrieving exact download bytes", async () => {
    const files = [
      input(),
      input("image.png", "image bytes", "image/png"),
      input("recording.mp3", "audio bytes", "audio/mpeg"),
    ];
    expect(
      (await store.attachLectureFiles(lectureId, files)).map(
        (row) => row.status,
      ),
    ).toEqual(["saved", "saved", "saved"]);
    store.close();
    store = new AcademicStore(new UniCoreDatabase(db.name));
    const workspace = await store.getLectureWorkspace(lectureId);
    expect(workspace.files).toHaveLength(3);
    expect(workspace.files[0]).not.toHaveProperty("blob");
    for (const original of files) {
      const saved = (await store.lectureFiles.get(original.id))!;
      expect(await saved.blob.arrayBuffer()).toEqual(
        await original.blob.arrayBuffer(),
      );
      expect(saved.fileSize).toBe(original.blob.size);
      expect(saved.mimeType).toBe(original.blob.type);
      expect(saved.createdAt).toBeGreaterThan(0);
    }
  });
  it("retains successes and reports validation/quota failures independently, allowing stable-ID retries", async () => {
    const files = [
      input("first.txt"),
      input("failure.txt"),
      input("script.html", "<script>bad</script>", "text/html"),
    ];
    const table = db.records("lectureFiles"),
      add = table.add.bind(table);
    vi.spyOn(table, "add").mockImplementation((record) =>
      record.fileName === "failure.txt"
        ? Dexie.Promise.reject(new DOMException("Full", "QuotaExceededError"))
        : add(record),
    );
    const result = await store.attachLectureFiles(lectureId, files);
    expect(result).toMatchObject([
      { status: "saved" },
      { status: "failed", code: "QUOTA" },
      { status: "failed", problem: "unsupported" },
    ]);
    expect(await store.lectureFiles.list({ lectureId })).toHaveLength(1);
    vi.restoreAllMocks();
    expect(
      (await store.attachLectureFiles(lectureId, files.slice(0, 2))).map(
        (row) => row.status,
      ),
    ).toEqual(["skipped", "saved"]);
    expect(await store.lectureFiles.list({ lectureId })).toHaveLength(2);
  });
  it("does not overwrite existing bytes for repeated identities or resurrect removed files", async () => {
    const file = input();
    await store.attachLectureFiles(lectureId, [file]);
    expect(
      (
        await store.attachLectureFiles(lectureId, [
          { ...file, blob: new Blob(["changed"]) },
        ])
      )[0].status,
    ).toBe("skipped");
    expect(await (await store.lectureFiles.get(file.id))?.blob.text()).toBe(
      "original bytes",
    );
    const saved = (await store.lectureFiles.get(file.id))!;
    await store.lectureFiles.delete(file.id, {
      expectedRevision: saved.revision,
    });
    expect(
      (await store.attachLectureFiles(lectureId, [file]))[0],
    ).toMatchObject({ status: "failed", code: "CONFLICT" });
  });
  it("prevents orphan writes and mismatched upload identities", async () => {
    expect(
      (await store.attachLectureFiles(crypto.randomUUID(), [input()]))[0],
    ).toMatchObject({ status: "failed", code: "NOT_FOUND" });
    const file = input();
    await store.attachLectureFiles(lectureId, [file]);
    const other = await store.lectures.create({ courseId, date: "2030-10-16" });
    expect((await store.attachLectureFiles(other.id, [file]))[0]).toMatchObject(
      { status: "failed", code: "CONFLICT" },
    );
    expect(await store.lectureFiles.list()).toHaveLength(1);
  });
  it("protects lecture removal and soft-deletes individual files without losing unrelated attachments", async () => {
    const files = [input("one.txt"), input("two.txt")];
    await store.attachLectureFiles(lectureId, files);
    const lecture = (await store.lectures.get(lectureId))!;
    await expect(
      store.lectures.delete(lectureId, { expectedRevision: lecture.revision }),
    ).rejects.toMatchObject({ code: "DEPENDENTS" });
    await store.lectureFiles.delete(files[0].id, { expectedRevision: 1 });
    expect(await store.lectureFiles.list({ lectureId })).toHaveLength(1);
    expect(
      await (
        await store.lectureFiles.get(files[0].id, { includeDeleted: true })
      )?.blob.text(),
    ).toBe("original bytes");
    await store.lectureFiles.delete(files[1].id, { expectedRevision: 1 });
    await store.lectures.delete(lectureId, {
      expectedRevision: lecture.revision,
    });
    expect(await store.lectures.get(lectureId)).toBeUndefined();
    expect(await store.courses.get(courseId)).toBeDefined();
  });
});
describe("file acceptance policy", () => {
  it.each([
    ["lecture.MP3", "audio/mpeg"],
    ["record.wav", "audio/x-wav"],
    ["clip.m4a", "audio/mp4"],
    ["a.aac", "audio/aac"],
    ["a.ogg", "audio/ogg"],
    ["v.mp4", "video/mp4"],
    ["v.webm", "video/webm"],
    ["v.mov", "video/quicktime"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.png", "image/png"],
    ["a.webp", "image/webp"],
    ["d.pdf", "application/pdf"],
    ["d.doc", "application/msword"],
    [
      "d.docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    ["d.ppt", "application/vnd.ms-powerpoint"],
    [
      "d.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["d.xls", "application/vnd.ms-excel"],
    [
      "d.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    ["d.txt", "text/plain"],
  ])("accepts %s with %s", (name, type) =>
    expect(fileProblem(name, new Blob(["data"], { type }))).toBeUndefined(),
  );
  it("rejects unsupported, mismatched, empty and oversize files and allows missing MIME only for known extensions", () => {
    expect(fileProblem("run.exe", new Blob(["x"]))).toBe("unsupported");
    expect(
      fileProblem("image.svg", new Blob(["x"], { type: "image/svg+xml" })),
    ).toBe("unsupported");
    expect(fileProblem("a.jpg", new Blob(["x"], { type: "text/html" }))).toBe(
      "mime",
    );
    expect(fileProblem("a.txt", new Blob())).toBe("empty");
    const blob = new Blob(["x"]);
    Object.defineProperty(blob, "size", { value: MAX_FILE_BYTES + 1 });
    expect(fileProblem("a.txt", blob)).toBe("size");
    expect(fileProblem("a.pdf", new Blob(["x"]))).toBeUndefined();
    expect(FILE_ACCEPT).not.toContain(".html");
    expect(FILE_ACCEPT).not.toContain(".svg");
  });
});
