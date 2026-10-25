import type { AcademicTerm, Course, ScheduleSession } from "./models";

type DraftRow<T> = Omit<
  T,
  "createdAt" | "updatedAt" | "deletedAt" | "revision" | "id"
> & {
  key: string;
  id?: string;
  unconfirmed: string[];
  /** Require insertion of a separate identity; mappings/exact duplicates reject this choice. */
  identity?: "new";
};
export type DraftTerm = DraftRow<AcademicTerm>;
export type DraftCourse = Omit<DraftRow<Course>, "academicTermId">;
export type DraftSession = Omit<
  DraftRow<ScheduleSession>,
  "academicTermId" | "courseId" | "deliveryMode"
> & { courseKey: string; deliveryMode: ScheduleSession["deliveryMode"] | "" };
export interface TimetableDraft {
  sourceId: string;
  term: DraftTerm;
  courses: DraftCourse[];
  sessions: DraftSession[];
  /** Draft-only original PDF date evidence/interpretation. Never stored in
   * academic records or mappings; manual edits retain the source evidence. */
  dateReviews?: {
    key: string;
    courseKey: string;
    sourceText: string;
    status: "iso" | "inferred-dmy" | "ambiguous" | "conflicting" | "invalid";
  }[];
  /** PDF review only, never persisted as academic rows or import mappings.
   * One notice per uncertain source meeting; unknown tokens invent no sessions. */
  weekdayReviews?: {
    key: string;
    courseKey: string;
    sourceText: string;
    recognizedDays: number[];
    unknownTokens: string[];
    acknowledged: boolean;
  }[];
  /** Recovery notice only: validated tombstones omitted from the editable draft.
   * Never persisted or interpreted as a request to delete/restore a record. */
  omittedDeletedRows?: {
    entity: "courses" | "scheduleSessions";
    id: string;
    key: string;
    label: string;
  }[];
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
