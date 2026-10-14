import Dexie from "dexie";
import type { Entities, EntityName } from "./models";

export const SCHEMA_V1 = {
  academicTerms: "id, academicYear",
  courses: "id, academicTermId, &[academicTermId+code]",
  scheduleSessions: "id, academicTermId, courseId, dayOfWeek",
  lectures: "id, courseId, scheduleSessionId, date",
  lectureFiles: "id, lectureId",
  materials: "id, courseId, category",
  materialFiles: "id, materialId",
};

/** Internal module. UI code must use the service exported by data/index.ts. */
export class UniCoreDatabase extends Dexie {
  constructor(name = "UniCore") {
    super(name);
    this.version(1).stores(SCHEMA_V1);
  }

  records<K extends EntityName>(name: K) {
    return this.table<Entities[K], string>(name);
  }
}
