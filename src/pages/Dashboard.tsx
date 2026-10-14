import { ArrowUpRight, CalendarClock, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { PageHeader } from "../components/PageHeader";
import { navigation } from "../app/navigation";

export function Dashboard() {
  return (
    <>
      <PageHeader
        title="Your academic life, under control."
        description="One focused space for your semester. The foundation is ready; your academic tools are next."
      />
      <section className="welcome-panel">
        <div>
          <p className="eyebrow text-secondary">BUILT AROUND YOUR SEMESTER</p>
          <h2>
            Less scattered.
            <br />
            More focused.
          </h2>
          <p>
            Courses, lectures, and study materials will come together here.
            Explore the workspace as it takes shape.
          </p>
          <span className="badge">Phase 0 · Foundation</span>
        </div>
        <div className="welcome-symbol" aria-hidden="true">
          <Layers3 size={72} strokeWidth={1} />
        </div>
      </section>
      <div className="section-heading">
        <h2>Your workspace</h2>
        <span>Navigation available · Features planned</span>
      </div>
      <section className="workspace-grid" aria-label="Workspace areas">
        {navigation
          .filter((item) => item.path !== "/")
          .map(({ path, label, icon: Icon }) => (
            <Link to={path} className="workspace-card" key={path}>
              <div className="card-top">
                <Icon size={24} aria-hidden="true" />
                <ArrowUpRight size={18} aria-hidden="true" />
              </div>
              <h3>{label}</h3>
              <p>Explore the planned {label.toLowerCase()} area.</p>
              <span className="badge">Planned</span>
            </Link>
          ))}
      </section>
      <section className="schedule-preview">
        <CalendarClock size={26} aria-hidden="true" />
        <div>
          <h2>Schedule & lecture countdown</h2>
          <p>Planned for a later phase. No timetable or countdown is active.</p>
        </div>
        <time dateTime={format(new Date(), "yyyy-MM-dd")}>
          {format(new Date(), "EEE, d MMM yyyy")}
        </time>
      </section>
    </>
  );
}
