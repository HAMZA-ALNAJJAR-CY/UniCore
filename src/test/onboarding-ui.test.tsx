import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  Home,
  Introduction,
  ManualSetup,
  Settings,
} from "../pages/Introduction";
import {
  finishIntroduction,
  introductionComplete,
  resetIntroduction,
} from "../features/onboarding";
import { setLanguage } from "../i18n/locale";
import { TimetableImport } from "../pages/TimetableImport";
import { sourceDraft } from "./fixtures/timetable";
import { emptyDraft } from "../features/timetable/draft";
import { createAcademicStore, type TimetableDraft } from "../data";
function Destination() {
  const location = useLocation();
  return (
    <p>
      Destination {location.pathname}
      {location.search}
      {location.state?.timetableSaved ? " saved" : ""}
    </p>
  );
}
beforeEach(() => {
  resetIntroduction();
  setLanguage("en");
});
afterEach(() => {
  act(() => {
    resetIntroduction();
    setLanguage("ar");
  });
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("Phase A first-run paths", () => {
  it("retains manual setup input after a failed write without marking setup complete", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Full"));
    const source = { academicTerms: { create } } as unknown as Pick<
      ReturnType<typeof createAcademicStore>,
      "academicTerms"
    >;
    render(
      <MemoryRouter>
        <ManualSetup source={source} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Term name"), {
      target: { value: "Keep failed term" },
    });
    fireEvent.change(screen.getByLabelText("Academic year"), {
      target: { value: "2030/2031" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save term and add courses" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Term name")).toHaveValue("Keep failed term");
    expect(introductionComplete()).toBe(false);
  });
  it("starts an empty draft without personal academic information", () => {
    const a = emptyDraft(),
      b = emptyDraft();
    expect(a.courses).toEqual([]);
    expect(a.sessions).toEqual([]);
    expect(a.term.name).toBe("");
    expect(a.term.academicYear).toBe("");
    expect(a.sourceId).not.toBe(b.sourceId);
  });
  it("offers a four-stop tour, skip and three concrete setup choices", () => {
    const done = vi.fn();
    render(<Introduction onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Take a quick tour" }));
    for (const name of [
      "Dashboard",
      "Courses & Calendar",
      "Lectures",
      "Materials",
    ]) {
      expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(name);
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(
      screen.getByRole("button", { name: "Import My Timetable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add Courses Manually" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "I'll Do This Later" }));
    expect(done).toHaveBeenCalledWith("/");
  });
  it("uses persisted data before completion preferences and does not mutate academic data", async () => {
    const source = {
      getAcademicPresence: vi.fn().mockResolvedValue({ hasRecords: true }),
    };
    render(
      <MemoryRouter>
        <Home source={source} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Welcome to UniCore" });
    expect(
      screen.queryByRole("button", { name: "Take a quick tour" }),
    ).not.toBeInTheDocument();
    expect(source.getAcademicPresence).toHaveBeenCalledOnce();
    expect(introductionComplete()).toBe(false);
  });
  it("skips the tour to choices and persists completion independently on choosing manual setup", async () => {
    const source = {
      getAcademicPresence: vi.fn().mockResolvedValue({ hasRecords: false }),
    };
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Home source={source} />} />
          <Route path="/courses/setup" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Skip tour" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add Courses Manually" }),
    );
    await screen.findByText("Destination /courses/setup");
    expect(localStorage.getItem("unicore.onboarding.complete")).toBe("done");
  });
  it("fails closed on unavailable storage and allows an explicit retry", async () => {
    const source = {
      getAcademicPresence: vi
        .fn()
        .mockRejectedValueOnce(new Error("Unavailable"))
        .mockResolvedValue({ hasRecords: false }),
    };
    render(
      <MemoryRouter>
        <Home source={source} />
      </MemoryRouter>,
    );
    await screen.findByText(/Storage will not be assumed empty/);
    expect(
      screen.queryByRole("button", { name: "Take a quick tour" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByRole("button", { name: "Take a quick tour" });
  });
  it("preserves completion through remount while empty dashboard still offers manual setup", async () => {
    finishIntroduction();
    const source = {
      getAcademicPresence: vi.fn().mockResolvedValue({ hasRecords: false }),
    };
    const view = render(
      <MemoryRouter>
        <Home source={source} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Welcome to UniCore" });
    expect(
      screen.queryByRole("button", { name: "Take a quick tour" }),
    ).not.toBeInTheDocument();
    view.unmount();
    render(
      <MemoryRouter>
        <Home source={source} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Welcome to UniCore" });
    expect(introductionComplete()).toBe(true);
  });
  it("creates the actual user term via the repository and navigates to its exact identity", async () => {
    const create = vi.fn().mockResolvedValue({ id: "new-term" });
    const source = { academicTerms: { create } } as unknown as Pick<
      ReturnType<typeof createAcademicStore>,
      "academicTerms"
    >;
    render(
      <MemoryRouter initialEntries={["/setup"]}>
        <Routes>
          <Route path="/setup" element={<ManualSetup source={source} />} />
          <Route path="/courses" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Term name"), {
      target: { value: "My actual term" },
    });
    fireEvent.change(screen.getByLabelText("Academic year"), {
      target: { value: "2030/2031" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save term and add courses" }),
    );
    await screen.findByText("Destination /courses?term=new-term");
    expect(create).toHaveBeenCalledWith({
      name: "My actual term",
      academicYear: "2030/2031",
      semester: 1,
    });
  });
  it("replays introduction explicitly for a returning user from preferences", async () => {
    finishIntroduction();
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <Routes>
          <Route path="/settings" element={<Settings />} />
          <Route
            path="/"
            element={
              <Home
                source={{
                  getAcademicPresence: vi
                    .fn()
                    .mockResolvedValue({ hasRecords: true }),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Replay introduction" }),
    );
    await screen.findByRole("button", { name: "Take a quick tour" });
    expect(introductionComplete()).toBe(true);
  });
  it("preserves a manual form draft when switching English to Arabic", () => {
    render(
      <MemoryRouter>
        <ManualSetup />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText("Term name"), {
      target: { value: "Keep my input" },
    });
    act(() => setLanguage("ar"));
    expect(screen.getByLabelText("اسم الفصل")).toHaveValue("Keep my input");
  });
  it("keeps an empty production review editable without calling the save or populated review on mount", async () => {
    const source = {
      listImportSources: vi.fn().mockResolvedValue([]),
      academicTerms: { list: vi.fn().mockResolvedValue([]) },
      reviewTimetable: vi.fn(),
      saveTimetable: vi.fn(),
    } as unknown as ReturnType<typeof createAcademicStore>;
    render(
      <MemoryRouter>
        <TimetableImport store={source} />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
    );
    expect(screen.getByLabelText("Term name")).toHaveValue("");
    expect(
      screen.getByText(/File\/image extraction is not available/),
    ).toBeInTheDocument();
    expect(source.reviewTimetable).not.toHaveBeenCalled();
    expect(source.saveTimetable).not.toHaveBeenCalled();
  });
  it("redirects a confirmed reviewed import to dashboard with success state", async () => {
    const source = {
      academicTerms: { list: vi.fn().mockResolvedValue([]) },
      reviewTimetable: vi.fn(async (draft: TimetableDraft) => ({
        draft,
        differences: [],
        existingKeys: [],
        snapshot: "review",
        savedSummary: { courses: 7, sessions: 15, hours: 15 },
      })),
      saveTimetable: vi
        .fn()
        .mockResolvedValue({ committed: true, created: ["term"], skipped: [] }),
    } as unknown as ReturnType<typeof createAcademicStore>;
    render(
      <MemoryRouter initialEntries={["/courses/import"]}>
        <Routes>
          <Route
            path="/courses/import"
            element={
              <TimetableImport initialDraft={sourceDraft()} store={source} />
            }
          />
          <Route path="/" element={<Destination />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next" })).toBeEnabled(),
    );
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Final review" });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "I reviewed the data and unconfirmed fields and approve local saving",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm and save timetable locally",
      }),
    );
    await screen.findByText("Destination / saved");
    expect(source.saveTimetable).toHaveBeenCalledOnce();
  });
});
