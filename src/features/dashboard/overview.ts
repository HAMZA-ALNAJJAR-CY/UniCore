import type { AcademicTerm, Course, ScheduleSession } from "../../data";
import { validSlot, overlappingSessions } from "../timetable/schedule";
import { addDays, atTime, localDate, onDate } from "../timetable/time";

export function dashboardSchedule(courses: Course[], sessions: ScheduleSession[], term?: AcademicTerm) {
  const activeCourses = courses.filter((row) => row.deletedAt === null && row.academicTermId === term?.id);
  const byCourse = new Map(activeCourses.map((row) => [row.id, row]));
  const candidates = sessions.filter((row) => row.deletedAt === null && row.academicTermId === term?.id);
  const valid = candidates.filter((row) => byCourse.has(row.courseId) && validSlot(row) &&
    (row.deliveryMode === "in-person" || row.deliveryMode === "online"));
  return { courses: activeCourses, byCourse, sessions: valid, invalid: candidates.length - valid.length };
}

/** Local calendar arithmetic (not UTC date slicing or fixed 24-hour increments).
 * A future term starts the preview window at its recorded start; otherwise it starts now.
 * All simultaneous occurrences remain visible, including the next week's same weekday.
 */
export function dashboardOccurrences(sessions: ScheduleSession[], now: Date, term?: AcademicTerm) {
  let from = new Date(now);
  if (term?.startDate && localDate(now) < term.startDate) {
    const [year, month, day] = term.startDate.split("-").map(Number);
    from = new Date(year, month - 1, day);
  }
  const until = addDays(from, 7);
  const upcoming: { session: ScheduleSession; starts: Date }[] = [];
  const invalidLocal = new Set<string>();
  const occurrencesOn = (date: Date) => onDate(sessions, date, term).filter((session) => {
    // A daylight-saving gap can make a valid HH:mm nonexistent on this date.
    const exists = [session.startTime, session.endTime].every((time) => {
      const value = atTime(date, time);
      return value.getHours() === Number(time.slice(0, 2)) && value.getMinutes() === Number(time.slice(3));
    });
    if (!exists) invalidLocal.add(session.id + localDate(date));
    return exists;
  });
  const today = occurrencesOn(now);
  for (let offset = 0; offset <= 7; offset++) {
    const date = addDays(from, offset);
    for (const session of occurrencesOn(date)) {
      const starts = atTime(date, session.startTime);
      if (starts > now && starts <= until) upcoming.push({ session, starts });
    }
  }
  upcoming.sort((a, b) => a.starts.getTime() - b.starts.getTime() || a.session.id.localeCompare(b.session.id));
  return { today, upcoming, from, until, invalidLocal: invalidLocal.size };
}

export const hasOverlap = (session: ScheduleSession, sessions: ScheduleSession[]) =>
  overlappingSessions(session, sessions, session.id).length > 0;

/** Only explicit course + session + local occurrence date identify a recorded lecture.
 * Multiple matches are returned, never silently reduced to one. Detached lectures stay in the saved list.
 */
export function occurrenceLectures<T extends { courseId: string; scheduleSessionId?: string | null; date: string }>(
  lectures: readonly T[], session: ScheduleSession, date: Date,
) {
  return lectures.filter((row) => row.courseId === session.courseId &&
    row.scheduleSessionId === session.id && row.date === localDate(date));
}

export function lectureHref(lecture: { id: string; courseId: string }, termId: string) {
  return "/lectures?" + new URLSearchParams({ term: termId, course: lecture.courseId, lecture: lecture.id });
}
