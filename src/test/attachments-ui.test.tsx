import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lectures } from "../pages/Lectures";
import { createAcademicStore, type LectureFile } from "../data";
import { setLanguage } from "../i18n/locale";
const meta = { createdAt: 1, updatedAt: 1, deletedAt: null, revision: 1 };
const lecture = {
  ...meta,
  id: "lecture",
  courseId: "course",
  date: "2030-10-15",
};
function mocked() {
  let files: Omit<LectureFile, "blob">[] = [];
  const blob = new Blob(["saved bytes"], { type: "text/plain" });
  const getLectureWorkspace = vi.fn(async (id?: string) => ({
    courses: [
      {
        ...meta,
        id: "course",
        academicTermId: "term",
        code: "DEMO",
        name: "Generic course",
        registeredHours: 1,
      },
    ],
    sessions: [],
    lectures: [lecture],
    lecture: id ? lecture : undefined,
    files,
  }));
  const attachLectureFiles = vi.fn(
    async (
      _id: string,
      inputs: { id: string; fileName: string; blob: Blob }[],
    ): Promise<
      Awaited<
        ReturnType<ReturnType<typeof createAcademicStore>["attachLectureFiles"]>
      >
    > => {
      files = inputs.map((row) => ({
        ...meta,
        id: row.id,
        lectureId: "lecture",
        fileName: row.fileName,
        fileSize: row.blob.size,
        mimeType: row.blob.type,
      }));
      return inputs.map((row) => ({ id: row.id, status: "saved" as const }));
    },
  );
  const create = vi.fn(async () => lecture),
    remove = vi.fn(async () => []),
    get = vi.fn(async () => ({
      ...meta,
      id: "file",
      lectureId: "lecture",
      fileName: "saved.txt",
      mimeType: "text/plain",
      fileSize: blob.size,
      blob,
    }));
  const store = {
    getLectureWorkspace,
    attachLectureFiles,
    lectures: { create, delete: remove },
    lectureFiles: { get, delete: remove },
  } as unknown as ReturnType<typeof createAcademicStore>;
  return {
    store,
    attachLectureFiles,
    create,
    remove,
    get,
    setFiles: (value: typeof files) => {
      files = value;
    },
  };
}
afterEach(() => {
  setLanguage("ar");
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function open() {
  setLanguage("en");
  const fixture = mocked();
  render(<Lectures store={fixture.store} />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Open attachments" }),
  );
  await screen.findByLabelText("Choose multiple files");
  return fixture;
}
describe("localized lecture workspace", () => {
  it("creates a lecture for a selected existing course/date without generating recurring lectures", async () => {
    setLanguage("en");
    const fixture = mocked();
    render(<Lectures store={fixture.store} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create lecture" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create lecture" }));
    fireEvent.change(screen.getByLabelText("Course"), {
      target: { value: "course" },
    });
    fireEvent.input(screen.getByLabelText("Lecture date"), {
      target: { value: "2030-10-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(fixture.create).toHaveBeenCalledWith({
        courseId: "course",
        date: "2030-10-16",
        scheduleSessionId: null,
      }),
    );
  });
  it("uploads multiple selected files once, preserving selection through language changes", async () => {
    const fixture = await open();
    const files = [
      new File(["one"], "one.txt", { type: "text/plain" }),
      new File(["two"], "two.pdf", { type: "application/pdf" }),
    ];
    fireEvent.change(screen.getByLabelText("Choose multiple files"), {
      target: { files },
    });
    act(() => setLanguage("ar"));
    expect(screen.getByText("one.txt")).toBeInTheDocument();
    expect(screen.getByLabelText("اختيار ملفات متعددة")).toHaveAttribute(
      "multiple",
    );
    act(() => setLanguage("en"));
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected files" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected files" }),
    );
    await waitFor(() =>
      expect(fixture.attachLectureFiles).toHaveBeenCalledTimes(1),
    );
    expect(
      fixture.attachLectureFiles.mock.calls[0][1].map((row) => row.blob),
    ).toEqual(files);
    await screen.findByText("Operation completed.");
  });
  it("shows per-file quota failures and retains stable identities for retry", async () => {
    const fixture = await open();
    fixture.attachLectureFiles.mockImplementationOnce(async (_id, inputs) =>
      inputs.map((row) => ({
        id: row.id,
        status: "failed" as const,
        code: "QUOTA",
      })),
    );
    fireEvent.change(screen.getByLabelText("Choose multiple files"), {
      target: {
        files: [new File(["data"], "quota.txt", { type: "text/plain" })],
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save selected files" }),
    );
    await screen.findByText(/Storage is full/);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry unsaved files" }),
    );
    await screen.findByText("Operation completed.");
    expect(fixture.attachLectureFiles.mock.calls[0][1][0].id).toBe(
      fixture.attachLectureFiles.mock.calls[1][1][0].id,
    );
  });
  it("downloads only as binary and revokes object URLs when the workspace unmounts", async () => {
    setLanguage("en");
    const fixture = mocked();
    fixture.setFiles([
      {
        ...meta,
        id: "file",
        lectureId: "lecture",
        fileName: "saved.txt",
        mimeType: "text/plain",
        fileSize: 11,
      },
    ]);
    const createURL = vi.fn((blob: Blob) => { void blob; return "blob:test"; }),
      revoke = vi.fn();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = createURL;
        static revokeObjectURL = revoke;
      },
    );
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    const view = render(<Lectures store={fixture.store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open attachments" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(createURL.mock.calls[0][0].type).toBe("application/octet-stream");
    view.unmount();
    expect(revoke).toHaveBeenCalledWith("blob:test");
  });
  it("requires an explicit confirmation for individual file removal", async () => {
    setLanguage("en");
    const fixture = mocked();
    fixture.setFiles([
      {
        ...meta,
        id: "file",
        lectureId: "lecture",
        fileName: "saved.txt",
        mimeType: "text/plain",
        fileSize: 11,
      },
    ]);
    render(<Lectures store={fixture.store} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Open attachments" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove attachment" }),
    );
    expect(fixture.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(fixture.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm removal" }));
    await waitFor(() =>
      expect(fixture.remove).toHaveBeenCalledWith("file", {
        expectedRevision: 1,
      }),
    );
  });
});
