import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { Lectures } from "../pages/Lectures";
import { createAcademicStore, DataError, type Lecture, type LectureFile } from "../data";
import { setLanguage } from "../i18n/locale";
import { mediaPreview } from "../features/lectures/files";

const meta = { createdAt: 1, updatedAt: 1, revision: 1, deletedAt: null };
const course = { ...meta, id: "course-a", academicTermId: "term-a", code: "SYN-A", name: "Synthetic course", registeredHours: 3 };
const lecture: Lecture = { ...meta, id: "lecture-a", courseId: course.id, date: "2032-03-05", notes: "", title: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function fixture() {
  let saved = { ...lecture };
  const update = vi.fn(async (_id: string, patch: Partial<Lecture>, revision: number) => {
    if (revision !== saved.revision) throw new DataError("CONFLICT", "Stale");
    saved = { ...saved, ...patch, revision: saved.revision + 1 };
    return saved;
  });
  const read = vi.fn(async (id?: string) => ({ courses: [course], sessions: [], lectures: [saved, { ...lecture, id: "lecture-b", courseId: "course-b" }], lecture: id ? saved : undefined, files: [] as Omit<LectureFile, "blob">[] }));
  const remove = vi.fn(async () => []);
  const create = vi.fn(async () => saved);
  const get = vi.fn();
  const upload = vi.fn(async () => []);
  const store = { getLectureWorkspace: read, lectures: { create, update, delete: remove }, lectureFiles: { get, delete: remove }, attachLectureFiles: upload } as unknown as ReturnType<typeof createAcademicStore>;
  return { store, create, update, read, remove, get, upload };
}
function view(f: ReturnType<typeof fixture>, path = "/lectures?course=course-a&term=term-a&lecture=lecture-a", history?: { initialEntries: string[]; initialIndex: number }) {
  setLanguage("en");
  const router = createMemoryRouter([{ path: "*", element: <Lectures store={f.store} /> }], history ?? { initialEntries: [path] });
  return { router, ...render(<RouterProvider router={router} />) };
}
afterEach(() => { setLanguage("ar"); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("stable lecture identity during hash navigation", () => {
  const path = "/lectures?course=course-a&term=term-a&lecture=lecture-a";
  it("preserves the exact dirty draft across same-lecture hash navigation without another read or write", async () => {
    const f = fixture(); const { router } = view(f);
    const notes = await screen.findByLabelText("Lecture notes");
    const draft = "123456789012345678901234567890";
    fireEvent.change(notes, { target: { value: draft } });
    const reads = f.read.mock.calls.length;
    await act(async () => { await router.navigate("/lectures?course=course-a&term=term-a&lecture=lecture-a#main-content"); });
    expect(await screen.findByLabelText("Lecture notes")).toHaveValue(draft);
    expect(screen.getByLabelText("Lecture notes")).toBe(notes);
    expect(f.read).toHaveBeenCalledTimes(reads);
    expect(f.update).not.toHaveBeenCalled();
  });
  it("retains a pending save across a hash change and reports success only after the write resolves", async () => {
    const f = fixture(), pending = deferred<Lecture>(); f.update.mockReturnValueOnce(pending.promise);
    const { router } = view(f);
    const draft = "Pending exact draft\nملاحظات تجريبية";
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    try {
      await screen.findByText("Saving…");
      await act(async () => { await router.navigate("/lectures?course=course-a&term=term-a&lecture=lecture-a#focus"); });
      expect(await screen.findByLabelText("Lecture notes")).toHaveValue(draft);
      expect(screen.getByText("Saving…")).toBeInTheDocument();
      expect(screen.queryByText("Notes saved locally.")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled();
      expect(f.update).toHaveBeenCalledOnce();
      await act(async () => { void router.navigate("/lectures?course=course-b&lecture=lecture-b"); });
      expect(screen.getByRole("button", { name: "Discard draft and leave" })).toBeDisabled();
      expect(screen.getByLabelText("Lecture notes")).toHaveValue(draft);
    } finally {
      await act(async () => pending.resolve({ ...lecture, notes: draft, revision: 2 }));
    }
    await screen.findByText("Notes saved locally.");
    expect(screen.getByLabelText("Lecture notes")).toHaveValue(draft);
    expect(router.state.location.hash).toBe("#focus");
    expect(router.state.location.search).toContain("lecture=lecture-a");
  });
  it("preserves language changes and a new history entry for the same lecture", async () => {
    const f = fixture(); const { router } = view(f);
    const notes = await screen.findByLabelText("Lecture notes");
    const draft = "  Exact draft\nملاحظات تجريبية  ";
    fireEvent.change(notes, { target: { value: draft } });
    await act(async () => { await router.navigate(path + "#first"); });
    act(() => setLanguage("ar"));
    expect(screen.getByLabelText("ملاحظات المحاضرة")).toBe(notes);
    expect(screen.getByLabelText("ملاحظات المحاضرة")).toHaveValue(draft);
    await act(async () => { await router.navigate(path + "#first", { state: { newEntry: true } }); });
    act(() => setLanguage("en"));
    expect(screen.getByLabelText("Lecture notes")).toBe(notes);
    expect(screen.getByLabelText("Lecture notes")).toHaveValue(draft);
    expect(f.update).not.toHaveBeenCalled();
  });
  it("keeps a dirty draft through Back and Forward between focus hashes", async () => {
    const f = fixture(); const { router } = view(f);
    const notes = await screen.findByLabelText("Lecture notes");
    await act(async () => { await router.navigate(path + "#one"); await router.navigate(path + "#two"); });
    fireEvent.change(notes, { target: { value: "Unsaved through history" } });
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.hash).toBe("#one");
    expect(screen.getByLabelText("Lecture notes")).toBe(notes);
    expect(notes).toHaveValue("Unsaved through history");
    await act(async () => { await router.navigate(1); });
    expect(router.state.location.hash).toBe("#two");
    expect(notes).toHaveValue("Unsaved through history");
    expect(screen.queryByRole("button", { name: "Discard draft and leave" })).not.toBeInTheDocument();
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each(["course-a", "course-b"])("requires explicit discard before selecting another lecture in %s", async nextCourseId => {
    const f = fixture();
    const nextLecture = { ...lecture, id: "lecture-b", courseId: nextCourseId, notes: "Saved second lecture" };
    f.read.mockImplementation(async id => ({ courses: [course, { ...course, id: "course-b", code: "SYN-B" }], lectures: [lecture, nextLecture], sessions: [], lecture: id === nextLecture.id ? nextLecture : id ? lecture : undefined, files: [] }));
    const { router } = view(f);
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "Unconfirmed draft" } });
    const nextPath = `/lectures?course=${nextCourseId}&lecture=lecture-b`;
    await act(async () => { void router.navigate(nextPath); });
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("Unconfirmed draft");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.search).toContain("lecture=lecture-a");
    await act(async () => { void router.navigate(nextPath); });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft and leave" }));
    await waitFor(() => expect(screen.getByLabelText("Lecture notes")).toHaveValue("Saved second lecture"));
    expect(router.state.location.search).toContain("lecture=lecture-b");
    expect(f.update).not.toHaveBeenCalled();
  });
  it("blocks Back and Forward to another lecture until explicit discard", async () => {
    const f = fixture(), nextPath = "/lectures?course=course-a&lecture=lecture-b";
    const nextLecture = { ...lecture, id: "lecture-b", notes: "Second persisted notes" };
    f.read.mockImplementation(async id => ({ courses: [course], lectures: [lecture, nextLecture], sessions: [], lecture: id === "lecture-b" ? nextLecture : lecture, files: [] }));
    const { router } = view(f, path, { initialEntries: [nextPath, path, nextPath + "#forward"], initialIndex: 1 });
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "Draft survives POP" } });
    await act(async () => { void router.navigate(-1); });
    expect(screen.getByRole("button", { name: "Discard draft and leave" })).toBeEnabled();
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("Draft survives POP");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await act(async () => { void router.navigate(1); });
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("Draft survives POP");
    fireEvent.click(screen.getByRole("button", { name: "Discard draft and leave" }));
    await waitFor(() => expect(screen.getByLabelText("Lecture notes")).toHaveValue("Second persisted notes"));
    expect(router.state.location.hash).toBe("#forward");
    expect(f.update).not.toHaveBeenCalled();
  });
  it("retains the unload warning across hashes and removes it only after explicit draft cleanup", async () => {
    const f = fixture(); const { router } = view(f);
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "Warn before reload" } });
    await act(async () => { await router.navigate(path + "#main-content"); });
    const blocked = new Event("beforeunload", { cancelable: true }); fireEvent(window, blocked);
    expect(blocked.defaultPrevented).toBe(true);
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("Warn before reload");
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("");
    const clean = new Event("beforeunload", { cancelable: true }); fireEvent(window, clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(f.update).not.toHaveBeenCalled();
  });
  it.each(["CONFLICT", "UNAVAILABLE"] as const)("preserves exact failed %s drafts through a hash and retries with the original revision", async code => {
    const f = fixture(); f.update.mockRejectedValueOnce(new DataError(code, "Synthetic save failure"));
    const { router } = view(f); const draft = "  Exact unsaved text\nملاحظات\n  ";
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: draft } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" })); await screen.findByRole("alert");
    await act(async () => { await router.navigate(path + "#retry"); });
    expect(screen.getByLabelText("Lecture notes")).toHaveValue(draft);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save notes" })); await screen.findByText("Notes saved locally.");
    expect(f.update.mock.calls.map(row => [row[0], row[1].notes, row[2]])).toEqual([[lecture.id, draft, 1], [lecture.id, draft, 1]]);
    expect(screen.getByLabelText("Lecture notes")).toHaveValue(draft);
  });
});

describe("lecture workspace notes and course navigation", () => {
  it("opens a newly created course-linked lecture after releasing the pending-write guard", async () => {
    const f = fixture(); const { router } = view(f, "/lectures?course=course-a&term=term-a");
    fireEvent.click(await screen.findByRole("button", { name: "Create lecture" }));
    fireEvent.input(screen.getByLabelText("Lecture date"), { target: { value: "2032-03-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await screen.findByLabelText("Lecture notes");
    expect(router.state.location.search).toContain("lecture=lecture-a");
    expect(f.create).toHaveBeenCalledOnce();
    expect(f.create).toHaveBeenCalledWith({ courseId: course.id, date: "2032-03-05", scheduleSessionId: null });
  });
  it("loads a direct lecture URL, creates and edits plain notes with successive revisions, and reloads them", async () => {
    const f = fixture(); const v = view(f);
    const notes = await screen.findByLabelText("Lecture notes");
    fireEvent.change(notes, { target: { value: "First notes <script>plain text</script>" } });
    fireEvent.change(screen.getByLabelText("Lecture title (optional)"), { target: { value: "Synthetic topic" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await screen.findByText("Notes saved locally.");
    expect(f.update).toHaveBeenLastCalledWith(lecture.id, { title: "Synthetic topic", notes: "First notes <script>plain text</script>" }, 1);
    fireEvent.change(notes, { target: { value: "Revised notes" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(f.update).toHaveBeenLastCalledWith(lecture.id, { title: "Synthetic topic", notes: "Revised notes" }, 2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save notes" })).toBeDisabled());
    v.unmount(); view(f);
    const reloadedNotes = await screen.findByLabelText("Lecture notes");
    expect(reloadedNotes).toHaveValue("Revised notes");
    expect((reloadedNotes as HTMLTextAreaElement).labels?.[0].textContent).toBe("Lecture notes");
    expect(screen.getByRole("link", { name: /Back to course/ })).toHaveAttribute("href", "/courses?term=term-a#course-course-a");
  });
  it("preserves unsaved text and the original revision on stale writes", async () => {
    const f = fixture(); f.update.mockRejectedValue(new DataError("CONFLICT", "Stale")); view(f);
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "My draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("My draft");
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2));
    expect(f.update.mock.calls.map(row => row[2])).toEqual([1, 1]);
    fireEvent.click(screen.getByRole("button", { name: "Discard edits" }));
    expect(screen.getByLabelText("Lecture notes")).toHaveValue("");
  });
  it("blocks navigation and duplicate submission during a controlled pending note save", async () => {
    const f = fixture(), pending = deferred<Lecture>(); f.update.mockReturnValue(pending.promise);
    const { router } = view(f);
    fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "Pending draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await screen.findByText("Saving…");
    await act(async () => { void router.navigate("/courses?term=other"); });
    const discard = screen.getByRole("button", { name: /Discard draft and leave/ });
    expect(discard).toBeDisabled();
    expect(f.update).toHaveBeenCalledOnce();
    await act(async () => pending.resolve({ ...lecture, notes: "Pending draft", revision: 2 }));
    await screen.findByText("Notes saved locally.");
    expect(router.state.location.pathname).toBe("/lectures");
  });
  it("filters lectures by course, persists selection in the URL and never writes while opening", async () => {
    const f = fixture(); const { router } = view(f, "/lectures?course=course-a&term=term-a");
    const buttons = await screen.findAllByRole("button", { name: "Open attachments" });
    expect(buttons).toHaveLength(1); fireEvent.click(buttons[0]);
    await screen.findByLabelText("Lecture notes");
    expect(router.state.location.search).toContain("lecture=lecture-a");
    expect(f.update).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    await act(async () => { await router.navigate(-1); });
    await screen.findByRole("button", { name: "Open attachments" });
  });
  it("hides stale workspace content on read failure and retries the same lecture", async () => {
    const f = fixture(); view(f); await screen.findByLabelText("Lecture notes");
    f.read.mockRejectedValueOnce(new Error("Storage unavailable"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("alert"); expect(screen.queryByLabelText("Lecture notes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByLabelText("Lecture notes"); expect(f.read).toHaveBeenLastCalledWith(lecture.id);
  });
  it("ignores a late read after navigation to the course list", async () => {
    const f = fixture(), pending = deferred<Awaited<ReturnType<typeof f.read>>>();
    f.read.mockReturnValueOnce(pending.promise); const { router } = view(f);
    await act(async () => { await router.navigate("/lectures?course=course-a"); });
    await screen.findByRole("button", { name: "Open attachments" });
    await act(async () => pending.resolve({ courses: [course], lectures: [lecture], sessions: [], lecture, files: [] }));
    expect(screen.queryByLabelText("Lecture notes")).not.toBeInTheDocument();
  });
  it("keeps the draft and accessible controls across Arabic/English changes", async () => {
    const f = fixture(); view(f); fireEvent.change(await screen.findByLabelText("Lecture notes"), { target: { value: "ملاحظات تجريبية" } });
    act(() => setLanguage("ar"));
    expect(screen.getByLabelText("ملاحظات المحاضرة")).toHaveValue("ملاحظات تجريبية");
    expect(screen.getByRole("button", { name: "حفظ الملاحظات" })).toBeEnabled();
    expect(document.documentElement.dir).toBe("rtl");
  });
  it("does not fall back to another course when the linked course is missing", async () => {
    const f = fixture(); view(f, "/lectures?course=deleted-course"); await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: "Create lecture" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Open attachments" })).not.toBeInTheDocument();
  });
});

describe("safe local attachment preview", () => {
  it("keeps legacy inherited-extension files available across refresh and remount without unsafe previews or writes", async () => {
    const f = fixture();
    const file = { ...meta, id: "legacy-file", lectureId: lecture.id, fileName: ".constructor", mimeType: "application/octet-stream", fileSize: 3 };
    f.read.mockImplementation(async () => ({ courses: [course], lectures: [lecture], lecture, sessions: [], files: [file] }));
    const v = view(f);
    await screen.findByLabelText("Lecture notes");
    expect(screen.getByText(".constructor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Preview media" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
    await screen.findByLabelText("Lecture notes");
    v.unmount(); view(f); await screen.findByLabelText("Lecture notes");
    expect(screen.getByText(".constructor")).toBeInTheDocument();
    expect(f.get).not.toHaveBeenCalled(); expect(f.create).not.toHaveBeenCalled();
    expect(f.update).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it.each([
    [null, ""], [{ corrupt: true }, "application/octet-stream"],
    ["legacy.png", { corrupt: true }], ["legacy.png", undefined],
  ])("contains malformed filename/MIME metadata %j / %j without losing notes or file actions", async (fileName, mimeType) => {
    const f = fixture();
    const file = { ...meta, id: "legacy-file", lectureId: lecture.id, fileName, mimeType, fileSize: 3 } as unknown as Omit<LectureFile, "blob">;
    f.read.mockImplementation(async () => ({ courses: [course], lectures: [lecture], lecture, sessions: [], files: [file] }));
    const v = view(f); await screen.findByLabelText("Lecture notes");
    expect(screen.queryByRole("button", { name: "Preview media" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    expect(screen.getByRole("region", { name: "Confirm removal" })).toBeInTheDocument();
    v.unmount(); view(f); await screen.findByLabelText("Lecture notes");
    expect(f.get).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
  });

  it("downloads legacy malformed filenames with a binary fallback without changing bytes or metadata", async () => {
    const f = fixture();
    const file = Object.freeze({ ...meta, id: "legacy-file", lectureId: lecture.id, fileName: null as unknown as string, mimeType: "application/octet-stream", fileSize: 3 });
    const original = new Blob([new Uint8Array([0, 128, 255])], { type: "application/octet-stream" });
    f.read.mockImplementation(async () => ({ courses: [course], lectures: [lecture], lecture, sessions: [], files: [file] }));
    f.get.mockResolvedValue(Object.freeze({ ...file, blob: original }));
    const create = vi.fn((_blob: Blob) => { void _blob; return "blob:legacy-download"; }), revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    const v = view(f);
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(names).toEqual(["attachment"]));
    expect(create.mock.calls[0][0].type).toBe("application/octet-stream");
    const reader = new FileReader();
    const bytes = new Promise<ArrayBuffer>((resolve, reject) => {
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
    });
    reader.readAsArrayBuffer(create.mock.calls[0][0]);
    expect(new Uint8Array(await bytes)).toEqual(new Uint8Array([0, 128, 255]));
    expect(file.fileName).toBeNull();
    expect(f.get).toHaveBeenCalledExactlyOnceWith(file.id);
    expect(f.update).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.upload).not.toHaveBeenCalled();
    v.unmount(); expect(revoke).toHaveBeenCalledWith("blob:legacy-download");
  });

  it("loads media only on request, checks its parent, and revokes the URL on close", async () => {
    const f = fixture();
    const file = { ...meta, id: "image-file", lectureId: lecture.id, fileName: "synthetic.png", mimeType: "image/png", fileSize: 5 };
    f.read.mockImplementation(async () => ({ courses: [course], lectures: [lecture], lecture, sessions: [], files: [file] }));
    f.get.mockResolvedValue({ ...file, blob: new Blob(["bytes"], { type: "image/png" }) });
    const create = vi.fn(() => "blob:synthetic"), revoke = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    view(f); await screen.findByRole("button", { name: "Preview media" });
    expect(f.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview media" }));
    expect(await screen.findByRole("img", { name: file.fileName })).toHaveAttribute("src", "blob:synthetic");
    fireEvent.click(screen.getByRole("button", { name: "Close preview" }));
    expect(revoke).toHaveBeenCalledWith("blob:synthetic");
    f.get.mockResolvedValue({ ...file, lectureId: "other-lecture", blob: new Blob(["bytes"], { type: "image/png" }) });
    fireEvent.click(screen.getByRole("button", { name: "Preview media" }));
    await screen.findByRole("alert"); expect(create).toHaveBeenCalledOnce();
  });
  it("does not create a URL when a preview read finishes after leaving", async () => {
    const f = fixture(); const file = { ...meta, id: "image-file", lectureId: lecture.id, fileName: "synthetic.png", mimeType: "image/png", fileSize: 5 };
    f.read.mockImplementation(async () => ({ courses: [course], lectures: [lecture], lecture, sessions: [], files: [file] }));
    const pending = deferred<LectureFile>(); f.get.mockReturnValue(pending.promise);
    const create = vi.fn(), revoke = vi.fn(); vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const v = view(f); fireEvent.click(await screen.findByRole("button", { name: "Preview media" })); v.unmount();
    await act(async () => pending.resolve({ ...file, blob: new Blob(["bytes"], { type: "image/png" }) }));
    expect(create).not.toHaveBeenCalled();
  });
  it.each([ ["photo.png", "image/png", "image"], ["recording.mp3", "audio/mpeg", "audio"], ["video.mp4", "video/mp4", "video"] ])("allows %s only as media", (name, mime, kind) => expect(mediaPreview(name, mime)?.kind).toBe(kind));
  it("never enables active documents or mismatched media", () => {
    for (const [name, mime] of [["page.html", "text/html"], ["vector.svg", "image/svg+xml"], ["notes.pdf", "application/pdf"], ["image.png", "text/html"]]) expect(mediaPreview(name, mime)).toBeUndefined();
  });
});
