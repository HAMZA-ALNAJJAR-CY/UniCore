import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { introductionText } from "../i18n/introduction";
import { PageHeader } from "../components/PageHeader";
import {
  useTimetable,
  type TimetableStore,
} from "../features/timetable/useTimetable";
import {
  countdownSeconds,
  nextSession,
  onDate,
  sessionStatus,
} from "../features/timetable/time";
import { dailyText as d } from "../i18n/daily";
import { dateLabel, numberLabel, useLanguage } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";
import type { ScheduleSession } from "../data";
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
}: {
  session: ScheduleSession;
  name: string;
  code?: string;
  status?: "upcoming" | "ongoing" | "completed";
}) {
  return (
    <li className="managed-session">
      <Link to={"/courses#course-" + session.courseId}>
        <strong>{name}</strong>
        {code && <bdi dir="ltr">{code}</bdi>}
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
    </li>
  );
}
export function Dashboard({ store }: { store?: TimetableStore }) {
  useLanguage();
  const location = useLocation();
  const state = useTimetable(store, location.state?.termId),
    now = useClock();
  const data = state.data,
    term = data?.terms.find((row) => row.id === data.termId);
  const today = onDate(data?.sessions ?? [], now, term),
    next = nextSession(data?.sessions ?? [], now, term),
    ongoing = today.filter((row) => sessionStatus(row, now, now) === "ongoing");
  const course = (id: string) => data?.courses.find((row) => row.id === id);
  const remaining = next ? countdownSeconds(next.starts, now) : 0;
  return (
    <div className="timetable-review daily-page">
      <PageHeader title={d.welcome} description={d.overview} />
      {location.state?.timetableSaved && (
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
              [d.courses, numberLabel(data!.courses.length)],
              [d.sessions, numberLabel(data!.sessions.length)],
              [
                d.credits,
                numberLabel(
                  data!.courses.reduce(
                    (sum, row) => sum + row.registeredHours,
                    0,
                  ),
                ),
              ],
              [d.term, term.name],
            ].map(([label, value]) => (
              <div className="review-card" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </section>
          <section className="review-card next-session">
            <h2>{d.next}</h2>
            {ongoing.map((row) => (
              <p key={row.id}>
                {d.ongoing}: {course(row.courseId)?.name} ·{" "}
                <bdi dir="ltr">
                  {row.startTime}–{row.endTime}
                </bdi>
              </p>
            ))}
            {next ? (
              <>
                <h3>{course(next.session.courseId)?.name}</h3>
                <p>
                  {dateLabel(next.starts)} ·{" "}
                  <bdi dir="ltr">{next.session.startTime}</bdi> ·{" "}
                  {next.session.room || t.unknown}
                </p>
                <p>
                  {d.remaining}:{" "}
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
              </>
            ) : (
              <p>{d.noNext}</p>
            )}
          </section>
          <section className="review-card">
            <h2>{d.today}</h2>
            <ul className="managed-sessions">
              {today.map((row) => (
                <SessionItem
                  key={row.id}
                  session={row}
                  name={course(row.courseId)?.name ?? t.unknown}
                  code={course(row.courseId)?.code}
                  status={sessionStatus(row, now, now)}
                />
              ))}
            </ul>
            {!today.length && <p>{d.none}</p>}
          </section>
          <section className="review-card">
            <h2>{d.week}</h2>
            <div className="week-counts">
              {[7, 1, 2, 3, 4, 5, 6].map((day) => (
                <div key={day}>
                  {t.days[day]}
                  <strong>
                    {numberLabel(
                      data!.sessions.filter((row) => row.dayOfWeek === day)
                        .length,
                    )}
                  </strong>
                </div>
              ))}
            </div>
            <Link className="button-link" to="/calendar">
              {d.calendar}
            </Link>
          </section>
          <p className="review-note">{d.recurring}</p>
        </>
      )}
    </div>
  );
}
