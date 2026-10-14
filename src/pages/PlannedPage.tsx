import { tr, dynamic } from "../i18n/locale";
import { CalendarDays, Files, NotebookPen } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";

const pages = dynamic(() => ({
  calendar: {
    title: tr("text_13"),
    description: tr("text_23"),
    icon: CalendarDays,
    emptyTitle: tr("text_24"),
    details: tr("text_25"),
  },
  lectures: {
    title: tr("text_14"),
    description: tr("text_26"),
    icon: NotebookPen,
    emptyTitle: tr("text_27"),
    details: tr("text_28"),
  },
  materials: {
    title: tr("text_15"),
    description: tr("text_29"),
    icon: Files,
    emptyTitle: tr("text_30"),
    details: tr("text_31"),
  },
}));

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
    </>
  );
}
