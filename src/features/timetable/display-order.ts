import type { Course, ScheduleSession } from "../../data";
import { validSlot } from "./schedule";

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
// Match the timetable's existing Sunday-first week, independently of locale.
const dayRank = (day: number) => day === 7 ? 0 : day;

/** Display-only grouping: never sort or edit the supplied persisted records.
 * Valid meetings determine the earliest time; invalid slots remain visible and
 * are never repaired/coerced into valid slots by a presentation comparator. */
export function savedTimetableGroups(courses: Course[], sessions: ScheduleSession[]) {
  return courses.map(course => {
    const meetings = sessions.filter(row => row.courseId === course.id && row.deletedAt === null);
    const valid = meetings.filter(validSlot).sort((a,b) => compareText(a.startTime,b.startTime) || dayRank(a.dayOfWeek)-dayRank(b.dayOfWeek));
    const first = valid[0];
    meetings.sort((a,b) => dayRank(a.dayOfWeek)-dayRank(b.dayOfWeek) || compareText(a.startTime,b.startTime) || compareText(a.id,b.id));
    return { course, meetings, first, category: first ? 0 : meetings.length ? 1 : 2 };
  }).sort((a,b) => a.category-b.category ||
    compareText(a.first?.startTime ?? "",b.first?.startTime ?? "") ||
    dayRank(a.first?.dayOfWeek ?? 7)-dayRank(b.first?.dayOfWeek ?? 7) ||
    compareText(a.course.code,b.course.code) || compareText(a.course.id,b.course.id));
}
