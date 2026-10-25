import "fake-indexeddb/auto";
import Dexie from "dexie";
import { Blob as StoredBlob } from "node:buffer";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAcademicStore, DataError, type AcademicTerm, type Course, type ImportMapping, type ScheduleSession } from "../data";
import { UniCoreDatabase } from "../data/database";
import { Dashboard } from "../pages/Dashboard";
import { Lectures } from "../pages/Lectures";
import { dashboardOccurrences, dashboardSchedule, occurrenceLectures } from "../features/dashboard/overview";
import { localDate } from "../features/timetable/time";
import { setLanguage } from "../i18n/locale";
import { dashboardText as c } from "../i18n/dashboard";
import { dailyText as d } from "../i18n/daily";

const meta = { createdAt: 1, updatedAt: 1, revision: 1, deletedAt: null };
const term: AcademicTerm = { ...meta, id: "term-a", name: "Synthetic semester A", academicYear: "2030/2031", semester: 1 };
const course: Course = { ...meta, id: "course-a", academicTermId: term.id, code: "SYN-A", name: "Synthetic computing", registeredHours: 3 };
const session: ScheduleSession = { ...meta, id: "session-a", courseId: course.id, academicTermId: term.id, dayOfWeek: 7, startTime: "09:00", endTime: "10:00", deliveryMode: "online", location: "Local online classroom" };
const lecture = { id: "lecture-a", courseId: course.id, scheduleSessionId: session.id, date: "2030-10-13", title: "Synthetic first lecture", hasNotes: true };
const sunday = (time = "08:00") => new Date(`2030-10-13T${time}:00`);
type Snapshot = Awaited<ReturnType<ReturnType<typeof createAcademicStore>["getDashboard"]>>;
const snapshot = (): Snapshot => ({ terms: [term], termId: term.id, courses: [course], sessions: [session], lectures: [lecture] });
function mockStore(value = snapshot()) {
  return { getTimetable: vi.fn().mockResolvedValue(value), getDashboard: vi.fn().mockResolvedValue(value) };
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
function mount(store: Parameters<typeof Dashboard>[0]["store"], path = "/?term=" + term.id) {
  const router = createMemoryRouter([{ path: "*", element: <Dashboard store={store} /> }], { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}
beforeEach(() => { setLanguage("en"); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(sunday()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); setLanguage("ar"); localStorage.clear(); });

describe("Dashboard local calendar projection", () => {
  it("orders all today's classes by time then UUID, retaining concurrent meetings", () => {
    const later = { ...session, id: "later", startTime: "11:00", endTime: "12:00" };
    const tie = { ...session, id: "session-b" };
    const result = dashboardOccurrences([later, tie, session], sunday(), term);
    expect(result.today.map(row => row.id)).toEqual([session.id, tie.id, later.id]);
    expect(result.upcoming.map(row => row.session.id)).toEqual([session.id, tie.id, later.id]);
  });
  it("finds the next week across Sunday/Monday without treating an ongoing meeting as future", () => {
    const monday = { ...session, id: "monday", dayOfWeek: 1, startTime: "08:00", endTime: "09:00" };
    const result = dashboardOccurrences([session, monday], sunday("09:30"), term);
    expect(result.upcoming.map(row => [row.session.id, localDate(row.starts)])).toEqual([
      ["monday", "2030-10-14"], [session.id, "2030-10-20"],
    ]);
  });
  it("respects inclusive term boundaries, future terms and ended terms", () => {
    expect(dashboardOccurrences([session], sunday(), { ...term, endDate: "2030-10-12" }).upcoming).toEqual([]);
    expect(dashboardOccurrences([session], sunday(), { ...term, endDate: "2030-10-13" }).today).toHaveLength(1);
    const future = dashboardOccurrences([session], sunday(), { ...term, startDate: "2030-12-01", endDate: "2030-12-01" });
    expect(future.today).toEqual([]);
    expect(future.upcoming.map(row => localDate(row.starts))).toEqual(["2030-12-01"]);
  });
  it("includes the exact seven-day boundary but excludes the next minute beyond it", () => {
    const exact = { ...session, id: "boundary", startTime: "08:30", endTime: "09:00" };
    const after = { ...exact, id: "after-boundary", startTime: "08:31" };
    const result = dashboardOccurrences([after, exact], sunday("08:30"), term);
    expect(result.upcoming.map(row => [row.session.id, localDate(row.starts)])).toEqual([
      [after.id, "2030-10-13"], [exact.id, "2030-10-20"],
    ]);
    expect(result.until.getTime()).toBe(new Date(2030, 9, 20, 8, 30).getTime());
  });
  it("keeps calendar-day endpoints at the local hour across an autumn DST transition", () => {
    const now = new Date(2030, 10, 2, 12);
    const result = dashboardOccurrences([session], now, term);
    expect(localDate(result.until)).toBe("2030-11-09");
    expect(result.until.getHours()).toBe(12);
    expect(result.upcoming[0].starts.getHours()).toBe(9);
    expect(localDate(result.upcoming[0].starts)).toBe("2030-11-03");
    const offsetChange = result.until.getTimezoneOffset() - now.getTimezoneOffset();
    expect(result.until.getTime() - now.getTime()).toBe((7 * 24 * 60 + offsetChange) * 60000);
  });
  it("uses local midnight and calendar dates across month/year changes", () => {
    const now = new Date(2030, 11, 31, 23, 59);
    const next = { ...session, dayOfWeek: new Date(2031, 0, 1).getDay() || 7, startTime: "00:01", endTime: "01:00" };
    const result = dashboardOccurrences([next], now, term);
    expect(localDate(result.upcoming[0].starts)).toBe("2031-01-01");
    expect(result.upcoming[0].starts.getHours()).toBe(0);
    expect(result.today).toEqual([]);
  });
  it("does not silently move a nonexistent DST wall-clock time to another hour", () => {
    const date = new Date(2030, 2, 10, 0, 0);
    const missingHour = { ...session, dayOfWeek: date.getDay() || 7, startTime: "02:30", endTime: "03:30" };
    const exists = new Date(2030, 2, 10, 2, 30).getHours() === 2;
    const result = dashboardOccurrences([missingHour], date, { ...term, endDate: "2030-03-10" });
    expect(result.today).toHaveLength(exists ? 1 : 0);
    expect(result.upcoming).toHaveLength(exists ? 1 : 0);
    expect(result.invalidLocal).toBe(exists ? 0 : 1);
  });
  it.each([
    { startTime: "" }, { startTime: undefined }, { startTime: "25:00" }, { endTime: "08:00" },
    { dayOfWeek: 99 }, { deliveryMode: "unknown" }, { courseId: "missing" },
  ])("excludes damaged schedule values without repairing them: %j", (patch) => {
    const damaged = { ...session, ...patch } as ScheduleSession;
    const before = structuredClone(damaged);
    const result = dashboardSchedule([course], [damaged], term);
    expect(result.sessions).toEqual([]); expect(result.invalid).toBe(1);
    expect(damaged).toEqual(before);
  });
  it("excludes deleted records and other terms without counting them as damaged", () => {
    const result = dashboardSchedule([course, { ...course, id: "removed", deletedAt: 2 }], [
      session, { ...session, id: "removed", deletedAt: 2 }, { ...session, academicTermId: "other" },
    ], term);
    expect(result.courses).toEqual([course]); expect(result.sessions).toEqual([session]); expect(result.invalid).toBe(0);
    expect(dashboardOccurrences([session], sunday(), undefined).upcoming).toEqual([]);
  });
  it("matches only explicit course/session/date links and preserves multiple matches", () => {
    const second = { ...lecture, id: "lecture-b" };
    expect(occurrenceLectures([lecture, second, { ...lecture, scheduleSessionId: null },
      { ...lecture, date: "2030-10-14" }, { ...lecture, courseId: "another" }], session, sunday())).toEqual([lecture, second]);
  });
});

describe("Dashboard overview and navigation", () => {
  it.each([["08:00", "upcoming"], ["09:00", "ongoing"], ["10:00", "completed"], ["23:59", "completed"]] as const)("labels today's meeting at %s as %s without creating a lecture", async (time, status) => {
    vi.setSystemTime(sunday(time)); const value = snapshot(); value.lectures = [];
    mount(mockStore(value));
    const today = await screen.findByRole("list", { name: d.today });
    expect(within(today).getByText(d[status])).toBeInTheDocument();
    expect(within(today).getByText(c.noLecture)).toBeInTheDocument();
  });
  it("uses actual term counters, selected window and saved-note metadata without polling reads", async () => {
    const store = mockStore(); mount(store);
    await screen.findByRole("list", { name: d.today });
    for (const [label, value] of [[d.courses, "1"], [d.sessions, "1"], [d.credits, "3"], [c.todayCount, "1"], [c.upcomingCount, "1"], [c.recorded, "1"], [c.notes, "1"]]) {
      expect(screen.getByText(label, { selector: "span" }).parentElement?.querySelector("strong")?.textContent).toBe(value);
    }
    await act(async () => { vi.setSystemTime(sunday("09:30")); await new Promise(resolve => setTimeout(resolve, 1100)); });
    expect(within(screen.getByRole("list", { name: d.today })).getByText(d.ongoing)).toBeInTheDocument();
    expect(store.getDashboard).toHaveBeenCalledExactlyOnceWith(term.id);
    expect(store.getTimetable).not.toHaveBeenCalled();
  });
  it("shows all concurrent classes with explicit overlap and status; future items include full details", async () => {
    vi.setSystemTime(sunday("09:30"));
    const value = snapshot(); value.sessions.push({ ...session, id: "session-b", startTime: "09:15", endTime: "11:00" });
    mount(mockStore(value));
    const today = await screen.findByRole("list", { name: d.today });
    expect(within(today).getAllByText(d.ongoing)).toHaveLength(2);
    expect(within(today).getAllByText(c.overlap)).toHaveLength(2);
    const upcoming = screen.getByRole("list", { name: c.upcoming });
    expect(within(upcoming).getAllByText(/09:00–10:00/)).toHaveLength(1);
    expect(within(upcoming).getAllByText(/Local online classroom/)).toHaveLength(2);
    expect(within(upcoming).getAllByText("SYN-A")).toHaveLength(2);
  });
  it("opens every matching lecture explicitly; unmatched sessions lead to the existing course flow", async () => {
    const value = snapshot(); value.lectures.push({ ...lecture, id: "lecture-b", title: "Synthetic second lecture" });
    value.sessions.push({ ...session, id: "monday", dayOfWeek: 1 });
    mount(mockStore(value));
    const today = await screen.findByRole("list", { name: d.today });
    expect(within(today).getByText(c.choose)).toBeInTheDocument();
    for (const id of ["lecture-a", "lecture-b"]) expect(within(today).getAllByRole("link").some(link => link.getAttribute("href") === `/lectures?term=term-a&course=course-a&lecture=${id}`)).toBe(true);
    const unmatched = within(screen.getByRole("list", { name: c.upcoming })).getByText(c.noLecture).closest("li")!;
    expect(within(unmatched).queryByRole("link", { name: /Open lecture/ })).not.toBeInTheDocument();
    expect(within(unmatched).getByRole("link")).toHaveAttribute("href", "/courses?term=term-a#course-course-a");
  });
  it("shows damaged-session warning and empty states without creating an academic record", async () => {
    const value = snapshot(); value.sessions = [{ ...session, startTime: "bad" }]; value.lectures = [];
    const store = mockStore(value); mount(store);
    expect(await screen.findByRole("alert")).toHaveTextContent(c.invalid);
    expect(screen.getByText(d.none)).toBeInTheDocument(); expect(screen.getByText(c.noUpcoming)).toBeInTheDocument();
    expect(screen.getByText(c.noSaved)).toBeInTheDocument(); expect(screen.queryByRole("timer")).not.toBeInTheDocument();
    expect(value.sessions[0].startTime).toBe("bad");
  });
  it("handles no term and a valid term with no courses explicitly", async () => {
    const store = mockStore(); store.getDashboard.mockResolvedValueOnce({ terms: [], termId: undefined, courses: [], sessions: [], lectures: [] });
    const first = mount(store);
    await screen.findByRole("link", { name: /Review and import timetable/ });
    expect(screen.queryByRole("list", { name: d.today })).not.toBeInTheDocument(); first.unmount();
    store.getDashboard.mockResolvedValueOnce({ ...snapshot(), courses: [], sessions: [], lectures: [] }); mount(store);
    expect(await screen.findByText(c.noSaved)).toBeInTheDocument(); expect(screen.getByText(d.none)).toBeInTheDocument();
  });
  it("changes languages without changing data or rereading the database", async () => {
    const store = mockStore(); mount(store); await screen.findByRole("list", { name: d.today });
    act(() => setLanguage("ar"));
    expect(screen.getByRole("heading", { name: "الجلسات المجدولة القادمة" })).toBeInTheDocument();
    expect(screen.getByText("المحاضرات المحفوظة", { selector: "span" })).toBeInTheDocument();
    expect(screen.getAllByText(course.name).length).toBeGreaterThan(0);
    expect(store.getDashboard).toHaveBeenCalledTimes(1);
  });
  it("refreshes the same selected term after failure, never selecting the default term", async () => {
    const store = mockStore(); store.getDashboard.mockRejectedValueOnce(new DataError("UNAVAILABLE", "Synthetic storage failure"));
    const { router } = mount(store);
    await screen.findByRole("alert"); expect(router.state.location.search).toBe("?term=term-a");
    fireEvent.click(screen.getByRole("button", { name: d.refresh }));
    await screen.findByRole("list", { name: d.today });
    expect(store.getDashboard.mock.calls).toEqual([[term.id], [term.id]]);
    expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(term.id);
    expect(router.state.location.search).toBe("?term=term-a");
  });
  it("does not let late term reads overwrite navigation, loading, lecture links or errors", async () => {
    const a = deferred<ReturnType<typeof snapshot>>(), b = deferred<ReturnType<typeof snapshot>>();
    const store = mockStore(); store.getDashboard.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { router } = mount(store);
    await waitFor(() => expect(store.getDashboard).toHaveBeenCalledWith(term.id));
    await act(async () => { await router.navigate("/?term=term-b"); });
    await act(async () => a.resolve(snapshot()));
    expect(screen.queryByRole("list", { name: d.today })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => b.reject(new DataError("UNAVAILABLE", "Synthetic error")));
    expect(screen.getByRole("alert")).toBeInTheDocument(); expect(router.state.location.search).toBe("?term=term-b");
    expect(screen.queryByRole("link", { name: /Open lecture/ })).not.toBeInTheDocument();
  });
  it("keeps selector, URL, lecture links and Back/Forward loading bound to the same term", async () => {
    const secondTerm = { ...term, id: "term-b", name: "Synthetic semester B" };
    const a = { ...snapshot(), terms: [term, secondTerm] };
    const b = { ...a, termId: secondTerm.id,
      courses: [{ ...course, id: "course-b", academicTermId: secondTerm.id }],
      sessions: [{ ...session, courseId: "course-b", academicTermId: secondTerm.id }],
      lectures: [{ ...lecture, id: "lecture-b", courseId: "course-b" }] };
    const pendingB = deferred<typeof b>(), pendingA = deferred<typeof a>();
    const store = mockStore(a); store.getDashboard.mockReturnValueOnce(Promise.resolve(a)).mockReturnValueOnce(pendingB.promise).mockReturnValueOnce(pendingA.promise).mockResolvedValue(b);
    const { router } = mount(store);
    await screen.findByRole("list", { name: d.today });
    fireEvent.change(screen.getByRole("combobox", { name: d.term }), { target: { value: secondTerm.id } });
    await waitFor(() => expect(router.state.location.search).toBe("?term=term-b"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    await act(async () => pendingB.resolve(b));
    expect(screen.getByRole("combobox", { name: d.term })).toHaveValue("term-b");
    expect(screen.getAllByRole("link", { name: /Open lecture/ }).every(link => link.getAttribute("href")?.includes("term=term-b&course=course-b&lecture=lecture-b"))).toBe(true);
    await act(async () => { await router.navigate(-1); });
    expect(screen.getByRole("status")).toBeInTheDocument(); expect(screen.queryByRole("list", { name: d.today })).not.toBeInTheDocument();
    await act(async () => pendingA.resolve(a));
    expect(screen.getByRole("combobox", { name: d.term })).toHaveValue("term-a");
    expect(screen.getAllByRole("link", { name: /Open lecture/ }).every(link => link.getAttribute("href")?.includes("term=term-a&course=course-a&lecture=lecture-a"))).toBe(true);
    await act(async () => { await router.navigate(1); });
    await waitFor(() => expect(screen.getByRole("combobox", { name: d.term })).toHaveValue("term-b"));
  });
});

describe("Dashboard real read-only service", () => {
  it("scopes records by active term/course, excludes tombstones, never reads file tables or writes, and preserves Blobs/revisions/mappings", async () => {
    vi.stubGlobal("Blob", StoredBlob);
    const db = new UniCoreDatabase("dashboard-" + crypto.randomUUID()), store = createAcademicStore(db.name);
    try {
      const a = await store.academicTerms.create({ name: "Synthetic A", academicYear: "2030/2031", semester: 1 });
      const b = await store.academicTerms.create({ name: "Synthetic B", academicYear: "2031/2032", semester: 1 });
      const ca = await store.courses.create({ academicTermId: a.id, code: "SYN-A", name: "Synthetic A", registeredHours: 3 });
      const cb = await store.courses.create({ academicTermId: b.id, code: "SYN-B", name: "Synthetic B", registeredHours: 2 });
      const la = await store.lectures.create({ courseId: ca.id, date: "2030-10-13", notes: "Private local synthetic notes" });
      await store.lectures.create({ courseId: cb.id, date: "2030-10-13" });
      const deleted = await store.lectures.create({ courseId: ca.id, date: "2030-10-12" });
      await store.lectures.delete(deleted.id, { expectedRevision: deleted.revision });
      const file = await store.lectureFiles.create({ lectureId: la.id, fileName: "synthetic.txt", blob: new StoredBlob(["synthetic bytes"], { type: "text/plain" }) as Blob });
      await db.open();
      await db.table("importMappings").put({ key: "synthetic-preserved-mapping", sourceId: "synthetic-source", sourceKey: "SYN-A", recordId: ca.id, entity: "courses", unconfirmed: [], createdAt: 1 } satisfies ImportMapping);
      const before = await Promise.all(db.tables.map(table => table.toArray()));
      const overview = await store.getDashboard(a.id);
      expect(overview.courses.map(row => row.id)).toEqual([ca.id]);
      expect(overview.lectures).toEqual([{ id: la.id, courseId: ca.id, scheduleSessionId: undefined, date: la.date, title: undefined, hasNotes: true }]);
      expect(JSON.stringify(overview)).not.toContain("Private local synthetic notes");
      const tableSpy = vi.spyOn(UniCoreDatabase.prototype, "records");
      await store.getDashboard(a.id);
      expect(tableSpy.mock.calls.map(([name]) => name)).not.toContain("lectureFiles");
      expect(tableSpy.mock.calls.map(([name]) => name)).not.toContain("materialFiles");
      tableSpy.mockRestore();
      expect(await Promise.all(db.tables.map(table => table.toArray()))).toEqual(before);
      const retained = await store.lectureFiles.get(file.id);
      expect(await retained!.blob.text()).toBe("synthetic bytes"); expect(retained!.revision).toBe(file.revision);
      const empty = await store.getDashboard(b.id); expect(empty.lectures).toHaveLength(1);
    } finally { store.close(); db.close(); await Dexie.delete(db.name); }
  });
  it("Dashboard lecture links open the exact workspace after a fresh route mount", async () => {
    const name = "dashboard-route-" + crypto.randomUUID(), store = createAcademicStore(name);
    try {
      const term = await store.academicTerms.create({ name: "Synthetic term", academicYear: "2030/2031", semester: 1 });
      const course = await store.courses.create({ academicTermId: term.id, code: "SYN", name: "Synthetic route course", registeredHours: 1 });
      const lecture = await store.lectures.create({ courseId: course.id, date: "2030-10-13", title: "Exact synthetic record", notes: "Persisted synthetic note" });
      const router = createMemoryRouter([{ path: "/", element: <Dashboard store={store} /> }, { path: "/lectures", element: <Lectures store={store} /> }], { initialEntries: ["/?term=" + term.id] });
      const view = render(<RouterProvider router={router} />);
      fireEvent.click(await screen.findByRole("link", { name: /Open lecture: Exact synthetic record/ }));
      expect(await screen.findByLabelText("Lecture notes")).toHaveValue("Persisted synthetic note");
      const url = router.state.location.pathname + router.state.location.search;
      expect(url).toBe(`/lectures?term=${term.id}&course=${course.id}&lecture=${lecture.id}`);
      view.unmount(); router.dispose();
      const fresh = createMemoryRouter([{ path: "*", element: <Lectures store={store} /> }], { initialEntries: [url] });
      const reopened = render(<RouterProvider router={fresh} />);
      expect(await screen.findByLabelText("Lecture notes")).toHaveValue("Persisted synthetic note");
      expect(screen.getByRole("link", { name: /Back to course/ })).toHaveAttribute("href", `/courses?term=${term.id}#course-${course.id}`);
      reopened.unmount(); fresh.dispose();
    } finally { store.close(); await Dexie.delete(name); }
  });
});
