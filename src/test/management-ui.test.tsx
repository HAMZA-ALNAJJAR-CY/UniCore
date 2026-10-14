import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Courses } from "../pages/Courses";
import {
  createAcademicStore,
  DataError,
  type Course,
  type ScheduleSession,
} from "../data";
import { timetableText as t } from "../features/timetable/messages";

let store: ReturnType<typeof createAcademicStore>,
  course: Course,
  session: ScheduleSession;
beforeEach(async () => {
  store = createAcademicStore(`ui-management-${crypto.randomUUID()}`);
  const term = await store.academicTerms.create({
    name: "فصل تجريبي",
    academicYear: "2030/2031",
    semester: 1,
  });
  course = await store.courses.create({
    academicTermId: term.id,
    name: "مقرر تجريبي",
    code: "COURSE1",
    registeredHours: 3,
    instructor: null,
  });
  session = await store.saveManagedSession({
    academicTermId: term.id,
    courseId: course.id,
    dayOfWeek: 7,
    startTime: "09:00",
    endTime: "10:00",
    room: "R1",
    deliveryMode: "in-person",
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  store.close();
  // Delete only the uniquely named isolated test database.
  const { default: Dexie } = await import("dexie");
  const names = await Dexie.getDatabaseNames();
  for (const name of names.filter((name) => name.startsWith("ui-management-")))
    await Dexie.delete(name);
});
async function mount() {
  const result = render(
    <MemoryRouter>
      <Courses store={store} />
    </MemoryRouter>,
  );
  await screen.findByRole("article", { name: course.name });
  return result;
}
const click = (label: string) =>
  fireEvent.click(screen.getByRole("button", { name: label }));
const fill = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });

describe("timetable management interface with real repositories", () => {
  it("loads saved sessions under the correct course and switches to daily agenda", async () => {
    await mount();
    const card = screen.getByRole("article", { name: course.name });
    expect(within(card).getByText("09:00–10:00")).toHaveAttribute("dir", "ltr");
    expect(within(card).getByText("الأحد")).toBeInTheDocument();
    click(t.weekView);
    const day = screen.getByRole("region", { name: "الأحد" });
    expect(within(day).getByText(course.name)).toBeInTheDocument();
    expect(within(day).getByText("R1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t.weekView })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("saves course edits, permits unknown instructors, and displays persisted values after remount", async () => {
    const view = await mount();
    click(t.editCourse);
    fill(t.name, "تصحيح المستخدم");
    fill(t.code, "CORRECTED");
    fill(t.instructor, "");
    click(t.save);
    await screen.findByText(t.saved);
    view.unmount();
    await mountWithChangedName();
    expect(screen.getByText("CORRECTED")).toBeInTheDocument();
    expect(await store.courses.get(course.id)).toMatchObject({
      id: course.id,
      name: "تصحيح المستخدم",
      instructor: null,
      revision: 2,
    });
  });
  it("cancels course and session edits without writing", async () => {
    await mount();
    click(t.editCourse);
    fill(t.name, "Discarded");
    click(t.cancel);
    click(t.editSession);
    fill(t.room, "Discarded room");
    click(t.cancel);
    expect(await store.courses.get(course.id)).toEqual(course);
    expect(await store.scheduleSessions.get(session.id)).toEqual(session);
  });
  it("saves session edits and persists them after remount", async () => {
    const view = await mount();
    click(t.editSession);
    fill(t.start, "11:00");
    fill(t.end, "12:00");
    fill(t.room, "R2");
    fireEvent.change(screen.getByLabelText(t.day), { target: { value: "2" } });
    click(t.save);
    await screen.findByText(t.saved);
    view.unmount();
    await mount();
    expect(screen.getByText("11:00–12:00")).toBeInTheDocument();
    expect(screen.getByText("الثلاثاء")).toBeInTheDocument();
    expect((await store.scheduleSessions.get(session.id))?.revision).toBe(2);
  });
  it("adds a course and then a session without repeating import", async () => {
    await mount();
    click(t.addCourse);
    fill(t.name, "مقرر جديد");
    fill(t.code, "NEW");
    fill(t.hours, "2");
    click(t.save);
    const card = await screen.findByRole("article", { name: "مقرر جديد" });
    fireEvent.click(within(card).getByRole("button", { name: t.addSession }));
    fill(t.start, "10:00");
    fill(t.end, "11:00");
    fill(t.room, "N1");
    click(t.save);
    await waitFor(() =>
      expect(
        within(screen.getByRole("article", { name: "مقرر جديد" })).getByText(
          "10:00–11:00",
        ),
      ).toBeInTheDocument(),
    );
    expect((await store.getTimetable()).courses).toHaveLength(2);
  });
  it("rejects invalid time ranges and requires explicit overlap acknowledgment", async () => {
    await mount();
    click(t.addSession);
    fill(t.start, "11:00");
    fill(t.end, "10:00");
    click(t.save);
    expect(screen.getByRole("alert")).toHaveTextContent(t.invalidTime);
    fill(t.start, "09:30");
    fill(t.end, "10:30");
    click(t.save);
    expect((await store.getTimetable()).sessions).toHaveLength(1);
    fireEvent.click(screen.getByLabelText(t.acknowledge));
    click(t.save);
    await screen.findByText(t.saved);
    expect((await store.getTimetable()).sessions).toHaveLength(2);
  });
  it("previews session deletion and permits cancel or confirmed removal only", async () => {
    await mount();
    click(t.removeSession);
    await screen.findByRole("region", { name: t.confirmDelete });
    click(t.cancel);
    expect(await store.scheduleSessions.get(session.id)).toEqual(session);
    click(t.removeSession);
    await screen.findByRole("region", { name: t.confirmDelete });
    click(t.confirmDelete);
    await screen.findByText(t.removed);
    expect(await store.scheduleSessions.get(session.id)).toBeUndefined();
    expect(await store.courses.get(course.id)).toEqual(course);
  });
  it("blocks course/session deletion when historical lectures exist", async () => {
    await store.lectures.create({
      courseId: course.id,
      scheduleSessionId: session.id,
      date: "2030-10-15",
    });
    await mount();
    click(t.removeCourse);
    await screen.findByText(t.protected);
    expect(
      screen.queryByRole("region", { name: t.confirmDelete }),
    ).not.toBeInTheDocument();
    click(t.removeSession);
    await screen.findByText(t.protected);
    expect(await store.scheduleSessions.get(session.id)).toEqual(session);
  });
  it("shows save failures, retains draft edits and permits retry or cancel", async () => {
    await mount();
    click(t.editCourse);
    fill(t.name, "Retained draft");
    vi.spyOn(store.courses, "update").mockRejectedValueOnce(
      new DataError("QUOTA", "No space"),
    );
    click(t.save);
    await screen.findByText(t.quota);
    expect(screen.getByLabelText(t.name)).toHaveValue("Retained draft");
    expect(await store.courses.get(course.id)).toEqual(course);
    click(t.save);
    await screen.findByText(t.saved);
  });
  it("shows a failed initial load and supports retry", async () => {
    vi.spyOn(store, "getTimetable").mockRejectedValueOnce(
      new DataError("UNAVAILABLE", "Unavailable"),
    );
    render(
      <MemoryRouter>
        <Courses store={store} />
      </MemoryRouter>,
    );
    await screen.findByText(t.unavailable);
    click(t.retry);
    await screen.findByRole("article", { name: course.name });
  });
});
async function mountWithChangedName() {
  render(
    <MemoryRouter>
      <Courses store={store} />
    </MemoryRouter>,
  );
  await screen.findByRole("article", { name: "تصحيح المستخدم" });
}
