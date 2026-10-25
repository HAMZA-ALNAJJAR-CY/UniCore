import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { introductionText } from "../i18n/introduction";
import { PageHeader } from "../components/PageHeader";
import {
  useTimetable,
  useTimetableSnapshot,
  type TimetableStore,
} from "../features/timetable/useTimetable";
import {
  countdownSeconds,
  sessionStatus,
} from "../features/timetable/time";
import { dailyText as d } from "../i18n/daily";
import { dateLabel, numberLabel, useLanguage } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";
import { createAcademicStore, type ScheduleSession } from "../data";
import { dashboardText as c } from "../i18n/dashboard";
import { dashboardOccurrences, dashboardSchedule, hasOverlap, lectureHref, occurrenceLectures } from "../features/dashboard/overview";
const defaultStore = createAcademicStore();
type DashboardStore = TimetableStore & Partial<Pick<typeof defaultStore, "getDashboard">>;
type SavedLecture = Awaited<ReturnType<typeof defaultStore.getDashboard>>["lectures"][number];
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}
export function AcademicDataControls({
  state,
}: {
  state: ReturnType<typeof useTimetable>;
}) {
  return (
    <>
      <div className="management-toolbar">
        <label className="review-field">
          <span>{d.term}</span>
          <select
            value={state.data?.termId ?? ""}
            disabled={state.loading}
            onChange={(event) => state.refresh(event.target.value)}
          >
            {state.data?.terms.map((term) => (
              <option key={term.id} value={term.id}>
                {term.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => state.refresh()} disabled={state.loading}>
          {d.refresh}
        </button>
      </div>
      {state.loading && <p role="status">{t.loading}</p>}
      {state.error && (
        <p role="alert" className="review-alert">
          {t.unavailable}
        </p>
      )}
      {!state.loading && state.data && !state.data.terms.length && (
        <section className="review-card">
          <p>{t.noTerm}</p>
          <Link className="button-link" to="/courses/import">
            {t.import}
          </Link>
          <Link className="button-link" to="/courses/setup">
            {introductionText.manual}
          </Link>
        </section>
      )}
    </>
  );
}
export function SessionItem({
  session,
  name,
  code,
  status,
  date,
  children,
}: {
  session: ScheduleSession;
  name: string;
  code?: string;
  status?: "upcoming" | "ongoing" | "completed";
  date?: Date;
  children?: ReactNode;
}) {
  return (
    <li className="managed-session">
      <Link to={"/courses?term=" + session.academicTermId + "#course-" + session.courseId}>
        <strong>{name}</strong>
        {code && <bdi dir="ltr">{code}</bdi>}
        {date && <p>{t.days[session.dayOfWeek]} · {dateLabel(date, { year: "numeric", month: "short", day: "numeric" })}</p>}
        <p>
          <bdi dir="ltr">
            {session.startTime}–{session.endTime}
          </bdi>{" "}
          · <bdi>{session.room || session.location || t.unknown}</bdi> ·{" "}
          {session.deliveryMode === "online" ? t.online : t.inPerson}
        </p>
        <span>{d.manage}</span>
      </Link>
      {status && (
        <span className={"session-status " + status}>{d[status]}</span>
      )}
      {children && <div className="dashboard-meeting-details">{children}</div>}
    </li>
  );
}
export function Dashboard({ store = defaultStore }: { store?: DashboardStore }) {
  useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [showSaved] = useState(() => Boolean(location.state?.timetableSaved));
  useEffect(() => {
    if (!location.state?.timetableSaved) return;
    const { timetableSaved, ...remaining } = location.state;
    void timetableSaved;
    navigate(location.pathname + location.search + location.hash, { replace: true, state: remaining });
  }, [location, navigate]);
  const reader = useMemo(() => ({
    getTimetable: async (termId?: string) => store.getDashboard
      ? store.getDashboard(termId)
      : { ...await store.getTimetable(termId), lectures: undefined },
  }), [store]);
  const state = useTimetableSnapshot(reader, location.state?.termId),
    now = useClock();
  const data = state.data,
    term = data?.terms.find((row) => row.id === data.termId);
  const schedule = useMemo(() => dashboardSchedule(data?.courses ?? [], data?.sessions ?? [], term), [data, term]);
  const minute = Math.floor(now.getTime() / 60000);
  const { today, upcoming, from, until, invalidLocal } = useMemo(
    () => dashboardOccurrences(schedule.sessions, new Date(minute * 60000), term), [schedule, minute, term],
  );
  const next = upcoming[0];
  const lectures = useMemo(() => data?.lectures?.slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), [data]);
  function lectureLinks(records: SavedLecture[]) {
    return <ul className="dashboard-lecture-links">{records.map((row) => <li key={row.id}>
      <Link to={lectureHref(row, term!.id)}>{c.open}{row.title && <>: {row.title}</>} · <bdi dir="ltr">{row.date}</bdi></Link>
    </li>)}</ul>;
  }
  function meeting(session: ScheduleSession, date: Date, upcomingItem = false) {
    const course = schedule.byCourse.get(session.courseId)!;
    const records = occurrenceLectures(lectures ?? [], session, date);
    return <SessionItem key={session.id + date.toDateString()} session={session} name={course.name} code={course.code}
      date={date} status={upcomingItem ? "upcoming" : sessionStatus(session, now, now)}>
      {hasOverlap(session, schedule.sessions) && <p className="dashboard-overlap">{c.overlap}</p>}
      {lectures && <>
        {records.length > 1 && <p>{c.choose}</p>}
        {records.length ? lectureLinks(records) : <p className="review-note">{c.noLecture}</p>}
      </>}
    </SessionItem>;
  }
  const remaining = next ? countdownSeconds(next.starts, now) : 0;
  return (
    <div className="timetable-review daily-page dashboard-page">
      <PageHeader title={d.welcome} description={d.overview} />
      {showSaved && (
        <p role="status" className="management-success">
          {introductionText.saved}
        </p>
      )}
      <p>{dateLabel(now)}</p>
      <AcademicDataControls state={state} />
      {term && (
        <>
          <section className="daily-stats" aria-label={d.overview}>
            {[
              [d.courses, numberLabel(schedule.courses.length)],
              [d.sessions, numberLabel(schedule.sessions.length)],
              [c.todayCount, numberLabel(today.length)],
              [c.upcomingCount, numberLabel(upcoming.length)],
              [
                d.credits,
                numberLabel(
                  schedule.courses.reduce(
                    (sum, row) => sum + row.registeredHours,
                    0,
                  ),
                ),
              ],
              [d.term, term.name],
              ...(lectures ? [
                [c.recorded, numberLabel(lectures.length)],
                [c.notes, numberLabel(lectures.filter((row) => row.hasNotes).length)],
              ] : []),
            ].map(([label, value]) => (
              <div className="review-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          {schedule.invalid + invalidLocal > 0 && <p role="alert" className="review-alert">{c.invalid}</p>}
          <section className="review-card">
            <h2 id="dashboard-today">{d.today}</h2>
            <ul className="managed-sessions" aria-labelledby="dashboard-today">
              {today.map((row) => meeting(row, now))}
            </ul>
            {!today.length && <p>{d.none}</p>}
          </section>
          <section className="review-card next-session">
            <h2 id="dashboard-upcoming">{c.upcoming}</h2>
            <p className="review-note">{c.window}: {dateLabel(from)} — {dateLabel(until)}</p>
            {next ? (
              <>
                <p>
                  {d.next} · {d.remaining}:{" "}
                  <bdi dir="ltr" role="timer">
                    {[
                      Math.floor(remaining / 3600),
                      Math.floor(remaining / 60) % 60,
                      remaining % 60,
                    ]
                      .map((value) => String(value).padStart(2, "0"))
                      .join(":")}
                  </bdi>
                </p>
                <ul className="managed-sessions" aria-labelledby="dashboard-upcoming">
                  {upcoming.map(({ session, starts }) => meeting(session, starts, true))}
                </ul>
              </>
            ) : (
              <p>{c.noUpcoming}</p>
            )}
          </section>
          {lectures && <section className="review-card" aria-labelledby="dashboard-lectures">
            <h2 id="dashboard-lectures">{c.saved}</h2>
            <p className="review-note">{c.savedHint}</p>
            {lectures.length ? <ul className="dashboard-saved-lectures">{lectures.slice(0, 5).map((row) => <li key={row.id}>
              <span>{schedule.byCourse.get(row.courseId)?.name} · <bdi dir="ltr">{schedule.byCourse.get(row.courseId)?.code}</bdi></span>
              {lectureLinks([row])}
            </li>)}</ul> : <p>{c.noSaved}</p>}
            <p className="review-note">{c.local}</p>
          </section>}
          <section className="review-card">
            <h2>{d.week}</h2>
            <div className="week-counts">
              {[7, 1, 2, 3, 4, 5, 6].map((day) => (
                <div key={day}>
                  {t.days[day]}
                  <strong>
                    {numberLabel(
                      schedule.sessions.filter((row) => row.dayOfWeek === day)
                        .length,
                    )}
                  </strong>
                </div>
              ))}
            </div>
            <Link className="button-link" to={"/calendar?term=" + data?.termId}>
              {d.calendar}
            </Link>
          </section>
          <p className="review-note">{d.recurring}</p>
        </>
      )}
    </div>
  );
}
