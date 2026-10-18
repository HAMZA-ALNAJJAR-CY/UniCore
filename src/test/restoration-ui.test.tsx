import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createAcademicStore, DataError } from "../data";
import { Courses } from "../pages/Courses";
import { setLanguage } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";
import { restorationText as r } from "../i18n/restoration";
import { introductionText as intro } from "../i18n/introduction";

const stores: ReturnType<typeof createAcademicStore>[] = [], names: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  stores.forEach(store => store.close());
  await Promise.all(names.map(name => Dexie.delete(name)));
  stores.length = 0; names.length = 0;
  setLanguage("ar"); localStorage.clear();
});
async function seed() {
  const name = `restore-ui-${crypto.randomUUID()}`, store = createAcademicStore(name);
  names.push(name); stores.push(store);
  const term = await store.academicTerms.create({ name: "Synthetic restoration term", academicYear: "2038/2039", semester: 1 });
  const course = await store.courses.create({ academicTermId: term.id, name: "Synthetic restoration course", code: "SYN-RESTORE", registeredHours: 2 });
  const session = await store.scheduleSessions.create({ academicTermId: term.id, courseId: course.id, dayOfWeek: 1, startTime: "09:00", endTime: "10:00", deliveryMode: "in-person" });
  return { store, term, course, session };
}

it.each(["en", "ar"] as const)("offers explicit removed-course recovery after managed deletion in %s", async language => {
  act(() => setLanguage(language));
  const { store, term, course, session } = await seed();
  render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  const card = await screen.findByRole("article", { name: course.name });
  fireEvent.click(within(card).getByRole("button", { name: t.removeCourse }));
  const confirmation = await screen.findByRole("region", { name: t.confirmDelete });
  fireEvent.click(within(confirmation).getByRole("button", { name: t.confirmDelete }));
  await waitFor(() => expect(screen.queryByRole("article", { name: course.name })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: language === "en" ? "Removed courses" : "المقررات المحذوفة" }));
  const removed = await screen.findByRole("article", { name: course.name });
  expect(removed).toHaveTextContent(term.name);
  expect(within(removed).getByText(course.code)).toHaveAttribute("dir", "ltr");
  fireEvent.click(within(removed).getByRole("button", { name: language === "en" ? "Review restoration" : "مراجعة الاستعادة" }));
  const preview = await screen.findByRole("region", { name: language === "en" ? "Review course restoration" : "مراجعة استعادة المقرر" });
  expect(within(preview).getByText("09:00–10:00")).toHaveAttribute("dir", "ltr");
  fireEvent.click(within(preview).getByRole("button", { name: language === "en" ? "Restore course only" : "استعادة المقرر فقط" }));
  await waitFor(async () => expect(await store.courses.get(course.id)).toMatchObject({ id: course.id, revision: 3 }));
  expect(await store.scheduleSessions.get(session.id)).toBeUndefined();
  await screen.findByText(r.restored);
  await screen.findByText(r.empty);
  expect(screen.getByRole("heading", { name: r.title })).toHaveFocus();
});

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function deletedSetup() {
  const data = await seed();
  await data.store.deleteManagedCourse(data.course.id, 1, await data.store.courses.previewDelete(data.course.id));
  return data;
}
async function openPreview(courseName: string) {
  fireEvent.click(await screen.findByRole("button", { name: r.title }));
  const removed = await screen.findByRole("article", { name: courseName });
  fireEvent.click(within(removed).getByRole("button", { name: r.review }));
  return screen.findByRole("region", { name: r.preview });
}

it("blocks duplicate submissions and browser Back during a pending restore; language and refresh do not resubmit", async () => {
  act(() => setLanguage("en"));
  const { store, term, course } = await deletedSetup();
  const real = store.restoreCourse.bind(store), gate = deferred<Awaited<ReturnType<typeof real>>>();
  const restore = vi.spyOn(store, "restoreCourse").mockImplementationOnce(() => gate.promise);
  const router = createMemoryRouter([
    { path: "/previous", element: <p>Previous page</p> },
    { path: "/courses", element: <Courses store={store} /> },
  ], { initialEntries: ["/previous", "/courses?term=" + term.id] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  const preview = await openPreview(course.name);
  expect(within(preview).getByRole("heading")).toHaveFocus();
  expect(preview).toHaveTextContent(r.policy);
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  expect(restore).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: r.close })).toBeDisabled();
  expect(screen.getByRole("button", { name: r.cancel })).toBeDisabled();
  expect(screen.getByRole("button", { name: r.retry })).toBeDisabled();
  expect(screen.getByRole("combobox", { name: t.term })).toBeDisabled();
  await act(async () => { void router.navigate(-1); });
  expect(await screen.findByText(intro.pendingWrite)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: intro.discardAndLeave })).toBeDisabled();
  act(() => setLanguage("ar"));
  expect(screen.getByRole("button", { name: r.confirm })).toBeDisabled();
  expect(screen.getByText(r.pending)).toBeInTheDocument();
  const args = restore.mock.calls[0];
  await act(async () => gate.resolve(await real(...args)));
  await screen.findByText(r.restored);
  await waitFor(() => expect(screen.getByRole("button", { name: r.close })).toBeEnabled());
  expect(router.state.location.pathname).toBe("/courses");
  expect(router.state.location.search).toBe("?term=" + term.id);
  expect(restore).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: r.retry }));
  await screen.findByText(r.empty);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(await store.courses.get(course.id)).toMatchObject({ id: course.id, revision: 3 });
});

it("retains the preview after failure, localizes its error and requires an explicit retry", async () => {
  act(() => setLanguage("en"));
  const { store, term, course } = await deletedSetup();
  const restore = vi.spyOn(store, "restoreCourse").mockRejectedValueOnce(new DataError("QUOTA", "Synthetic quota"));
  render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  const preview = await openPreview(course.name);
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  expect(await screen.findByRole("alert")).toHaveTextContent(r.quota);
  expect(await store.courses.get(course.id)).toBeUndefined();
  act(() => setLanguage("ar"));
  expect(screen.getByRole("alert")).toHaveTextContent(r.quota);
  expect(restore).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: r.confirm }));
  await screen.findByText(r.restored);
  expect(restore).toHaveBeenCalledTimes(2);
});

it("rejects a stale preview and offers cancel, refresh and fresh explicit confirmation", async () => {
  const { store, term, course } = await deletedSetup();
  render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  const preview = await openPreview(course.name);
  await store.academicTerms.update(term.id, { name: "Changed synthetic term" }, term.revision);
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  expect(await screen.findByRole("alert")).toHaveTextContent(r.stale);
  expect(await store.courses.get(course.id)).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: r.cancel }));
  fireEvent.click(screen.getByRole("button", { name: r.retry }));
  const removed = await screen.findByRole("article", { name: course.name });
  expect(removed).toHaveTextContent("Changed synthetic term");
  fireEvent.click(within(removed).getByRole("button", { name: r.review }));
  const fresh = await screen.findByRole("region", { name: r.preview });
  expect(fresh).toHaveTextContent("Changed synthetic term");
  fireEvent.click(within(fresh).getByRole("button", { name: r.confirm }));
  await screen.findByText(r.restored);
});

it("shows list loading, read failure and a working retry without running restoration", async () => {
  const { store, term, course } = await deletedSetup();
  const gate = deferred<Awaited<ReturnType<typeof store.getRemovedCourses>>>();
  const read = vi.spyOn(store, "getRemovedCourses").mockImplementationOnce(() => gate.promise);
  const restore = vi.spyOn(store, "restoreCourse");
  render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: r.title }));
  await screen.findByText(r.loading);
  expect(screen.getByRole("button", { name: r.retry })).toBeDisabled();
  await act(async () => gate.reject(new DataError("UNAVAILABLE", "Synthetic failure")));
  expect(screen.getByRole("alert")).toHaveTextContent(r.unavailable);
  fireEvent.click(screen.getByRole("button", { name: r.retry }));
  await screen.findByRole("article", { name: course.name });
  expect(read).toHaveBeenCalledTimes(2);
  expect(restore).not.toHaveBeenCalled();
});

it("explains a removed course's reserved code and preserves the failed new-course draft until explicit cancellation", async () => {
  const { store, term, course } = await deletedSetup();
  render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: t.addCourse })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: t.addCourse }));
  fireEvent.change(screen.getByLabelText(t.name, { exact: true }), { target: { value: "New synthetic draft" } });
  fireEvent.change(screen.getByLabelText(t.code, { exact: true }), { target: { value: course.code } });
  fireEvent.change(screen.getByLabelText(t.hours, { exact: true }), { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await screen.findByRole("alert");
  expect(screen.getByText(r.reserved)).toBeInTheDocument();
  expect(screen.getByLabelText(t.name, { exact: true })).toHaveValue("New synthetic draft");
  expect(await store.courses.list()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: t.cancel }));
  const preview = await openPreview(course.name);
  expect(preview).toHaveTextContent(course.code);
  expect(await store.courses.get(course.id)).toBeUndefined();
});

it("discards a stale preview response after navigation without touching records", async () => {
  const { store, term, course } = await deletedSetup();
  const snapshot = await store.previewCourseRestore(course.id), gate = deferred<typeof snapshot>();
  vi.spyOn(store, "previewCourseRestore").mockImplementationOnce(() => gate.promise);
  const restore = vi.spyOn(store, "restoreCourse");
  const router = createMemoryRouter([
    { path: "/previous", element: <p>Previous page</p> },
    { path: "/courses", element: <Courses store={store} /> },
  ], { initialEntries: ["/previous", "/courses?term=" + term.id] });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: r.title }));
  fireEvent.click(within(await screen.findByRole("article", { name: course.name })).getByRole("button", { name: r.review }));
  await act(async () => { void router.navigate(-1); });
  fireEvent.click(await screen.findByRole("button", { name: intro.discardAndLeave }));
  await screen.findByText("Previous page");
  await act(async () => gate.resolve(snapshot));
  expect(screen.queryByRole("region", { name: r.preview })).not.toBeInTheDocument();
  expect(restore).not.toHaveBeenCalled();
  expect(await store.courses.get(course.id)).toBeUndefined();
});

it.each(["unmount", "store replacement"] as const)("does not apply late save completion after %s or repeat the write", async kind => {
  const { store, term, course } = await deletedSetup();
  const real = store.restoreCourse.bind(store), gate = deferred<Awaited<ReturnType<typeof real>>>();
  const restore = vi.spyOn(store, "restoreCourse").mockImplementationOnce(() => gate.promise);
  const mount = () => render(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={store} /></MemoryRouter>);
  const view = mount();
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  const preview = await openPreview(course.name);
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  const other = kind === "store replacement" ? await seed() : undefined;
  const otherRestore = other ? vi.spyOn(other.store, "restoreCourse") : undefined;
  if (other) view.rerender(<MemoryRouter initialEntries={["/courses?term=" + term.id]}><Courses store={other.store} /></MemoryRouter>);
  else view.unmount();
  await act(async () => gate.resolve(await real(...restore.mock.calls[0])));
  if (other) {
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: t.retry }));
  } else mount();
  await screen.findByRole("article", { name: course.name });
  expect(screen.queryByText(r.restored)).not.toBeInTheDocument();
  expect(restore).toHaveBeenCalledOnce();
  if (other) {
    expect(otherRestore).not.toHaveBeenCalled();
    expect(await other.store.courses.get(other.course.id)).toMatchObject({ revision: 1 });
  }
});

it("keeps recovery bound to its opening term if the term is removed after commit, without silently falling back", async () => {
  const { store, term, course } = await deletedSetup();
  const other = await store.academicTerms.create({ name: "Other synthetic term", academicYear: "2039/2040", semester: 1 });
  const real = store.restoreCourse.bind(store);
  vi.spyOn(store, "restoreCourse").mockImplementationOnce(async (...args) => {
    const result = await real(...args);
    // A second operation can run after commit and before the UI's refresh.
    await store.academicTerms.delete(term.id, { expectedRevision: term.revision, cascade: true,
      confirmation: await store.academicTerms.previewDelete(term.id) });
    return result;
  });
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + term.id],
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("button", { name: r.title })).toBeEnabled());
  const preview = await openPreview(course.name);
  fireEvent.click(within(preview).getByRole("button", { name: r.confirm }));
  const panel = await screen.findByRole("region", { name: r.title });
  await waitFor(() => expect(within(panel).getByRole("alert")).toHaveTextContent(r.deletedTerm));
  expect(router.state.location.search).toBe("?term=" + term.id);
  expect(within(panel).getByRole("button", { name: r.close })).toBeEnabled();
  fireEvent.click(within(panel).getByRole("button", { name: r.close }));
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await waitFor(() => expect(router.state.location.search).toBe("?term=" + other.id));
});
