import type { AcademicTerm, Course, ScheduleSession } from "./models";

type DraftRow<T> = Omit<
  T,
  "createdAt" | "updatedAt" | "deletedAt" | "revision" | "id"
> & {
  key: string;
  id?: string;
  unconfirmed: string[];
  /** Explicit permission to insert an unmatched row alongside existing history. */
  identity?: "new";
};
export type DraftTerm = DraftRow<AcademicTerm>;
export type DraftCourse = Omit<DraftRow<Course>, "academicTermId">;
export type DraftSession = Omit<
  DraftRow<ScheduleSession>,
  "academicTermId" | "courseId"
> & { courseKey: string };
export interface TimetableDraft {
  sourceId: string;
  term: DraftTerm;
  courses: DraftCourse[];
  sessions: DraftSession[];
}
export interface ImportMapping {
  key: string;
  sourceId: string;
  entity: "academicTerms" | "courses" | "scheduleSessions";
  sourceKey: string;
  recordId: string;
  unconfirmed: string[];
  createdAt: number;
}
export interface SavedImportSource {
  sourceId: string;
  termName: string | null;
}
export interface ImportDifference {
  key: string;
  label: string;
  fields: { field: string; incoming: string; existing: string }[];
}
export interface TimetableReview {
  draft: TimetableDraft;
  differences: ImportDifference[];
  existingKeys: string[];
  snapshot: string;
  savedSummary: { courses: number; sessions: number; hours: number };
}
