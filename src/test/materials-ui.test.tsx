import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Materials } from "../pages/Materials";
import { createAcademicStore, DataError, type Material, type MaterialFile } from "../data";
import type { MaterialSave } from "../data/material-types";
import { setLanguage } from "../i18n/locale";

const meta = { createdAt: 1, updatedAt: 1, revision: 1, deletedAt: null };
const term = { ...meta, id: "10000000-0000-4000-8000-000000000001", name: "Synthetic term A", academicYear: "2033/2034", semester: 1 };
const otherTerm = { ...term, id: "10000000-0000-4000-8000-000000000002", name: "Synthetic term B" };
const course = { ...meta, id: "20000000-0000-4000-8000-000000000001", academicTermId: term.id, code: "SYN-A", name: "Synthetic subject A", registeredHours: 2 };
const otherCourse = { ...course, id: "20000000-0000-4000-8000-000000000002", code: "SYN-B", name: "Synthetic subject B" };
const material: Material = { ...meta, id: "30000000-0000-4000-8000-000000000001", courseId: course.id, title: "Synthetic study notes", category: "Notes", description: "Searchable description" };
function deferred<T>() { let resolve!: (value: T) => void, reject!: (failure: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { resolve, reject, promise }; }
function fixture(initial = [material]) {
  let records = initial.map(row => ({ ...row }));
  const read = vi.fn(async (id?: string) => {
    if (id && ![term.id, otherTerm.id].includes(id)) throw new DataError("NOT_FOUND", "Missing term");
    return { terms: [term, otherTerm], termId: id ?? term.id, courses: id === otherTerm.id ? [] : [course, otherCourse], materials: id === otherTerm.id ? [] : records };
  });
  const details = vi.fn(async (_term: string, id: string) => { const row = records.find(row => row.id === id); if (!row) throw new DataError("NOT_FOUND", "Missing material"); return { material: row, files: [] as Omit<MaterialFile, "blob">[] }; });
  const save = vi.fn(async (input: MaterialSave) => {
    const record: Material = { ...meta, ...input.values, id: input.id, revision: (input.expectedRevision ?? 0) + 1 };
    records = [...records.filter(row => row.id !== record.id), record]; return record;
  });
  const preview = vi.fn(async () => [{ kind: "materials" as const, id: material.id, revision: 1 }]);
  const remove = vi.fn(async () => { records = records.filter(row => row.id !== material.id); return []; });
  const removeFile = vi.fn(async () => []), getFile = vi.fn();
  const store = { getMaterialLibrary: read, getMaterialDetails: details, saveMaterial: save, previewMaterialRemoval: preview, removeMaterial: remove, removeMaterialFile: removeFile, getMaterialFile: getFile } as unknown as ReturnType<typeof createAcademicStore>;
  return { store, read, details, save, preview, remove, removeFile, getFile };
}
function view(f: ReturnType<typeof fixture>, path = `/materials?term=${term.id}`, entries?: string[]) {
  setLanguage("en");
  const router = createMemoryRouter([{ path: "/materials", element: <Materials store={f.store} /> }, { path: "*", element: <h1>Other page</h1> }], { initialEntries: entries ?? [path], initialIndex: entries ? entries.length - 1 : undefined });
  return { router, ...render(<RouterProvider router={router} />) };
}
const existingPath = `/materials?term=${term.id}&material=${material.id}`;
afterEach(() => { setLanguage("ar"); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("materials library workflow", () => {
  it("filters by course/category and searches metadata without opening or downloading files", async () => {
    const second = { ...material, id: "30000000-0000-4000-8000-000000000002", courseId: otherCourse.id, title: "Synthetic slides", category: "Slides", description: "Only slides" };
    const f = fixture([material, second]); view(f);
    await screen.findByRole("link", { name: "Open material: Synthetic study notes" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search materials" }), { target: { value: "searchable description" } });
    expect(screen.queryByRole("link", { name: "Open material: Synthetic slides" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "No result" } });
    expect(screen.getByText("No materials match these filters.")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "Slides" } });
    expect(screen.queryByRole("link", { name: "Open material: Synthetic study notes" })).not.toBeInTheDocument();
    expect(f.details).not.toHaveBeenCalled(); expect(f.getFile).not.toHaveBeenCalled();
  });
  it("keeps term/course selection in the URL and restores the filter on reload", async () => {
    const f = fixture(); const { router, unmount } = view(f);
    const select = await screen.findByRole("combobox", { name: "Course" });
    fireEvent.change(select, { target: { value: otherCourse.id } });
    await waitFor(() => expect(router.state.location.search).toContain(`course=${otherCourse.id}`));
    expect(screen.queryByRole("link", { name: /Open material:/ })).not.toBeInTheDocument();
    const path = router.state.location.pathname + router.state.location.search; unmount(); view(f, path);
    expect(await screen.findByRole("combobox", { name: "Course" })).toHaveValue(otherCourse.id);
    fireEvent.change(screen.getByRole("combobox", { name: "Academic term" }), { target: { value: otherTerm.id } });
    await screen.findByText("Add a course in this term before creating materials.");
    expect(screen.getByRole("button", { name: "Create material" })).toBeDisabled();
  });
  it("creates without files only on confirmation and recomputes the list", async () => {
    const f = fixture([]); view(f);
    fireEvent.click(await screen.findByRole("button", { name: "Create material" }));
    fireEvent.change(screen.getByLabelText("Material title"), { target: { value: "New synthetic notes" } });
    expect(f.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save material" }));
    await screen.findByRole("link", { name: "Open material: New synthetic notes" });
    expect(f.save).toHaveBeenCalledOnce(); expect(f.save.mock.calls[0][0]).toMatchObject({ termId: term.id, values: { courseId: course.id, title: "New synthetic notes" }, files: [] });
  });
  it("retains exact draft/revision/file IDs on failed save and retry and blocks double submission", async () => {
    const f = fixture(), write = deferred<Material>(); f.save.mockReturnValueOnce(write.promise); const { router } = view(f, existingPath);
    fireEvent.change(await screen.findByLabelText("Material title"), { target: { value: "  Exact edited title  " } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Exact\nArabic وصف" } });
    const upload = new File(["Exact bytes"], "notes.txt", { type: "text/plain" });
    fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [upload] } });
    fireEvent.click(screen.getByRole("button", { name: "Save material" })); fireEvent.click(screen.getByRole("button", { name: "Save material" }));
    expect(f.save).toHaveBeenCalledOnce();
    await act(async () => { void router.navigate("/lectures"); });
    expect(screen.getByRole("button", { name: "Discard draft and leave" })).toBeDisabled();
    await act(async () => write.reject(new DataError("CONFLICT", "Stale revision")));
    expect(screen.getByLabelText("Material title")).toHaveValue("  Exact edited title  "); expect(screen.getByLabelText("Description")).toHaveValue("Exact\nArabic وصف");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Save material" }));
    await screen.findByRole("link", { name: "Open material: Exact edited title" });
    expect(screen.getByText("Saved locally.")).toHaveFocus();
    expect(f.save.mock.calls[1][0]).toEqual(f.save.mock.calls[0][0]);
    expect(f.save.mock.calls[1][0].expectedRevision).toBe(1);
    expect(router.state.location.pathname).toBe("/materials");
  });
  it("retains dirty input through hashes, language changes, Back/Forward focus navigation and warns on reload", async () => {
    const f = fixture(); const { router } = view(f, existingPath);
    const title = await screen.findByLabelText("Material title");
    fireEvent.change(title, { target: { value: "Unconfirmed exact draft" } });
    await act(async () => { await router.navigate(existingPath + "#main-content"); await router.navigate(existingPath + "#focus"); });
    act(() => setLanguage("ar")); expect(screen.getByLabelText("عنوان المادة")).toBe(title); expect(title).toHaveValue("Unconfirmed exact draft");
    await act(async () => { await router.navigate(-1); }); expect(title).toHaveValue("Unconfirmed exact draft");
    await act(async () => { await router.navigate(1); }); expect(title).toHaveValue("Unconfirmed exact draft");
    const unload = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(f.details).toHaveBeenCalledOnce(); expect(f.save).not.toHaveBeenCalled();
  });
  it("blocks term/route changes until explicit discard, and clears the draft only then", async () => {
    const f = fixture(); const { router } = view(f, existingPath);
    fireEvent.change(await screen.findByLabelText("Material title"), { target: { value: "Unconfirmed" } });
    await act(async () => { void router.navigate(`/materials?term=${otherTerm.id}`); });
    expect(screen.getByLabelText("Material title")).toHaveValue("Unconfirmed");
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(router.state.location.search).toContain(term.id);
    await act(async () => { void router.navigate(`/materials?term=${otherTerm.id}`); });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft and leave" }));
    await screen.findByText("Add a course in this term before creating materials."); expect(f.save).not.toHaveBeenCalled();
  });
  it("protects browser Back/Forward to another page and offers explicit local cancellation", async () => {
    const f = fixture(); const { router } = view(f, existingPath, ["/lectures", existingPath]);
    fireEvent.change(await screen.findByLabelText("Material title"), { target: { value: "Draft" } });
    await act(async () => { void router.navigate(-1); });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    expect(screen.getByRole("heading", { name: "Discard these unsaved changes?" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.getByLabelText("Material title")).toHaveValue("Draft");
    fireEvent.click(screen.getByRole("button", { name: "Close editor" })); fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(screen.queryByLabelText("Material title")).not.toBeInTheDocument()); expect(f.save).not.toHaveBeenCalled();
  });
  it("validates uploads before saving, permits repeated names and preserves files selected across attempts", async () => {
    const f = fixture(); view(f); fireEvent.click(await screen.findByRole("button", { name: "Create material" }));
    const picker = screen.getByLabelText("Choose files");
    fireEvent.change(picker, { target: { files: [new File(["x"], "unsafe.svg", { type: "image/svg+xml" }), new File(["first"], "same.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("alert")).toHaveTextContent("Unsupported or unsafe file name/extension.");
    fireEvent.change(picker, { target: { files: [new File(["second"], "same.txt", { type: "text/plain" })] } });
    expect(within(screen.getByRole("list", { name: "Files to save" })).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Material title"), { target: { value: "Uploads" } }); fireEvent.click(screen.getByRole("button", { name: "Save material" }));
    await screen.findByRole("link", { name: "Open material: Uploads" });
    expect(f.save.mock.calls[0][0].files).toHaveLength(2); expect(new Set(f.save.mock.calls[0][0].files.map(row => row.id)).size).toBe(2);
  });
  it("requires confirmation for material deletion, cancellation performs no write", async () => {
    const f = fixture(); view(f, existingPath);
    fireEvent.click(await screen.findByRole("button", { name: "Remove material" }));
    await screen.findByRole("button", { name: "Confirm removal" }); expect(f.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" })); expect(f.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove material" })); fireEvent.click(await screen.findByRole("button", { name: "Confirm removal" }));
    await screen.findByText("No materials in this term yet.");
    expect(f.remove).toHaveBeenCalledWith(term.id, material.id, { expectedRevision: 1, cascade: true, confirmation: [{ kind: "materials", id: material.id, revision: 1 }] });
  });
  it("downloads only the selected file without inline preview and revokes its URL on close", async () => {
    const f = fixture(), savedFile = { ...meta, id: "40000000-0000-4000-8000-000000000001", materialId: material.id, fileName: "..\\unsafe:name.txt", fileSize: 5, mimeType: "text/plain" };
    f.details.mockResolvedValueOnce({ material, files: [savedFile] }); f.getFile.mockResolvedValueOnce({ ...savedFile, blob: new Blob(["bytes"], { type: "text/plain" }) });
    const create = vi.fn((blob: Blob) => { void blob; return "blob:synthetic-download"; }), revoke = vi.fn(); vi.stubGlobal("URL", class extends URL { static createObjectURL = create; static revokeObjectURL = revoke; });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe("_unsafe_name.txt"); expect(this.href).toBe("blob:synthetic-download"); });
    const { unmount, container } = view(f, existingPath);
    fireEvent.click(await screen.findByRole("button", { name: /Download file:/ }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(f.getFile).toHaveBeenCalledWith(term.id, material.id, savedFile.id); expect(create.mock.calls[0][0].type).toBe("application/octet-stream");
    expect(container.querySelector("iframe, object, embed, img, audio, video")).toBeNull(); unmount(); expect(revoke).toHaveBeenCalledWith("blob:synthetic-download");
  });
  it("requires file-removal confirmation and uses its revision", async () => {
    const f = fixture(), savedFile = { ...meta, id: "file-a", materialId: material.id, fileName: "notes.txt", fileSize: 5, mimeType: "text/plain", revision: 3 };
    f.details.mockResolvedValueOnce({ material, files: [savedFile] }); view(f, existingPath);
    fireEvent.click(await screen.findByRole("button", { name: "Remove file: notes.txt" })); expect(f.removeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" })); expect(f.removeFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove file: notes.txt" })); fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Download file:/ })).not.toBeInTheDocument());
    expect(f.removeFile).toHaveBeenCalledWith(term.id, material.id, savedFile.id, 3); expect(f.remove).not.toHaveBeenCalled();
  });
  it("preserves valid requested term after storage failure, but recovers invalid/deleted terms", async () => {
    const f = fixture(); f.read.mockRejectedValueOnce(new DataError("UNAVAILABLE", "Temporary failure")); const { router } = view(f, `/materials?term=${otherTerm.id}`);
    await screen.findByRole("alert"); expect(router.state.location.search).toContain(otherTerm.id);
    fireEvent.click(screen.getByRole("button", { name: "Refresh data" })); await screen.findByRole("combobox", { name: "Academic term" });
    expect(f.read).toHaveBeenLastCalledWith(otherTerm.id);
    await act(async () => { await router.navigate("/materials?term=invalid&course=invalid&material=invalid#focus"); });
    await waitFor(() => expect(router.state.location.search).toBe(`?term=${term.id}`)); expect(router.state.location.hash).toBe("#focus");
    expect(f.save).not.toHaveBeenCalled();
  });
  it("ignores obsolete library reads after newer term selection and unmount", async () => {
    const f = fixture(), old = deferred<Awaited<ReturnType<typeof f.read>>>(); f.read.mockReturnValueOnce(old.promise); const { router, unmount } = view(f);
    await act(async () => { await router.navigate(`/materials?term=${otherTerm.id}`); });
    await screen.findByText("Add a course in this term before creating materials.");
    await act(async () => old.resolve({ terms: [term, otherTerm], termId: term.id, courses: [course], materials: [material] }));
    expect(screen.getByRole("combobox", { name: "Academic term" })).toHaveValue(otherTerm.id); expect(screen.queryByRole("link", { name: /Open material:/ })).not.toBeInTheDocument();
    unmount(); expect(f.save).not.toHaveBeenCalled();
  });
  it("does not recover an obsolete failed term read before React completes newer navigation", async () => {
    const f = fixture(), old = deferred<Awaited<ReturnType<typeof f.read>>>(); f.read.mockReturnValueOnce(old.promise); const { router } = view(f);
    await act(async () => {
      const navigation = router.navigate(`/materials?term=${otherTerm.id}`);
      old.reject(new DataError("NOT_FOUND", "Obsolete missing term"));
      await navigation;
    });
    await screen.findByText("Add a course in this term before creating materials.");
    expect(router.state.location.search).toBe(`?term=${otherTerm.id}`);
    expect(f.read.mock.calls.map(call => call[0])).toEqual([term.id, otherTerm.id]);
  });
  it("ignores obsolete material details after navigation and reports deleted parents without rendering an editor", async () => {
    const f = fixture(), old = deferred<Awaited<ReturnType<typeof f.details>>>(); f.details.mockReturnValueOnce(old.promise); const { router } = view(f, existingPath);
    await waitFor(() => expect(f.details).toHaveBeenCalledOnce());
    await act(async () => { await router.navigate(`/materials?term=${term.id}&material=missing`); });
    await screen.findByText("This material or its academic parent is unavailable or deleted.");
    await act(async () => old.resolve({ material, files: [] }));
    expect(screen.queryByLabelText("Material title")).not.toBeInTheDocument(); expect(f.save).not.toHaveBeenCalled();
  });
});
