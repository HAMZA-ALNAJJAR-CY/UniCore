import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { DataError, type Course, type Material, type MaterialFile, type createAcademicStore, type DeletionEntry } from "../data";
import { FILE_ACCEPT, fileProblem } from "../features/lectures/files";
import { downloadMaterial, disposeDownloads } from "../features/materials/download";
import { materialsText as t } from "../i18n/materials";

type Store = ReturnType<typeof createAcademicStore>;
type Problem = "error" | "conflict" | "invalid" | "missing" | "quota" | "downloadError";
function materialError(failure: unknown): Problem {
  if (!(failure instanceof DataError)) return "error";
  if (failure.code === "QUOTA") return "quota";
  if (failure.code === "CONFLICT" || failure.code === "DUPLICATE") return "conflict";
  if (failure.code === "NOT_FOUND" || failure.code === "RELATIONSHIP") return "missing";
  if (failure.code === "VALIDATION") return "invalid";
  return "error";
}
type Props = {
  store: Store; termId: string; courses: Course[]; materialId?: string; initialCourse?: string;
  onState: (state: { dirty: boolean; pending: boolean }) => void;
  onDone: (saved: boolean) => void;
};

/** Identity is the academic term/material, never a router entry or language. */
export function MaterialEditor({ store, termId, courses, materialId, initialCourse, onState, onDone }: Props) {
  const [id] = useState(() => materialId ?? crypto.randomUUID());
  const [original, setOriginal] = useState<Material | null>(null);
  const [courseId, setCourseId] = useState(initialCourse ?? courses[0]?.id ?? "");
  const [initialCourseId] = useState(courseId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [files, setFiles] = useState<Omit<MaterialFile, "blob">[]>([]);
  const [selected, setSelected] = useState<{ id: string; file: File }[]>([]);
  const [fileError, setFileError] = useState<ReturnType<typeof fileProblem>>();
  const [error, setError] = useState<Problem | null>(null);
  const [loading, setLoading] = useState(!!materialId);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [removal, setRemoval] = useState<{ file?: Omit<MaterialFile, "blob">; graph?: DeletionEntry[] } | null>(null);
  const lock = useRef(false), alive = useRef(true);
  const urls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const heading = useRef<HTMLHeadingElement>(null), confirmation = useRef<HTMLHeadingElement>(null);
  const dirty = !!selected.length || courseId !== (original?.courseId ?? initialCourseId) || title !== (original?.title ?? "") || description !== (original?.description ?? "") || category !== (original?.category ?? "");
  useEffect(() => { onState({ dirty, pending }); }, [dirty, pending, onState]);
  useEffect(() => {
    alive.current = true;
    const downloads = urls.current;
    heading.current?.focus();
    return () => { alive.current = false; disposeDownloads(downloads); };
  }, []);
  useEffect(() => { if (discard || removal) confirmation.current?.focus(); }, [discard, removal]);
  useEffect(() => { if (!loading) heading.current?.focus(); }, [loading]);
  useEffect(() => {
    if (!materialId) return;
    let current = true;
    store.getMaterialDetails(termId, materialId).then(data => {
      if (!current) return;
      setOriginal(data.material); setCourseId(data.material.courseId);
      setTitle(data.material.title); setDescription(data.material.description ?? ""); setCategory(data.material.category ?? ""); setFiles(data.files);
      setLoading(false); setError(null);
    }).catch(failure => { if (current) { setError(materialError(failure)); setLoading(false); } });
    return () => { current = false; };
  }, [store, termId, materialId, attempt]);

  async function perform(operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(null);
    try { await operation(); } catch (failure) { if (alive.current) setError(materialError(failure)); }
    finally { lock.current = false; if (alive.current) setPending(false); }
  }
  async function save() {
    await perform(async () => {
      await store.saveMaterial({ termId, id, expectedRevision: original?.revision, values: { courseId, title, description, category }, files: selected.map(row => ({ id: row.id, fileName: row.file.name, blob: row.file })) });
      if (alive.current) { onState({ dirty: false, pending: false }); onDone(true); }
    });
  }
  async function download(fileId: string) {
    await perform(async () => {
      const file = await store.getMaterialFile(termId, id, fileId);
      if (!alive.current) return;
      try { downloadMaterial(file, urls.current); } catch { setError("downloadError"); }
    });
  }
  async function previewRemoval() {
    await perform(async () => {
      const graph = await store.previewMaterialRemoval(termId, id);
      if (alive.current) setRemoval({ graph });
    });
  }
  async function remove() {
    if (!removal || !original) return;
    await perform(async () => {
      if (removal.file) {
        await store.removeMaterialFile(termId, id, removal.file.id, removal.file.revision);
        if (alive.current) { setFiles(current => current.filter(row => row.id !== removal.file?.id)); setRemoval(null); }
      } else {
        await store.removeMaterial(termId, id, { expectedRevision: original.revision, cascade: true, confirmation: removal.graph });
        if (alive.current) { onState({ dirty: false, pending: false }); onDone(true); }
      }
    });
  }
  if (loading) return <p role="status">{t.loading}</p>;
  if (materialId && !original) return <section className="review-card"><p role="alert">{error ? t[error] : t.missing}</p><button onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>{t.retry}</button><button onClick={() => onDone(false)}>{t.cancel}</button></section>;
  const course = courses.find(row => row.id === courseId);
  return <section className="review-card management-editor material-editor" aria-labelledby="material-editor-title">
    <h2 ref={heading} id="material-editor-title" tabIndex={-1}>{original ? t.edit : t.create}</h2>
    {course && <Link to={`/courses?term=${encodeURIComponent(termId)}#course-${course.id}`}>{t.backCourse} · {course.code}</Link>}
    {error && <p role="alert">{t[error]}</p>}
    {pending && <p role="status">{t.saving}</p>}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={pending || !!removal || discard}>
        <label className="review-field">{t.course}<select required value={courseId} disabled={!!original} onChange={event => setCourseId(event.target.value)}>{courses.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        <label className="review-field">{t.titleField}<input required value={title} onChange={event => setTitle(event.target.value)} /></label>
        <label className="review-field">{t.optionalCategory}<input value={category} onChange={event => setCategory(event.target.value)} /></label>
        <label className="review-field">{t.description}<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} /></label>
        <p className="review-note">{t.policy}</p>
        <label className="review-field">{t.picker}<input type="file" multiple accept={FILE_ACCEPT} onChange={event => {
          let problem: ReturnType<typeof fileProblem>;
          const added: typeof selected = [];
          for (const file of Array.from(event.target.files ?? [])) {
            const failure = fileProblem(file.name, file);
            if (failure) problem ??= failure;
            else added.push({ id: crypto.randomUUID(), file });
          }
          setFileError(problem); setSelected(current => [...current, ...added]); event.target.value = "";
        }} /></label>
        {fileError && <p role="alert">{t[fileError === "empty" ? "emptyFile" : fileError]}</p>}
        {!!selected.length && <ul aria-label={t.selected} className="material-files">{selected.map(row => <li key={row.id}><bdi>{row.file.name}</bdi> · {row.file.size.toLocaleString()} B <button type="button" aria-label={`${t.removeSelected}: ${row.file.name}`} onClick={() => setSelected(current => current.filter(item => item.id !== row.id))}>{t.removeSelected}</button></li>)}</ul>}
        <div className="management-actions"><button type="submit" disabled={!!original && !dirty}>{t.save}</button></div>
      </fieldset>
    </form>
    <button disabled={pending} onClick={() => { if (dirty) setDiscard(true); else onDone(false); }}>{t.cancel}</button>
    {dirty && original && <p className="review-note">{t.changed}</p>}
    <h3>{t.files}</h3>
    {!files.length && <p>{t.noFiles}</p>}
    <ul className="material-files">{files.map(file => <li key={file.id}>
      <div><bdi>{file.fileName}</bdi><p className="review-note">{file.mimeType || "application/octet-stream"} · {file.fileSize.toLocaleString()} B</p></div>
      <div className="management-actions"><button disabled={pending || !!removal || discard} aria-label={`${t.download}: ${file.fileName}`} onClick={() => void download(file.id)}>{t.download}</button><button disabled={pending || dirty || !!removal || discard} aria-label={`${t.removeFile}: ${file.fileName}`} onClick={() => setRemoval({ file })}>{t.removeFile}</button></div>
    </li>)}</ul>
    {original && <button disabled={pending || dirty || !!removal || discard} onClick={() => void previewRemoval()}>{t.remove}</button>}
    {discard && <section className="review-card" role="region" aria-labelledby="material-discard"><h3 id="material-discard" ref={confirmation} tabIndex={-1}>{t.confirmDiscard}</h3><button onClick={() => { setDiscard(false); heading.current?.focus(); }}>{t.keep}</button><button onClick={() => { onState({ dirty: false, pending: false }); onDone(false); }}>{t.discard}</button></section>}
    {removal && <section className="review-card" role="region" aria-labelledby="material-removal"><h3 id="material-removal" ref={confirmation} tabIndex={-1}>{removal.file ? t.fileWarning : t.removeWarning}</h3><p><bdi>{removal.file?.fileName ?? original?.title}</bdi></p>{removal.graph && <p>{t.count}: {removal.graph.filter(row => row.kind === "materialFiles").length}</p>}<button disabled={pending} onClick={() => { setRemoval(null); heading.current?.focus(); }}>{t.keep}</button><button disabled={pending} onClick={() => void remove()}>{t.confirm}</button></section>}
  </section>;
}
