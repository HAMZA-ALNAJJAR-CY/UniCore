import { useEffect, useId, useMemo, useRef, useState } from "react";
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
const STEPS = [
  "بيانات الفصل",
  "المقررات",
  "الجلسات الأسبوعية",
  "المراجعة النهائية",
  "التأكيد والحفظ",
];
const nullable = (value: string) => (value.trim() ? value : null);
function message(error: unknown) {
  if (error instanceof DataError) {
    if (error.code === "IDENTITY_COLLISION")
      return "تعذر ترحيل هويات قديمة متعارضة. بياناتك الأصلية محفوظة. لا تمسح بيانات الموقع؛ اطلب مراجعة المطور وفق ملف RECOVERY.md ثم أعد المحاولة.";
    if (error.code === "QUOTA")
      return "مساحة التخزين غير كافية. لم تُحفظ أي سجلات جديدة. حرر مساحة ثم أعد المراجعة والمحاولة.";
    if (error.code === "CONFLICT" || error.code === "VALIDATION")
      return /[\u0600-\u06ff]/.test(error.message)
        ? error.message
        : "تعارضت البيانات أو تغيرت منذ المراجعة. راجع الحقول والبيانات المحفوظة قبل إعادة التأكيد.";
  }
  return "تعذر الوصول إلى التخزين المحلي. لم تُحفظ أي سجلات جديدة. أعد المحاولة دون مسح بيانات الموقع.";
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
      <summary>الحقول غير المؤكدة ({value.length})</summary>
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
            {FIELD_LABELS[field]} غير مؤكد
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
        <p>لا توجد ملاحظات في هذه الفئة.</p>
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
      aria-label="ملخص الجلسات الأسبوعية"
    >
      <table>
        <caption>الجلسات التي راجعتها</caption>
        <thead>
          <tr>
            <th>المقرر</th>
            <th>اليوم</th>
            <th>الوقت (24 ساعة)</th>
            <th>القاعة</th>
            <th>الحضور</th>
          </tr>
        </thead>
        <tbody>
          {draft.sessions.map((session) => (
            <tr key={session.key}>
              <td>
                {draft.courses.find(
                  (course) => course.key === session.courseKey,
                )?.name ?? "ارتباط غير صالح"}
              </td>
              <td>{DAYS[session.dayOfWeek]}</td>
              <td>
                <bdi dir="ltr">
                  {session.startTime}–{session.endTime}
                </bdi>
              </td>
              <td>
                <bdi dir="ltr">{session.room ?? "غير معروف"}</bdi>
              </td>
              <td>
                {session.deliveryMode === "online" ? "إلكتروني" : "وجاهي"}
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
  const stats = useMemo(() => analyzeDraft(draft), [draft]);
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
        setError("صحح البيانات ثم ارجع إلى الجلسات وأعد المراجعة النهائية.");
        return;
      }
      if (plan.differences.some((row) => !keep.includes(row.key))) {
        setError(
          "اختر الاحتفاظ بكل سجل محفوظ مختلف، أو ارجع لتعديل/استبعاد بيانات المسودة. لن نستبدل تعديلاتك تلقائياً.",
        );
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
        setError(
          message(
            new DataError(
              code,
              "تغيرت البيانات أو رُفض أحد السجلات. لم تُحفظ أي سجلات جديدة. ارجع إلى المراجعة قبل إعادة التأكيد.",
            ),
          ),
        );
        setConfirmed(false);
        setPlan(null);
      } else
        setSuccess(
          `اكتمل الحفظ: ${result.created.length} سجل جديد، و${result.skipped.length} سجل موجود احتُفظ به دون تغيير. لم تُنشأ أي محاضرات فعلية.`,
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
    <div className="timetable-review" dir="rtl" lang="ar">
      <header className="page-header">
        <p className="eyebrow">استيراد محلي بعد المراجعة</p>
        <h1>مراجعة الجدول الدراسي</h1>
        <p>
          مسودة من الجدول المقدم، وليست بيانات مؤكدة. لن تُحفظ المقررات أو
          الجلسات إلا بعد تأكيدك الصريح.
        </p>
      </header>
      <ol className="review-steps" aria-label="خطوات الاستيراد">
        {STEPS.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      {error && (
        <div className="review-alert" role="alert">
          {error}
        </div>
      )}
      {!ready && <p role="status">جارٍ فحص التخزين والروابط السابقة…</p>}
      {success ? (
        <section className="empty-state" role="status">
          <CheckCircle2 size={40} aria-hidden="true" />
          <h2>حُفظت المراجعة محلياً</h2>
          <p>{success}</p>
          <button
            onClick={() => {
              setSuccess("");
              setStep(0);
              setPlan(null);
              setConfirmed(false);
            }}
          >
            مراجعة المسودة مجدداً
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
                    label="اسم الفصل"
                    value={draft.term.name}
                    onChange={(name) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, name },
                      }))
                    }
                  />
                  <TextField
                    label="العام الدراسي"
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
                    label="رقم الفصل"
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
                    label="الكلية (اختياري)"
                    value={draft.term.college ?? ""}
                    onChange={(college) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, college: nullable(college) },
                      }))
                    }
                  />
                  <TextField
                    label="التخصص (اختياري)"
                    value={draft.term.program ?? ""}
                    onChange={(program) =>
                      edit((current) => ({
                        ...current,
                        term: { ...current.term, program: nullable(program) },
                      }))
                    }
                  />
                  <TextField
                    label="بداية الفصل (اختيارية)"
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
                    label="نهاية الفصل (اختيارية)"
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
                      الفصل المحفوظ المستهدف
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
                        <option value="">
                          تحديد تلقائي آمن حسب الربط أو العام والفصل
                        </option>
                        {terms.map((term) => (
                          <option key={term.id} value={term.id}>
                            {term.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <p className="review-note">
                  المصدر يسجل 15 ساعة. الإجمالي أدناه يُحسب من المقررات بعد
                  تعديلاتك. لا توجد تواريخ فصل أو منطقة زمنية مفترضة.
                </p>
              </section>
            )}
            {step === 1 && (
              <>
                <p className="review-note">
                  المدرس والشعبة اختياريان. لا تدمج مقرر البرمجة ومختبره؛ لكل
                  منهما رمز مستقل.
                </p>
                {draft.courses.map((course, index) => (
                  <section
                    className="review-card"
                    key={course.key}
                    aria-label={`المقرر ${index + 1}`}
                  >
                    <div className="review-card-heading">
                      <h3>{course.name || "مقرر جديد"}</h3>
                      <span className="badge">{index + 1}</span>
                    </div>
                    <div className="review-fields">
                      <TextField
                        label="اسم المقرر"
                        value={course.name}
                        onChange={(name) => courseEdit(course.key, { name })}
                      />
                      <TextField
                        label="رمز المقرر"
                        value={course.code}
                        ltr
                        onChange={(code) => courseEdit(course.key, { code })}
                      />
                      <TextField
                        label="اسم المدرس (اختياري)"
                        value={course.instructor ?? ""}
                        onChange={(instructor) =>
                          courseEdit(course.key, {
                            instructor: nullable(instructor),
                          })
                        }
                      />
                      <TextField
                        label="الشعبة (اختيارية)"
                        value={course.section ?? ""}
                        ltr
                        onChange={(section) =>
                          courseEdit(course.key, { section: nullable(section) })
                        }
                      />
                      <TextField
                        label="الساعات المسجلة"
                        type="number"
                        value={course.registeredHours}
                        onChange={(value) =>
                          courseEdit(course.key, {
                            registeredHours: value === "" ? NaN : Number(value),
                          })
                        }
                      />
                      <label className="review-field">
                        النشاط
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
                          <option value="">غير مؤكد</option>
                          <option value="theory">نظري</option>
                          <option value="practical">عملي</option>
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
                      استبعاد المقرر وجلساته من المسودة
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
                  إضافة مقرر
                </button>
              </>
            )}
            {step === 2 && (
              <>
                <p className="review-note">
                  الأوقات بصيغة 24 ساعة. الأيام الأخرى غير مذكورة في المصدر؛ لا
                  يعني ذلك خلوها من الالتزامات.
                </p>
                {draft.sessions.map((session, index) => (
                  <section
                    className="review-card session-card"
                    data-mode={session.deliveryMode}
                    key={session.key}
                    aria-label={`الجلسة ${index + 1}`}
                  >
                    <div className="review-card-heading">
                      <h3>الجلسة {index + 1}</h3>
                      <span className="badge">
                        {session.deliveryMode === "online"
                          ? "إلكتروني"
                          : "وجاهي"}
                      </span>
                    </div>
                    <div className="review-fields">
                      <label className="review-field">
                        المقرر المرتبط
                        <select
                          value={session.courseKey}
                          onChange={(event) =>
                            sessionEdit(session.key, {
                              courseKey: event.target.value,
                            })
                          }
                        >
                          <option value="">اختر مقرراً</option>
                          {draft.courses.map((course) => (
                            <option key={course.key} value={course.key}>
                              {course.name} — {course.code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="review-field">
                        اليوم
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
                        label="وقت البداية (HH:mm)"
                        value={session.startTime}
                        ltr
                        onChange={(startTime) =>
                          sessionEdit(session.key, { startTime })
                        }
                      />
                      <TextField
                        label="وقت النهاية (HH:mm)"
                        value={session.endTime}
                        ltr
                        onChange={(endTime) =>
                          sessionEdit(session.key, { endTime })
                        }
                      />
                      <TextField
                        label="القاعة أو الموقع (اختياري)"
                        value={session.room ?? ""}
                        ltr
                        onChange={(room) =>
                          sessionEdit(session.key, { room: nullable(room) })
                        }
                      />
                      <label className="review-field">
                        نمط الحضور
                        <select
                          value={session.deliveryMode}
                          onChange={(event) =>
                            sessionEdit(session.key, {
                              deliveryMode: event.target.value as
                                "online" | "in-person",
                            })
                          }
                        >
                          <option value="in-person">وجاهي</option>
                          <option value="online">إلكتروني</option>
                        </select>
                      </label>
                      <TextField
                        label="ملاحظة المصدر (اختيارية)"
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
                      استبعاد الجلسة من المسودة
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
                  إضافة جلسة
                </button>
              </>
            )}
            {(step === 3 || step === 4) && (
              <>
                <section className="review-stats">
                  <div>
                    <strong>{stats.courseCount}</strong>مقررات
                  </div>
                  <div>
                    <strong>
                      {step === 4 && plan
                        ? plan.savedSummary.hours
                        : stats.hours}
                    </strong>
                    ساعات المقررات المراجعة
                  </div>
                  <div>
                    <strong>{stats.sessionCount}</strong>جلسات أسبوعية
                  </div>
                </section>
                {step === 3 && (
                  <>
                    <WeeklySummary draft={draft} />
                    {plan && plan.savedSummary.hours !== stats.hours && (
                      <p className="review-note">
                        بعد الاحتفاظ بالنسخ المحفوظة سيكون إجمالي ساعات المقررات
                        المراجعة {plan.savedSummary.hours} بدلاً من{" "}
                        {stats.hours} في المسودة.
                      </p>
                    )}
                    <Findings
                      title="أخطاء تمنع الحفظ"
                      items={stats.errors}
                      danger
                    />
                    <Findings
                      title="تداخلات زمنية"
                      items={stats.overlaps}
                      danger
                    />
                    <Findings
                      title="انتقالات بلا فاصل زمني (ليست تداخلاً)"
                      items={stats.transitions}
                    />
                    <Findings
                      title="حقول غير مؤكدة"
                      items={stats.unconfirmed}
                    />
                    <Findings
                      title="معلومات اختيارية مفقودة"
                      items={stats.missing}
                    />
                    <p className="review-note">
                      يمكن حفظ المعلومات الاختيارية غير المعروفة. التداخلات
                      تحتاج انتباهك، ولا تُساوى بجلسات متتالية بفاصل صفر دقيقة.
                    </p>
                    {plan && (
                      <>
                        <p>
                          {plan.existingKeys.length} سجلات موجودة ستُتخطى دون
                          استبدال تعديلاتك.
                        </p>
                        {plan.differences.map((difference) => (
                          <section className="review-card" key={difference.key}>
                            <h3>اختلاف عن المحفوظ: {difference.label}</h3>
                            <div className="difference-list">
                              {difference.fields.map((field) => (
                                <p key={field.field}>
                                  <strong>{field.field}</strong>: المسودة{" "}
                                  <bdi>{field.incoming}</bdi>؛ المحفوظ{" "}
                                  <bdi>{field.existing}</bdi>
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
                              أحتفظ بالنسخة المحفوظة دون تغيير
                            </label>
                            <p className="review-note">
                              أو ارجع لتعديل المسودة أو استبعاد الصف. الاستيراد
                              لا يستبدل بياناتك المحفوظة.
                            </p>
                          </section>
                        ))}
                      </>
                    )}
                  </>
                )}
                {step === 4 && (
                  <section className="review-card">
                    <FileCheck2 size={28} aria-hidden="true" />
                    <h3>لن يُحفظ شيء قبل تأكيدك</h3>
                    <p>
                      سيُحفظ الفصل والمقررات والجلسات وروابط المصدر معاً.
                      السجلات الموجودة ستبقى كما هي. استبعاد صف من المسودة لا
                      يحذفه من قاعدة البيانات.
                    </p>
                    <label className="review-choice">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      راجعت البيانات والحقول غير المؤكدة وأوافق على الحفظ المحلي
                    </label>
                    <button
                      className="save-import"
                      disabled={!confirmed || !plan}
                      onClick={() => void save()}
                    >
                      {busy ? "جارٍ الحفظ…" : "تأكيد وحفظ الجدول محلياً"}
                    </button>
                  </section>
                )}
              </>
            )}
          </fieldset>
          <nav
            className="review-actions"
            aria-label="التنقل بين خطوات المراجعة"
          >
            <button
              disabled={step === 0 || busy}
              onClick={() => {
                setStep(step - 1);
                setPlan(step - 1 < 3 ? null : plan);
                setConfirmed(false);
                setError("");
              }}
            >
              السابق
            </button>
            {step < 4 && (
              <button
                disabled={!ready || blocked || busy}
                onClick={() => void next()}
              >
                {busy ? "جارٍ الفحص…" : "التالي"}
              </button>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
