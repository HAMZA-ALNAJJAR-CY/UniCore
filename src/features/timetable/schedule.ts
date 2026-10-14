import type { ScheduleSession } from "../../data/models";

type TimeSlot = Pick<ScheduleSession, "dayOfWeek" | "startTime" | "endTime">;
export function overlappingSessions(
  slot: TimeSlot,
  sessions: ScheduleSession[],
  exceptId?: string,
) {
  return sessions.filter(
    (row) =>
      row.id !== exceptId &&
      row.dayOfWeek === slot.dayOfWeek &&
      slot.startTime < row.endTime &&
      row.startTime < slot.endTime,
  );
}
export function validSlot(slot: TimeSlot) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  return (
    Number.isInteger(slot.dayOfWeek) &&
    slot.dayOfWeek >= 1 &&
    slot.dayOfWeek <= 7 &&
    time.test(slot.startTime) &&
    time.test(slot.endTime) &&
    slot.startTime < slot.endTime
  );
}
