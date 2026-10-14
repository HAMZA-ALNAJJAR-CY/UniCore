import { tr, dynamic, useLanguage, translateMessage } from "../i18n/locale";
import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { timetableText } from "../features/timetable/messages";
import { CheckCircle2, FileCheck2, Plus, Trash2 } from "lucide-react";
import {
  createAcademicStore,
  DataError,
  type AcademicTerm,
  type TimetableDraft,
  type TimetableReview,
} from "../data";
import {
  analyzeDraft,
  DAYS,
  FIELD_LABELS,
  sourceDraft,
} from "../features/timetable/draft";

const defaultStore = createAcademicStore();
const STEPS = dynamic(() => [
  tr("text_32"),
  tr("text_12"),
  tr("text_33"),
  tr("text_34"),
  tr("text_35"),
]);
const nullable = (value: string) => (value.trim() ? value : null);
function message(error: unknown) {
  if (error instanceof DataError) {
    if (error.code === "IDENTITY_COLLISION") return tr("text_36");
    if (error.code === "QUOTA") return tr("text_37");
    if (error.code === "CONFLICT" || error.code === "VALIDATION")
      return /[\u0600-\u06ff]/.test(error.message)
        ? error.message
        : tr("text_38");
  }
  return tr("text_39");
}
function TextField({
  label,
  value,
  onChange,
  ltr = false,
  type = "text",
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  ltr?: boolean;
  type?: "text" | "date" | "number";
}) {
  const id = useId();
  return (
    <label className="review-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={type}
        value={
          typeof value === "number" && !Number.isFinite(value) ? "" : value
        }
        dir={ltr ? "ltr" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function UnknownFields({
  fields,
  value,
  onChange,
}: {
  fields: string[];
  value: string[];
  onChange: (fields: string[]) => void;
}) {
  return (
    <details className="unknown-fields">
      <summary>
        {tr("text_40")}
        {value.length})
      </summary>
      <div>
        {fields.map((field) => (
          <label key={field}>
            <input
              type="checkbox"
              checked={value.includes(field)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...value, field]
                    : value.filter((item) => item !== field),
                )
              }
            />
            {FIELD_LABELS[field]} {tr("text_41")}
          </label>
        ))}
      </div>
    </details>
  );
}
function Findings({
  title,
  items,
  danger = false,
}: {
  title: string;
  items: string[];
  danger?: boolean;
}) {
  return (
    <section className={`review-findings ${danger ? "finding-danger" : ""}`}>
      <h3>
        {title} ({items.length})
      </h3>
      {items.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{tr("text_42")}</p>
      )}
    </section>
  );
}

function WeeklySummary({ draft }: { draft: TimetableDraft }) {
  return (
    <div
      className="review-table-scroll"
      tabIndex={0}
      role="region"
      aria-label={tr("text_43")}
    >
      <table>
        <caption>{tr("text_44")}</caption>
        <thead>
          <tr>
            <th>{tr("text_45")}</th>
            <th>{tr("text_46")}</th>
            <th>{tr("text_47")}</th>
            <th>{tr("text_48")}</th>
            <th>{tr("text_49")}</th>
          </tr>
        </thead>
        <tbody>
          {draft.sessions.map((session) => (
            <tr key={session.key}>
              <td>
                {draft.courses.find(
                  (course) => course.key === session.courseKey,
                )?.name ?? tr("text_50")}
              </td>
              <td>{DAYS[session.dayOfWeek]}</td>
              <td>
                <bdi dir="ltr">
                  {session.startTime}–{session.endTime}
                </bdi>
              </td>
              <td>
                <bdi dir="ltr">{session.room ?? tr("text_51")}</bdi>
              </td>
              <td>
                {session.deliveryMode === "online"
                  ? tr("text_52")
                  : tr("text_53")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TimetableImport({
  store = defaultStore,
}: {
  store?: ReturnType<typeof createAcademicStore>;
}) {
  useLanguage();
  const [draft, setDraft] = useState(sourceDraft);
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [plan, setPlan] = useState<TimetableReview | null>(null);
  const [keep, setKeep] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [success, setSuccess] = useState("");
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stats = analyzeDraft(draft);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const existingTerms = await store.academicTerms.list();
        if (active) setTerms(existingTerms);
        const initial = await store.reviewTimetable(sourceDraft());
        if (active) setDraft(initial.draft);
      } catch (failure) {
        if (active) {
          setError(message(failure));
          setBlocked(
            failure instanceof DataError &&
              failure.code === "IDENTITY_COLLISION",
          );
        }
      } finally {
        if (active) setReady(true);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [store]);
  useEffect(() => {
    stepHeading.current?.focus();
  }, [step]);
  function edit(change: (current: TimetableDraft) => TimetableDraft) {
    setDraft(change);
    setPlan(null);
    setConfirmed(false);
    setKeep([]);
    setError("");
  }
  function courseEdit(
    key: string,
    patch: Partial<TimetableDraft["courses"][number]>,
  ) {
    edit((current) => ({
      ...current,
      courses: current.courses.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    }));
  }
  function sessionEdit(
    key: string,
    patch: Partial<TimetableDraft["sessions"][number]>,
  ) {
    edit((current) => ({
      ...current,
      sessions: current.sessions.map((row) =>
        row.key === key ? { ...row, ...patch } : row,
      ),
    }));
  }
  async function next() {
    setError("");
    if (step === 2) {
      if (stats.errors.length) {
        setStep(3);
        return;
      }
      setBusy(true);
      try {
        const reviewed = await store.reviewTimetable(draft);
        setDraft(reviewed.draft);
        setPlan(reviewed);
        setKeep([]);
        setStep(3);
      } catch (failure) {
        setError(message(failure));
      } finally {
        setBusy(false);
      }
    } else if (step === 3) {
      if (!plan || stats.errors.length) {
        setError(tr("text_54"));
        return;
      }
      if (plan.differences.some((row) => !keep.includes(row.key))) {
        setError(tr("text_55"));
        return;
      }
      setStep(4);
    } else setStep(step + 1);
  }
  async function save() {
    if (!plan || !confirmed || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await store.saveTimetable(plan, {
        confirmed,
        keepExistingKeys: keep,
      });
      if (!result.committed) {
        const code = result.rejected[0]?.code ?? "CONFLICT";
        setError(message(new DataError(code, tr("text_56"))));
        setConfirmed(false);
        setPlan(null);
      } else
        setSuccess(
          tr("text_57", [result.created.length, result.skipped.length]),
        );
    } catch (failure) {
      setError(message(failure));
      setConfirmed(false);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="timetable-review">
      <header className="page-header">
        <p className="eyebrow">{tr("text_58")}</p>
        <h1>{tr("text_2")}</h1>
        <p>{tr("text_59")}</p>
      </header>
      <ol className="review-steps" aria-label={tr("text_60")}>
        {STEPS.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="review-alert" role="alert">
          {translateMessage(error)}
        </div>
      )}
      {!ready && <p role="status">{tr("text_61")}</p>}
      {success ? (
        <section className="empty-state" role="status">
          <CheckCircle2 size={40} aria-hidden="true" />
          <h2>{tr("text_62")}</h2>
          <p>{translateMessage(success)}</p>
          <Link className="button-link" to="/courses">
            {timetableText.coursesView}
          </Link>
          <button
            onClick={() => {
              setSuccess("");
              setStep(0);
              setPlan(null);
              setConfirmed(false);
            }}
          >
            {tr("text_63")}
          </button>
        </section>
      ) : (
        <>
          <h2 className="review-step-title" tabIndex={-1} ref={stepHeading}>
            {STEPS[step]}
          </h2>
          <fieldset
            className="review-body"
            disabled={!ready || blocked || busy}
          >
            {step === 0 && (
              <section className="review-card">
                <div className="review-fields">
                  <TextField
                    label={tr("text_64")}
                    value={draft.term.name}
                    onChange={(name) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, name },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_65")}
                    value={draft.term.academicYear}
                    ltr
                    onChange={(academicYear) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, academicYear },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_66")}
                    type="number"
                    value={draft.term.semester}
                    onChange={(value) =>
                      edit((current) => ({
                        ...current,
                        term: {
                          ...current.term,
                          semester: value === "" ? NaN : Number(value),
                        },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_67")}
                    value={draft.term.college ?? ""}
                    onChange={(college) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, college: nullable(college) },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_68")}
                    value={draft.term.program ?? ""}
                    onChange={(program) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, program: nullable(program) },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_69")}
                    type="date"
                    value={draft.term.startDate ?? ""}
                    onChange={(startDate) =>
                      edit((current) => ({
                        ...current,
                        term: {
                          ...current.term,
                          startDate: nullable(startDate),
                        },
                      }))
                    }
                  />
                  <TextField
                    label={tr("text_70")}
                    type="date"
                    value={draft.term.endDate ?? ""}
                    onChange={(endDate) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, endDate: nullable(endDate) },
                      }))
                    }
                  />
                  {terms.length > 0 && (
                    <label className="review-field">
                      {tr("text_71")}
                      <select
                        value={
                          draft.term.id &&
                          terms.some((row) => row.id === draft.term.id)
                            ? draft.term.id
                            : ""
                        }
                        onChange={(event) =>
                          edit((current) => ({
                            ...current,
                            term: {
                              ...current.term,
                              id: event.target.value || undefined,
                            },
                          }))
                        }
                      >
                        <option value="">{tr("text_72")}</option>
                        {terms.map((term) => (
                          <option key={term.id} value={term.id}>
                            {term.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <p className="review-note">{tr("text_73")}</p>
              </section>
            )}
            {step === 1 && (
              <>
                <p className="review-note">{tr("text_74")}</p>
                {draft.courses.map((course, index) => (
                  <section
                    className="review-card"
                    key={course.key}
                    aria-label={tr("text_75", [index + 1])}
                  >
                    <div className="review-card-heading">
                      <h3>{course.name || tr("text_76")}</h3>
                      <span className="badge">{index + 1}</span>
                    </div>
                    <div className="review-fields">
                      <TextField
                        label={tr("text_77")}
                        value={course.name}
                        onChange={(name) => courseEdit(course.key, { name })}
                      />
                      <TextField
                        label={tr("text_78")}
                        value={course.code}
                        ltr
                        onChange={(code) => courseEdit(course.key, { code })}
                      />
                      <TextField
                        label={tr("text_79")}
                        value={course.instructor ?? ""}
                        onChange={(instructor) =>
                          courseEdit(course.key, {
                            instructor: nullable(instructor),
                          })
                        }
                      />
                      <TextField
                        label={tr("text_80")}
                        value={course.section ?? ""}
                        ltr
                        onChange={(section) =>
                          courseEdit(course.key, { section: nullable(section) })
                        }
                      />
                      <TextField
                        label={tr("text_81")}
                        type="number"
                        value={course.registeredHours}
                        onChange={(value) =>
                          courseEdit(course.key, {
                            registeredHours: value === "" ? NaN : Number(value),
                          })
                        }
                      />
                      <label className="review-field">
                        {tr("text_82")}
                        <select
                          value={course.activityType ?? ""}
                          onChange={(event) =>
                            courseEdit(course.key, {
                              activityType:
                                event.target.value === ""
                                  ? null
                                  : (event.target.value as
                                      "theory" | "practical"),
                            })
                          }
                        >
                          <option value="">{tr("text_83")}</option>
                          <option value="theory">{tr("text_84")}</option>
                          <option value="practical">{tr("text_85")}</option>
                        </select>
                      </label>
                    </div>
                    <UnknownFields
                      fields={[
                        "name",
                        "code",
                        "instructor",
                        "section",
                        "registeredHours",
                        "activityType",
                      ]}
                      value={course.unconfirmed}
                      onChange={(unconfirmed) =>
                        courseEdit(course.key, { unconfirmed })
                      }
                    />
                    <button
                      className="remove-draft"
                      onClick={() =>
                        edit((current) => ({
                          ...current,
                          courses: current.courses.filter(
                            (row) => row.key !== course.key,
                          ),
                          sessions: current.sessions.filter(
                            (row) => row.courseKey !== course.key,
                          ),
                        }))
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      {tr("text_86")}
                    </button>
                  </section>
                ))}
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    edit((current) => ({
                      ...current,
                      courses: [
                        ...current.courses,
                        {
                          key: `added-${id}`,
                          id,
                          code: "",
                          name: "",
                          instructor: null,
                          section: null,
                          registeredHours: NaN,
                          activityType: null,
                          unconfirmed: ["instructor"],
                        },
                      ],
                    }));
                  }}
                >
                  <Plus size={18} aria-hidden="true" />
                  {tr("text_87")}
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <p className="review-note">{tr("text_88")}</p>
                {draft.sessions.map((session, index) => (
                  <section
                    className="review-card session-card"
                    data-mode={session.deliveryMode}
                    key={session.key}
                    aria-label={tr("text_89", [index + 1])}
                  >
                    <div className="review-card-heading">
                      <h3>
                        {tr("text_90")}
                        {index + 1}
                      </h3>
                      <span className="badge">
                        {session.deliveryMode === "online"
                          ? tr("text_52")
                          : tr("text_53")}
                      </span>
                    </div>
                    <div className="review-fields">
                      <label className="review-field">
                        {tr("text_91")}
                        <select
                          value={session.courseKey}
                          onChange={(event) =>
                            sessionEdit(session.key, {
                              courseKey: event.target.value,
                            })
                          }
                        >
                          <option value="">{tr("text_92")}</option>
                          {draft.courses.map((course) => (
                            <option key={course.key} value={course.key}>
                              {course.name} — {course.code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="review-field">
                        {tr("text_46")}
                        <select
                          value={session.dayOfWeek}
                          onChange={(event) =>
                            sessionEdit(session.key, {
                              dayOfWeek: Number(event.target.value),
                            })
                          }
                        >
                          {DAYS.slice(1).map((day, i) => (
                            <option key={day} value={i + 1}>
                              {day}
                            </option>
                          ))}
                        </select>
                      </label>
                      <TextField
                        label={tr("text_93")}
                        value={session.startTime}
                        ltr
                        onChange={(startTime) =>
                          sessionEdit(session.key, { startTime })
                        }
                      />
                      <TextField
                        label={tr("text_94")}
                        value={session.endTime}
                        ltr
                        onChange={(endTime) =>
                          sessionEdit(session.key, { endTime })
                        }
                      />
                      <TextField
                        label={tr("text_95")}
                        value={session.room ?? ""}
                        ltr
                        onChange={(room) =>
                          sessionEdit(session.key, { room: nullable(room) })
                        }
                      />
                      <label className="review-field">
                        {tr("text_96")}
                        <select
                          value={session.deliveryMode}
                          onChange={(event) =>
                            sessionEdit(session.key, {
                              deliveryMode: event.target.value as
                                "online" | "in-person",
                            })
                          }
                        >
                          <option value="in-person">{tr("text_53")}</option>
                          <option value="online">{tr("text_52")}</option>
                        </select>
                      </label>
                      <TextField
                        label={tr("text_97")}
                        value={session.notes ?? ""}
                        onChange={(notes) =>
                          sessionEdit(session.key, { notes: nullable(notes) })
                        }
                      />
                    </div>
                    <UnknownFields
                      fields={["room", "notes"]}
                      value={session.unconfirmed}
                      onChange={(unconfirmed) =>
                        sessionEdit(session.key, { unconfirmed })
                      }
                    />
                    <button
                      className="remove-draft"
                      onClick={() =>
                        edit((current) => ({
                          ...current,
                          sessions: current.sessions.filter(
                            (row) => row.key !== session.key,
                          ),
                        }))
                      }
                    >
                      <Trash2 size={16} aria-hidden="true" />
                      {tr("text_98")}
                    </button>
                  </section>
                ))}
                <button
                  onClick={() => {
                    const id = crypto.randomUUID();
                    edit((current) => ({
                      ...current,
                      sessions: [
                        ...current.sessions,
                        {
                          id,
                          key: `added-${id}`,
                          courseKey: current.courses[0]?.key ?? "",
                          dayOfWeek: 7,
                          startTime: "",
                          endTime: "",
                          room: null,
                          deliveryMode: "in-person",
                          notes: null,
                          unconfirmed: ["room"],
                        },
                      ],
                    }));
                  }}
                >
                  <Plus size={18} aria-hidden="true" />
                  {tr("text_99")}
                </button>
              </>
            )}
            {(step === 3 || step === 4) && (
              <>
                <section className="review-stats">
                  <div>
                    <strong>{stats.courseCount}</strong>
                    {tr("text_100")}
                  </div>
                  <div>
                    <strong>
                      {step === 4 && plan
                        ? plan.savedSummary.hours
                        : stats.hours}
                    </strong>
                    {tr("text_101")}
                  </div>
                  <div>
                    <strong>{stats.sessionCount}</strong>
                    {tr("text_102")}
                  </div>
                </section>
                {step === 3 && (
                  <>
                    <WeeklySummary draft={draft} />
                    {plan && plan.savedSummary.hours !== stats.hours && (
                      <p className="review-note">
                        {tr("text_103")}
                        {plan.savedSummary.hours} {tr("text_104")} {stats.hours}{" "}
                        {tr("text_105")}
                      </p>
                    )}
                    <Findings
                      title={tr("text_106")}
                      items={stats.errors}
                      danger
                    />
                    <Findings
                      title={tr("text_107")}
                      items={stats.overlaps}
                      danger
                    />
                    <Findings
                      title={tr("text_108")}
                      items={stats.transitions}
                    />
                    <Findings
                      title={tr("text_109")}
                      items={stats.unconfirmed}
                    />
                    <Findings title={tr("text_110")} items={stats.missing} />
                    <p className="review-note">{tr("text_111")}</p>
                    {plan && (
                      <>
                        <p>
                          {plan.existingKeys.length} {tr("text_112")}
                        </p>
                        {plan.differences.map((difference) => (
                          <section className="review-card" key={difference.key}>
                            <h3>
                              {tr("text_113")}
                              {difference.label}
                            </h3>
                            <div className="difference-list">
                              {difference.fields.map((field) => (
                                <p key={translateMessage(field.field)}>
                                  <strong>{field.field}</strong>
                                  {tr("text_114")}{" "}
                                  <bdi>{translateMessage(field.incoming)}</bdi>
                                  {tr("text_115")}{" "}
                                  <bdi>{translateMessage(field.existing)}</bdi>
                                </p>
                              ))}
                            </div>
                            <label className="review-choice">
                              <input
                                type="checkbox"
                                checked={keep.includes(difference.key)}
                                onChange={(event) =>
                                  setKeep((current) =>
                                    event.target.checked
                                      ? [...current, difference.key]
                                      : current.filter(
                                          (key) => key !== difference.key,
                                        ),
                                  )
                                }
                              />
                              {tr("text_116")}
                            </label>
                            <p className="review-note">{tr("text_117")}</p>
                          </section>
                        ))}
                      </>
                    )}
                  </>
                )}
                {step === 4 && (
                  <section className="review-card">
                    <FileCheck2 size={28} aria-hidden="true" />
                    <h3>{tr("text_118")}</h3>
                    <p>{tr("text_119")}</p>
                    <label className="review-choice">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      {tr("text_120")}
                    </label>
                    <button
                      className="save-import"
                      disabled={!confirmed || !plan}
                      onClick={() => void save()}
                    >
                      {busy ? tr("text_121") : tr("text_122")}
                    </button>
                  </section>
                )}
              </>
            )}
          </fieldset>
          <nav className="review-actions" aria-label={tr("text_123")}>
            <button
              disabled={step === 0 || busy}
              onClick={() => {
                setStep(step - 1);
                setPlan(step - 1 < 3 ? null : plan);
                setConfirmed(false);
                setError("");
              }}
            >
              {tr("text_124")}
            </button>
            {step < 4 && (
              <button
                disabled={!ready || blocked || busy}
                onClick={() => void next()}
              >
                {busy ? tr("text_125") : tr("text_126")}
              </button>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
