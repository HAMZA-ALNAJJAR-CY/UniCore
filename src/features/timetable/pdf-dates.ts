import type { DraftCourse, TimetableDraft } from "../../data";

/** Same strict calendar round-trip as timetable/domain validation, including
 * Gregorian leap years. JavaScript's overflow normalization is never accepted. */
export function validPdfIsoDate(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value+"T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export function interpretPdfDates(courses: DraftCourse[], sources: {courseKey:string;sourceText:string;value:string}[]) {
  const candidates = sources.map(source => {
    const match = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(source.value);
    const iso = (day:string,month:string,year:string) => `${year}-${month.padStart(2,"0")}-${day.padStart(2,"0")}`;
    const dmy = match ? iso(match[1],match[2],match[3]) : null;
    const mdy = match ? iso(match[2],match[1],match[3]) : null;
    return {...source,match,dmy,mdy};
  });
  const dmyEvidence = candidates.some(c => c.match && Number(c.match[1]) > 12 && validPdfIsoDate(c.dmy));
  const mdyEvidence = candidates.some(c => c.match && Number(c.match[2]) > 12 && validPdfIsoDate(c.mdy));
  const conflicting = dmyEvidence && mdyEvidence;
  const reviews: NonNullable<TimetableDraft["dateReviews"]> = [];
  const byKey = new Map(courses.map(course => [course.key,course]));
  for (const candidate of candidates) {
    const {courseKey,sourceText,value,dmy,mdy,match} = candidate;
    let status: (typeof reviews)[number]["status"];
    let converted = value;
    if (validPdfIsoDate(value)) status = "iso";
    else if (!match || !validPdfIsoDate(dmy) && !validPdfIsoDate(mdy)) status = "invalid";
    else if (conflicting) status = "conflicting";
    else if (dmyEvidence && !mdyEvidence && validPdfIsoDate(dmy)) {status = "inferred-dmy";converted = dmy;}
    else status = "ambiguous";
    const course = byKey.get(courseKey)!;
    course.registrationDate = converted;
    course.unconfirmed = course.unconfirmed.filter(field => field !== "registrationDate");
    if (status !== "iso" && status !== "inferred-dmy") course.unconfirmed.push("registrationDate");
    reviews.push({key:"pdf-date:"+crypto.randomUUID(),courseKey,sourceText,status});
  }
  return reviews;
}
