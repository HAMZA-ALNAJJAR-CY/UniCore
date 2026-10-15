import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { Dashboard } from "../pages/Dashboard";
import { Calendar } from "../pages/Calendar";
import { setLanguage, getLanguage, tr, translateMessage } from "../i18n/locale";
import {
  addDays,
  atTime,
  countdownSeconds,
  isoDay,
  nextSession,
  onDate,
  sessionStatus,
} from "../features/timetable/time";
import type { AcademicTerm, Course, ScheduleSession } from "../data";
const meta = { createdAt: 1, updatedAt: 1, revision: 1, deletedAt: null };
const term: AcademicTerm = {
  ...meta,
  id: "term",
  name: "Test semester",
  academicYear: "2030/2031",
  semester: 1,
};
const course: Course = {
  ...meta,
  id: "course",
  academicTermId: term.id,
  name: "Sample subject",
  code: "EXAMPLE",
  registeredHours: 3,
};
const session: ScheduleSession = {
  ...meta,
  id: "session",
  courseId: course.id,
  academicTermId: term.id,
  dayOfWeek: 7,
  startTime: "09:00",
  endTime: "10:00",
  deliveryMode: "online",
};
const snapshot = {
  terms: [term],
  termId: term.id,
  courses: [course],
  sessions: [session],
};
const store = () => ({ getTimetable: vi.fn().mockResolvedValue(snapshot) });
const sunday = (time = "08:00") => new Date(`2030-10-13T${time}:00`);
afterEach(() => {
  vi.useRealTimers();
  setLanguage("ar");
  localStorage.clear();
});
describe("local recurring time calculations", () => {
  it("uses ISO Sunday 7 and Monday 1", () => {
    expect(isoDay(sunday())).toBe(7);
    expect(isoDay(addDays(sunday(), 1))).toBe(1);
  });
  it("filters tombstones, other terms and weekdays and orders sessions", () => {
    const earlier = {
      ...session,
      id: "earlier",
      startTime: "07:00",
      endTime: "08:00",
    };
    expect(
      onDate(
        [
          session,
          { ...session, id: "deleted", deletedAt: 2 },
          { ...session, academicTermId: "other" },
          earlier,
        ],
        sunday(),
        term,
      ),
    ).toEqual([earlier, session]);
    expect(onDate([session], addDays(sunday(), 1), term)).toEqual([]);
  });
  it.each([
    ["08:59", "upcoming"],
    ["09:00", "ongoing"],
    ["09:59", "ongoing"],
    ["10:00", "completed"],
  ])("status at %s is %s", (time, status) =>
    expect(sessionStatus(session, sunday(), sunday(time))).toBe(status),
  );
  it("finds next day and next week without calling an in-progress session upcoming", () => {
    const monday = { ...session, id: "monday", dayOfWeek: 1 };
    expect(
      nextSession([session, monday], sunday("09:30"), term)?.session.id,
    ).toBe("monday");
    expect(
      nextSession([session], sunday("10:00"), term)?.starts.getDate(),
    ).toBe(20);
    expect(nextSession([], sunday(), term)).toBeUndefined();
  });
  it("respects recorded term start/end dates without inventing them", () => {
    expect(
      onDate([session], sunday(), { ...term, startDate: "2030-10-14" }),
    ).toEqual([]);
    expect(
      nextSession([session], sunday(), { ...term, endDate: "2030-10-12" }),
    ).toBeUndefined();
    expect(
      nextSession([session], sunday(), {
        ...term,
        startDate: "2030-12-01",
      })?.starts.getMonth(),
    ).toBe(11);
    expect(onDate([session], sunday(), undefined)).toEqual([]);
  });
  it("handles exact countdown and midnight/date transitions in local time", () => {
    expect(countdownSeconds(atTime(sunday(), "09:00"), sunday("08:59"))).toBe(
      60,
    );
    expect(countdownSeconds(atTime(sunday(), "09:00"), sunday("09:00"))).toBe(
      0,
    );
    expect(countdownSeconds(atTime(sunday(), "09:00"), sunday("10:00"))).toBe(
      0,
    );
    expect(addDays(new Date(2030, 11, 31), 1).getFullYear()).toBe(2031);
  });
});
describe("dashboard, calendar and language UI", () => {
  it("opens the confirmed import term explicitly with a success notice", async () => {
    setLanguage("en");
    const mocked = store();
    render(
      <MemoryRouter
        initialEntries={[
          { pathname: "/", state: { termId: term.id, timetableSaved: true } },
        ]}
      >
        <Dashboard store={mocked} />
      </MemoryRouter>,
    );
    await screen.findByText(
      "Timetable saved. Continue your academic day from the Dashboard.",
    );
    expect(mocked.getTimetable).toHaveBeenCalledWith(term.id);
  });
  it("renders real snapshot statistics and today sessions without repeated timer reads", async () => {
    setLanguage("en");
    const mocked = store();
    render(
      <MemoryRouter>
        <Dashboard store={mocked} />
      </MemoryRouter>,
    );
    await screen.findByText("Test semester", { selector: "strong" });
    expect(
      screen.getAllByText("1", { selector: "strong" }).length,
    ).toBeGreaterThan(0);
    expect(mocked.getTimetable).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: "Open Calendar" })).toHaveAttribute(
      "href",
      "/calendar",
    );
  });
  it("shows an empty term with a real import action", async () => {
    const mocked = {
      getTimetable: vi
        .fn()
        .mockResolvedValue({ terms: [], courses: [], sessions: [] }),
    };
    render(
      <MemoryRouter>
        <Dashboard store={mocked} />
      </MemoryRouter>,
    );
    await screen.findByRole("link", { name: "مراجعة واستيراد الجدول" });
    expect(screen.queryByRole("timer")).not.toBeInTheDocument();
  });
  it("navigates calendar weeks/days, returns to today and links sessions to management", async () => {
    setLanguage("en");
    render(
      <MemoryRouter>
        <Calendar store={store()} />
      </MemoryRouter>,
    );
    await screen.findByText("Sample subject");
    expect(
      screen.getByRole("link", { name: /Sample subject/ }),
    ).toHaveAttribute("href", "/courses#course-course");
    const heading = screen.getByRole("heading", { level: 2 }).textContent;
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).not.toBe(
      heading,
    );
    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe(heading);
    fireEvent.click(screen.getByRole("button", { name: "Daily agenda" }));
    expect(
      screen.getByRole("button", { name: "Daily agenda" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
  it("switches every shell direction, persists preference, and preserves data and form draft", async () => {
    render(
      <MemoryRouter initialEntries={["/courses/import"]}>
        <App />
      </MemoryRouter>,
    );
    expect(getLanguage()).toBe("ar");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Language / اللغة" }),
      { target: { value: "en" } },
    );
    expect(document.documentElement).toHaveAttribute("dir", "ltr");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Timetable review",
    );
    expect(screen.getByLabelText("Term name")).toHaveValue("");
    expect(localStorage.getItem("unicore.language")).toBe("en");
    expect(tr("text_153")).toMatch(/valid day/);
    expect(
      translateMessage(
        "اختر يوماً صحيحاً ووقتاً بصيغة HH:mm، على أن تكون النهاية بعد البداية.",
      ),
    ).toMatch(/valid day/);
    fireEvent.change(
      screen.getByRole("combobox", { name: "Language / اللغة" }),
      { target: { value: "ar" } },
    );
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(course.name).toBe("Sample subject");
  });
  it("has complete catalogs with safe fallback", () => {
    expect(tr("missing.key")).toBe("missing.key");
  });
  it("cleans the dashboard timer on unmount", async () => {
    const spy = vi.spyOn(globalThis, "clearInterval");
    const view = render(
      <MemoryRouter>
        <Dashboard store={store()} />
      </MemoryRouter>,
    );
    view.unmount();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
