import "fake-indexeddb/auto";
import Dexie from "dexie";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAcademicStore, DataError, type AcademicTerm } from "../data";
import { Courses } from "../pages/Courses";
import { Dashboard } from "../pages/Dashboard";
import { Home, Introduction, ManualSetup, Settings } from "../pages/Introduction";
import { TimetableImport } from "../pages/TimetableImport";
import { finishIntroduction, introductionComplete, resetIntroduction } from "../features/onboarding";
import { setLanguage } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";
import { introductionText as intro } from "../i18n/introduction";
import { sourceDraft } from "./fixtures/timetable";
import { App } from "../app/App";
import { tr } from "../i18n/locale";
import { useTimetable, type TimetableStore } from "../features/timetable/useTimetable";

let store: ReturnType<typeof createAcademicStore>, name: string;
beforeEach(() => {
  setLanguage("en"); resetIntroduction();
  name = "corrective-" + crypto.randomUUID(); store = createAcademicStore(name);
});
afterEach(async () => {
  store.close(); await Dexie.delete(name);
  resetIntroduction(); setLanguage("ar"); localStorage.clear(); vi.restoreAllMocks();
});
function Probe({ jump }: { jump?: string }) {
  const location = useLocation(), navigate = useNavigate();
  return <><output aria-label="Current route">{location.pathname + location.search}</output>
    <output aria-label="Saved navigation flag">{String(Boolean(location.state?.timetableSaved))}</output>
    {jump && <button onClick={() => navigate(jump)}>Change route</button>}</>;
}
async function terms() {
  const a = await store.academicTerms.create({ name: "Synthetic term A", academicYear: "2031/2032", semester: 1 });
  const b = await store.academicTerms.create({ name: "Synthetic term B", academicYear: "2032/2033", semester: 1 });
  const course = await store.courses.create({ academicTermId: a.id, code: "SYN-A", name: "Synthetic course A", registeredHours: 2 });
  return { a, b, course };
}
function courseRoute(a: AcademicTerm, b: AcademicTerm, path = "/courses?term=" + a.id) {
  return render(<MemoryRouter initialEntries={[path]}><Probe jump={"/courses?term=" + b.id} /><Courses store={store} /></MemoryRouter>);
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } });

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it("retries the URL's valid nondefault Courses term after its initial read fails", async () => {
  const { a, b, course } = await terms();
  const get = store.getTimetable.bind(store), snapshot = await get(a.id);
  expect((await get()).termId).toBe(b.id);
  const initial = deferred<typeof snapshot>(), retry = deferred<typeof snapshot>();
  const read = vi.spyOn(store, "getTimetable")
    .mockImplementationOnce(() => initial.promise)
    .mockImplementationOnce(() => retry.promise);
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + a.id],
  });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith(a.id));
  await act(async () => initial.reject(new DataError("UNAVAILABLE", "Synthetic transient read failure")));
  expect(screen.getByRole("alert")).toHaveTextContent(t.unavailable);
  expect(router.state.location.search).toBe("?term=" + a.id);
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
  const key = router.state.location.key;
  const refresh = screen.getByRole("button", { name: t.retry });
  expect(refresh).toBeEnabled();
  fireEvent.click(refresh);
  expect(read).toHaveBeenNthCalledWith(2, a.id);
  expect(refresh).toBeDisabled();
  expect(screen.getByText(t.loading)).toHaveAttribute("role", "status");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => retry.resolve(snapshot));
  await screen.findByRole("rowgroup", { name: course.name });
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).not.toHaveBeenCalledWith(undefined);
  expect(screen.getByLabelText(t.term)).toHaveValue(a.id);
  expect(router.state.location.search).toBe("?term=" + a.id);
  expect(router.state.location.key).toBe(key);
  expect(refresh).toBeEnabled();
  expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
  view.unmount(); router.dispose();
});

it("ignores a refresh settling after router navigation but before React commits its effects", async () => {
  const { a, b, course } = await terms();
  const snapshot = await store.getTimetable(a.id), pending = deferred<typeof snapshot>();
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + b.id, "/courses?term=" + a.id], initialIndex: 1,
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await act(async () => {
    const navigation = router.navigate(-1);
    pending.resolve(snapshot);
    await navigation;
  });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  expect(router.state.location.search).toBe("?term=" + b.id);
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
  view.unmount(); router.dispose();
});

it.each([-1, 1])("ignores a delayed Courses refresh after history navigation in direction %s", async direction => {
  const { a, b, course } = await terms();
  const get = store.getTimetable.bind(store), snapshotA = await get(a.id);
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: direction === -1 ? ["/courses?term=" + b.id, "/courses?term=" + a.id] : ["/courses?term=" + a.id, "/courses?term=" + b.id],
    initialIndex: direction === -1 ? 1 : 0,
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  const pending = deferred<typeof snapshotA>();
  vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  expect(screen.getByRole("button", { name: t.retry })).toBeDisabled();
  await act(async () => { await router.navigate(direction); });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  await waitFor(() => expect(screen.getByRole("button", { name: t.retry })).toBeEnabled());
  const key = router.state.location.key;
  await act(async () => pending.resolve(snapshotA));
  expect(router.state.location.search).toBe("?term=" + b.id);
  expect(router.state.location.key).toBe(key);
  expect(screen.getByLabelText(t.term)).toHaveValue(b.id);
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
  expect((await get(a.id)).courses).toEqual(snapshotA.courses);
  view.unmount(); router.dispose();
});

it.each(["resolve", "reject"] as const)("keeps the newest refresh after rapid Back/Forward when the older request later %ss", async outcome => {
  const { a, b, course } = await terms();
  const get = store.getTimetable.bind(store), oldSnapshot = await get(a.id);
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + b.id, "/courses?term=" + a.id], initialIndex: 1,
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  const older = deferred<typeof oldSnapshot>(), newer = deferred<typeof oldSnapshot>();
  const read = vi.spyOn(store, "getTimetable").mockImplementationOnce(() => older.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await store.courses.update(course.id, { name: "Newest synthetic course" }, 1);
  await act(async () => { await router.navigate(-1); });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  await act(async () => { await router.navigate(1); });
  // The old A refresh must not leave this returned navigation context busy.
  await waitFor(() => expect(screen.getByRole("button", { name: t.retry })).toBeEnabled());
  read.mockImplementationOnce(() => newer.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await act(async () => newer.resolve(await get(a.id)));
  await screen.findByRole("rowgroup", { name: "Newest synthetic course" });
  const key = router.state.location.key;
  await act(async () => { if (outcome === "resolve") older.resolve(oldSnapshot); else older.reject(new Error("Stale read failure")); });
  expect(router.state.location.search).toBe("?term=" + a.id);
  expect(router.state.location.key).toBe(key);
  expect(screen.getByRole("rowgroup", { name: "Newest synthetic course" })).toBeInTheDocument();
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: t.retry })).toBeEnabled();
  view.unmount(); router.dispose();
});

it("never navigates or updates a departed page when a Courses refresh settles after unmount", async () => {
  const { a, course } = await terms();
  const snapshot = await store.getTimetable(a.id), pending = deferred<typeof snapshot>();
  const router = createMemoryRouter([
    { path: "/courses", element: <Courses store={store} /> },
    { path: "/elsewhere", element: <p>Different page</p> },
  ], { initialEntries: ["/courses?term=" + a.id] });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await act(async () => { await router.navigate("/elsewhere"); });
  await screen.findByText("Different page");
  const navigation = vi.spyOn(router, "navigate"), key = router.state.location.key;
  await act(async () => pending.resolve(snapshot));
  expect(navigation).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/elsewhere");
  expect(router.state.location.key).toBe(key);
  expect(screen.getByText("Different page")).toBeInTheDocument();
  view.unmount(); router.dispose();
});

it("does not clear a newer refresh's loading state when an abandoned refresh finishes first", async () => {
  const { a, b, course } = await terms();
  const get = store.getTimetable.bind(store), snapshotA = await get(a.id), snapshotB = await get(b.id);
  const older = deferred<typeof snapshotA>(), newer = deferred<typeof snapshotB>();
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + b.id, "/courses?term=" + a.id], initialIndex: 1,
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  const read = vi.spyOn(store, "getTimetable").mockImplementationOnce(() => older.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await act(async () => { await router.navigate(-1); });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  await waitFor(() => expect(screen.getByRole("button", { name: t.retry })).toBeEnabled());
  read.mockImplementationOnce(() => newer.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  await act(async () => older.resolve(snapshotA));
  expect(screen.getByRole("button", { name: t.retry })).toBeDisabled();
  expect(screen.getByText(t.loading)).toHaveAttribute("role", "status");
  expect(screen.getByLabelText(t.term)).toHaveValue(b.id);
  expect(router.state.location.search).toBe("?term=" + b.id);
  await act(async () => newer.resolve(snapshotB));
  expect(screen.getByRole("button", { name: t.retry })).toBeEnabled();
  view.unmount(); router.dispose();
});

it("blocks the retained-parent import reproduction and resolves it by explicitly excluding the conflicting session", async () => {
  const first = await store.reviewTimetable(sourceDraft());
  await store.saveTimetable(first, { confirmed: true, keepExistingKeys: [] });
  const incoming = structuredClone(first.draft); incoming.sourceId = "synthetic-parent-ui";
  const parentKey = incoming.sessions[0].courseKey;
  const other = incoming.courses.find(row => row.key !== parentKey)!;
  const parentIndex = incoming.courses.findIndex(row => row.key === parentKey);
  const router = createMemoryRouter([
    { path: "/courses/import", element: <TimetableImport store={store} initialDraft={incoming} /> },
    { path: "/", element: <p>Import saved destination</p> },
  ], { initialEntries: ["/courses/import"] });
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(within(screen.getByRole("region", { name: "Session 1" })).getByLabelText(tr("text_91")), { target: { value: other.key } });
  fireEvent.click(screen.getByRole("button", { name: tr("text_124") }));
  fireEvent.click(within(screen.getByRole("region", { name: `Course ${parentIndex + 1}` })).getByRole("button", { name: tr("text_86") }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(/original course.*excluded/i);
  expect(screen.getByRole("region", { name: "Session 1" })).toBeInTheDocument();
  expect(await store.listImportSources()).toHaveLength(1);
  fireEvent.click(within(screen.getByRole("region", { name: "Session 1" })).getByRole("button", { name: tr("text_98") }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Final review" }, { timeout: 5000 });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("checkbox", { name: tr("text_120") }));
  fireEvent.click(screen.getByRole("button", { name: tr("text_122") }));
  await screen.findByText("Import saved destination", {}, { timeout: 5000 });
  expect((await store.reopenImportSource(incoming.sourceId)).courses.some(row => row.key === parentKey)).toBe(false);
  expect(await store.courses.list()).toHaveLength(7);
  expect(await store.scheduleSessions.list()).toHaveLength(15);
  view.unmount(); router.dispose();
}, 15000);

it("keeps a pending course write in term A when Back targets B and discard is attempted", async () => {
  const { a, b, course } = await terms();
  const create = store.courses.create.bind(store.courses);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  vi.spyOn(store.courses, "create").mockImplementation(async input => { await gate; return create(input); });
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=" + b.id, "/courses?term=" + a.id], initialIndex: 1,
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: t.addCourse }));
  fill(t.name, "Pending A course"); fill(t.code, "PENDING-A"); fill(t.hours, "3");
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await act(async () => { await router.navigate(-1); });
  const discard = await screen.findByRole("button", { name: intro.discardAndLeave });
  expect(discard).toBeDisabled();
  expect(screen.getByText(intro.pendingWrite)).toHaveAttribute("role", "status");
  fireEvent.click(discard);
  expect(router.state.location.search).toBe("?term=" + a.id);
  await act(async () => release());
  await screen.findByRole("rowgroup", { name: "Pending A course" });
  await waitFor(() => expect(screen.queryByRole("button", { name: intro.discardAndLeave })).not.toBeInTheDocument());
  expect(screen.getByLabelText(t.term)).toBeEnabled();
  expect(router.state.location.search).toBe("?term=" + a.id);
  await act(async () => { await router.navigate(-1); });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  expect(screen.queryByRole("rowgroup", { name: "Pending A course" })).not.toBeInTheDocument();
  expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
  expect((await store.getTimetable(a.id)).courses.find(row => row.code === "PENDING-A")?.academicTermId).toBe(a.id);
  expect((await store.getTimetable(b.id)).courses).toEqual([]);
});

it("shows the explicit-new identity conflict in import review and permits selecting the saved session", async () => {
  const first = await store.reviewTimetable(sourceDraft());
  await store.saveTimetable(first, { confirmed: true, keepExistingKeys: [] });
  const incoming = sourceDraft(); incoming.sourceId = "new-choice-ui-source";
  incoming.term.id = first.draft.term.id;
  render(<MemoryRouter><TimetableImport store={store} initialDraft={incoming} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const identity = within(screen.getByRole("region", { name: "Session 1" })).getByLabelText(intro.identity);
  fireEvent.change(identity, { target: { value: "new" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("alert", {}, { timeout: 5000 })).toHaveTextContent(intro.newIdentityConflict);
  act(() => setLanguage("ar"));
  expect(screen.getByRole("alert")).toHaveTextContent(intro.newIdentityConflict);
  act(() => setLanguage("en"));
  fireEvent.change(identity, { target: { value: first.draft.sessions[0].id } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Final review" }, { timeout: 5000 });
  expect(await store.scheduleSessions.list()).toHaveLength(15);
}, 15000);

it("shares manual setup across mounts, rejects duplicate submissions, and waits for explicit continuation", async () => {
  const create = store.academicTerms.create.bind(store.academicTerms);
  let release!: () => void;
  const gate = new Promise<void>(done => { release = done; });
  const write = vi.spyOn(store.academicTerms, "create").mockImplementation(async input => { await gate; return create(input); });
  const mount = () => render(<MemoryRouter initialEntries={["/setup"]}><Probe /><ManualSetup source={store} /></MemoryRouter>);
  const first = mount();
  fill(intro.name, "Shared synthetic term"); fill(intro.year, "2040/2041");
  fireEvent.click(screen.getByRole("button", { name: intro.create }));
  first.unmount();
  const second = mount();
  expect(screen.getByLabelText(intro.name)).toHaveValue("Shared synthetic term");
  expect(screen.getByRole("button", { name: intro.cancel })).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: intro.create }).closest("form")!);
  expect(write).toHaveBeenCalledOnce();
  await act(async () => release());
  await screen.findByText(intro.createdTerm);
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/setup");
  expect(introductionComplete()).toBe(false);
  expect(await store.academicTerms.list()).toHaveLength(1);
  second.unmount(); mount();
  fireEvent.click(screen.getByRole("button", { name: intro.openTerm }));
  const term = (await store.academicTerms.list())[0];
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term=" + term.id);
  expect(write).toHaveBeenCalledOnce();
});

it("preserves a failed manual operation across remount and retries it through repository validation", async () => {
  const first = render(<MemoryRouter><ManualSetup source={store} /></MemoryRouter>);
  fill(intro.name, "Retry synthetic term"); fill(intro.year, "2040/2041"); fill(intro.semester, "0");
  fireEvent.submit(screen.getByRole("button", { name: intro.create }).closest("form")!);
  await screen.findByRole("alert");
  first.unmount();
  render(<MemoryRouter><Probe /><ManualSetup source={store} /></MemoryRouter>);
  expect(screen.getByLabelText(intro.name)).toHaveValue("Retry synthetic term");
  expect(screen.getByLabelText(intro.semester)).toHaveValue(0);
  expect(await store.academicTerms.list()).toEqual([]);
  fill(intro.semester, "1");
  fireEvent.click(screen.getByRole("button", { name: intro.create }));
  await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term="));
  expect(await store.academicTerms.list()).toHaveLength(1);
});

function TimetableProbe({ source, next }: { source: TimetableStore; next: string }) {
  const { data, loading, error, refresh } = useTimetable(source);
  return <><output aria-label="Snapshot term">{data?.termId ?? "none"}</output>
    <output aria-label="Read state">{loading ? "loading" : error ? "error" : "ready"}</output>
    <button onClick={() => refresh()}>Refresh snapshot</button>
    <button onClick={() => refresh(next)}>Select next term</button></>;
}
it("refreshes repeatedly without adding history entries or changing the default-term URL", async () => {
  const { a } = await terms();
  const router = createMemoryRouter([
    { path: "/", element: <p>Earlier page</p> },
    { path: "/calendar", element: <TimetableProbe source={store} next={a.id} /> },
  ], { initialEntries: ["/", "/calendar?term=" + a.id], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Read state")).toHaveTextContent("ready"));
  const key = router.state.location.key;
  for (let i = 0; i < 3; i++) {
    fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
    await waitFor(() => expect(screen.getByLabelText("Read state")).toHaveTextContent("ready"));
    expect(router.state.location.key).toBe(key);
  }
  await act(async () => { await router.navigate(-1); });
  await screen.findByText("Earlier page");
  await act(async () => { await router.navigate("/calendar"); });
  await waitFor(() => expect(screen.getByLabelText("Read state")).toHaveTextContent("ready"));
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  await waitFor(() => expect(screen.getByLabelText("Read state")).toHaveTextContent("ready"));
  expect(router.state.location.search).toBe("");
});

it("clears old term data during Back/Forward reads, fails explicitly, and retries the intended term", async () => {
  const { a, b } = await terms();
  const get = store.getTimetable.bind(store);
  const router = createMemoryRouter([{ path: "/calendar", element: <TimetableProbe source={store} next={b.id} /> }], {
    initialEntries: ["/calendar?term=" + b.id, "/calendar?term=" + a.id], initialIndex: 1,
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(screen.getByLabelText("Snapshot term")).toHaveTextContent(a.id));
  let reject!: (error: Error) => void;
  const read = vi.spyOn(store, "getTimetable").mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await act(async () => { await router.navigate(-1); });
  expect(screen.getByLabelText("Read state")).toHaveTextContent("loading");
  expect(screen.getByLabelText("Snapshot term")).toHaveTextContent("none");
  await act(async () => reject(new Error("Read unavailable")));
  expect(screen.getByLabelText("Read state")).toHaveTextContent("error");
  expect(screen.getByLabelText("Snapshot term")).toHaveTextContent("none");
  read.mockImplementation(get);
  fireEvent.click(screen.getByRole("button", { name: "Refresh snapshot" }));
  await waitFor(() => expect(screen.getByLabelText("Snapshot term")).toHaveTextContent(b.id));
  expect(read).toHaveBeenLastCalledWith(b.id);
  let resolveA!: (snapshot: Awaited<ReturnType<typeof get>>) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolveA = done; }));
  await act(async () => { await router.navigate(1); });
  expect(screen.getByLabelText("Read state")).toHaveTextContent("loading");
  expect(screen.getByLabelText("Snapshot term")).toHaveTextContent("none");
  await act(async () => resolveA(await get(a.id)));
  await waitFor(() => expect(screen.getByLabelText("Snapshot term")).toHaveTextContent(a.id));
  let resolveB!: (snapshot: Awaited<ReturnType<typeof get>>) => void;
  read.mockImplementationOnce(() => new Promise(done => { resolveB = done; }));
  await act(async () => { await router.navigate(-1); });
  // Return before B resolves: cached A must still enter a new loading request.
  read.mockImplementationOnce(() => new Promise(done => { resolveA = done; }));
  await act(async () => { await router.navigate(1); });
  expect(screen.getByLabelText("Read state")).toHaveTextContent("loading");
  await act(async () => resolveB(await get(b.id)));
  expect(screen.getByLabelText("Read state")).toHaveTextContent("loading");
  await act(async () => resolveA(await get(a.id)));
  await waitFor(() => expect(screen.getByLabelText("Snapshot term")).toHaveTextContent(a.id));
});

it.each(["new", "existing"])("binds a dirty %s course editor to its opening term and prevents URL retargeting", async kind => {
  const { a, b, course } = await terms();
  courseRoute(a, b);
  await screen.findByRole("rowgroup", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: kind === "new" ? t.addCourse : t.editCourse }));
  fill(t.name, "Retained synthetic draft");
  if (kind === "new") { fill(t.code, "DRAFT-A"); fill(t.hours, "3"); }
  fireEvent.click(screen.getByRole("button", { name: "Change route" }));
  await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term=" + a.id));
  expect(screen.getByLabelText(t.name, { exact: true })).toHaveValue("Retained synthetic draft");
  expect(screen.getByLabelText(t.term)).toBeDisabled();
  expect(screen.getByText(intro.finishEditing)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await screen.findByRole("rowgroup", { name: "Retained synthetic draft" });
  expect((await store.getTimetable(b.id)).courses).toEqual([]);
  expect((await store.getTimetable(a.id)).courses.find(row => row.name === "Retained synthetic draft")?.academicTermId).toBe(a.id);
});

it("synchronizes a term selection to the URL, loads it, and restores it after remount", async () => {
  const { a, b, course } = await terms();
  const view = courseRoute(a, b);
  await screen.findByRole("rowgroup", { name: course.name });
  fireEvent.change(screen.getByLabelText(t.term), { target: { value: b.id } });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  const path = screen.getByLabelText("Current route").textContent!;
  expect(path).toBe("/courses?term=" + b.id);
  view.unmount(); courseRoute(a, b, path);
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
});

it("sets loading state during a term transition and does not leave old records editable", async () => {
  const { a, b, course } = await terms();
  courseRoute(a, b); await screen.findByRole("rowgroup", { name: course.name });
  const get = store.getTimetable.bind(store);
  let resolve!: (value: Awaited<ReturnType<typeof get>>) => void;
  vi.spyOn(store, "getTimetable").mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.change(screen.getByLabelText(t.term), { target: { value: b.id } });
  expect(await screen.findByText(t.loading)).toHaveAttribute("role", "status");
  expect(screen.getByRole("button", { name: t.editCourse })).toBeDisabled();
  await act(async () => resolve(await get(b.id)));
  await waitFor(() => expect(screen.queryByText(t.loading)).not.toBeInTheDocument());
});

it.each(["malformed", "missing", "deleted"] as const)("recovers a %s term URL without leaving old records editable or loading forever", async kind => {
  const { a, b, course } = await terms();
  let unavailableId = kind === "malformed" ? "invalid" : crypto.randomUUID();
  if (kind === "deleted") {
    const removed = await store.academicTerms.create({ name: "Synthetic removed term", academicYear: "2030/2031", semester: 1 });
    unavailableId = removed.id;
    await store.academicTerms.delete(removed.id, { expectedRevision: removed.revision });
  }
  const read = vi.spyOn(store, "getTimetable");
  render(<MemoryRouter initialEntries={["/courses?term=" + a.id]}><Probe jump={"/courses?term=" + unavailableId} /><Courses store={store} /></MemoryRouter>);
  await screen.findByRole("rowgroup", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: "Change route" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("rowgroup", { name: course.name })).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: t.retry });
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term=" + b.id));
  expect(read).toHaveBeenNthCalledWith(3, unavailableId);
  expect(read).toHaveBeenLastCalledWith();
});

it("does not fall back when an invalid-term retry rejects after Courses navigation", async () => {
  const { b } = await terms();
  const router = createMemoryRouter([{ path: "/courses", element: <Courses store={store} /> }], {
    initialEntries: ["/courses?term=invalid"],
  });
  const view = render(<RouterProvider router={router} />);
  await screen.findByRole("alert");
  const pending = deferred<Awaited<ReturnType<typeof store.getTimetable>>>();
  const read = vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: t.retry }));
  expect(read).toHaveBeenCalledExactlyOnceWith("invalid");
  await act(async () => { await router.navigate("/courses?term=" + b.id); });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  const key = router.state.location.key;
  await act(async () => pending.reject(new DataError("VALIDATION", "Synthetic invalid UUID")));
  expect(read.mock.calls).toEqual([["invalid"], [b.id]]);
  expect(router.state.location.search).toBe("?term=" + b.id);
  expect(router.state.location.key).toBe(key);
  expect(screen.getByLabelText(t.term)).toHaveValue(b.id);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(t.loading)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: t.retry })).toBeEnabled();
  view.unmount(); router.dispose();
});

it("blocks browser history navigation until the user keeps or explicitly discards the editor", async () => {
  const { a, course } = await terms();
  const router = createMemoryRouter([
    { path: "/", element: <p>Previous page</p> },
    { path: "/courses", element: <Courses store={store} /> },
  ], { initialEntries: ["/", "/courses?term=" + a.id], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  await screen.findByRole("rowgroup", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: t.editCourse }));
  fill(t.name, "Keep this dirty draft");
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(await screen.findByRole("button", { name: intro.keepEditing }));
  expect(screen.getByLabelText(t.name, { exact: true })).toHaveValue("Keep this dirty draft");
  await act(async () => { await router.navigate(-1); });
  fireEvent.click(await screen.findByRole("button", { name: intro.discardAndLeave }));
  await screen.findByText("Previous page");
  expect((await store.courses.get(course.id))?.name).toBe(course.name);
});

it("reopens a saved source after confirmed course removal and visibly explains omitted records in both languages", async () => {
  const first = await store.reviewTimetable(sourceDraft());
  expect((await store.saveTimetable(first, { confirmed: true, keepExistingKeys: [] })).committed).toBe(true);
  const removed = first.draft.courses[0];
  const view = render(<MemoryRouter initialEntries={["/courses?term=" + first.draft.term.id]}>
    <Probe jump={"/courses/import?source=" + first.draft.sourceId} />
    <Routes><Route path="/courses" element={<Courses store={store} />} />
      <Route path="/courses/import" element={<TimetableImport store={store} />} /></Routes>
  </MemoryRouter>);
  const card = await screen.findByRole("rowgroup", { name: removed.name });
  fireEvent.click(within(card).getByRole("button", { name: t.removeCourse }));
  const confirmation = await screen.findByRole("region", { name: t.confirmDelete });
  fireEvent.click(within(confirmation).getByRole("button", { name: t.confirmDelete }));
  await waitFor(() => expect(screen.queryByRole("rowgroup", { name: removed.name })).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Change route" }));
  await screen.findByDisplayValue(first.draft.term.name);
  expect(screen.getByRole("region", { name: intro.omittedDeletedRows })).toHaveTextContent(removed.name);
  expect(within(screen.getByRole("region", { name: intro.omittedDeletedRows })).getAllByRole("listitem"))
    .toHaveLength(1 + first.draft.sessions.filter(row => row.courseKey === removed.key).length);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  act(() => setLanguage("ar"));
  expect(screen.getByRole("region", { name: intro.omittedDeletedRows })).toHaveTextContent(removed.name);
  act(() => setLanguage("en"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByRole("region", { name: /^Course \d/ })).toHaveLength(6);
  expect(screen.queryByDisplayValue(removed.name)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getAllByRole("region", { name: /^Session \d/ })).toHaveLength(first.draft.sessions.filter(row => row.courseKey !== removed.key).length);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Final review" });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  view.unmount();
  render(<MemoryRouter initialEntries={["/courses/import?source=" + first.draft.sourceId]}><TimetableImport store={store} /></MemoryRouter>);
  await screen.findByRole("region", { name: intro.omittedDeletedRows });
  expect(await store.courses.get(removed.id!)).toBeUndefined();
});

it("reopens the import route using discoverable stored mappings and reviews an edited time", async () => {
  const first = await store.reviewTimetable(sourceDraft());
  await store.saveTimetable(first, { confirmed: true, keepExistingKeys: [] });
  const original = first.draft.sessions[0];
  await store.scheduleSessions.update(original.id!, { startTime: "07:30" }, 1);
  const mount = (path: string) => render(<MemoryRouter initialEntries={[path]}><Probe /><TimetableImport store={store} /></MemoryRouter>);
  let view = mount("/courses/import");
  fireEvent.change(await screen.findByLabelText(intro.source), { target: { value: first.draft.sourceId } });
  fireEvent.click(screen.getByRole("button", { name: intro.openSource }));
  await screen.findByDisplayValue(first.draft.term.name);
  const path = screen.getByLabelText("Current route").textContent!;
  expect(new URLSearchParams(path.split("?")[1]).get("source")).toBe(first.draft.sourceId);
  view.unmount(); view = mount(path);
  await screen.findByDisplayValue(first.draft.term.name);
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const region = screen.getAllByRole("region", { name: /^Session \d/ }).find(region => within(region).queryByDisplayValue("07:30"))!;
  fireEvent.change(within(region).getByLabelText("Start time (HH:mm)"), { target: { value: original.startTime } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Final review" }, { timeout: 5000 });
  expect(screen.getByText("07:30", { exact: true })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/keep/i);
  expect(await store.scheduleSessions.list()).toHaveLength(15);
  expect((await store.scheduleSessions.get(original.id!))?.startTime).toBe("07:30");
  act(() => setLanguage("ar"));
  expect(screen.getByText(tr("text_189"), { exact: true })).toBeInTheDocument();
  view.unmount();
}, 15000);

it("requires explicit identity resolution in review when an incoming session no longer matches", async () => {
  const first = await store.reviewTimetable(sourceDraft());
  await store.saveTimetable(first, { confirmed: true, keepExistingKeys: [] });
  const original = first.draft.sessions[0];
  await store.scheduleSessions.update(original.id!, { startTime: "07:30" }, 1);
  const incoming = sourceDraft(); incoming.sourceId = "different-synthetic-source"; incoming.term.id = first.draft.term.id;
  render(<MemoryRouter><TimetableImport store={store} initialDraft={incoming} /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Next" })).toBeEnabled());
  expect(await screen.findByRole("alert")).toHaveTextContent(intro.resolveIdentity);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  const region = screen.getByRole("region", { name: "Session 1" });
  await waitFor(() => expect(within(region).getByLabelText(intro.identity).querySelector(`option[value="${original.id}"]`)).not.toBeNull());
  fireEvent.change(within(region).getByLabelText(intro.identity), { target: { value: original.id } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByRole("heading", { name: "Final review" }, { timeout: 5000 });
  expect(screen.getByText("07:30", { exact: true })).toBeInTheDocument();
}, 10000);

it("disables manual cancellation, prevents duplicate submits, and never navigates back after leaving a pending save", async () => {
  let resolve!: (value: { id: string }) => void;
  const create = vi.fn(() => new Promise<{ id: string }>(done => { resolve = done; }));
  const source = { academicTerms: { create } } as unknown as Pick<ReturnType<typeof createAcademicStore>, "academicTerms">;
  function Leave() { const navigate = useNavigate(); return <button onClick={() => navigate("/elsewhere")}>Leave page</button>; }
  render(<MemoryRouter initialEntries={["/setup"]}><Probe /><Leave /><Routes>
    <Route path="/setup" element={<ManualSetup source={source} />} />
    <Route path="*" element={<p>Elsewhere</p>} />
  </Routes></MemoryRouter>);
  fill(intro.name, "Synthetic pending term"); fill(intro.year, "2035/2036");
  const form = screen.getByRole("button", { name: intro.create }).closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(create).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: intro.cancel })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Leave page" }));
  await act(async () => resolve({ id: crypto.randomUUID() }));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/elsewhere");
  expect(introductionComplete()).toBe(false);
});

it("preserves persisted completion after replay is started and abandoned", async () => {
  finishIntroduction();
  const view = render(<MemoryRouter initialEntries={["/settings"]}><Routes><Route path="/settings" element={<Settings />} /><Route path="/" element={<Home source={{ getAcademicPresence: async () => ({ hasRecords: false }) }} />} /></Routes></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: intro.replay }));
  await screen.findByRole("button", { name: intro.tour });
  view.unmount();
  expect(localStorage.getItem("unicore.onboarding.complete")).toBe("done");
  render(<MemoryRouter><Home source={{ getAcademicPresence: async () => ({ hasRecords: false }) }} /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Welcome to UniCore" });
  expect(screen.queryByRole("button", { name: intro.tour })).not.toBeInTheDocument();
});

it("focuses each tour step, announces progress, and preserves the step on language change", () => {
  render(<Introduction onDone={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: intro.tour }));
  expect(screen.getByRole("heading", { name: "Dashboard" })).toHaveFocus();
  expect(screen.getByRole("status")).toHaveTextContent("Step 1 / 4");
  act(() => setLanguage("ar"));
  expect(screen.getByRole("heading", { name: intro.dashboard })).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: intro.skip }));
  expect(screen.getByRole("heading", { level: 2, name: intro.choices })).toHaveFocus();
});

it("consumes success history state once and preserves the exact imported term and course link context", async () => {
  const { a, course } = await terms();
  const now = new Date(), dayOfWeek = now.getDay() || 7;
  await store.saveManagedSession({ academicTermId: a.id, courseId: course.id, dayOfWeek, startTime: "08:00", endTime: "09:00", deliveryMode: "online" });
  const initial = { pathname: "/", state: { timetableSaved: true, termId: a.id, unrelated: "retain" } };
  let consumed: { pathname: string; state: unknown };
  function Capture() { const location = useLocation(); useEffect(() => { consumed = { pathname: location.pathname, state: location.state }; }, [location]); return <Probe />; }
  const view = render(<MemoryRouter initialEntries={[initial]}><Capture /><Dashboard store={store} /></MemoryRouter>);
  await screen.findByText(intro.saved);
  await waitFor(() => expect(screen.getByLabelText("Saved navigation flag")).toHaveTextContent("false"));
  expect(consumed!.state).toEqual({ termId: a.id, unrelated: "retain" });
  const links = await screen.findAllByRole("link", { name: new RegExp(course.name) });
  expect(links.every(link => link.getAttribute("href") === `/courses?term=${a.id}#course-${course.id}`)).toBe(true);
  view.unmount();
  render(<MemoryRouter initialEntries={[consumed!]}><Dashboard store={store} /></MemoryRouter>);
  await screen.findAllByText(a.name);
  expect(screen.queryByText(intro.saved)).not.toBeInTheDocument();
});

it("preserves term context in both desktop and mobile academic navigation", () => {
  const termId = crypto.randomUUID();
  render(<MemoryRouter initialEntries={[`/calendar?term=${termId}`]}><App /></MemoryRouter>);
  for (const [label, path] of [["Dashboard", "/"], ["Courses", "/courses"], ["Calendar", "/calendar"]]) {
    const links = screen.getAllByRole("link", { name: label });
    expect(links).toHaveLength(2);
    links.forEach(link => expect(link).toHaveAttribute("href", `${path}?term=${termId}`));
  }
});
