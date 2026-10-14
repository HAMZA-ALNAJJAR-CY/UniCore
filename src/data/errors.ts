export type DataErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "RELATIONSHIP"
  | "DUPLICATE"
  | "CONFLICT"
  | "IDENTITY_COLLISION"
  | "DEPENDENTS"
  | "QUOTA"
  | "UNAVAILABLE";

export class DataError extends Error {
  constructor(
    public readonly code: DataErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    // Avoid colliding with IndexedDB's native DataError name, which Dexie wraps.
    this.name = "AcademicDataError";
  }
}

function hasErrorName(error: unknown, name: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("name" in error && error.name === name) return true;
  return (
    "inner" in error && error.inner !== error && hasErrorName(error.inner, name)
  );
}

export function translateStorageError(error: unknown): never {
  if (error instanceof DataError) throw error;
  if (hasErrorName(error, "QuotaExceededError")) {
    throw new DataError(
      "QUOTA",
      "Device storage is full. The operation was rolled back; existing data was retained. Free space and retry.",
      { cause: error },
    );
  }
  if (hasErrorName(error, "ConstraintError")) {
    throw new DataError(
      "DUPLICATE",
      "This ID or course code already exists. Existing data was not overwritten.",
      { cause: error },
    );
  }
  throw new DataError(
    "UNAVAILABLE",
    "Local storage could not complete the operation. Retry without resetting the database.",
    { cause: error },
  );
}
