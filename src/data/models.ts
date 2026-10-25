export interface RecordMetadata {
  id: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  revision: number;
}

export interface AcademicTerm extends RecordMetadata {
  name: string;
  academicYear: string;
  semester: number;
  startDate?: string | null;
  endDate?: string | null;
  college?: string | null;
  program?: string | null;
}

export interface Course extends RecordMetadata {
  academicTermId: string;
  code: string;
  name: string;
  instructor?: string | null;
  section?: string | null;
  registeredHours: number;
  description?: string | null;
  activityType?: "theory" | "practical" | "lab" | null;
  /** University registration date, if supplied; never inferred from createdAt. */
  registrationDate?: string | null;
}

export interface ScheduleSession extends RecordMetadata {
  academicTermId: string;
  courseId: string;
  /** ISO weekday: Monday = 1, Sunday = 7. */
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  room?: string | null;
  location?: string | null;
  deliveryMode: "in-person" | "online";
  notes?: string | null;
}

export interface Lecture extends RecordMetadata {
  courseId: string;
  scheduleSessionId?: string | null;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  title?: string | null;
  notes?: string | null;
}

export interface Material extends RecordMetadata {
  courseId: string;
  title: string;
  description?: string | null;
  category?: string | null;
}

interface StoredFile extends RecordMetadata {
  fileName: string;
  mimeType: string;
  fileSize: number;
  blob: Blob;
}

export interface LectureFile extends StoredFile {
  lectureId: string;
}
export interface MaterialFile extends StoredFile {
  materialId: string;
}

export interface Entities {
  academicTerms: AcademicTerm;
  courses: Course;
  scheduleSessions: ScheduleSession;
  lectures: Lecture;
  lectureFiles: LectureFile;
  materials: Material;
  materialFiles: MaterialFile;
}

export type EntityName = keyof Entities;
// File size and MIME type always come from the Blob, never caller-supplied metadata.
export type CreateInput<K extends EntityName> = Omit<
  Entities[K],
  keyof RecordMetadata | "mimeType" | "fileSize"
>;
export type UpdateInput<K extends EntityName> = Partial<CreateInput<K>>;
export type BulkInput<K extends EntityName> = CreateInput<K> & { id: string };
export type ListFilter<K extends EntityName> = Partial<
  Pick<Entities[K], Exclude<keyof Entities[K], "blob">>
>;
