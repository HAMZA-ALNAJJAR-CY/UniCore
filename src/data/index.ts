import { UniCoreDatabase } from "./database";
import { AcademicStore } from "./store";

/** Does not open a database or write data until explicitly used. */
export function createAcademicStore(name = "UniCore") {
  return new AcademicStore(new UniCoreDatabase(name));
}

export { DataError } from "./errors";
export type { DataErrorCode } from "./errors";
export type * from "./models";
export type { BulkResult, DeletionEntry } from "./store";
