// Test-only historical source fixture. Never import this module into production.
import type { TimetableDraft } from "../../data/timetable-types";
const SOURCE_ID = "IMG_20261015_001157:2026-2027:semester-1";
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
