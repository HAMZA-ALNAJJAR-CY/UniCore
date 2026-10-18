import type { ReactNode } from "react";
import type { Course, ScheduleSession } from "../data";
import { pdfText as p } from "../i18n/pdf";
import { timetableText as t } from "../features/timetable/messages";

export function TimetableTableFrame({ caption, children, editable = false }: { caption: string; children: ReactNode; editable?: boolean }) {
  const headings = [p.code,p.name,p.activity,p.hours,p.section,p.day,p.time,p.instructor,p.room,p.registrationDate,p.actions];
  return <div className={`review-table-scroll academic-table-scroll${editable ? " editable-timetable" : ""}`} tabIndex={0} role="region" aria-label={caption}>
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
    {courses.map(course => {
      const meetings: (ScheduleSession | null)[] = sessions.filter(row => row.courseId === course.id);
      if (!meetings.length) meetings.push(null);
      return <tbody key={course.id} id={"course-"+course.id} tabIndex={-1} aria-label={course.name}>
        {meetings.map((session,index) => <tr key={session?.id ?? course.id}>
          {index === 0 && <>
            <td rowSpan={meetings.length}><bdi dir="ltr" className="course-code">{course.code}</bdi></td>
            <th scope="rowgroup" rowSpan={meetings.length}><h2>{course.name}</h2></th>
            <td rowSpan={meetings.length}>{course.activityType === "theory" ? t.theory : course.activityType === "practical" ? t.practical : course.activityType === "lab" ? p.lab : p.unknown}</td>
            <td rowSpan={meetings.length}>{course.registeredHours}</td>
            <td rowSpan={meetings.length}><bdi>{course.section || p.unknown}</bdi></td>
          </>}
          <td>{session ? t.days[session.dayOfWeek] : p.noMeetings}</td>
          <td>{session ? <bdi dir="ltr">{session.startTime}–{session.endTime}</bdi> : p.unknown}</td>
          {index === 0 && <td rowSpan={meetings.length}><bdi>{course.instructor || p.unknown}</bdi></td>}
          <td>{session ? <><bdi>{session.room || session.location || p.unknown}</bdi><br/>{session.deliveryMode === "online" ? t.online : t.inPerson}</> : p.unknown}</td>
          {index === 0 && <td rowSpan={meetings.length}><bdi dir="ltr">{course.registrationDate || p.unknown}</bdi></td>}
          <td><div className="table-actions">{index === 0 && courseActions(course)}{session && sessionActions(course,session)}</div></td>
        </tr>)}
      </tbody>;
    })}
  </TimetableTableFrame>;
}
