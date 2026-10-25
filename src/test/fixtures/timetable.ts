// Fully synthetic test fixture. Never import this module into production.
import type { TimetableDraft } from "../../data/timetable-types";
const SOURCE_ID = "synthetic-timetable-fixture-v1";
/** Synthetic scenario only. Constructing this object writes nothing. */
export function sourceDraft(): TimetableDraft {
  const courses = [
    ["SYN101", "مقرر تجريبي ألف", "مدرس تجريبي ألف", "2", "theory", 1],
    ["SYN102", "مقرر تجريبي باء", null, "1", "theory", 2],
    ["SYN103", "مقرر تجريبي جيم", "مدرس تجريبي جيم", "2", "theory", 3],
    ["SYN104", "مقرر تجريبي دال", null, "2", "theory", 3],
    [
      "SYN105",
      "برمجة تجريبية",
      "مدرس تجريبي دال",
      "1",
      "theory",
      2,
    ],
    [
      "SYN106",
      "مختبر تجريبي",
      "مدرس تجريبي دال",
      "2",
      "practical",
      1,
    ],
    [
      "SYN107",
      "مقرر تجريبي هاء",
      "مدرس تجريبي هاء",
      "1",
      "theory",
      3,
    ],
  ] as const;
  const sessions = [
    ["SYN105", 7, "08:00", "09:00", "TEST-R1"],
    ["SYN103", 7, "09:00", "10:00", "TEST-R1"],
    ["SYN107", 7, "10:00", "11:00", "TEST-R3"],
    ["SYN104", 7, "11:00", "12:00", "TEST-R2"],
    ["SYN102", 7, "15:00", "16:00", "Online"],
    ["SYN105", 2, "08:00", "09:00", "TEST-R1"],
    ["SYN103", 2, "09:00", "10:00", "TEST-R1"],
    ["SYN107", 2, "10:00", "11:00", "TEST-R3"],
    ["SYN104", 2, "11:00", "12:00", "TEST-R2"],
    ["SYN106", 2, "12:00", "14:00", "TEST-LAB"],
    ["SYN101", 2, "14:00", "15:00", "Online"],
    ["SYN102", 2, "15:00", "16:00", "Online"],
    ["SYN103", 4, "09:00", "10:00", "TEST-R1"],
    ["SYN107", 4, "10:00", "11:00", "TEST-R3"],
    ["SYN104", 4, "11:00", "12:00", "TEST-R2"],
  ] as const;
  return {
    sourceId: SOURCE_ID,
    term: {
      key: "term",
      name: "الفصل الدراسي الأول 2038/2039",
      academicYear: "2038/2039",
      semester: 1,
      college: "كلية تجريبية",
      program: "برنامج تجريبي",
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
          room === "TEST-R1"
            ? "تظهر علامة * بجوار TEST-R1 في المصدر؛ معناها غير مؤكد."
            : null,
        unconfirmed: room === "TEST-R1" ? ["notes"] : [],
      }),
    ),
  };
}
