import { translateMessage, useLanguage } from "../i18n/locale";
import { restorationText } from "../i18n/restoration";
import { TimetableTable } from "../components/TimetableTable";
import { pdfText } from "../i18n/pdf";
import { lectureText } from "../i18n/lectures";
import { RemovedCourses } from "../components/RemovedCourses";
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, UNSAFE_DataRouterContext, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { introductionText } from "../i18n/introduction";
import { EditorNavigationGuard } from "../components/EditorNavigationGuard";
import {
  createAcademicStore,
  DataError,
  type Course,
  type ScheduleSession,
  type CreateInput,
  type DeletionEntry,
} from "../data";
import { timetableText as t } from "../features/timetable/messages";
import { overlappingSessions, validSlot } from "../features/timetable/schedule";
import { PageHeader } from "../components/PageHeader";

const defaultStore = createAcademicStore();
type Store = ReturnType<typeof createAcademicStore>;
type Snapshot = Awaited<ReturnType<Store["getTimetable"]>>;
const dayOrder = [7, 1, 2, 3, 4, 5, 6];
const ordered = (rows: ScheduleSession[]) =>
  [...rows].sort(
    (a, b) =>
      dayOrder.indexOf(a.dayOfWeek) - dayOrder.indexOf(b.dayOfWeek) ||
      a.startTime.localeCompare(b.startTime) ||
      a.id.localeCompare(b.id),
  );
const nullable = (value: string) => (value.trim() ? value : null);
function errorText(error: unknown, session = false) {
  if (!(error instanceof DataError)) return t.unavailable;
  return {
    CONFLICT: t.conflict,
    DUPLICATE: session ? t.duplicateSession : t.duplicate,
    DEPENDENTS: t.protected,
    VALIDATION: t.validation,
    RELATIONSHIP: t.validation,
    NOT_FOUND: t.conflict,
    QUOTA: t.quota,
    UNAVAILABLE: t.unavailable,
    IDENTITY_COLLISION: t.collision,
  }[error.code];
}
function Field({
  label,
  value,
  onChange,
  ltr = false,
  type = "text",
  required = false,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  ltr?: boolean;
  type?: "text" | "number";
  required?: boolean;
}) {
  const id = useId();
  return (
    <label className="review-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        dir={ltr ? "ltr" : undefined}
        onChange={(event) => onChange(event.target.value)}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? 0 : undefined}
      />
    </label>
  );
}
function FocusHeading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2 ref={ref} tabIndex={-1}>
      {children}
    </h2>
  );
}
function CourseEditor({
  course,
  termId,
  busy,
  onSave,
  onCancel,
}: {
  course?: Course;
  termId: string;
  busy: boolean;
  onSave: (input: CreateInput<"courses">) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(course?.name ?? "");
  const [code, setCode] = useState(course?.code ?? "");
  const [instructor, setInstructor] = useState(course?.instructor ?? "");
  const [section, setSection] = useState(course?.section ?? "");
  const [hours, setHours] = useState(String(course?.registeredHours ?? ""));
  const [activity, setActivity] = useState(course?.activityType ?? "");
  const [registrationDate, setRegistrationDate] = useState(course?.registrationDate ?? "");
  const [error, setError] = useState("");
  return (
    <form
      className="review-card management-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !name.trim() ||
          !code.trim() ||
          !hours.trim() ||
          !Number.isFinite(Number(hours)) ||
          Number(hours) < 0
        ) {
          setError(t.invalidCourse);
          return;
        }
        onSave({
          academicTermId: termId,
          name,
          code,
          instructor: nullable(instructor),
          section: nullable(section),
          registeredHours: Number(hours),
          activityType:
            activity === "theory" || activity === "practical" || activity === "lab" ? activity : null,
          registrationDate: nullable(registrationDate),
        });
      }}
    >
      <FocusHeading>{course ? t.editCourse : t.addCourse}</FocusHeading>
      <p className="review-note">{t.editHint}</p>
      {error && <p role="alert">{translateMessage(error)}</p>}
      <fieldset disabled={busy}>
        <div className="review-fields">
          <Field label={t.name} value={name} onChange={setName} required />
          <Field label={t.code} value={code} onChange={setCode} ltr required />
          <Field
            label={t.instructor}
            value={instructor}
            onChange={setInstructor}
          />
          <Field label={pdfText.registrationDate} value={registrationDate} onChange={setRegistrationDate} ltr />
          <Field label={t.section} value={section} onChange={setSection} ltr />
          <Field
            label={t.hours}
            value={hours}
            onChange={setHours}
            type="number"
            ltr
            required
          />
          <label className="review-field">
            <span>{t.activity}</span>
            <select
              value={activity}
              onChange={(event) => setActivity(event.target.value)}
            >
              <option value="">{t.unknown}</option>
              <option value="theory">{t.theory}</option>
              <option value="practical">{t.practical}</option>
              <option value="lab">{pdfText.lab}</option>
            </select>
          </label>
        </div>
        <div className="management-actions">
          <button type="submit">{t.save}</button>
          <button type="button" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function SessionEditor({
  session,
  course,
  sessions,
  courses,
  busy,
  onSave,
  onCancel,
}: {
  session?: ScheduleSession;
  course: Course;
  sessions: ScheduleSession[];
  courses: Course[];
  busy: boolean;
  onSave: (
    input: CreateInput<"scheduleSessions">,
    overlaps: ScheduleSession[],
  ) => void;
  onCancel: () => void;
}) {
  const [day, setDay] = useState(session?.dayOfWeek ?? 7);
  const [start, setStart] = useState(session?.startTime ?? "");
  const [end, setEnd] = useState(session?.endTime ?? "");
  const [room, setRoom] = useState(session?.room ?? "");
  const [mode, setMode] = useState(session?.deliveryMode ?? "in-person");
  const [ack, setAck] = useState(false);
  const [error, setError] = useState("");
  const slot = { dayOfWeek: day, startTime: start, endTime: end };
  const valid = validSlot(slot);
  const overlaps = valid
    ? overlappingSessions(slot, sessions, session?.id)
    : [];
  return (
    <form
      className="review-card management-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) {
          setError(t.invalidTime);
          return;
        }
        if (overlaps.length && !ack) {
          setError(t.acknowledge);
          return;
        }
        onSave(
          {
            academicTermId: course.academicTermId,
            courseId: course.id,
            ...slot,
            room: nullable(room),
            deliveryMode: mode,
          },
          overlaps,
        );
      }}
    >
      <FocusHeading>
        {session ? t.editSession : t.addSession} · {course.name}
      </FocusHeading>
      {error && <p role="alert">{translateMessage(error)}</p>}
      <fieldset disabled={busy}>
        <div className="review-fields">
          <label className="review-field">
            <span>{t.day}</span>
            <select
              value={day}
              onChange={(event) => {
                setDay(Number(event.target.value));
                setAck(false);
              }}
            >
              {dayOrder.map((value) => (
                <option key={value} value={value}>
                  {t.days[value]}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={t.start}
            value={start}
            onChange={(value) => {
              setStart(value);
              setAck(false);
            }}
            ltr
            required
          />
          <Field
            label={t.end}
            value={end}
            onChange={(value) => {
              setEnd(value);
              setAck(false);
            }}
            ltr
            required
          />
          <Field label={t.room} value={room} onChange={setRoom} ltr />
          <label className="review-field">
            <span>{t.mode}</span>
            <select
              value={mode}
              onChange={(event) =>
                setMode(event.target.value as ScheduleSession["deliveryMode"])
              }
            >
              <option value="in-person">{t.inPerson}</option>
              <option value="online">{t.online}</option>
            </select>
          </label>
        </div>
        <p className="review-note">{t.adjacency}</p>
        {overlaps.length > 0 && (
          <div className="review-alert">
            <h3>{t.overlaps}</h3>
            <ul>
              {overlaps.map((row) => (
                <li key={row.id}>
                  {t.sessionLabel(
                    courses.find((item) => item.id === row.courseId)?.name ??
                      t.unknown,
                    t.days[row.dayOfWeek],
                    row.startTime,
                    row.endTime,
                  )}
                </li>
              ))}
            </ul>
            <label className="review-choice">
              <input
                type="checkbox"
                checked={ack}
                onChange={(event) => setAck(event.target.checked)}
              />
              {t.acknowledge}
            </label>
          </div>
        )}
        <div className="management-actions">
          <button type="submit">{t.save}</button>
          <button type="button" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

type Editor =
  | { kind: "course"; course?: Course }
  | { kind: "session"; course: Course; session?: ScheduleSession };
type Removal =
  | { kind: "course"; record: Course; graph: DeletionEntry[] }
  | { kind: "session"; record: ScheduleSession; graph: DeletionEntry[] };

export function Courses({ store = defaultStore }: { store?: Store }) {
  useLanguage();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const replaceTermQuery = useCallback((termId: string) => {
    const activeLocation = router?.state.location;
    if (activeLocation && activeLocation.key !== location.key) return;
    const next = new URLSearchParams(location.search);
    next.set("term", termId);
    // Search-only navigation drops the hash. Keep the complete target and state.
    void navigate({ pathname: location.pathname, search: "?" + next.toString(), hash: location.hash },
      { replace: true, state: location.state });
  }, [location, navigate, router]);
  // A return to the same history entry is still a new navigation lifetime.
  const refreshContext = useMemo(() => ({ store, router, key: location.key, pathname: location.pathname, search: location.search }),
    [store, router, location.key, location.pathname, location.search]);
  const refreshOperation = useRef<symbol | null>(null);
  const [refreshState, setRefreshState] = useState<{ context: typeof refreshContext; pending: boolean } | null>(null);
  const refreshing = refreshState?.context === refreshContext && refreshState.pending;
  // Invalidate before passive effects or a late promise can apply old results.
  useLayoutEffect(() => () => { refreshOperation.current = null; }, [refreshContext]);
  const requestedTerm = params.get("term") ?? undefined;
  const [data, setData] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [viewChoice, setViewChoice] = useState<{ key: string; view: "courses" | "week" }>({ key: location.key, view: "courses" });
  // A new course-target navigation reveals the card; later view choices remain explicit.
  const view = location.hash.startsWith("#course-") && viewChoice.key !== location.key ? "courses" : viewChoice.view;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorTermId, setEditorTermId] = useState<string | undefined>();
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [recovery, setRecovery] = useState<{ store: Store; termId: string }>();
  const recoveryTermId = recovery?.store === store ? recovery.termId : undefined;
  const recoveryOpen = recoveryTermId !== undefined;
  const [pendingWrite, setPendingWrite] = useState(false);
  const writeOperation = useRef<symbol | null>(null);
  useEffect(() => () => { writeOperation.current = null; }, [store]);
  const protectedTermId = editor ? editorTermId : removal?.record.academicTermId ?? recoveryTermId;
  const loadedContext = useRef<{ store: Store; termId: string | undefined } | null>(null);
  const handledCourseTarget = useRef<{ context: typeof refreshContext; hash: string } | null>(null);
  useEffect(() => {
    const nextLocation = router?.state.location;
    if (!data || busy || refreshing || protectedTermId ||
      loadedContext.current?.store !== store || loadedContext.current.termId !== data.termId ||
      (requestedTerm && data.termId !== requestedTerm.toLowerCase()) ||
      (nextLocation && (nextLocation.key !== location.key || nextLocation.pathname !== location.pathname || nextLocation.search !== location.search || nextLocation.hash !== location.hash)) ||
      (handledCourseTarget.current?.context === refreshContext && handledCourseTarget.current.hash === location.hash)) return;
    let id: string;
    try { id = decodeURIComponent(location.hash).replace(/^#course-/, ""); }
    catch { return; }
    if (!location.hash.startsWith("#course-") || !data.courses.some(course => course.id === id)) return;
    if (view !== "courses") return;
    const target = document.getElementById("course-" + id);
    if (!target) return;
    handledCourseTarget.current = { context: refreshContext, hash: location.hash };
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start" });
  }, [data, busy, refreshing, protectedTermId, requestedTerm, router, location, refreshContext, view, store]);
  useEffect(() => {
    if (!protectedTermId) return;
    const guard = (event: MouseEvent) => {
      const anchor = (event.target as Element).closest?.<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const target = new URL(anchor.href, window.location.href);
      if (target.origin !== window.location.origin || target.pathname !== window.location.pathname || target.search !== window.location.search) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    document.addEventListener("click", guard, true);
    window.addEventListener("beforeunload", unload);
    return () => {
      document.removeEventListener("click", guard, true);
      window.removeEventListener("beforeunload", unload);
    };
  }, [protectedTermId]);
  useEffect(() => {
    if (protectedTermId && requestedTerm !== protectedTermId) {
      setParams(current => { current.set("term", protectedTermId); return current; }, { replace: true });
      return;
    }
    if (loadedContext.current?.store === store && loadedContext.current.termId === requestedTerm) return;
    let active = true;
    store
      .getTimetable(requestedTerm)
      .then((snapshot) => {
        if (active) {
          setError("");
          loadedContext.current = { store, termId: snapshot.termId };
          setData(snapshot);
          // Finish this read before URL replacement invalidates its effect.
          setBusy(false);
          if (!requestedTerm && snapshot.termId)
            replaceTermQuery(snapshot.termId);
        }
      })
      .catch((failure) => {
        if (active) {
          loadedContext.current = null;
          setData(null);
          setError(errorText(failure));
          setBusy(false);
        }
      });
    return () => {
      active = false;
    };
  }, [store, requestedTerm, protectedTermId, setParams, replaceTermQuery]);

  async function load(termId = requestedTerm ?? data?.termId, recoverInvalidTerm = true) {
    const operation = Symbol("course refresh");
    refreshOperation.current = operation;
    const current = () => {
      // Router state can advance before React commits the next layout effect.
      const activeLocation = router?.state.location;
      return refreshOperation.current === operation && (!activeLocation ||
        (activeLocation.key === refreshContext.key && activeLocation.pathname === refreshContext.pathname && activeLocation.search === refreshContext.search));
    };
    setRefreshState({ context: refreshContext, pending: true });
    setError("");
    setNotice("");
    try {
      const snapshot = await store.getTimetable(termId).catch((failure: unknown) => {
        // Only a definitively invalid/missing term permits default selection.
        // Storage failures must retain the URL's term even without loaded data.
        if (recoverInvalidTerm && current() && termId && failure instanceof DataError &&
          (failure.code === "VALIDATION" || failure.code === "NOT_FOUND"))
          return store.getTimetable();
        throw failure;
      });
      if (!current()) return;
      setData(snapshot);
      loadedContext.current = { store, termId: snapshot.termId };
      if (snapshot.termId && snapshot.termId !== requestedTerm)
        replaceTermQuery(snapshot.termId);
    } catch (failure) {
      if (current()) setError(errorText(failure));
    } finally {
      if (current()) {
        refreshOperation.current = null;
        setRefreshState({ context: refreshContext, pending: false });
      }
    }
  }
  function begin(next: Editor) {
    setEditorTermId(data?.termId);
    setEditor(next);
    setRemoval(null);
    setNotice("");
    setError("");
  }
  function cancel() {
    if (writeOperation.current || pendingWrite) return;
    setEditor(null);
    setRemoval(null);
    setRecovery(undefined);
    setError("");
  }
  async function write(
    action: () => Promise<unknown>,
    session = false,
    deleting = false,
  ) {
    if (writeOperation.current) return;
    const operation = Symbol("course write");
    writeOperation.current = operation;
    const termId = protectedTermId ?? data?.termId;
    const current = () => writeOperation.current === operation;
    setPendingWrite(true);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (!current()) return;
      setNotice(deleting ? t.removed : t.saved);
      // A refresh failure must not report a committed write as a failed save.
      try {
        const snapshot = await store.getTimetable(termId);
        if (current()) {
          setData(snapshot);
          loadedContext.current = { store, termId: snapshot.termId };
        }
      } catch (failure) {
        if (current()) {
          setData(null);
          loadedContext.current = null;
          setError(errorText(failure));
        }
      }
      if (current()) { setEditor(null); setRemoval(null); }
    } catch (failure) {
      if (current()) setError(errorText(failure, session));
    } finally {
      if (current()) {
        writeOperation.current = null;
        setPendingWrite(false);
        setBusy(false);
      }
    }
  }
  async function preview(
    kind: "course" | "session",
    record: Course | ScheduleSession,
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const graph = await (
        kind === "course" ? store.courses : store.scheduleSessions
      ).previewDelete(record.id);
      if (
        graph.some(
          (row) => row.kind !== "courses" && row.kind !== "scheduleSessions",
        )
      ) {
        setError(t.protected);
        return;
      }
      setRemoval(
        kind === "course"
          ? { kind, record: record as Course, graph }
          : { kind, record: record as ScheduleSession, graph },
      );
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  const transitioning = !protectedTermId && data !== null && requestedTerm !== undefined && requestedTerm !== data.termId;
  const locked = busy || refreshing || transitioning || !!editor || !!removal || recoveryOpen;
  const courses = data?.courses ?? [];
  const sessions = ordered(data?.sessions ?? []);
  const conflicts = sessions.flatMap((row, index) =>
    overlappingSessions(row, sessions.slice(index + 1)).map((other) => ({
      row,
      other,
    })),
  );
  const sessionLabel = (row: ScheduleSession) =>
    t.sessionLabel(
      courses.find((course) => course.id === row.courseId)?.name ?? t.unknown,
      t.days[row.dayOfWeek],
      row.startTime,
      row.endTime,
    );
  function renderSession(row: ScheduleSession, includeCourse = false) {
    const course = courses.find((item) => item.id === row.courseId);
    const color = courses.findIndex((item) => item.id === row.courseId) % 5;
    return (
      <li className="managed-session" data-course-color={color} key={row.id}>
        <div>
          {includeCourse && <strong>{course?.name ?? t.unknown}</strong>}
          <p>
            <span>{t.days[row.dayOfWeek]}</span> ·{" "}
            <bdi dir="ltr">
              {row.startTime}–{row.endTime}
            </bdi>
          </p>
          <p>
            <bdi dir="ltr">{row.room || row.location || t.unknown}</bdi> ·{" "}
            <span className="session-mode" data-mode={row.deliveryMode}>
              {row.deliveryMode === "online" ? t.online : t.inPerson}
            </span>
          </p>
        </div>
        <div className="management-actions">
          <button
            disabled={locked || !course}
            onClick={() =>
              course && begin({ kind: "session", session: row, course })
            }
          >
            {t.editSession}
          </button>
          <button
            className="remove-draft"
            disabled={locked}
            onClick={() => void preview("session", row)}
          >
            {t.removeSession}
          </button>
        </div>
      </li>
    );
  }
  return (
    <div className="timetable-review timetable-management">
      <EditorNavigationGuard enabled={!!protectedTermId} pending={pendingWrite} onDiscard={cancel} />
      <PageHeader title={t.title} description={t.description} />
      <div className="management-toolbar">
        <Link className="button-link" to="/courses/import">
          {t.import}
        </Link>
        <Link className="button-link" to="/courses/import?pdf=1">{pdfText.import}</Link>
        <Link className="button-link" to="/courses/setup">
          {introductionText.startSetup}
        </Link>
        <button disabled={locked} onClick={() => void load()}>
          {t.retry}
        </button>
        <button disabled={locked || !data?.termId} onClick={() => { if (data?.termId) setRecovery({ store, termId: data.termId }); setError(""); setNotice(""); }}>
          {restorationText.title}
        </button>
      </div>
      <p className="review-note">{t.refreshHint}</p>
      {(busy || refreshing || transitioning) && <p role="status">{t.loading}</p>}
      {protectedTermId && <p role="status">{introductionText.finishEditing}</p>}
      {notice && (
        <p role="status" className="management-success">
          {translateMessage(notice)}
        </p>
      )}
      {error && (
        <p role="alert" className="review-alert">
          {translateMessage(error)}
        </p>
      )}
      {error && translateMessage(error) === t.duplicate && <p className="review-note">{restorationText.reserved}</p>}
      {recoveryTermId && <RemovedCourses store={store} termId={recoveryTermId}
        onClose={cancel} onPendingChange={setPendingWrite} onRestored={() => load(recoveryTermId, false)} />}
      {data && !data.terms.length && <p className="review-card">{t.noTerm}</p>}
      {conflicts.length > 0 && (
        <section className="review-alert" aria-label={t.overlaps}>
          <h2>{t.overlaps}</h2>
          <ul>
            {conflicts.map(({ row, other }) => (
              <li key={`${row.id}:${other.id}`}>
                {sessionLabel(row)} / {sessionLabel(other)}
              </li>
            ))}
          </ul>
          <p>{t.adjacency}</p>
        </section>
      )}
      {!!data?.terms.length && (
        <>
          <div className="management-toolbar">
            <label className="review-field">
              <span>{t.term}</span>
              <select
                value={data.termId}
                disabled={locked}
                onChange={(event) => {
                  if (locked) return;
                  setParams(current => { current.set("term", event.target.value); return current; });
                }}
              >
                {data.terms.map((term) => (
                  <option key={term.id} value={term.id}>
                    {term.name} · {term.academicYear}
                  </option>
                ))}
              </select>
            </label>
            <div
              role="group"
              aria-label={t.view}
              className="management-actions"
            >
              <button
                aria-pressed={view === "courses"}
                disabled={!!editor || !!removal || recoveryOpen}
                onClick={() => setViewChoice({ key: location.key, view: "courses" })}
              >
                {t.coursesView}
              </button>
              <button
                aria-pressed={view === "week"}
                disabled={!!editor || !!removal || recoveryOpen}
                onClick={() => setViewChoice({ key: location.key, view: "week" })}
              >
                {t.weekView}
              </button>
            </div>
            <button disabled={locked} onClick={() => begin({ kind: "course" })}>
              {t.addCourse}
            </button>
          </div>
          {editor?.kind === "course" && (
            <CourseEditor
              key={editor.course?.id ?? "new-course"}
              course={editor.course}
              termId={editorTermId!}
              busy={busy || transitioning}
              onCancel={cancel}
              onSave={(input) =>
                void write(() =>
                  editor.course
                    ? store.courses.update(
                        editor.course.id,
                        input,
                        editor.course.revision,
                      )
                    : store.courses.create(input),
                )
              }
            />
          )}
          {editor?.kind === "session" && (
            <SessionEditor
              key={editor.session?.id ?? "new-session"}
              session={editor.session}
              course={editor.course}
              sessions={sessions}
              courses={courses}
              busy={busy || transitioning}
              onCancel={cancel}
              onSave={(input, overlaps) =>
                void write(
                  () =>
                    store.saveManagedSession(
                      input,
                      editor.session
                        ? {
                            id: editor.session.id,
                            revision: editor.session.revision,
                          }
                        : undefined,
                      overlaps.map((row) => ({
                        id: row.id,
                        revision: row.revision,
                      })),
                    ),
                  true,
                )
              }
            />
          )}
          {removal && (
            <section
              className="review-card management-editor"
              aria-label={t.confirmDelete}
            >
              <FocusHeading>{t.confirmDelete}</FocusHeading>
              <p>
                {removal.kind === "course"
                  ? removal.record.name
                  : t.sessionLabel(
                      courses.find((row) => row.id === removal.record.courseId)
                        ?.name ?? t.unknown,
                      t.days[removal.record.dayOfWeek],
                      removal.record.startTime,
                      removal.record.endTime,
                    )}
              </p>
              <p className="review-note">
                {removal.kind === "course"
                  ? t.deleteCourseNote(
                      removal.graph.filter(
                        (row) => row.kind === "scheduleSessions",
                      ).length,
                    )
                  : t.deleteSessionNote}
              </p>
              <div className="management-actions">
                <button
                  className="remove-draft"
                  disabled={busy}
                  onClick={() =>
                    void write(
                      () =>
                        removal.kind === "course"
                          ? store.deleteManagedCourse(
                              removal.record.id,
                              removal.record.revision,
                              removal.graph,
                            )
                          : store.scheduleSessions.delete(removal.record.id, {
                              expectedRevision: removal.record.revision,
                            }),
                      false,
                      true,
                    )
                  }
                >
                  {t.confirmDelete}
                </button>
                <button disabled={busy} onClick={cancel}>
                  {t.cancel}
                </button>
              </div>
            </section>
          )}
          {view === "courses" ? (
            <div className="managed-courses">
              {!courses.length && <p className="review-card">{t.empty}</p>}
              <TimetableTable courses={courses} sessions={sessions}
                courseActions={course => <>
                  <Link className="button-link" to={`/lectures?course=${course.id}&term=${course.academicTermId}`}>{lectureText.title}</Link>
                  <button disabled={locked} onClick={() => begin({ kind: "course", course })}>{t.editCourse}</button>
                  <button className="remove-draft" disabled={locked} onClick={() => void preview("course", course)}>{t.removeCourse}</button>
                  <button disabled={locked} onClick={() => begin({ kind: "session", course })}>{t.addSession}</button>
                </>}
                sessionActions={(course, session) => <>
                  <button disabled={locked} onClick={() => begin({ kind: "session", course, session })}>{t.editSession}</button>
                  <button className="remove-draft" disabled={locked} onClick={() => void preview("session", session)}>{t.removeSession}</button>
                </>}
              />
            </div>
          ) : (
            <div className="weekly-agenda">
              {dayOrder.map((day) => (
                <section
                  key={day}
                  className="agenda-day"
                  aria-label={t.days[day]}
                >
                  <h2>{t.days[day]}</h2>
                  <ul className="managed-sessions">
                    {sessions
                      .filter((row) => row.dayOfWeek === day)
                      .map((row) => renderSession(row, true))}
                  </ul>
                  {!sessions.some((row) => row.dayOfWeek === day) && (
                    <p className="review-note">{t.noDaySessions}</p>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
