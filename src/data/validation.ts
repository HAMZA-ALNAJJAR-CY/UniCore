import type { CreateInput, Entities, EntityName } from "./models";
import { DataError } from "./errors";
import { canonicalUuid } from "./identity";
import { assertNever } from "./entity-integrity";

export const INPUT_FIELDS = {
  academicTerms: [
    "name",
    "academicYear",
    "semester",
    "startDate",
    "endDate",
    "college",
    "program",
  ],
  courses: [
    "academicTermId",
    "code",
    "name",
    "instructor",
    "section",
    "registeredHours",
    "description",
    "activityType",
    "registrationDate",
  ],
  scheduleSessions: [
    "academicTermId",
    "courseId",
    "dayOfWeek",
    "startTime",
    "endTime",
    "room",
    "location",
    "deliveryMode",
    "notes",
  ],
  lectures: [
    "courseId",
    "scheduleSessionId",
    "date",
    "startTime",
    "endTime",
    "title",
    "notes",
  ],
  lectureFiles: ["lectureId", "fileName", "blob"],
  materials: ["courseId", "title", "description", "category"],
  materialFiles: ["materialId", "fileName", "blob"],
} as const satisfies { [K in EntityName]: readonly (keyof CreateInput<K> & string)[] };

type RequireComplete<T extends never> = T;
// CreateInput excludes immutable metadata and Blob-derived size/MIME fields.
// Every remaining field, including optional fields, must be registered here.
export type InputFieldCoverage = RequireComplete<{
  [K in EntityName]: Exclude<keyof CreateInput<K>, (typeof INPUT_FIELDS)[K][number]>
}[EntityName]>;

export function invalid(message: string): never {
  throw new DataError("VALIDATION", message);
}

export function uuid(value: unknown): asserts value is string {
  canonicalUuid(value);
}

export function assertInput(kind: EntityName, value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid("Record input must be an object.");
  const allowedFields: readonly string[] = INPUT_FIELDS[kind];
  for (const key of Object.keys(value)) {
    if (!allowedFields.includes(key))
      invalid(`Unsupported or immutable field: ${key}`);
  }
}

function text(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim())
    invalid(`${label} must be non-empty text.`);
}

function date(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    invalid("Dates must use YYYY-MM-DD.");
  const parsed = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    invalid("Date does not exist.");
}

function times(start: unknown, end: unknown, required: boolean) {
  if (!required && start == null && end == null) return;
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(start) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(end) ||
    start >= end
  )
    invalid("Provide a valid same-day HH:mm time range with start before end.");
}

/** Runtime validation protects JS callers as well as typed callers. */
export function validate<K extends EntityName>(kind: K, record: Entities[K]) {
  const value = record as unknown as Record<string, unknown>;
  for (const key of INPUT_FIELDS[kind]) {
    if (
      [
        "instructor",
        "section",
        "description",
        "room",
        "location",
        "notes",
        "title",
        "category",
        "college",
        "program",
      ].includes(key) &&
      value[key] != null &&
      typeof value[key] !== "string"
    )
      invalid(`${key} must be text or null.`);
  }
  switch (kind) {
    case "academicTerms":
      text(value.name, "name");
      text(value.academicYear, "academicYear");
      if (
        typeof value.semester !== "number" ||
        !Number.isInteger(value.semester) ||
        value.semester < 1
      )
        invalid("semester must be a positive integer.");
      if (value.startDate != null) date(value.startDate);
      if (value.endDate != null) date(value.endDate);
      if (
        typeof value.startDate === "string" &&
        typeof value.endDate === "string" &&
        value.startDate > value.endDate
      )
        invalid("Term end date precedes its start date.");
      break;
    case "courses":
      if (
        value.activityType != null &&
        value.activityType !== "theory" &&
        value.activityType !== "practical" &&
        value.activityType !== "lab"
      )
        invalid("Invalid activityType.");
      if (value.registrationDate != null) date(value.registrationDate);
      uuid(value.academicTermId);
      text(value.code, "code");
      text(value.name, "name");
      if (
        typeof value.registeredHours !== "number" ||
        !Number.isFinite(value.registeredHours) ||
        value.registeredHours < 0
      )
        invalid("registeredHours must be a finite non-negative number.");
      break;
    case "scheduleSessions":
      uuid(value.academicTermId);
      uuid(value.courseId);
      if (
        typeof value.dayOfWeek !== "number" ||
        !Number.isInteger(value.dayOfWeek) ||
        value.dayOfWeek < 1 ||
        value.dayOfWeek > 7
      )
        invalid("dayOfWeek must be an ISO weekday from 1 through 7.");
      times(value.startTime, value.endTime, true);
      if (value.deliveryMode !== "in-person" && value.deliveryMode !== "online")
        invalid("Invalid deliveryMode.");
      break;
    case "lectures":
      uuid(value.courseId);
      if (value.scheduleSessionId != null) uuid(value.scheduleSessionId);
      date(value.date);
      times(value.startTime, value.endTime, false);
      break;
    case "materials":
      uuid(value.courseId);
      text(value.title, "title");
      break;
    case "lectureFiles":
    case "materialFiles":
      uuid(value[kind === "lectureFiles" ? "lectureId" : "materialId"]);
      text(value.fileName, "fileName");
      if (!(value.blob instanceof Blob))
        invalid("An actual Blob is required for file content.");
      break;
    default:
      assertNever(kind);
  }
}
