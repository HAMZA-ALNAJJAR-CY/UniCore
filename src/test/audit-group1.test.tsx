import "fake-indexeddb/auto";
import Dexie from "dexie";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAcademicStore, DataError } from "../data";
import { Dashboard } from "../pages/Dashboard";
import { Calendar } from "../pages/Calendar";
import { Courses } from "../pages/Courses";
import { dailyText as d } from "../i18n/daily";
import { timetableText as t } from "../features/timetable/messages";
import { setLanguage } from "../i18n/locale";

let store: ReturnType<typeof createAcademicStore>, databaseName: string;
const scroll = vi.fn();
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => {
  setLanguage("en");
  databaseName = "audit-group1-" + crypto.randomUUID();
  store = createAcademicStore(databaseName);
  scroll.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scroll });
});
afterEach(async () => {
  store.close(); await Dexie.delete(databaseName);
  vi.restoreAllMocks(); setLanguage("ar"); localStorage.clear();
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function records() {
  const a = await store.academicTerms.create({ name: "Synthetic older A", academicYear: "2031/2032", semester: 1 });
  const b = await store.academicTerms.create({ name: "Synthetic default B", academicYear: "2032/2033", semester: 1 });
  const courseA = await store.courses.create({ academicTermId: a.id, code: "SYN-A", name: "Synthetic subject A", registeredHours: 3 });
  const courseB = await store.courses.create({ academicTermId: b.id, code: "SYN-B", name: "Synthetic subject B", registeredHours: 3 });
  for (const course of [courseA, courseB]) await store.scheduleSessions.create({
    academicTermId: course.academicTermId, courseId: course.id, dayOfWeek: new Date().getDay() || 7,
    startTime: "09:00", endTime: "10:00", deliveryMode: "online",
  });
  return { a, b, courseA, courseB };
}
function mount(path: string) {
  const router = createMemoryRouter([
    { path: "/", element: <Dashboard store={store} /> },
    { path: "/calendar", element: <Calendar store={store} /> },
    { path: "/courses", element: <Courses store={store} /> },
  ], { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, dispose: () => { view.unmount(); router.dispose(); } };
}

describe.each([["Dashboard", "/"], ["Calendar", "/calendar"]])("%s invalid term recovery", (_label, path) => {
  it("removes an invalid term when no active fallback term exists", async () => {
    const { router, dispose } = mount(path + "?keep=value&term=invalid");
    await screen.findByRole("link", { name: /Review and import timetable/i });
    expect(router.state.location.search).toBe("?keep=value");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect([...document.querySelectorAll("a")].every(link => !link.getAttribute("href")?.includes("term="))).toBe(true);
    dispose();
  });

  it.each(["malformed", "missing", "deleted"])("replaces a %s term without propagating it to links", async kind => {
    const { b, courseB } = await records();
    let requested = kind === "malformed" ? "invalid" : crypto.randomUUID();
    if (kind === "deleted") {
      const removed = await store.academicTerms.create({ name: "Synthetic removed", academicYear: "2030/2031", semester: 1 });
      requested = removed.id;
      await store.academicTerms.delete(removed.id, { expectedRevision: removed.revision });
    }
    const { router, dispose } = mount(path + "?keep=value&term=" + requested);
    const manage = await screen.findByRole("link", { name: new RegExp(courseB.name) });
    await waitFor(() => expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(b.id));
    expect(router.state.location.search).toBe("?keep=value&term=" + b.id);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(manage).toHaveAttribute("href", `/courses?term=${b.id}#course-${courseB.id}`);
    expect([...document.querySelectorAll("a")].every(link => !link.getAttribute("href")?.includes(requested))).toBe(true);
    dispose();
  });

  it.each(["valid", "invalid"])("does not fall back after a genuine storage failure for a %s requested term", async kind => {
    const { a } = await records();
    const requested = kind === "valid" ? a.id : "invalid";
    const pending = deferred<Awaited<ReturnType<typeof store.getTimetable>>>();
    const read = vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
    const { router, dispose } = mount(path + "?term=" + requested);
    await waitFor(() => expect(read).toHaveBeenCalledExactlyOnceWith(requested));
    await act(async () => pending.reject(new DataError("UNAVAILABLE", "Synthetic storage read failure")));
    expect(screen.getByRole("alert")).toHaveTextContent(t.unavailable);
    expect(read).toHaveBeenCalledExactlyOnceWith(requested);
    expect(router.state.location.search).toBe("?term=" + requested);
    if (kind === "valid") {
      fireEvent.click(screen.getByRole("button", { name: d.refresh }));
      await waitFor(() => expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(a.id));
      expect(read).toHaveBeenLastCalledWith(a.id);
      expect(router.state.location.search).toBe("?term=" + a.id);
    }
    dispose();
  });

  it("exposes an error if the default-term read fails and retries safely", async () => {
    const { b } = await records();
    const read = vi.spyOn(store, "getTimetable")
      .mockRejectedValueOnce(new DataError("VALIDATION", "Synthetic invalid term"))
      .mockRejectedValueOnce(new DataError("UNAVAILABLE", "Synthetic fallback read failure"));
    const { router, dispose } = mount(path + "?term=invalid");
    expect(await screen.findByRole("alert")).toHaveTextContent(t.unavailable);
    expect(read.mock.calls).toEqual([["invalid"], []]);
    expect(router.state.location.search).toBe("?term=invalid");
    fireEvent.click(screen.getByRole("button", { name: d.refresh }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(b.id));
    expect(router.state.location.search).toBe("?term=" + b.id);
    dispose();
  });

  it("ignores a fallback completing after navigation to a valid term", async () => {
    const { a, b } = await records();
    const get = store.getTimetable.bind(store), pending = deferred<Awaited<ReturnType<typeof get>>>();
    const read = vi.spyOn(store, "getTimetable").mockImplementation(id => id === undefined ? pending.promise : get(id));
    const { router, dispose } = mount(path + "?term=invalid");
    await waitFor(() => expect(read).toHaveBeenCalledWith());
    await act(async () => { await router.navigate(path + "?term=" + a.id); });
    await waitFor(() => expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(a.id));
    const key = router.state.location.key;
    await act(async () => pending.resolve(await get(b.id)));
    expect(router.state.location.key).toBe(key);
    expect(router.state.location.search).toBe("?term=" + a.id);
    expect(screen.getByRole("combobox", { name: d.term })).toHaveValue(a.id);
    dispose();
  });
});

describe("Courses asynchronous Manage targets", () => {
  it("scrolls and focuses a direct target only after its data loads, without repeating on refresh", async () => {
    const { a, courseA } = await records();
    const snapshot = await store.getTimetable(a.id), pending = deferred<typeof snapshot>();
    vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
    const { dispose } = mount(`/courses?term=${a.id}#course-${courseA.id}`);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => pending.resolve(snapshot));
    const target = await screen.findByRole("article", { name: courseA.name });
    await waitFor(() => expect(target).toHaveFocus());
    expect(scroll.mock.contexts).toEqual([target]);
    fireEvent.click(screen.getByRole("button", { name: t.retry }));
    await waitFor(() => expect(screen.getByRole("button", { name: t.retry })).toBeEnabled());
    expect(scroll).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("follows Dashboard Manage links and waits for the destination read", async () => {
    const { a, courseA } = await records();
    const { router, dispose } = mount("/?term=" + a.id);
    const link = await screen.findByRole("link", { name: new RegExp(courseA.name) });
    const snapshot = await store.getTimetable(a.id), pending = deferred<typeof snapshot>();
    vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
    fireEvent.click(link);
    expect(scroll).not.toHaveBeenCalled();
    await act(async () => pending.resolve(snapshot));
    const target = await screen.findByRole("article", { name: courseA.name });
    await waitFor(() => expect(target).toHaveFocus());
    expect(router.state.location.hash).toBe("#course-" + courseA.id);
    expect(scroll.mock.contexts).toEqual([target]);
    dispose();
  });

  it.each(["missing", "deleted", "malformed"])("ignores a %s target while keeping the course list usable", async kind => {
    const { a, courseA } = await records();
    let targetId = kind === "malformed" ? "%" : crypto.randomUUID();
    if (kind === "deleted") {
      const removed = await store.courses.create({ academicTermId: a.id, code: "REMOVED", name: "Synthetic removed subject", registeredHours: 1 });
      targetId = removed.id;
      await store.courses.delete(removed.id, { expectedRevision: removed.revision });
    }
    const { dispose } = mount(`/courses?term=${a.id}#course-${targetId}`);
    await screen.findByRole("article", { name: courseA.name });
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.editCourse })).toBeEnabled();
    dispose();
  });

  it("does not scroll an old target after navigating to another term", async () => {
    const { a, b, courseA, courseB } = await records();
    const snapshot = await store.getTimetable(a.id), pending = deferred<typeof snapshot>();
    vi.spyOn(store, "getTimetable").mockImplementationOnce(() => pending.promise);
    const { router, dispose } = mount(`/courses?term=${a.id}#course-${courseA.id}`);
    await act(async () => { await router.navigate(`/courses?term=${b.id}#course-${courseB.id}`); });
    const target = await screen.findByRole("article", { name: courseB.name });
    await waitFor(() => expect(target).toHaveFocus());
    await act(async () => pending.resolve(snapshot));
    expect(scroll.mock.contexts).toEqual([target]);
    expect(target).toHaveFocus();
    expect(screen.queryByRole("article", { name: courseA.name })).not.toBeInTheDocument();
    dispose();
  });

  it("reveals a hash target when navigation starts from the weekly view", async () => {
    const { a, courseA } = await records();
    const { router, dispose } = mount("/courses?term=" + a.id);
    await screen.findByRole("article", { name: courseA.name });
    fireEvent.click(screen.getByRole("button", { name: t.weekView }));
    expect(screen.queryByRole("article", { name: courseA.name })).not.toBeInTheDocument();
    await act(async () => { await router.navigate(`/courses?term=${a.id}#course-${courseA.id}`); });
    const target = await screen.findByRole("article", { name: courseA.name });
    await waitFor(() => expect(target).toHaveFocus());
    expect(scroll.mock.contexts).toEqual([target]);
    dispose();
  });
});
