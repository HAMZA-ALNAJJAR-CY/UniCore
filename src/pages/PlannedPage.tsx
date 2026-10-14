import { BookOpen, CalendarDays, Files, NotebookPen } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";
import { Link } from "react-router-dom";

const pages = {
  courses: {
    title: "المقررات",
    description: "مساحة منظمة لكل مقرر.",
    icon: BookOpen,
    emptyTitle: "إدارة المقررات مخططة",
    details:
      "يمكنك الآن مراجعة واستيراد الجدول محلياً. عرض المقررات وإدارتها هنا مخططان لمرحلة لاحقة.",
  },
  calendar: {
    title: "التقويم",
    description: "نظرة منظمة على الفصل الدراسي.",
    icon: CalendarDays,
    emptyTitle: "تقويمك الأكاديمي قريباً",
    details: "الفعاليات وعرض الجدول وإدارة التقويم مخططة لمرحلة لاحقة.",
  },
  lectures: {
    title: "المحاضرات",
    description: "كل محاضرة وأفكارها في مكان واحد.",
    icon: NotebookPen,
    emptyTitle: "مساحة لكل محاضرة",
    details:
      "واجهات المحاضرات والملاحظات والمرفقات والعد التنازلي مخططة لمرحلة لاحقة.",
  },
  materials: {
    title: "المواد",
    description: "مصادرك الدراسية في مكان واحد.",
    icon: Files,
    emptyTitle: "مكتبتك الدراسية تبدأ هنا",
    details:
      "واجهات المستندات وتنظيم المصادر والوصول كتطبيق دون اتصال مخططة لمرحلة لاحقة.",
  },
};

export function PlannedPage({ kind }: { kind: keyof typeof pages }) {
  const page = pages[kind];
  return (
    <>
      <PageHeader title={page.title} description={page.description} />
      <EmptyState
        icon={page.icon}
        title={page.emptyTitle}
        description={page.details}
      />
      {kind === "courses" && (
        <Link className="button-link import-entry" to="/courses/import">
          مراجعة واستيراد الجدول
        </Link>
      )}
    </>
  );
}
