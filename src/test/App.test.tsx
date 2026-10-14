import { render, screen, within, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { ToastProvider } from "../components/ToastProvider";
import { useToast } from "../components/toast-context";

function renderRoute(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("Phase 0 shell", () => {
  it("renders the dashboard with honest planned feature labels", () => {
    renderRoute();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your academic life, under control.",
    );
    expect(
      screen.getByText(
        "Planned for a later phase. No timetable or countdown is active.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it.each(["Courses", "Calendar", "Lectures", "Materials"])(
    "navigates to the %s placeholder with both navigation states synchronized",
    (label) => {
      renderRoute();
      const desktop = screen.getByRole("navigation", {
        name: "Primary navigation",
      });
      fireEvent.click(within(desktop).getByRole("link", { name: label }));
      expect(
        screen.getByRole("heading", { level: 1, name: label }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "This area is a Phase 0 placeholder. No academic data is stored yet.",
        ),
      ).toBeInTheDocument();
      for (const nav of screen.getAllByRole("navigation")) {
        expect(within(nav).getByRole("link", { name: label })).toHaveAttribute(
          "aria-current",
          "page",
        );
        expect(
          within(nav).getByRole("link", { name: "Dashboard" }),
        ).not.toHaveAttribute("aria-current");
      }
      expect(document.title).toBe(`${label} | UniCore`);
      expect(screen.getByRole("main")).toHaveFocus();
    },
  );
  it("handles unknown routes and offers working recovery", () => {
    renderRoute("/missing");
    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Back to dashboard" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your academic life, under control.",
    );
  });
});

function ToastHarness() {
  const notify = useToast();
  return <button onClick={() => notify("Example notification")}>Notify</button>;
}

describe("Toast foundation", () => {
  it("announces a message and supports dismissal", () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Example notification",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
  it("expires messages and cleans timers on unmount", () => {
    vi.useFakeTimers();
    try {
      const view = render(
        <ToastProvider>
          <ToastHarness />
        </ToastProvider>,
      );
      fireEvent.click(screen.getByRole("button", { name: "Notify" }));
      act(() => vi.advanceTimersByTime(6000));
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      fireEvent.click(screen.getByRole("button", { name: "Notify" }));
      view.unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
