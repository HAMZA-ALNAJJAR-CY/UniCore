import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useInRouterContext, useSearchParams } from "react-router-dom";
import { LectureNotes } from "../components/LectureNotes";
import { LectureMedia } from "../components/LectureMedia";
import { EditorNavigationGuard } from "../components/EditorNavigationGuard";
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
  mediaPreview,
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
  const routed = useInRouterContext();
  return routed ? <RoutedLectures store={store} /> : <LectureWorkspace store={store} />;
}
type RouteSelection = { lectureId?: string; courseId?: string; open: (id?: string) => void; created: (id: string) => void };
function RoutedLectures({ store }: { store: Store }) {
  const [params, setParams] = useSearchParams();
  const lectureId = params.get("lecture")?.toLowerCase();
  const courseId = params.get("course")?.toLowerCase();
  const [created, setCreated] = useState<string>();
  const handledCreation = useRef<string | undefined>(undefined);
  // Navigate after the completed write has released the pending-write guard.
  useEffect(() => {
    if (!created || handledCreation.current === created) return;
    handledCreation.current = created;
    setParams(current => { current.set("lecture", created); return current; });
  }, [created, setParams]);
  // History entries and focus hashes are not academic identities. Keep the draft
  // mounted until the selected course/lecture actually changes after the guard.
  return <LectureWorkspace key={JSON.stringify([courseId, lectureId])} store={store} route={{
    lectureId,
    courseId,
    open: id => setParams(current => { if (id) current.set("lecture", id); else current.delete("lecture"); return current; }),
    created: setCreated,
  }} />;
}
function LectureWorkspace({ store, route }: { store: Store; route?: RouteSelection }) {
  useLanguage();
  const [data, setData] = useState<Workspace | null>(null),
    [localOpened, setLocalOpened] = useState<string | undefined>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<
      ReturnType<typeof errorKey> | "downloadError" | null
    >(null),
    [success, setSuccess] = useState(false);
  const opened = route ? route.lectureId : localOpened;
  const setOpened = (id?: string) => route ? route.open(id) : setLocalOpened(id);
  const [notesState, setNotesState] = useState({ dirty: false, pending: false });
  const [notesReset, setNotesReset] = useState(0);
  const protectNotes = useCallback((dirty: boolean, pending: boolean) => setNotesState({ dirty, pending }), []);
  const [creating, setCreating] = useState(false),
    [courseId, setCourseId] = useState(route?.courseId ?? ""),
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
  const workspaceHeading = useRef<HTMLHeadingElement>(null);
  const removalHeading = useRef<HTMLHeadingElement>(null);
  const alive = useRef(false);
  const readContext = useRef<symbol | null>(null);
  const [readVersion, setReadVersion] = useState(0);
  useLayoutEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useLayoutEffect(() => {
    readContext.current = Symbol();
    return () => { readContext.current = null; };
  }, [store, opened, readVersion]);
  const loadedLectureId = data?.lecture?.id;
  useEffect(() => {
    if (!loading && !error && loadedLectureId === opened) workspaceHeading.current?.focus();
  }, [loading, error, loadedLectureId, opened]);
  useEffect(() => {
    if (removal) removalHeading.current?.focus();
  }, [removal]);
  useEffect(() => {
    let active = true;
    const context = readContext.current;
    store
      .getLectureWorkspace(opened)
      .then((value) => {
        if (active && readContext.current === context) {
          setData(value);
          setError(null);
        }
      })
      .catch((failure) => {
        if (active && readContext.current === context) { setData(null); setError(errorKey(failure)); }
      })
      .finally(() => {
        if (active && readContext.current === context) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [store, opened, readVersion]);
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
    setReadVersion(current => current + 1);
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
      if (alive.current) setError(errorKey(failure));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function create() {
    await perform(async () => {
      const lecture = await store.lectures.create({
        courseId,
        date,
        scheduleSessionId: sessionId || null,
      });
      if (!alive.current) return;
      setCreating(false);
      setDate("");
      setSessionId("");
      if (route) route.created(lecture.id);
      else { setLoading(true); setOpened(lecture.id); }
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
      if (!alive.current) return;
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
      if (!alive.current) return;
      if (!file || file.lectureId !== opened) {
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
        const name = typeof file.fileName === "string" ? file.fileName : "attachment";
        a.download = Array.from(name).map(character => character.charCodeAt(0)<32 || character==='/' || character==='\\' ? '_' : character).join('');
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
  const disabled = busy || loading || notesState.dirty || notesState.pending;
  const selectedPending = selected.some(row => !row.result || row.result.status === "failed");
  const protectedDraft = notesState.dirty || notesState.pending || selectedPending || busy || (creating && !!date);
  useEffect(() => {
    if (!protectedDraft) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [protectedDraft]);
  const linkedCourse = data?.courses.find(course => course.id === (data.lecture?.courseId ?? route?.courseId));
  const missingCourse = !!route?.courseId && !!data && !linkedCourse;
  const mismatchedCourse = !!route?.courseId && !!data?.lecture && data.lecture.courseId !== route.courseId;
  const lectures = data?.lectures.filter(lecture => !route?.courseId || lecture.courseId === route.courseId) ?? [];
  return (
    <div className="timetable-review lecture-workspace">
      <EditorNavigationGuard enabled={protectedDraft} pending={busy || notesState.pending} onDiscard={() => { setCreating(false); setDate(""); setSessionId(""); setSelected([]); setNotesReset(current => current + 1); setNotesState({ dirty: false, pending: false }); }} />
      <PageHeader title={t.title} description={t.intro} />
      <p className="review-note">{t.warning}</p>
      {linkedCourse && route && <Link className="button-link" to={`/courses?term=${encodeURIComponent(linkedCourse.academicTermId)}#course-${linkedCourse.id}`}>{t.backCourse} · {linkedCourse.name}</Link>}
      {missingCourse && <p role="alert">{t.missingCourse}</p>}
      {mismatchedCourse && <p role="alert">{t.conflict}</p>}
      {(notesState.dirty || notesState.pending) && <p className="review-note">{t.finishNotes}</p>}
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
            disabled={disabled || !data?.courses.length || missingCourse}
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
                  {data?.courses.filter(course => !route?.courseId || course.id === route.courseId).map((course) => (
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
      {!opened && !loading && !error && !missingCourse && (
        <div className="managed-courses">
          {lectures.map((lecture) => (
            <article className="review-card" key={lecture.id}>
              <h2>
                {data?.courses.find((course) => course.id === lecture.courseId)
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
          {data && !lectures.length && <p>{t.empty}</p>}
        </div>
      )}
      {opened && !loading && !error && !mismatchedCourse && data?.lecture?.id === opened && (
        <section className="review-card">
          <h2 ref={workspaceHeading} tabIndex={-1}>
            {data.courses.find((course) => course.id === data.lecture?.courseId)
              ?.name ?? t.lecture}{" "}
            · <bdi dir="ltr">{data.lecture.date}</bdi>
          </h2>
          <LectureNotes key={`${opened}:${notesReset}`} lecture={data.lecture} store={store} disabled={busy || loading} onProtectedChange={protectNotes} onSaved={lecture => setData(current => current ? { ...current, lecture, lectures: current.lectures.map(row => row.id === lecture.id ? lecture : row) } : current)} />
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
            {data.files.map((file) => {
              const name = typeof file.fileName === "string" ? file.fileName : "";
              const mime = typeof file.mimeType === "string" ? file.mimeType : "";
              return (
                <li key={file.id} className="managed-session">
                  <div>
                    <strong>
                      <bdi>{name || t.unsupported}</bdi>
                    </strong>
                    <p>
                      {t.type}:{" "}
                      <bdi>{mime || name.split(".").pop() || "—"}</bdi>{" "}
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
                    {mediaPreview(file.fileName, file.mimeType) && <LectureMedia id={file.id} lectureId={opened} store={store} disabled={disabled} />}
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
              );
            })}
          </ul>
          {!data.files.length && <p>{t.noFiles}</p>}
        </section>
      )}
      {removal && (
        <section className="review-card" role="region" aria-label={t.confirm}>
          <h2 ref={removalHeading} tabIndex={-1}>{t.confirm}</h2>
          <p>{removal.kind === "lecture" ? t.deleteLecture : t.deleteFile}</p>
          <p>
            <bdi>
              {removal.kind === "file"
                ? typeof removal.record.fileName === "string" ? removal.record.fileName : t.unsupported
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
                  if (!alive.current) return;
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
