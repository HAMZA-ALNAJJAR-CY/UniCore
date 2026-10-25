import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link, UNSAFE_DataRouterContext, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { createAcademicStore, DataError } from "../data";
import { MaterialEditor } from "../components/MaterialEditor";
import { EditorNavigationGuard } from "../components/EditorNavigationGuard";
import { PageHeader } from "../components/PageHeader";
import { useLanguage } from "../i18n/locale";
import { materialsText as t } from "../i18n/materials";

const defaultStore = createAcademicStore();
type Store = ReturnType<typeof createAcademicStore>;
type Library = Awaited<ReturnType<Store["getMaterialLibrary"]>>;

export function Materials({ store = defaultStore }: { store?: Store }) {
  useLanguage();
  const [params] = useSearchParams();
  const [savedTerm, setSavedTerm] = useState<string | null>(null);
  // Hashes, language and router-entry keys never define editor identity.
  const termId = params.get("term") ?? undefined;
  return <MaterialLibrary key={JSON.stringify([termId, params.get("material")])} store={store} requestedTerm={termId} message={!!termId && savedTerm === termId} setMessage={saved => setSavedTerm(saved ? termId ?? null : null)} />;
}

function MaterialLibrary({ store, requestedTerm, message, setMessage }: { store: Store; requestedTerm?: string; message: boolean; setMessage: (saved: boolean) => void }) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const requestedMaterial = params.get("material") ?? undefined;
  const courseFilter = params.get("course") ?? "";
  const [data, setData] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0), [search, setSearch] = useState(""), [category, setCategory] = useState("");
  const [creating, setCreating] = useState(false), [closed, setClosed] = useState(false);
  const [queueClose, setQueueClose] = useState(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const [protection, setProtection] = useState({ dirty: false, pending: false });
  const onState = useCallback((state: typeof protection) => setProtection(state), []);
  const protectedDraft = protection.dirty || protection.pending;
  const locationRef = useRef(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => {
    let current = true;
    const ownsRead = () => {
      const latest = router?.state.location;
      if (!current || !latest) return current;
      const query = new URLSearchParams(latest.search);
      return latest.pathname === "/materials" && (query.get("term") ?? undefined) === requestedTerm && (query.get("material") ?? undefined) === requestedMaterial;
    };
    store.getMaterialLibrary(requestedTerm).catch((failure: unknown) => {
      // A failed database read must not silently select a different term.
      if (ownsRead() && requestedTerm && failure instanceof DataError && (failure.code === "NOT_FOUND" || failure.code === "VALIDATION")) return store.getMaterialLibrary();
      throw failure;
    }).then(value => {
      if (!ownsRead()) return;
      setData(value); setError(false); setLoading(false);
      if ((value.termId ?? undefined) !== requestedTerm) {
        const latest = router?.state.location ?? locationRef.current, next = new URLSearchParams(latest.search);
        if (value.termId) next.set("term", value.termId); else next.delete("term");
        // An invalid term's child IDs must not leak into the recovered context.
        if (requestedTerm) { next.delete("course"); next.delete("material"); }
        void navigate({ pathname: latest.pathname, search: next.toString(), hash: latest.hash }, { replace: true });
      }
    }).catch(() => { if (ownsRead()) { setData(null); setError(true); setLoading(false); } });
    return () => { current = false; };
  }, [store, requestedTerm, requestedMaterial, refresh, navigate, router]);
  useEffect(() => {
    if (!protectedDraft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [protectedDraft]);
  useEffect(() => {
    if (!queueClose || protectedDraft || !requestedMaterial) return;
    const next = new URLSearchParams(location.search); next.delete("material");
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true });
  }, [queueClose, protectedDraft, requestedMaterial, navigate, location]);
  const invalidCourse = !!courseFilter && !!data && !data.courses.some(course => course.id === courseFilter);
  const editing = !closed && (creating || !!requestedMaterial);
  const disabled = protectedDraft || editing;
  useEffect(() => { if (!loading && !editing && message) feedback.current?.focus(); }, [loading, editing, message]);
  function changeQuery(key: string, value: string) {
    const next = new URLSearchParams(location.search);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("material");
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash });
  }
  const categories = [...new Set(data?.materials.map(row => row.category).filter((value): value is string => !!value) ?? [])].sort();
  const query = search.trim().toLocaleLowerCase();
  const visible = data?.materials.filter(row => {
    const course = data.courses.find(item => item.id === row.courseId);
    return (!courseFilter || row.courseId === courseFilter) && (!category || row.category === category) &&
      [row.title, row.description, row.category, course?.code, course?.name].some(value => value?.toLocaleLowerCase().includes(query));
  }) ?? [];
  return <div className="timetable-review materials-library">
    <EditorNavigationGuard enabled={protectedDraft} pending={protection.pending} onDiscard={() => { setClosed(true); setCreating(false); onState({ dirty: false, pending: false }); }} />
    <PageHeader title={t.title} description={t.intro} />
    <p className="review-note">{t.local}</p>
    {message && !editing && <p role="status" tabIndex={-1} ref={feedback}>{t.saved}</p>}
    {loading && <p role="status">{t.loading}</p>}
    {error && <p role="alert">{t.error}</p>}
    <button disabled={disabled || loading} onClick={() => { setLoading(true); setData(null); setError(false); setRefresh(value => value + 1); }}>{t.refresh}</button>
    {data && !loading && <>
      {!data.terms.length && <p>{t.noTerms} <Link to="/courses/setup">{t.courses}</Link></p>}
      <div className="management-toolbar">
        <label className="review-field">{t.term}<select disabled={disabled || !data.terms.length} value={data.termId ?? ""} onChange={event => { const next = new URLSearchParams(); next.set("term", event.target.value); void navigate({ pathname: location.pathname, search: next.toString() }); }}>{data.terms.map(term => <option key={term.id} value={term.id}>{term.name} · {term.academicYear}</option>)}</select></label>
        <label className="review-field">{t.course}<select disabled={disabled} value={courseFilter} onChange={event => changeQuery("course", event.target.value)}><option value="">{t.allCourses}</option>{invalidCourse && <option value={courseFilter}>{t.invalidCourse}</option>}{data.courses.map(course => <option key={course.id} value={course.id}>{course.code} · {course.name}</option>)}</select></label>
        <label className="review-field">{t.search}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <label className="review-field">{t.category}<select value={category} onChange={event => setCategory(event.target.value)}><option value="">{t.allCategories}</option>{categories.map(value => <option key={value}>{value}</option>)}</select></label>
      </div>
      {invalidCourse && <p role="alert">{t.invalidCourse}</p>}
      {!data.courses.length && !!data.termId && <p>{t.noCourses} <Link to={`/courses?term=${data.termId}`}>{t.courses}</Link></p>}
      <button disabled={disabled || !data.courses.length || invalidCourse} onClick={() => { setClosed(false); setCreating(true); setMessage(false); }}>{t.create}</button>
      {editing && data.termId && <MaterialEditor key={`${data.termId}:${creating ? "new" : requestedMaterial}`} store={store} termId={data.termId} courses={data.courses} materialId={creating ? undefined : requestedMaterial} initialCourse={invalidCourse ? undefined : courseFilter || undefined} onState={onState} onDone={saved => { setClosed(true); setCreating(false); onState({ dirty: false, pending: false }); setMessage(saved); setQueueClose(true); setLoading(true); setData(null); setRefresh(value => value + 1); }} />}
      <p role="status">{t.results}: {visible.length}</p>
      {!visible.length && <p>{data.materials.length ? t.noResults : t.empty}</p>}
      <ul className="material-list">{visible.map(row => {
        const course = data.courses.find(item => item.id === row.courseId);
        const next = new URLSearchParams(location.search); next.set("material", row.id);
        return <li className="review-card" key={row.id}><h2>{row.title}</h2><p>{course?.code} · {course?.name}</p><p>{row.category || t.uncategorized}</p>{row.description && <p className="material-description">{row.description}</p>}<Link aria-label={`${t.open}: ${row.title}`} to={{ pathname: location.pathname, search: next.toString() }}>{t.open}</Link></li>;
      })}</ul>
    </>}
  </div>;
}
