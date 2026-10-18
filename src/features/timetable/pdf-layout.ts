import type { DraftCourse, DraftSession, TimetableDraft } from "../../data";

/** Coordinates are page-local PDF points. Input order is never treated as row order. */
export interface PdfTextItem { text: string; x: number; y: number; width: number; height: number; dir: string }
export interface PdfTextPage { items: PdfTextItem[] }
export class PdfImportError extends Error {
  constructor(public readonly reason: "invalid" | "malformed" | "scanned" | "limit", options?: ErrorOptions) { super(reason, options); }
}
type Column = "code" | "name" | "activity" | "hours" | "section" | "time" | "day" | "start" | "end" | "instructor" | "room" | "date";
const clean = (text: string) => text.normalize("NFKC").replace(/[\u064B-\u065F\u0670\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").trim();
const digits = (text: string) => text.replace(/[٠-٩۰-۹]/g, c => String("٠١٢٣٤٥٦٧٨٩".indexOf(c) >= 0 ? "٠١٢٣٤٥٦٧٨٩".indexOf(c) : "۰۱۲۳۴۵۶۷۸۹".indexOf(c)));
const aliases: Record<Column, string[]> = {
  code: ["course code", "course number", "رقم المقرر", "رمز المقرر"], name: ["course name", "اسم المقرر"],
  activity: ["activity", "activity type", "النشاط", "نوع النشاط"], hours: ["credits", "credit hours", "الساعات", "س"],
  section: ["section", "الشعبه"], time: ["time", "الوقت"], day: ["day", "days", "اليوم", "الايام"],
  start: ["start", "start time", "البدايه"], end: ["end", "end time", "النهايه"],
  instructor: ["instructor", "instructor name", "اسم المدرس", "المدرس"], room: ["room", "location", "القاعة", "الموقع"],
  date: ["registration date", "تاريخ التسجيل"],
};
function lines(items: PdfTextItem[]) {
  const result: PdfTextItem[][] = [];
  for (const item of [...items].sort((a,b) => b.y - a.y || a.x - b.x)) {
    // Items are already sorted by y. Only the last line can contain this item;
    // avoid a quadratic search through every preceding line of an untrusted PDF.
    let line = result.at(-1);
    if (!line || Math.abs(line[0].y - item.y) > Math.max(3, Math.min(item.height, line[0].height) * .35)) { line = []; result.push(line); }
    line.push(item);
  }
  return result.sort((a,b) => b[0].y - a[0].y);
}
function joined(items: PdfTextItem[]) {
  // PDF.js supplies logical strings (including Arabic). Sort fragments by their
  // visual position; never reverse letters or mixed-script values heuristically.
  const rtl = items.some(item => item.dir === "rtl");
  return [...items].sort((a,b) => rtl ? b.x - a.x : a.x - b.x).map(item => item.text).join(" ").trim();
}
function headers(line: PdfTextItem[]) {
  const found: { column: Column; x: number }[] = [];
  const sorted = [...line].sort((a,b) => a.x-b.x);
  for (const column of Object.keys(aliases) as Column[]) {
    for (let i=0; i<sorted.length; i++) for (let n=1; n<=4 && i+n<=sorted.length; n++) {
      const parts = sorted.slice(i,i+n);
      if (parts.some((part,j) => j && part.x - (parts[j-1].x+parts[j-1].width) > 28)) continue;
      const text = clean(joined(parts)).toLowerCase();
      if (aliases[column].some(alias => clean(alias).toLowerCase() === text)) {
        if (!found.some(item => item.column === column)) found.push({column, x:(parts[0].x + parts.at(-1)!.x + parts.at(-1)!.width)/2});
      }
    }
  }
  return found.sort((a,b) => a.x-b.x);
}
const weekdays: Record<string, number> = {
  "الاحد":7,"احد":7,"ح":7,"sunday":7,"sun":7,
  "الاثنين":1,"الاثنان":1,"اثنين":1,"ن":1,"monday":1,"mon":1,
  "الثلاثاء":2,"ثلاثاء":2,"ث":2,"tuesday":2,"tue":2,
  "الاربعاء":3,"اربعاء":3,"ر":3,"wednesday":3,"wed":3,
  "الخميس":4,"خميس":4,"خ":4,"thursday":4,"thu":4,
  "الجمعه":5,"جمعه":5,"ج":5,"friday":5,"fri":5,
  "السبت":6,"سبت":6,"س":6,"saturday":6,"sat":6,
};
function days(text: string) {
  // Time and attendance annotations can share the day cell. Remove only known
  // non-day notation; every remaining unknown word needs explicit review.
  const withoutAnnotations = digits(text).replace(/\d{1,2}:\d{2}/g, " ")
    .replace(/(?<!\p{L})(?:in[\s-]+person|face[\s-]+to[\s-]+face|عن\s+بعد)(?!\p{L})/giu, " ");
  const annotations = new Set(["online", "وجا", "وجاهي", "الك", "الكتروني", "مد", "مدمج", "خار", "خارجي", "am", "pm", "صباح", "صباحا", "مساء"]);
  const recognizedDays: number[] = [], unknownTokens: string[] = [];
  for (const token of withoutAnnotations.split(/[\s\p{P}\p{S}]+/u).filter(Boolean)) {
    const word = clean(token).toLowerCase();
    if (!word || annotations.has(word)) continue;
    const day = Object.hasOwn(weekdays, word) ? weekdays[word] : undefined;
    if (day) { if (!recognizedDays.includes(day)) recognizedDays.push(day); }
    else if (!unknownTokens.includes(token)) unknownTokens.push(token);
  }
  return { recognizedDays, unknownTokens, sourceText: text };
}
function times(text: string): [string,string] | null {
  const values = [...digits(text).matchAll(/\b(\d{1,2}):([0-5]\d)\b/g)].map(match => match[1].padStart(2,"0")+":"+match[2]);
  if (values.length !== 2 || values.some(value => value > "23:59") || values[0] === values[1]) return null;
  // Never swap endpoints to make a range pass validation. Reversed/overnight
  // ranges and ambiguous AM/PM notation require correction in the preview.
  if (/\b(am|pm)\b|صباح|مساء/i.test(text)) return null;
  return [values[0],values[1]];
}

/** Recognized tables only. Discard headers/PII outside table columns, retain incomplete
 * academic cells as visible invalid/uncertain draft values. Never choose stored IDs. */
export function parseTimetablePages(pages: PdfTextPage[], base: TimetableDraft): TimetableDraft {
  const courses: DraftCourse[] = [], sessions: DraftSession[] = [];
  const weekdayReviews: NonNullable<TimetableDraft["weekdayReviews"]> = [];
  for (const page of pages) {
    const rows = lines(page.items.filter(item => item.text.trim()));
    const headerWords = new Set(Object.values(aliases).flat().flatMap(alias => clean(alias).toLowerCase().split(/\s+/)));
    const headerRows = (index: number) => {
      const next = rows[index+1];
      const continuation = next && Math.abs(rows[index][0].y-next[0].y) <= 18 &&
        next.every(item => clean(item.text).toLowerCase().split(/\s+/).every(word => headerWords.has(word)));
      return continuation ? rows.slice(index,index+2) : [rows[index]];
    };
    const headerIndex = rows.findIndex((_, index) => {
      const fields = headers(headerRows(index).flat()).map(item => item.column);
      return fields.includes("code") && fields.includes("name") && (fields.includes("time") || fields.includes("start"));
    });
    if (headerIndex < 0) throw new PdfImportError("scanned");
    const columns = headers(headerRows(headerIndex).flat());
    const cell = (row: PdfTextItem[], column: Column) => {
      const index = columns.findIndex(item => item.column === column);
      if (index < 0) return "";
      const low = index ? (columns[index-1].x+columns[index].x)/2 : -Infinity;
      const high = index<columns.length-1 ? (columns[index].x+columns[index+1].x)/2 : Infinity;
      return joined(row.filter(item => item.x+item.width/2 >= low && item.x+item.width/2 < high));
    };
    const body = rows.slice(headerIndex+headerRows(headerIndex).length);
    const anchors = body.flatMap((row,index) => {
      const code = digits(cell(row,"code")).trim();
      if (/مجموع|total|رموز/i.test(joined(row))) return [];
      return (code && (cell(row,"name") || cell(row,"time") || cell(row,"start"))) ||
        (!code && cell(row,"name") && (/^\d+(\.\d+)?$/.test(digits(cell(row,"hours"))) || /:/.test(cell(row,"time")+cell(row,"start")))) ? [index] : [];
    });
    for (let i=0; i<anchors.length; i++) {
      const group = body.slice(anchors[i],anchors[i+1] ?? body.length);
      // Stop at totals/footer, rather than importing arbitrary trailing text.
      const usable = group.slice(0, group.findIndex(row => /مجموع|total|رموز|legend|day codes/i.test(joined(row))) < 0 ? group.length : group.findIndex(row => /مجموع|total|رموز|legend|day codes/i.test(joined(row))));
      const value = (column: Column) => usable.map(row => cell(row,column)).filter(Boolean).join(" ").trim();
      const code = digits(value("code"));
      const name = value("name");
      const activity = clean(value("activity")).toLowerCase();
      const activityType: DraftCourse["activityType"] = /^(نظري|theory|theoretical)$/.test(activity) ? "theory" : /^(عملي|practical)$/.test(activity) ? "practical" : /^(مختبر|lab|laboratory)$/.test(activity) ? "lab" : null;
      const rawHours = digits(value("hours"));
      const registeredHours = /^\d+(\.\d+)?$/.test(rawHours) ? Number(rawHours) : NaN;
      const registrationDate = digits(value("date")) || null;
      // Repeated course rows collapse only if their course-level values agree.
      const candidate = {code,name,activityType,registeredHours,instructor:value("instructor")||null,section:digits(value("section"))||null,registrationDate,description:activity && !activityType ? value("activity") : null};
      let course = courses.find(row => JSON.stringify([row.code,row.name,row.activityType,row.registeredHours,row.instructor,row.section,row.registrationDate,row.description]) === JSON.stringify(Object.values(candidate)));
      if (!course) {
        const unconfirmed = Object.entries(candidate).filter(([k,v]) => k !== "description" && (v === null || v === "" || typeof v === "number" && !Number.isFinite(v))).map(([k])=>k);
        if (registrationDate && !/^\d{4}-\d{2}-\d{2}$/.test(registrationDate)) unconfirmed.push("registrationDate");
        course = { ...candidate, key:"pdf-course:"+crypto.randomUUID(), unconfirmed };
        courses.push(course);
      }
      let meetingFound = false;
      const meetingRows: PdfTextItem[][] = [];
      for (const row of usable) {
        const fragment = cell(row,"time") + " " + cell(row,"day") + " " + cell(row,"start") + " " + cell(row,"end");
        if (!fragment.trim()) continue;
        if (!/\d:\d/.test(digits(fragment)) && meetingRows.length) meetingRows.at(-1)!.push(...row);
        else meetingRows.push([...row]);
      }
      for (const row of meetingRows) {
        const timeText = [cell(row,"time"),cell(row,"start"),cell(row,"end")].filter(Boolean).join(" ");
        if (!timeText && !cell(row,"day")) continue;
        meetingFound = true;
        const slot = times(timeText), parsedDays = days(cell(row,"day") || timeText);
        const weeklyDays = parsedDays.recognizedDays;
        if (parsedDays.unknownTokens.length) weekdayReviews.push({
          key: "pdf-weekdays:"+crypto.randomUUID(), courseKey: course.key,
          ...parsedDays, acknowledged: false,
        });
        const room = cell(row,"room") || value("room") || null;
        const online = /online|الكتروني|عن بعد/i.test(clean(room ?? "")+" "+clean(timeText));
        const invalidRange = !slot || slot[0] >= slot[1];
        const unknown = [invalidRange && "startTime", invalidRange && "endTime", !weeklyDays.length && "dayOfWeek", !room && "room", !room && !online && "deliveryMode"].filter((v): v is string => !!v);
        for (const dayOfWeek of weeklyDays.length ? weeklyDays : [0]) {
          sessions.push({ key:"pdf-session:"+crypto.randomUUID(), courseKey:course.key, dayOfWeek, startTime:slot?.[0]??"", endTime:slot?.[1]??"", room, deliveryMode:online?"online":room?"in-person":"", notes:unknown.length ? timeText : null, unconfirmed:[...unknown] });
        }
      }
      if (!meetingFound) sessions.push({key:"pdf-session:"+crypto.randomUUID(),courseKey:course.key,dayOfWeek:0,startTime:"",endTime:"",room:value("room")||null,deliveryMode:"",unconfirmed:["dayOfWeek","startTime","endTime","deliveryMode"]});
    }
  }
  if (!courses.length) throw new PdfImportError("scanned");
  // Never silently discard duplicate slots; analyzeDraft requires their resolution.
  return {...base, courses, sessions, weekdayReviews};
}
