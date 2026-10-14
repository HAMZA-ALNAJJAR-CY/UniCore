import { tr, dynamic } from "../../i18n/locale";
import type { TimetableDraft } from "../../data/timetable-types";

export const SOURCE_ID = "IMG_20261015_001157:2026-2027:semester-1";
export const DAYS = dynamic(() => [
  "",
  tr("text_173"),
  tr("text_174"),
  tr("text_175"),
  tr("text_176"),
  tr("text_177"),
  tr("text_178"),
  tr("text_179"),
]);
export const FIELD_LABELS: Record<string, string> = dynamic(() => ({
  name: tr("text_180"),
  code: tr("text_78"),
  instructor: tr("text_181"),
  section: tr("text_182"),
  registeredHours: tr("text_183"),
  activityType: tr("text_82"),
  academicYear: tr("text_65"),
  semester: tr("text_184"),
  college: tr("text_185"),
  program: tr("text_186"),
  startDate: tr("text_187"),
  endDate: tr("text_188"),
  dayOfWeek: tr("text_46"),
  startTime: tr("text_189"),
  endTime: tr("text_190"),
  room: tr("text_48"),
  deliveryMode: tr("text_96"),
  notes: tr("text_191"),
  location: tr("text_192"),
}));

/** Development-time extraction only. Constructing this object writes nothing. */
export function sourceDraft(): TimetableDraft {
  const courses = [
    ["A0161404", "فن الاتيكيت", "وسام حسين علي الزعبي", "2", "theory", 1],
    ["A0161503", "الفكر الناقد", null, "1", "theory", 2],
    ["A0181101", "تفاضل وتكامل (1)", "غدير عيسى خليل فراج", "2", "theory", 3],
    ["A0181105", "رياضيات متقطعة", null, "2", "theory", 3],
    [
      "A0181504",
      "اساسيات البرمجة",
      "بشير خالد عبد الرحمن شحادة",
      "1",
      "theory",
      2,
    ],
    [
      "A0181505",
      "مختبر اساسيات البرمجة",
      "بشير خالد عبد الرحمن شحادة",
      "2",
      "practical",
      1,
    ],
    [
      "A0412102",
      "تصميم وتحليل الخوارزميات",
      "ساره عماد خالد شكري",
      "1",
      "theory",
      3,
    ],
  ] as const;
  const sessions = [
    ["A0181504", 7, "08:00", "09:00", "B203"],
    ["A0181101", 7, "09:00", "10:00", "B203"],
    ["A0412102", 7, "10:00", "11:00", "M1108"],
    ["A0181105", 7, "11:00", "12:00", "H010"],
    ["A0161503", 7, "15:00", "16:00", "Online"],
    ["A0181504", 2, "08:00", "09:00", "B203"],
    ["A0181101", 2, "09:00", "10:00", "B203"],
    ["A0412102", 2, "10:00", "11:00", "M1108"],
    ["A0181105", 2, "11:00", "12:00", "H010"],
    ["A0181505", 2, "12:00", "14:00", "NB09"],
    ["A0161404", 2, "14:00", "15:00", "Online"],
    ["A0161503", 2, "15:00", "16:00", "Online"],
    ["A0181101", 4, "09:00", "10:00", "B203"],
    ["A0412102", 4, "10:00", "11:00", "M1108"],
    ["A0181105", 4, "11:00", "12:00", "H010"],
  ] as const;
  return {
    sourceId: SOURCE_ID,
    term: {
      key: "term",
      name: "الفصل الدراسي الأول 2026/2027",
      academicYear: "2026/2027",
      semester: 1,
      college: "تكنولوجيا المعلومات",
      program: "الأمن السيبراني / البكالوريوس",
      startDate: null,
      endDate: null,
      unconfirmed: [],
    },
    courses: courses.map(
      ([code, name, instructor, section, activityType, registeredHours]) => ({
        key: code,
        code,
        name,
        instructor,
        section,
        activityType,
        registeredHours,
        unconfirmed: instructor === null ? ["instructor"] : [],
      }),
    ),
    sessions: sessions.map(
      ([courseKey, dayOfWeek, startTime, endTime, room], index) => ({
        key: `session-${index + 1}`,
        courseKey,
        dayOfWeek,
        startTime,
        endTime,
        room,
        deliveryMode: room === "Online" ? "online" : "in-person",
        notes:
          room === "B203"
            ? "تظهر علامة * بجوار B203 في المصدر؛ معناها غير مؤكد."
            : null,
        unconfirmed: room === "B203" ? ["notes"] : [],
      }),
    ),
  };
}

export function analyzeDraft(draft: TimetableDraft) {
  const errors: string[] = [],
    missing: string[] = [],
    unconfirmed: string[] = [],
    overlaps: string[] = [],
    transitions: string[] = [];
  const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const existsDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(new Date(`${value}T00:00:00Z`).getTime()) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (
    !draft.term.name.trim() ||
    !draft.term.academicYear.trim() ||
    !Number.isInteger(draft.term.semester) ||
    draft.term.semester < 1
  )
    errors.push(tr("text_193"));
  for (const field of ["startDate", "endDate"] as const) {
    const date = draft.term[field];
    if (date && !existsDate(date))
      errors.push(tr("text_194", [FIELD_LABELS[field]]));
    if (!date) missing.push(tr("text_195", [FIELD_LABELS[field]]));
  }
  if (
    draft.term.startDate &&
    draft.term.endDate &&
    draft.term.startDate > draft.term.endDate
  )
    errors.push(tr("text_196"));
  if (!draft.courses.length) errors.push(tr("text_197"));
  const keys = new Set<string>(),
    codes = new Set<string>(),
    sessionKeys = new Set<string>(),
    signatures = new Set<string>();
  for (const course of draft.courses) {
    if (!course.key || keys.has(course.key)) errors.push(tr("text_198"));
    keys.add(course.key);
    const code = course.code.trim().toUpperCase();
    if (
      !code ||
      !course.name.trim() ||
      !Number.isFinite(course.registeredHours) ||
      course.registeredHours < 0
    )
      errors.push(
        tr("text_199", [course.name || course.code || tr("text_76")]),
      );
    if (codes.has(code)) errors.push(tr("text_200", [code]));
    codes.add(code);
    if (!course.instructor) missing.push(tr("text_201", [course.name]));
    if (
      course.activityType != null &&
      course.activityType !== "theory" &&
      course.activityType !== "practical"
    )
      errors.push(tr("text_202", [course.name]));
    if (!course.section) missing.push(tr("text_203", [course.name]));
    course.unconfirmed.forEach((field) =>
      unconfirmed.push(
        `${course.name || code}: ${FIELD_LABELS[field] ?? field}`,
      ),
    );
  }
  for (const session of draft.sessions) {
    const course = draft.courses.find((row) => row.key === session.courseKey);
    const label = `${course?.name ?? tr("text_204")} — ${DAYS[session.dayOfWeek] ?? tr("text_205")} ${session.startTime}`;
    if (!session.key || sessionKeys.has(session.key))
      errors.push(tr("text_206"));
    sessionKeys.add(session.key);
    if (!course) errors.push(tr("text_207", [label]));
    if (
      session.deliveryMode !== "online" &&
      session.deliveryMode !== "in-person"
    )
      errors.push(tr("text_208", [label]));
    if (
      !Number.isInteger(session.dayOfWeek) ||
      session.dayOfWeek < 1 ||
      session.dayOfWeek > 7 ||
      !validTime(session.startTime) ||
      !validTime(session.endTime) ||
      session.startTime >= session.endTime
    )
      errors.push(tr("text_209", [label]));
    const signature = JSON.stringify([
      session.courseKey,
      session.dayOfWeek,
      session.startTime,
      session.endTime,
    ]);
    if (signatures.has(signature)) errors.push(tr("text_210", [label]));
    signatures.add(signature);
    if (!session.room) missing.push(tr("text_211", [label]));
    session.unconfirmed.forEach((field) =>
      unconfirmed.push(`${label}: ${FIELD_LABELS[field] ?? field}`),
    );
  }
  for (let i = 0; i < draft.sessions.length; i++)
    for (let j = i + 1; j < draft.sessions.length; j++) {
      const a = draft.sessions[i],
        b = draft.sessions[j];
      if (
        a.dayOfWeek !== b.dayOfWeek ||
        ![a.startTime, a.endTime, b.startTime, b.endTime].every(validTime)
      )
        continue;
      const label = `${DAYS[a.dayOfWeek]}: ${draft.courses.find((c) => c.key === a.courseKey)?.name ?? tr("text_212")} (${a.startTime}–${a.endTime}) / ${draft.courses.find((c) => c.key === b.courseKey)?.name ?? tr("text_212")} (${b.startTime}–${b.endTime})`;
      if (a.startTime < b.endTime && b.startTime < a.endTime)
        overlaps.push(label);
      else if (a.endTime === b.startTime || b.endTime === a.startTime)
        transitions.push(label);
    }
  return {
    errors,
    missing,
    unconfirmed,
    overlaps,
    transitions,
    courseCount: draft.courses.length,
    sessionCount: draft.sessions.length,
    hours: draft.courses.reduce(
      (sum, course) =>
        sum +
        (Number.isFinite(course.registeredHours) ? course.registeredHours : 0),
      0,
    ),
  };
}
