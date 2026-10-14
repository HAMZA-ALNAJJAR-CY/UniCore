import type { TimetableDraft } from "../../data/timetable-types";

export const SOURCE_ID = "IMG_20261015_001157:2026-2027:semester-1";
export const DAYS = [
  "",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
  "الأحد",
];
export const FIELD_LABELS: Record<string, string> = {
  name: "الاسم",
  code: "رمز المقرر",
  instructor: "المدرس",
  section: "الشعبة",
  registeredHours: "الساعات",
  activityType: "النشاط",
  academicYear: "العام الدراسي",
  semester: "الفصل",
  college: "الكلية",
  program: "التخصص",
  startDate: "بداية الفصل",
  endDate: "نهاية الفصل",
  dayOfWeek: "اليوم",
  startTime: "البداية",
  endTime: "النهاية",
  room: "القاعة",
  deliveryMode: "نمط الحضور",
  notes: "ملاحظة المصدر",
  location: "الموقع",
};

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
    errors.push("أكمل اسم الفصل والعام الدراسي ورقم الفصل الصحيح.");
  for (const field of ["startDate", "endDate"] as const) {
    const date = draft.term[field];
    if (date && !existsDate(date))
      errors.push(`${FIELD_LABELS[field]} غير صالح.`);
    if (!date) missing.push(`${FIELD_LABELS[field]} غير معروفة (اختيارية).`);
  }
  if (
    draft.term.startDate &&
    draft.term.endDate &&
    draft.term.startDate > draft.term.endDate
  )
    errors.push("نهاية الفصل تسبق بدايته.");
  if (!draft.courses.length)
    errors.push("أضف مقرراً واحداً على الأقل قبل الحفظ.");
  const keys = new Set<string>(),
    codes = new Set<string>(),
    sessionKeys = new Set<string>(),
    signatures = new Set<string>();
  for (const course of draft.courses) {
    if (!course.key || keys.has(course.key))
      errors.push("يوجد تكرار في هوية مقرر بالمسودة.");
    keys.add(course.key);
    const code = course.code.trim().toUpperCase();
    if (
      !code ||
      !course.name.trim() ||
      !Number.isFinite(course.registeredHours) ||
      course.registeredHours < 0
    )
      errors.push(
        `بيانات المقرر ${course.name || course.code || "الجديد"} غير مكتملة: الاسم والرمز والساعات مطلوبة.`,
      );
    if (codes.has(code)) errors.push(`رمز المقرر ${code} مكرر داخل الفصل.`);
    codes.add(code);
    if (!course.instructor)
      missing.push(`${course.name}: المدرس غير معروف (اختياري).`);
    if (
      course.activityType != null &&
      course.activityType !== "theory" &&
      course.activityType !== "practical"
    )
      errors.push(`${course.name}: النشاط غير صالح.`);
    if (!course.section)
      missing.push(`${course.name}: الشعبة غير معروفة (اختيارية).`);
    course.unconfirmed.forEach((field) =>
      unconfirmed.push(
        `${course.name || code}: ${FIELD_LABELS[field] ?? field}`,
      ),
    );
  }
  for (const session of draft.sessions) {
    const course = draft.courses.find((row) => row.key === session.courseKey);
    const label = `${course?.name ?? "مقرر غير مرتبط"} — ${DAYS[session.dayOfWeek] ?? "يوم غير صالح"} ${session.startTime}`;
    if (!session.key || sessionKeys.has(session.key))
      errors.push("يوجد تكرار في هوية جلسة بالمسودة.");
    sessionKeys.add(session.key);
    if (!course)
      errors.push(`${label}: اختر مقرراً من قائمة المقررات المراجعة.`);
    if (
      session.deliveryMode !== "online" &&
      session.deliveryMode !== "in-person"
    )
      errors.push(`${label}: نمط الحضور غير صالح.`);
    if (
      !Number.isInteger(session.dayOfWeek) ||
      session.dayOfWeek < 1 ||
      session.dayOfWeek > 7 ||
      !validTime(session.startTime) ||
      !validTime(session.endTime) ||
      session.startTime >= session.endTime
    )
      errors.push(
        `${label}: اليوم أو نطاق الوقت غير صالح؛ استخدم HH:mm ونهاية بعد البداية.`,
      );
    const signature = JSON.stringify([
      session.courseKey,
      session.dayOfWeek,
      session.startTime,
      session.endTime,
    ]);
    if (signatures.has(signature))
      errors.push(`${label}: جلسة أسبوعية مكررة لنفس المقرر.`);
    signatures.add(signature);
    if (!session.room)
      missing.push(`${label}: القاعة/الموقع غير معروف (اختياري).`);
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
      const label = `${DAYS[a.dayOfWeek]}: ${draft.courses.find((c) => c.key === a.courseKey)?.name ?? "؟"} (${a.startTime}–${a.endTime}) / ${draft.courses.find((c) => c.key === b.courseKey)?.name ?? "؟"} (${b.startTime}–${b.endTime})`;
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
