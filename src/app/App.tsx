import { tr } from "../i18n/locale";
import { useEffect, useRef } from "react";
import {
  Link,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { GraduationCap } from "lucide-react";
import { navigation } from "./navigation";
import { Home, ManualSetup, Settings } from "../pages/Introduction";
import { introductionText } from "../i18n/introduction";
import { PlannedPage } from "../pages/PlannedPage";
import { NotFound } from "../pages/NotFound";
import { ToastProvider } from "../components/ToastProvider";
import { TimetableImport } from "../pages/TimetableImport";
import { Courses } from "../pages/Courses";
import { Lectures } from "../pages/Lectures";
import { Calendar } from "../pages/Calendar";
import { useLanguage, setLanguage } from "../i18n/locale";

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={mobile ? "mobile-nav" : "desktop-nav"}
      aria-label={mobile ? tr("text_0") : tr("text_1")}
    >
      {navigation.map(({ path, label, icon: Icon }) => (
        <NavLink key={path} to={path} end={path === "/"}>
          <Icon size={20} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function Shell() {
  const language = useLanguage();
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
    const label =
      location.pathname === "/courses/import"
        ? tr("text_2")
        : (navigation.find((item) => item.path === location.pathname)?.label ??
          tr("text_3"));
    document.title = `${location.pathname === "/settings" ? introductionText.settings : location.pathname === "/courses/setup" ? introductionText.newTerm : label} | UniCore`;
    main.current?.focus();
  }, [location.pathname, language]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {tr("text_4")}
      </a>
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">
            <GraduationCap aria-hidden="true" />
          </span>
          <span>
            Uni<span className="text-primary">Core</span>
          </span>
        </Link>
        <p className="brand-tagline">
          {tr("text_5")}
          <br />
          {tr("text_6")}
        </p>
        <Navigation />
        <div className="sidebar-footer">
          <span className="status-dot" />
          {tr("text_7")}
          <p>{tr("text_8")}</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link className="settings-link" to="/settings">
            {introductionText.settings}
          </Link>
          <label className="language-select">
            <span>Language / اللغة</span>
            <select
              aria-label="Language / اللغة"
              value={language}
              onChange={(event) =>
                setLanguage(event.target.value as "ar" | "en")
              }
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </label>
          <Link to="/" className="mobile-brand">
            UniCore
          </Link>
          <span className="topbar-label">{tr("text_9")}</span>
          <span className="badge">{tr("text_10")}</span>
        </header>
        <main id="main-content" ref={main} tabIndex={-1}>
          <Outlet />
        </main>
        <footer className="workspace-footer">
          UniCore · Your Academic Life, Under Control.
        </footer>
      </div>
      <Navigation mobile />
    </div>
  );
}

export function App() {
  useLanguage();
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Home />} />
          <Route path="settings" element={<Settings />} />
          <Route path="courses/setup" element={<ManualSetup />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/import" element={<TimetableImport />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="lectures" element={<Lectures />} />
          <Route path="materials" element={<PlannedPage kind="materials" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
