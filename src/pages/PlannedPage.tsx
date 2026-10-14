import { BookOpen, CalendarDays, Files, NotebookPen } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { EmptyState } from "../components/EmptyState";

const pages = {
  courses: {
    title: "Courses",
    description: "A dedicated home for every subject.",
    icon: BookOpen,
    emptyTitle: "Your courses will live here",
    details:
      "Course organization, semester details, and linked study resources are planned for a later phase.",
  },
  calendar: {
    title: "Calendar",
    description: "Make room for what matters this semester.",
    icon: CalendarDays,
    emptyTitle: "Your semester, in perspective",
    details:
      "Academic events, timetable views, and calendar management are planned for a later phase.",
  },
  lectures: {
    title: "Lectures",
    description: "Keep each lecture and its ideas together.",
    icon: NotebookPen,
    emptyTitle: "A place for every lecture",
    details:
      "Lecture notes, photos, attachments, and schedule countdowns are planned for a later phase.",
  },
  materials: {
    title: "Materials",
    description: "Bring your study resources into one place.",
    icon: Files,
    emptyTitle: "Your study library starts here",
    details:
      "Document storage, resource organization, and offline access are planned for a later phase.",
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
    </>
  );
}
