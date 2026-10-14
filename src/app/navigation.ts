import { tr, dynamic } from "../i18n/locale";
import {
  BookOpen,
  CalendarDays,
  Files,
  LayoutDashboard,
  NotebookPen,
} from "lucide-react";

export const navigation = dynamic(
  () =>
    [
      { path: "/", label: tr("text_11"), icon: LayoutDashboard },
      { path: "/courses", label: tr("text_12"), icon: BookOpen },
      { path: "/calendar", label: tr("text_13"), icon: CalendarDays },
      { path: "/lectures", label: tr("text_14"), icon: NotebookPen },
      { path: "/materials", label: tr("text_15"), icon: Files },
    ] as const,
);
