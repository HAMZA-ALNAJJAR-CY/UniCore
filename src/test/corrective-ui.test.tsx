import "fake-indexeddb/auto";
import Dexie from "dexie";
import { useEffect } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAcademicStore, type AcademicTerm } from "../data";
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

it.each(["new", "existing"])("binds a dirty %s course editor to its opening term and prevents URL retargeting", async kind => {
  const { a, b, course } = await terms();
  courseRoute(a, b);
  await screen.findByRole("article", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: kind === "new" ? t.addCourse : t.editCourse }));
  fill(t.name, "Retained synthetic draft");
  if (kind === "new") { fill(t.code, "DRAFT-A"); fill(t.hours, "3"); }
  fireEvent.click(screen.getByRole("button", { name: "Change route" }));
  await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term=" + a.id));
  expect(screen.getByLabelText(t.name, { exact: true })).toHaveValue("Retained synthetic draft");
  expect(screen.getByLabelText(t.term)).toBeDisabled();
  expect(screen.getByText(intro.finishEditing)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t.save }));
  await screen.findByRole("article", { name: "Retained synthetic draft" });
  expect((await store.getTimetable(b.id)).courses).toEqual([]);
  expect((await store.getTimetable(a.id)).courses.find(row => row.name === "Retained synthetic draft")?.academicTermId).toBe(a.id);
});

it("synchronizes a term selection to the URL, loads it, and restores it after remount", async () => {
  const { a, b, course } = await terms();
  const view = courseRoute(a, b);
  await screen.findByRole("article", { name: course.name });
  fireEvent.change(screen.getByLabelText(t.term), { target: { value: b.id } });
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  const path = screen.getByLabelText("Current route").textContent!;
  expect(path).toBe("/courses?term=" + b.id);
  view.unmount(); courseRoute(a, b, path);
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  expect(screen.queryByRole("article", { name: course.name })).not.toBeInTheDocument();
});

it("sets loading state during a term transition and does not leave old records editable", async () => {
  const { a, b, course } = await terms();
  courseRoute(a, b); await screen.findByRole("article", { name: course.name });
  const get = store.getTimetable.bind(store);
  let resolve!: (value: Awaited<ReturnType<typeof get>>) => void;
  vi.spyOn(store, "getTimetable").mockImplementation(() => new Promise(done => { resolve = done; }));
  fireEvent.change(screen.getByLabelText(t.term), { target: { value: b.id } });
  expect(await screen.findByText(t.loading)).toHaveAttribute("role", "status");
  expect(screen.getByRole("button", { name: t.editCourse })).toBeDisabled();
  await act(async () => resolve(await get(b.id)));
  await waitFor(() => expect(screen.queryByText(t.loading)).not.toBeInTheDocument());
});

it("recovers an invalid term URL without leaving old records editable or loading forever", async () => {
  const { a, b, course } = await terms();
  render(<MemoryRouter initialEntries={["/courses?term=" + a.id]}><Probe jump="/courses?term=invalid" /><Courses store={store} /></MemoryRouter>);
  await screen.findByRole("article", { name: course.name });
  fireEvent.click(screen.getByRole("button", { name: "Change route" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("article", { name: course.name })).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: t.retry });
  expect(retry).toBeEnabled(); fireEvent.click(retry);
  await waitFor(() => expect(screen.getByLabelText(t.term)).toHaveValue(b.id));
  expect(screen.getByLabelText("Current route")).toHaveTextContent("/courses?term=" + b.id);
});

it("blocks browser history navigation until the user keeps or explicitly discards the editor", async () => {
  const { a, course } = await terms();
  const router = createMemoryRouter([
    { path: "/", element: <p>Previous page</p> },
    { path: "/courses", element: <Courses store={store} /> },
  ], { initialEntries: ["/", "/courses?term=" + a.id], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  await screen.findByRole("article", { name: course.name });
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
  await screen.findByText(/07:30/);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("alert")).toHaveTextContent(/keep/i);
  expect(await store.scheduleSessions.list()).toHaveLength(15);
  expect((await store.scheduleSessions.get(original.id!))?.startTime).toBe("07:30");
  act(() => setLanguage("ar"));
  expect(screen.getByText(tr("text_189"), { exact: true })).toBeInTheDocument();
  view.unmount();
});

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
  await screen.findByRole("heading", { name: "Final review" });
  expect(screen.getByText(/07:30/)).toBeInTheDocument();
});

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
