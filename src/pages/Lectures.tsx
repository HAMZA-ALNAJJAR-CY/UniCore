import { useEffect, useRef, useState } from "react";
import {
  createAcademicStore,
  DataError,
  type Lecture,
  type LectureFile,
} from "../data";
import { PageHeader } from "../components/PageHeader";
import { lectureText as t } from "../i18n/lectures";
import { dateLabel, numberLabel, useLanguage } from "../i18n/locale";
import {
  FILE_ACCEPT,
  fileProblem,
  type FileProblem,
} from "../features/lectures/files";
import { DAYS } from "../features/timetable/draft";
const defaultStore = createAcademicStore();
type Store = ReturnType<typeof createAcademicStore>;
type Workspace = Awaited<ReturnType<Store["getLectureWorkspace"]>>;
type UploadResult = Awaited<ReturnType<Store["attachLectureFiles"]>>[number];
type Selection = { id: string; file: File; result?: UploadResult };
function problemText(problem?: FileProblem, code?: string) {
  if (problem) return problem === "empty" ? t.emptyFile : t[problem];
  return code === "QUOTA"
    ? t.quota
    : code === "CONFLICT" || code === "NOT_FOUND"
      ? t.conflict
      : t.storage;
}
function errorKey(error: unknown) {
  if (error instanceof DataError) {
    if (error.code === "QUOTA") return "quota";
    if (error.code === "DEPENDENTS") return "protected";
    if (error.code === "CONFLICT" || error.code === "NOT_FOUND")
      return "conflict";
    if (error.code === "VALIDATION" || error.code === "RELATIONSHIP")
      return "invalid";
  }
  return "storage";
}
export function Lectures({ store = defaultStore }: { store?: Store }) {
  useLanguage();
  const [data, setData] = useState<Workspace | null>(null),
    [opened, setOpened] = useState<string | undefined>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<
      ReturnType<typeof errorKey> | "downloadError" | null
    >(null),
    [success, setSuccess] = useState(false);
  const [creating, setCreating] = useState(false),
    [courseId, setCourseId] = useState(""),
    [date, setDate] = useState(""),
    [sessionId, setSessionId] = useState("");
  const [selected, setSelected] = useState<Selection[]>([]),
    [removal, setRemoval] = useState<
      | { kind: "lecture"; record: Lecture }
      | { kind: "file"; record: Omit<LectureFile, "blob"> }
      | null
    >(null);
  const lock = useRef(false),
    picker = useRef<HTMLInputElement>(null),
    urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    let active = true;
    store
      .getLectureWorkspace(opened)
      .then((value) => {
        if (active) {
          setData(value);
          setError(null);
        }
      })
      .catch((failure) => {
        if (active) setError(errorKey(failure));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, opened]);
  useEffect(() => {
    const pending = urls.current;
    return () => {
      for (const [url, timer] of pending) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      pending.clear();
    };
  }, []);
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await store.getLectureWorkspace(opened));
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      setLoading(false);
    }
  }
  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setSuccess(false);
    try {
      await action();
    } catch (failure) {
      setError(errorKey(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function create() {
    await perform(async () => {
      const lecture = await store.lectures.create({
        courseId,
        date,
        scheduleSessionId: sessionId || null,
      });
      setCreating(false);
      setDate("");
      setSessionId("");
      setLoading(true);
      setOpened(lecture.id);
      setSuccess(true);
    });
  }
  async function upload() {
    if (!opened || !selected.length) return;
    await perform(async () => {
      const pending = selected.filter(
        (row) => !row.result || row.result.status === "failed",
      );
      const results = await store.attachLectureFiles(
        opened,
        pending.map((row) => ({
          id: row.id,
          fileName: row.file.name,
          blob: row.file,
        })),
      );
      setSelected((current) =>
        current.map((row) => ({
          ...row,
          result: results.find((result) => result.id === row.id) ?? row.result,
        })),
      );
      setSuccess(results.every((row) => row.status !== "failed"));
      await refresh();
    });
  }
  async function download(id: string) {
    await perform(async () => {
      const file = await store.lectureFiles.get(id);
      if (!file) {
        setError("conflict");
        return;
      }
      let url: string | undefined;
      try {
        url = URL.createObjectURL(
          new Blob([file.blob], { type: "application/octet-stream" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = Array.from(file.fileName).map(character => character.charCodeAt(0)<32 || character==='/' || character==='\\' ? '_' : character).join('');
        document.body.append(a);
        try {
          a.click();
        } finally {
          a.remove();
        }
        const activeUrl = url;
        urls.current.set(
          activeUrl,
          setTimeout(() => {
            URL.revokeObjectURL(activeUrl);
            urls.current.delete(activeUrl);
          }, 60000),
        );
      } catch {
        if (url) URL.revokeObjectURL(url);
        setError("downloadError");
      }
    });
  }
  const disabled = busy || loading;
  return (
    <div className="timetable-review lecture-workspace">
      <PageHeader title={t.title} description={t.intro} />
      <p className="review-note">{t.warning}</p>
      <div className="management-toolbar">
        <button disabled={disabled} onClick={() => void refresh()}>
          {t.refresh}
        </button>
        {opened ? (
          <button
            disabled={disabled}
            onClick={() => {
              setLoading(true);
              setOpened(undefined);
              setSelected([]);
              setRemoval(null);
              setError(null);
              setSuccess(false);
            }}
          >
            {t.back}
          </button>
        ) : (
          <button
            disabled={disabled || !data?.courses.length}
            onClick={() => setCreating(true)}
          >
            {t.create}
          </button>
        )}
      </div>
      {loading && <p role="status">{t.loading}</p>}
      {error && (
        <p role="alert" className="review-alert">
          {t[error]}
        </p>
      )}
      {success && (
        <p role="status" className="management-success">
          {t.success}
        </p>
      )}
      {data && !data.courses.length && <p>{t.noCourses}</p>}
      {creating && !opened && (
        <form
          className="review-card"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <fieldset disabled={disabled}>
            <div className="review-fields">
              <label className="review-field">
                <span>{t.course}</span>
                <select
                  required
                  value={courseId}
                  onChange={(event) => {
                    setCourseId(event.target.value);
                    setSessionId("");
                  }}
                >
                  <option value="">{t.choose}</option>
                  {data?.courses.map((course) => (
                    <option key={course.id} value={course.id}>
                      {course.name} — {course.code}
                    </option>
                  ))}
                </select>
              </label>
              <label className="review-field">
                <span>{t.date}</span>
                <input
                  required
                  type="date"
                  value={date}
                  dir="ltr"
                  onChange={(event) => setDate(event.target.value)}
                onInput={(event) => setDate(event.currentTarget.value)}
                />
              </label>
              <label className="review-field">
                <span>{t.session}</span>
                <select
                  value={sessionId}
                  onChange={(event) => setSessionId(event.target.value)}
                >
                  <option value="">{t.none}</option>
                  {data?.sessions
                    .filter((row) => row.courseId === courseId)
                    .map((row) => (
                      <option key={row.id} value={row.id}>
                        {DAYS[row.dayOfWeek]} {row.startTime}–{row.endTime}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="management-actions">
              <button type="submit">{t.save}</button>
              <button type="button" onClick={() => setCreating(false)}>
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {!opened && (
        <div className="managed-courses">
          {data?.lectures.map((lecture) => (
            <article className="review-card" key={lecture.id}>
              <h2>
                {data.courses.find((course) => course.id === lecture.courseId)
                  ?.name ?? t.lecture}
              </h2>
              <p>
                <bdi dir="ltr">{lecture.date}</bdi>
                {lecture.title && <> · {lecture.title}</>}
              </p>
              <div className="management-actions">
                <button
                  disabled={disabled}
                  onClick={() => {
                    setLoading(true);
                    setOpened(lecture.id);
                    setSuccess(false);
                  }}
                >
                  {t.open}
                </button>
                <button
                  className="remove-draft"
                  disabled={disabled}
                  onClick={() =>
                    setRemoval({ kind: "lecture", record: lecture })
                  }
                >
                  {t.remove}
                </button>
              </div>
            </article>
          ))}
          {data && !data.lectures.length && !loading && <p>{t.empty}</p>}
        </div>
      )}
      {opened && data?.lecture?.id === opened && (
        <section className="review-card">
          <h2>
            {data.courses.find((course) => course.id === data.lecture?.courseId)
              ?.name ?? t.lecture}{" "}
            · <bdi dir="ltr">{data.lecture.date}</bdi>
          </h2>
          <h3>{t.files}</h3>
          <p className="review-note">{t.limit}</p>
          <label className="review-field">
            <span>{t.picker}</span>
            <input
              ref={picker}
              type="file"
              accept={FILE_ACCEPT}
              multiple
              disabled={disabled}
              onChange={(event) => {
                setSelected(
                  Array.from(event.target.files ?? []).map((file) => ({
                    id: crypto.randomUUID(),
                    file,
                  })),
                );
                setSuccess(false);
              }}
            />
          </label>
          {!!selected.length && (
            <section aria-label={t.selected}>
              <ul className="managed-sessions">
                {selected.map((row) => {
                  const validation = fileProblem(row.file.name, row.file);
                  return (
                    <li key={row.id} className="managed-session">
                      <bdi>{row.file.name}</bdi>
                      <span>
                        {numberLabel(row.file.size)} B ·{" "}
                        {validation
                          ? problemText(validation)
                          : row.result?.status === "failed"
                            ? problemText(row.result.problem, row.result.code)
                            : row.result
                              ? t[row.result.status]
                              : t.pending}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button
                disabled={
                  disabled ||
                  selected.every(
                    (row) => row.result && row.result.status !== "failed",
                  )
                }
                onClick={() => void upload()}
              >
                {selected.some((row) => row.result?.status === "failed")
                  ? t.retry
                  : t.upload}
              </button>
            </section>
          )}
          <ul className="managed-sessions">
            {data.files.map((file) => (
              <li key={file.id} className="managed-session">
                <div>
                  <strong>
                    <bdi>{file.fileName}</bdi>
                  </strong>
                  <p>
                    {t.type}:{" "}
                    <bdi>{file.mimeType || file.fileName.split(".").pop()}</bdi>{" "}
                    · {t.sizeLabel}: {numberLabel(file.fileSize)} B
                  </p>
                  <p>
                    {t.uploaded}:{" "}
                    {dateLabel(new Date(file.createdAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <div className="management-actions">
                  <button
                    disabled={disabled}
                    onClick={() => void download(file.id)}
                  >
                    {t.download}
                  </button>
                  <button
                    className="remove-draft"
                    disabled={disabled}
                    onClick={() => setRemoval({ kind: "file", record: file })}
                  >
                    {t.removeFile}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {!data.files.length && <p>{t.noFiles}</p>}
        </section>
      )}
      {removal && (
        <section className="review-card" role="region" aria-label={t.confirm}>
          <h2>{t.confirm}</h2>
          <p>{removal.kind === "lecture" ? t.deleteLecture : t.deleteFile}</p>
          <p>
            <bdi>
              {removal.kind === "file"
                ? removal.record.fileName
                : removal.record.date}
            </bdi>
          </p>
          <div className="management-actions">
            <button
              className="remove-draft"
              disabled={disabled}
              onClick={() =>
                void perform(async () => {
                  if (removal.kind === "file")
                    await store.lectureFiles.delete(removal.record.id, {
                      expectedRevision: removal.record.revision,
                    });
                  else
                    await store.lectures.delete(removal.record.id, {
                      expectedRevision: removal.record.revision,
                    });
                  setRemoval(null);
                  setSuccess(true);
                  await refresh();
                })
              }
            >
              {t.confirm}
            </button>
            <button disabled={disabled} onClick={() => setRemoval(null)}>
              {t.cancel}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
