import { UniCoreDatabase } from "./database";
import { AcademicStore } from "./store";

/** Does not open a database or write data until explicitly used. */
export function createAcademicStore(name = "UniCore") {
  return new AcademicStore(new UniCoreDatabase(name));
}

export { DataError } from "./errors";
export type { DataErrorCode } from "./errors";
export type * from "./models";
export type * from "./timetable-types";
export type { CourseRestorePreview } from "./course-restoration";
export type {
  BulkResult,
  DeletionEntry,
  RecordOutcome,
  RelatedBatch,
} from "./store";
