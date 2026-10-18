import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DataError, type Course, type CourseRestorePreview, type createAcademicStore } from "../data";
import { useLanguage } from "../i18n/locale";
import { restorationText as t, translateRestorationMessage } from "../i18n/restoration";
import { timetableText } from "../features/timetable/messages";

type Store = ReturnType<typeof createAcademicStore>;
function failureText(error: unknown) {
  if (!(error instanceof DataError)) return t.unavailable;
  const known = translateRestorationMessage(error.message);
  if (Object.values(t).includes(known)) return known;
  switch (error.code) {
    case "CONFLICT": return t.stale;
    case "NOT_FOUND": return t.missingCourse;
    case "RELATIONSHIP": return t.invalidSessions;
    case "DUPLICATE": return t.codeConflict;
    case "VALIDATION": case "IDENTITY_COLLISION": return t.invalidRecord;
    case "QUOTA": return t.quota;
    default: return t.unavailable;
  }
}

export function RemovedCourses({ store, termId, onClose, onPendingChange, onRestored }: {
  store: Store; termId: string; onClose: () => void;
  onPendingChange: (pending: boolean) => void; onRestored: () => Promise<void>;
}) {
  useLanguage();
  const context = useMemo(() => ({ store, termId }), [store, termId]);
  const alive = useRef<typeof context | null>(context);
  const readOperation = useRef<symbol | null>(null), writeOperation = useRef<symbol | null>(null);
  const restoredCallback = useRef(onRestored);
  useLayoutEffect(() => { restoredCallback.current = onRestored; }, [onRestored]);
  useLayoutEffect(() => {
    alive.current = context;
    return () => { alive.current = null; readOperation.current = null; writeOperation.current = null; onPendingChange(false); };
  }, [context, onPendingChange]);
  const [request, setRequest] = useState(0);
  const [list, setList] = useState<{ context: typeof context; request: number; data?: Awaited<ReturnType<Store["getRemovedCourses"]>>; error?: string } | null>(null);
  const [inspecting, setInspecting] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [success, setSuccess] = useState(false);
  const [preview, setPreview] = useState<CourseRestorePreview | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), previewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { (preview ? previewHeading.current : heading.current)?.focus(); }, [preview]);

  function read() { setError(""); setRequest(current => current + 1); }
  useEffect(() => {
    const operation = Symbol("removed courses read"); readOperation.current = operation;
    const current = () => alive.current === context && readOperation.current === operation;
    store.getRemovedCourses(termId).then(data => {
      if (current()) setList({ context, request, data });
    }).catch(failure => {
      if (current()) setList({ context, request, error: failureText(failure) });
    });
    return () => { if (readOperation.current === operation) readOperation.current = null; };
  }, [context, store, termId, request]);

  async function inspect(course: Course) {
    const operation = Symbol("restoration preview"); readOperation.current = operation;
    const current = () => alive.current === context && readOperation.current === operation;
    setInspecting(true); setError(""); setSuccess(false);
    try {
      const result = await store.previewCourseRestore(course.id);
      if (current()) setPreview(result);
    } catch (failure) { if (current()) setError(failureText(failure)); }
    finally { if (current()) setInspecting(false); }
  }
  async function restore() {
    if (!preview || writeOperation.current) return;
    const operation = Symbol("course restoration"); writeOperation.current = operation;
    const current = () => alive.current === context && writeOperation.current === operation;
    setSaving(true); onPendingChange(true); setError("");
    try {
      await store.restoreCourse(preview.course.id, preview.course.revision, preview.snapshot);
      if (!current()) return;
      setSuccess(true); setPreview(null);
      await restoredCallback.current();
      if (current()) read();
    } catch (failure) { if (current()) setError(failureText(failure)); }
    finally {
      if (current()) { writeOperation.current = null; setSaving(false); onPendingChange(false); }
    }
  }
  const loading = list?.context !== context || list.request !== request;
  const data = !loading ? list.data : null;
  const feedback = error || (!loading ? list.error : "");
  const blocked = loading || inspecting || saving;
  return <section className="review-card management-editor course-recovery" aria-label={t.title} aria-busy={blocked}>
    <h2 ref={heading} tabIndex={-1}>{t.title}</h2>
    <p>{t.description}</p>
    {(loading || inspecting) && <p role="status">{t.loading}</p>}
    {saving && <p role="status">{t.pending}</p>}
    {success && <p role="status" className="management-success">{t.restored}</p>}
    {feedback && <p role="alert" className="review-alert">{translateRestorationMessage(feedback)}</p>}
    <div className="management-actions">
      <button disabled={blocked || !!preview} onClick={() => void read()}>{t.retry}</button>
      <button disabled={saving} onClick={() => { if (!writeOperation.current) onClose(); }}>{t.close}</button>
    </div>
    {data && !preview && <>
      {!data.courses.length && <p>{t.empty}</p>}
      {data.courses.map(course => <article className="review-card" aria-label={course.name} key={course.id}>
        <h3>{course.name}</h3><bdi dir="ltr">{course.code}</bdi>
        <p>{data.term.name} · {data.term.academicYear}</p>
        <button disabled={blocked} onClick={() => void inspect(course)}>{t.review}</button>
      </article>)}
    </>}
    {preview && <section className="review-card" aria-label={t.preview}>
      <h3 ref={previewHeading} tabIndex={-1}>{t.preview}</h3>
      <p>{preview.course.name} · <bdi dir="ltr">{preview.course.code}</bdi> · {preview.term.name}</p>
      <p className="review-note">{t.policy}</p><p className="review-note">{t.history}</p>
      {!preview.sessionsRemainingDeleted.length && <p>{t.noSessions}</p>}
      <ul>{preview.sessionsRemainingDeleted.map(session => <li key={session.id}>
        {timetableText.days[session.dayOfWeek]} · <bdi dir="ltr">{session.startTime}–{session.endTime}</bdi> — {t.remainsRemoved}
      </li>)}</ul>
      <div className="management-actions">
        <button disabled={saving} onClick={() => void restore()}>{t.confirm}</button>
        <button disabled={saving} onClick={() => { if (!writeOperation.current) { setPreview(null); setError(""); } }}>{t.cancel}</button>
      </div>
    </section>}
  </section>;
}
