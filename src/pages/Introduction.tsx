import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { createAcademicStore } from "../data";
import { manualSetupOperation, type ManualSetupStore } from "../features/manualSetup";
import { Dashboard } from "./Dashboard";
import { PageHeader } from "../components/PageHeader";
import { introductionText as t } from "../i18n/introduction";
import { useLanguage, setLanguage } from "../i18n/locale";
import {
  finishIntroduction,
  introductionComplete,
} from "../features/onboarding";
const store = createAcademicStore();
type PresenceStore = Pick<
  ReturnType<typeof createAcademicStore>,
  "getAcademicPresence"
>;
export function Introduction({ onDone }: { onDone: (path: string) => void }) {
  useLanguage();
  const [step, setStep] = useState(-1);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (step >= 0) heading.current?.focus(); }, [step]);
  const stops = [
    [t.dashboard, t.dashboardInfo],
    [t.courses, t.coursesInfo],
    [t.lectures, t.lecturesInfo],
    [t.materials, t.materialsInfo],
  ];
  return (
    <div className="timetable-review introduction">
      <PageHeader
        title={step === 4 ? t.choices : t.welcome}
        description={t.purpose}
      />
      <p className="review-note">{t.local}</p>
      {step === -1 ? (
        <div className="review-card management-actions">
          <button onClick={() => setStep(0)}>{t.tour}</button>
          <button onClick={() => setStep(4)}>{t.skip}</button>
        </div>
      ) : step < 4 ? (
        <section className="review-card" aria-label={t.progress}>
          <p role="status" aria-live="polite" aria-atomic="true">{t.progressStep} {step + 1} / 4: {stops[step][0]}</p>
          <h2 ref={heading} tabIndex={-1}>{stops[step][0]}</h2>
          <p>{stops[step][1]}</p>
          <div className="management-actions">
            <button onClick={() => setStep(step + 1)}>{t.next}</button>
            <button onClick={() => setStep(4)}>{t.skip}</button>
          </div>
        </section>
      ) : (
        <section className="review-card management-actions">
          <h2 ref={heading} tabIndex={-1}>{t.choices}</h2>
          <button onClick={() => onDone("/courses/import")}>{t.import}</button>
          <button onClick={() => onDone("/courses/setup")}>{t.manual}</button>
          <button onClick={() => onDone("/")}>{t.later}</button>
        </section>
      )}
    </div>
  );
}
export function Home({ source = store }: { source?: PresenceStore }) {
  useLanguage();
  const [params] = useSearchParams(),
    navigate = useNavigate();
  const [presence, setPresence] = useState<boolean | null>(null),
    [error, setError] = useState(false),
    [request, setRequest] = useState(0),
    [complete, setComplete] = useState(introductionComplete),
    [bypass, setBypass] = useState(false);
  useEffect(() => {
    let active = true;
    source
      .getAcademicPresence()
      .then((result) => {
        if (active) {
          setPresence(result.hasRecords);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [source, request]);
  function done(path: string) {
    finishIntroduction();
    setComplete(true);
    navigate(path, { replace: true });
  }
  if (bypass) return <Dashboard />;
  if (error)
    return (
      <div className="timetable-review">
        <PageHeader title={t.welcome} description={t.error} />
        <div className="management-actions">
          <button
            onClick={() => {
              setError(false);
              setRequest(request + 1);
            }}
          >
            {t.retry}
          </button>
          <button onClick={() => setBypass(true)}>{t.continue}</button>
        </div>
      </div>
    );
  if (presence === null) return <p role="status">{t.checking}</p>;
  if (params.get("intro") === "1" || (!presence && !complete))
    return <Introduction onDone={done} />;
  return <Dashboard />;
}
export function ManualSetup({
  source = store,
}: {
  source?: ManualSetupStore;
}) {
  useLanguage();
  const navigate = useNavigate();
  const mounted = useRef<ReturnType<typeof manualSetupOperation> | null>(null);
  const operation = useMemo(() => manualSetupOperation(source), [source]);
  const { name, year, semester, status, termId } = useSyncExternalStore(operation.subscribe, operation.snapshot);
  const busy = status === "pending", error = status === "failed";
  useEffect(() => {
    mounted.current = operation;
    return () => { mounted.current = null; };
  }, [operation]);
  function openTerm(id: string) {
    finishIntroduction();
    navigate("/courses?term=" + id, { replace: true });
    operation.clear();
  }
  return (
    <div className="timetable-review">
      <PageHeader title={t.newTerm} description={t.termHint} />
      {status === "saved" && termId ? <section className="review-card">
        <p role="status">{t.createdTerm}</p>
        <button onClick={() => openTerm(termId)}>{t.openTerm}</button>
      </section> :
      <form
        className="review-card"
        onSubmit={async (event) => {
          event.preventDefault();
          const id = await operation.submit();
          if (id && mounted.current === operation) openTerm(id);
        }}
      >
        {busy && <p role="status">{t.savingTerm}</p>}
        <fieldset disabled={busy}>
          <div className="review-fields">
            <label className="review-field">
              {t.name}
              <input
                required
                value={name}
                onChange={(event) => operation.edit({ name: event.target.value })}
              />
            </label>
            <label className="review-field">
              {t.year}
              <input
                required
                value={year}
                onChange={(event) => operation.edit({ year: event.target.value })}
              />
            </label>
            <label className="review-field">
              {t.semester}
              <input
                type="number"
                min="1"
                step="1"
                required
                dir="ltr"
                value={semester}
                onChange={(event) => operation.edit({ semester: event.target.value })}
              />
            </label>
          </div>
          {error && <p role="alert">{t.saveError}</p>}
          <div className="management-actions">
            <button type="submit">{t.create}</button>
            <button type="button" disabled={busy} onClick={() => { if (operation.snapshot().status !== "pending") { operation.clear(); navigate("/"); } }}>{t.cancel}</button>
          </div>
        </fieldset>
      </form>}
    </div>
  );
}
/** Phase A preferences entry only; account/profile controls belong to Phase E/F. */
export function Settings() {
  const language = useLanguage(),
    navigate = useNavigate();
  return (
    <div className="timetable-review">
      <PageHeader title={t.settings} description={t.local} />
      <section className="review-card">
        <p>{t.localOnly}</p>
        <label className="review-field">
          {t.language}
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as "ar" | "en")}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
        <div className="management-actions">
          <button
            onClick={() => {
              navigate("/?intro=1");
            }}
          >
            {t.replay}
          </button>
        </div>
      </section>
    </div>
  );
}
