import {
  BookOpen,
  CalendarDays,
  Files,
  LayoutDashboard,
  NotebookPen,
} from "lucide-react";

export const navigation = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/courses", label: "Courses", icon: BookOpen },
  { path: "/calendar", label: "Calendar", icon: CalendarDays },
  { path: "/lectures", label: "Lectures", icon: NotebookPen },
  { path: "/materials", label: "Materials", icon: Files },
] as const;
