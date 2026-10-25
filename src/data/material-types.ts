import type { CreateInput } from "./models";

/** Caller-owned IDs survive retries. A failed save rolls back the material and every new file. */
export interface MaterialSave {
  termId: string;
  id: string;
  expectedRevision?: number;
  values: CreateInput<"materials">;
  files: readonly { id: string; fileName: string; blob: Blob }[];
}
