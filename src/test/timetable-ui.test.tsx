import { sourceDraft } from "./fixtures/timetable";
import {
  render,
  screen,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi } from "vitest";
import { App } from "../app/App";
import { TimetableImport } from "../pages/TimetableImport";
import {
  DataError,
  type TimetableDraft,
  type TimetableReview,
  type createAcademicStore,
} from "../data";
import { analyzeDraft } from "../features/timetable/draft";

function mockStore() {
  const reviewTimetable = vi.fn(
    async (draft: TimetableDraft): Promise<TimetableReview> => ({
      draft,
      differences: [],
      existingKeys: [],
      snapshot: "reviewed",
      savedSummary: {
        courses: draft.courses.length,
        sessions: draft.sessions.length,
        hours: analyzeDraft(draft).hours,
      },
    }),
  );
  const saveTimetable = vi.fn().mockResolvedValue({
    committed: true,
    outcomes: [],
    rejected: [],
    created: ["saved"],
    skipped: [],
  });
  const store = {
    academicTerms: { list: vi.fn().mockResolvedValue([]) },
    reviewTimetable,
    saveTimetable,
  } as unknown as ReturnType<typeof createAcademicStore>;
  return { store, reviewTimetable, saveTimetable };
}
async function mount() {
  const mocked = mockStore();
  render(
    <MemoryRouter>
      <TimetableImport store={mocked.store} initialDraft={sourceDraft()} />
    </MemoryRouter>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "التالي" })).toBeEnabled(),
  );
  return mocked;
}
async function finalStep() {
  for (let i = 0; i < 3; i++)
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
  await screen.findByRole("heading", { name: "المراجعة النهائية", level: 2 });
  fireEvent.click(screen.getByRole("button", { name: "التالي" }));
  await screen.findByRole("heading", { name: "التأكيد والحفظ", level: 2 });
}

describe("Arabic timetable review interface", () => {
  it("sets Arabic RTL on the document and preserves navigation to the importer", () => {
    render(
      <MemoryRouter initialEntries={["/courses"]}>
        <App />
      </MemoryRouter>,
    );
    expect(document.documentElement).toHaveAttribute("lang", "ar");
    expect(document.documentElement).toHaveAttribute("dir", "rtl");
    expect(
      screen.getByRole("link", { name: "مراجعة واستيراد الجدول" }),
    ).toHaveAttribute("href", "/courses/import");
  });
  it("does not save on load, step changes or before explicit confirmation", async () => {
    const mocked = await mount();
    expect(mocked.saveTimetable).not.toHaveBeenCalled();
    await finalStep();
    const save = screen.getByRole("button", {
      name: "تأكيد وحفظ الجدول محلياً",
    });
    expect(save).toBeDisabled();
    expect(mocked.saveTimetable).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByLabelText(
        "راجعت البيانات والحقول غير المؤكدة وأوافق على الحفظ المحلي",
      ),
    );
    fireEvent.click(save);
    await waitFor(() => expect(mocked.saveTimetable).toHaveBeenCalledTimes(1));
    expect(mocked.saveTimetable.mock.calls[0][1]).toMatchObject({
      confirmed: true,
    });
    await screen.findByRole("heading", { name: "حُفظت المراجعة محلياً" });
  });
  it("allows course/session edits, additions and removals before review", async () => {
    const mocked = await mount();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getAllByRole("region", { name: /^المقرر \d/ })).toHaveLength(
      7,
    );
    const first = screen.getByRole("region", { name: "المقرر 1" });
    fireEvent.change(within(first).getByLabelText("اسم المقرر"), {
      target: { value: "اسم معدل" },
    });
    fireEvent.change(within(first).getByLabelText("رمز المقرر"), {
      target: { value: "EDITED" },
    });
    const unknown = screen.getByRole("region", { name: "المقرر 2" });
    expect(within(unknown).getByLabelText("اسم المدرس (اختياري)")).toHaveValue(
      "",
    );
    expect(within(unknown).getByLabelText("المدرس غير مؤكد")).toBeChecked();
    fireEvent.click(
      within(screen.getByRole("region", { name: "المقرر 7" })).getByRole(
        "button",
        { name: "استبعاد المقرر وجلساته من المسودة" },
      ),
    );
    expect(screen.getAllByRole("region", { name: /^المقرر \d/ })).toHaveLength(
      6,
    );
    fireEvent.click(screen.getByRole("button", { name: "إضافة مقرر" }));
    const added = screen.getByRole("region", { name: "المقرر 7" });
    fireEvent.change(within(added).getByLabelText("اسم المقرر"), {
      target: { value: "مقرر جديد" },
    });
    fireEvent.change(within(added).getByLabelText("رمز المقرر"), {
      target: { value: "USER101" },
    });
    fireEvent.change(within(added).getByLabelText("الساعات المسجلة"), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getAllByRole("region", { name: /^الجلسة \d/ })).toHaveLength(
      12,
    );
    const session = screen.getByRole("region", { name: "الجلسة 1" });
    expect(
      within(session).getByLabelText("وقت البداية (HH:mm)"),
    ).toHaveAttribute("dir", "ltr");
    fireEvent.change(
      within(session).getByLabelText("القاعة أو الموقع (اختياري)"),
      { target: { value: "USER-ROOM" } },
    );
    expect(
      within(session).getByLabelText("ملاحظة المصدر غير مؤكد"),
    ).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "إضافة جلسة" }));
    const newSession = screen.getByRole("region", { name: "الجلسة 13" });
    fireEvent.change(within(newSession).getByLabelText("وقت البداية (HH:mm)"), {
      target: { value: "17:00" },
    });
    fireEvent.change(within(newSession).getByLabelText("وقت النهاية (HH:mm)"), {
      target: { value: "18:00" },
    });
    fireEvent.click(
      within(screen.getByRole("region", { name: "الجلسة 12" })).getByRole(
        "button",
        { name: "استبعاد الجلسة من المسودة" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "المراجعة النهائية", level: 2 });
    const reviewed = mocked.reviewTimetable.mock.calls.at(-1)![0];
    expect(reviewed.courses).toHaveLength(7);
    expect(reviewed.sessions).toHaveLength(12);
    expect(reviewed.courses[0]).toMatchObject({
      name: "اسم معدل",
      code: "EDITED",
    });
    expect(reviewed.sessions[0].room).toBe("USER-ROOM");
    expect(
      reviewed.courses.find((row) => row.code === "USER101")?.registeredHours,
    ).toBe(2);
    expect(mocked.saveTimetable).not.toHaveBeenCalled();
  });
  it("shows differences and requires a keep-existing decision", async () => {
    const mocked = await mount();
    mocked.reviewTimetable.mockImplementation(async (draft) => ({
      draft,
      existingKeys: ["courses:SYN101"],
      differences: [
        {
          key: "courses:SYN101",
          label: "مقرر تجريبي ألف",
          fields: [
            { field: "الاسم", incoming: "المسودة", existing: "تعديل المستخدم" },
          ],
        },
      ],
      snapshot: "reviewed",
      savedSummary: { courses: 7, sessions: 15, hours: 15 },
    }));
    for (let i = 0; i < 3; i++)
      fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    await screen.findByRole("heading", { name: "المراجعة النهائية", level: 2 });
    expect(screen.getByText(/تعديل المستخدم/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(screen.getByRole("alert")).toHaveTextContent("اختر الاحتفاظ");
    fireEvent.click(screen.getByLabelText("أحتفظ بالنسخة المحفوظة دون تغيير"));
    fireEvent.click(screen.getByRole("button", { name: "التالي" }));
    expect(
      screen.getByRole("heading", { name: "التأكيد والحفظ", level: 2 }),
    ).toBeInTheDocument();
  });
  it("shows an Arabic storage failure and does not claim a successful save", async () => {
    const mocked = await mount();
    mocked.saveTimetable.mockRejectedValueOnce(new DataError("QUOTA", "Full"));
    await finalStep();
    fireEvent.click(
      screen.getByLabelText(
        "راجعت البيانات والحقول غير المؤكدة وأوافق على الحفظ المحلي",
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "تأكيد وحفظ الجدول محلياً" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("مساحة التخزين"),
    );
    expect(
      screen.queryByRole("heading", { name: "حُفظت المراجعة محلياً" }),
    ).not.toBeInTheDocument();
  });
});
