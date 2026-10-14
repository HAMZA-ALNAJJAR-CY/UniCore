import type { AcademicTerm, ScheduleSession } from "../../data";
export const isoDay = (date: Date) => date.getDay() || 7;
export function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}
export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function atTime(date: Date, time: string) {
  const result = new Date(date);
  const [h, m] = time.split(":").map(Number);
  result.setHours(h, m, 0, 0);
  return result;
}
export function onDate(
  sessions: ScheduleSession[],
  date: Date,
  term?: AcademicTerm,
) {
  const key = localDate(date);
  if (
    !term ||
    term.deletedAt !== null ||
    (term.startDate && key < term.startDate) ||
    (term.endDate && key > term.endDate)
  )
    return [];
  return sessions
    .filter(
      (row) =>
        row.deletedAt === null &&
        row.academicTermId === term.id &&
        row.dayOfWeek === isoDay(date),
    )
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.id.localeCompare(b.id),
    );
}
export function sessionStatus(session: ScheduleSession, date: Date, now: Date) {
  return now < atTime(date, session.startTime)
    ? "upcoming"
    : now < atTime(date, session.endTime)
      ? "ongoing"
      : "completed";
}
export function nextSession(
  sessions: ScheduleSession[],
  now: Date,
  term?: AcademicTerm,
) {
  let start = new Date(now);
  if (term?.startDate && localDate(start) < term.startDate) {
    const [y, m, d] = term.startDate.split("-").map(Number);
    start = new Date(y, m - 1, d);
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = addDays(start, offset);
    for (const session of onDate(sessions, day, term)) {
      const starts = atTime(day, session.startTime);
      if (starts > now) return { session, starts };
    }
  }
  return undefined;
}
export const countdownSeconds = (starts: Date, now: Date) =>
  Math.max(0, Math.ceil((starts.getTime() - now.getTime()) / 1000));
