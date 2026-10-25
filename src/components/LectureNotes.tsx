import { useEffect, useId, useRef, useState } from "react";
import { type Lecture, DataError, createAcademicStore } from "../data";
import { lectureText as t } from "../i18n/lectures";

/** The opening revision is retained on failure; retry never silently adopts a newer revision. */
export function LectureNotes({ lecture, store, disabled, onSaved, onProtectedChange }: {
  lecture: Lecture;
  store: ReturnType<typeof createAcademicStore>;
  disabled: boolean;
  onSaved: (lecture: Lecture) => void;
  onProtectedChange: (dirty: boolean, pending: boolean) => void;
}) {
  const titleId = useId(), notesId = useId();
  const [title, setTitle] = useState(lecture.title ?? "");
  const [notes, setNotes] = useState(lecture.notes ?? "");
  const [saved, setSaved] = useState(lecture);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<"conflict" | "storage" | "notesSaved" | null>(null);
  const lock = useRef(false);
  const alive = useRef(false);
  const dirty = title !== (saved.title ?? "") || notes !== (saved.notes ?? "");
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    onProtectedChange(dirty, pending);
  }, [dirty, pending, onProtectedChange]);
  useEffect(() => () => onProtectedChange(false, false), [onProtectedChange]);
  function discard() {
    if (lock.current) return;
    setTitle(saved.title ?? "");
    setNotes(saved.notes ?? "");
    setMessage(null);
    onProtectedChange(false, false);
  }
  async function save() {
    if (lock.current || disabled || !dirty) return;
    lock.current = true;
    setPending(true);
    setMessage(null);
    try {
      const updated = await store.lectures.update(saved.id, { title: title.trim() || null, notes }, saved.revision);
      if (!alive.current) return;
      setSaved(updated);
      setTitle(updated.title ?? "");
      setMessage("notesSaved");
      onSaved(updated);
    } catch (error) {
      if (alive.current) setMessage(error instanceof DataError && ["CONFLICT", "NOT_FOUND", "RELATIONSHIP"].includes(error.code) ? "conflict" : "storage");
    } finally {
      lock.current = false;
      if (alive.current) setPending(false);
    }
  }
  return <form className="lecture-notes management-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3>{t.notes}</h3>
    <fieldset disabled={disabled || pending}>
      <div className="review-field"><label htmlFor={titleId}>{t.lectureTitle}</label><input id={titleId} value={title} onChange={event => setTitle(event.target.value)} /></div>
      <div className="review-field"><label htmlFor={notesId}>{t.notes}</label><textarea id={notesId} rows={8} value={notes} onChange={event => setNotes(event.target.value)} /></div>
      <p className="review-note">{t.plainNotes}</p>
      <div className="management-actions">
        <button type="submit" disabled={!dirty}>{t.saveNotes}</button>
        <button type="button" disabled={!dirty} onClick={discard}>{t.discardNotes}</button>
      </div>
    </fieldset>
    {pending && <p role="status">{t.saving}</p>}
    {message && <p role={message === "notesSaved" ? "status" : "alert"}>{t[message]}</p>}
  </form>;
}
