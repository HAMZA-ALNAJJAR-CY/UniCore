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
import { Dashboard } from "../pages/Dashboard";
import { PlannedPage } from "../pages/PlannedPage";
import { NotFound } from "../pages/NotFound";
import { ToastProvider } from "../components/ToastProvider";
import { TimetableImport } from "../pages/TimetableImport";
import { Courses } from "../pages/Courses";

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={mobile ? "mobile-nav" : "desktop-nav"}
      aria-label={mobile ? "التنقل للجوال" : "التنقل الرئيسي"}
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
  const location = useLocation();
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    document.documentElement.lang = "ar";
    document.documentElement.dir = "rtl";
    const label =
      location.pathname === "/courses/import"
        ? "مراجعة الجدول الدراسي"
        : (navigation.find((item) => item.path === location.pathname)?.label ??
          "الصفحة غير موجودة");
    document.title = `${label} | UniCore`;
    main.current?.focus();
  }, [location.pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        الانتقال إلى المحتوى
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
          حياتك الأكاديمية،
          <br />
          تحت السيطرة.
        </p>
        <Navigation />
        <div className="sidebar-footer">
          <span className="status-dot" />
          مراجعة الجدول · محلياً<p>المزامنة والعمل كتطبيق دون اتصال مخططان.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link to="/" className="mobile-brand">
            UniCore
          </Link>
          <span className="topbar-label">تنظيم أبسط. تركيز أكبر.</span>
          <span className="badge">معاينة UniCore</span>
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
  return (
    <ToastProvider>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Dashboard />} />
          <Route path="courses" element={<Courses />} />
          <Route path="courses/import" element={<TimetableImport />} />
          <Route path="calendar" element={<PlannedPage kind="calendar" />} />
          <Route path="lectures" element={<PlannedPage kind="lectures" />} />
          <Route path="materials" element={<PlannedPage kind="materials" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
