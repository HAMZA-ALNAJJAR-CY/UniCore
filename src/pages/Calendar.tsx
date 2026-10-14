import { useState } from "react";
import { PageHeader } from "../components/PageHeader";
import {
  useTimetable,
  type TimetableStore,
} from "../features/timetable/useTimetable";
import { addDays, isoDay, onDate } from "../features/timetable/time";
import { dailyText as d } from "../i18n/daily";
import { dateLabel, useLanguage, tr } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";
import { AcademicDataControls, SessionItem } from "./Dashboard";
export function Calendar({ store }: { store?: TimetableStore }) {
  useLanguage();
  const state = useTimetable(store),
    [anchor, setAnchor] = useState(() => new Date()),
    [view, setView] = useState<"week" | "day">("week"),
    [selected, setSelected] = useState(() => new Date());
  const monday = addDays(anchor, 1 - isoDay(anchor));
  const dates =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(monday, i))
      : [anchor];
  const term = state.data?.terms.find((row) => row.id === state.data?.termId);
  const navigate = (amount: number) => {
    const date = addDays(anchor, amount * (view === "week" ? 7 : 1));
    setAnchor(date);
    setSelected(date);
  };
  return (
    <div className="timetable-review daily-page">
      <PageHeader title={tr("text_13")} description={d.recurring} />
      <AcademicDataControls state={state} />
      <div className="management-toolbar">
        <button onClick={() => navigate(-1)}>{d.previous}</button>
        <button
          onClick={() => {
            const date = new Date();
            setAnchor(date);
            setSelected(date);
          }}
        >
          {d.now}
        </button>
        <button onClick={() => navigate(1)}>{d.following}</button>
        <button aria-pressed={view === "week"} onClick={() => setView("week")}>
          {d.weekly}
        </button>
        <button
          aria-pressed={view === "day"}
          onClick={() => {
            setAnchor(selected);
            setView("day");
          }}
        >
          {d.daily}
        </button>
      </div>
      <h2>
        {view === "week"
          ? `${dateLabel(dates[0], { dateStyle: "medium" })} – ${dateLabel(dates[6], { dateStyle: "medium" })}`
          : dateLabel(anchor)}
      </h2>
      {view === "week" && (
        <div className="calendar-day-picker" role="group" aria-label={d.daily}>
          {dates.map((date) => (
            <button
              key={date.toDateString()}
              aria-pressed={date.toDateString() === selected.toDateString()}
              onClick={() => setSelected(date)}
            >
              {dateLabel(date, { weekday: "short", day: "numeric" })}
            </button>
          ))}
        </div>
      )}
      <div className={"calendar-days " + (view === "day" ? "single-day" : "")}>
        {dates.map((date) => {
          const sessions = onDate(state.data?.sessions ?? [], date, term);
          return (
            <section
              className="agenda-day"
              key={date.toDateString()}
              data-selected={date.toDateString() === selected.toDateString()}
            >
              <h3>
                {dateLabel(date, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })}
              </h3>
              <ul className="managed-sessions">
                {sessions.map((row) => (
                  <SessionItem
                    key={row.id}
                    session={row}
                    name={
                      state.data?.courses.find(
                        (course) => course.id === row.courseId,
                      )?.name ?? t.unknown
                    }
                  />
                ))}
              </ul>
              {!sessions.length && <p>{d.none}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}
