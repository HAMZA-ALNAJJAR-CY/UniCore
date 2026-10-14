import {
  BookOpen,
  CalendarDays,
  Files,
  LayoutDashboard,
  NotebookPen,
} from "lucide-react";

export const navigation = [
  { path: "/", label: "لوحة التحكم", icon: LayoutDashboard },
  { path: "/courses", label: "المقررات", icon: BookOpen },
  { path: "/calendar", label: "التقويم", icon: CalendarDays },
  { path: "/lectures", label: "المحاضرات", icon: NotebookPen },
  { path: "/materials", label: "المواد", icon: Files },
] as const;
