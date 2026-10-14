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

function Navigation({ mobile = false }: { mobile?: boolean }) {
  return (
    <nav
      className={mobile ? "mobile-nav" : "desktop-nav"}
      aria-label={mobile ? "Mobile navigation" : "Primary navigation"}
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
    const label =
      navigation.find((item) => item.path === location.pathname)?.label ??
      "Page not found";
    document.title = `${label} | UniCore`;
    main.current?.focus();
  }, [location.pathname]);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
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
          Your Academic Life,
          <br />
          Under Control.
        </p>
        <Navigation />
        <div className="sidebar-footer">
          <span className="status-dot" />
          Phase 0 · Foundation<p>Offline access & sync are planned.</p>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <Link to="/" className="mobile-brand">
            UniCore
          </Link>
          <span className="topbar-label">
            A little structure. More headspace.
          </span>
          <span className="badge">Foundation preview</span>
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
          <Route path="courses" element={<PlannedPage kind="courses" />} />
          <Route path="calendar" element={<PlannedPage kind="calendar" />} />
          <Route path="lectures" element={<PlannedPage kind="lectures" />} />
          <Route path="materials" element={<PlannedPage kind="materials" />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </ToastProvider>
  );
}
