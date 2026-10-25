import type { ReactNode } from "react";
import type { Course, ScheduleSession } from "../data";
import { pdfText as p } from "../i18n/pdf";
import { timetableText as t } from "../features/timetable/messages";
import { savedTimetableGroups } from "../features/timetable/display-order";

export function TimetableTableFrame({ caption, children, editable = false }: { caption: string; children: ReactNode; editable?: boolean }) {
  const headings = [p.code,p.name,p.activity,p.hours,p.section,p.day,p.time,p.instructor,p.room,p.registrationDate,...(editable ? [p.actions] : [p.courseActions,p.sessionActions])];
  return <div className={`review-table-scroll academic-table-scroll${editable ? " editable-timetable" : " saved-timetable"}`} tabIndex={0} role="region" aria-label={caption} onFocus={event => {
    // Native Tab scrolling can leave partially visible controls clipped inside
    // a wide cell. Reveal the focused control, without scrolling the whole row.
    // Course anchor focus is managed by Courses; reveal interactive controls only.
    if (event.target.matches("button, input, select, textarea, a")) event.target.scrollIntoView?.({block:"nearest",inline:"nearest"});
  }}>
    <table className="academic-table"><caption>{caption}</caption>
      <thead><tr>{headings.map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      {children}
    </table>
  </div>;
}
export function TimetableTable({ courses, sessions, courseActions, sessionActions }: {
  courses: Course[]; sessions: ScheduleSession[];
  courseActions: (course: Course) => ReactNode;
  sessionActions: (course: Course, session: ScheduleSession) => ReactNode;
}) {
  return <TimetableTableFrame caption={p.table}>
    {savedTimetableGroups(courses,sessions).map(({course,meetings: activeMeetings}) => {
      const meetings: (ScheduleSession | null)[] = [...activeMeetings];
      if (!meetings.length) meetings.push(null);
      return <tbody key={course.id} id={"course-"+course.id} tabIndex={-1} aria-label={course.name}>
        {meetings.map((session,index) => <tr key={session?.id ?? course.id} data-session-id={session?.id}>
          {index === 0 && <>
            <td rowSpan={meetings.length}><bdi dir="ltr" className="course-code">{course.code}</bdi></td>
            <th scope="rowgroup" rowSpan={meetings.length} aria-label={course.name}><h2>{course.name}</h2></th>
            <td rowSpan={meetings.length}>{course.activityType === "theory" ? t.theory : course.activityType === "practical" ? t.practical : course.activityType === "lab" ? p.lab : p.unknown}</td>
            <td rowSpan={meetings.length}>{course.registeredHours}</td>
            <td rowSpan={meetings.length}><bdi>{course.section || p.unknown}</bdi></td>
          </>}
          <td>{session ? t.days[session.dayOfWeek] : p.noMeetings}</td>
          <td>{session ? <bdi dir="ltr">{session.startTime}–{session.endTime}</bdi> : p.unknown}</td>
          {index === 0 && <td rowSpan={meetings.length}><bdi>{course.instructor || p.unknown}</bdi></td>}
          <td>{session ? <><bdi>{session.room || session.location || p.unknown}</bdi><br/>{session.deliveryMode === "online" ? t.online : t.inPerson}</> : p.unknown}</td>
          {index === 0 && <td rowSpan={meetings.length}><bdi dir="ltr">{course.registrationDate || p.unknown}</bdi></td>}
          {index === 0 && <td rowSpan={meetings.length}><div className="saved-course-actions" role="group" aria-label={p.courseActions+" · "+course.code}>{courseActions(course)}</div></td>}
          <td><div className="table-actions" role="group" aria-label={p.sessionActions+" · "+course.code+(session ? " · "+t.days[session.dayOfWeek]+" · "+session.startTime : "")}>{session && sessionActions(course,session)}</div></td>
        </tr>)}
      </tbody>;
    })}
  </TimetableTableFrame>;
}
