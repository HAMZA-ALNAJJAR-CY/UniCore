import type { DraftCourse, DraftSession, TimetableDraft } from "../../data";
import { interpretPdfDates } from "./pdf-dates";

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
  activity: ["activity", "activity type", "النشاط", "نوع النشاط"], hours: ["credits", "credit hours", "الساعات", "عدد الساعات", "س"],
  section: ["section", "الشعبه"], time: ["time", "الوقت"], day: ["day", "days", "اليوم", "الايام"],
  start: ["start", "start time", "البدايه"], end: ["end", "end time", "النهايه"],
  instructor: ["instructor", "instructor name", "اسم المدرس", "المدرس", "المحاضر"], room: ["room", "location", "القاعة", "الموقع"],
  date: ["registration date", "تاريخ التسجيل"],
};
function lines(items: PdfTextItem[], columnAt?: (item: PdfTextItem) => number) {
  const result: PdfTextItem[][] = [];
  const columnBaselines = new Map<number,number>();
  for (const item of [...items].sort((a,b) => b.y - a.y || a.x - b.x)) {
    // Items are already sorted by y. Only the last line can contain this item;
    // avoid a quadratic search through every preceding line of an untrusted PDF.
    let line = result.at(-1);
    // Mixed fonts can place centered cell values about half a glyph below a
    // wrapped cell's first baseline. Keep them in one row, below a full line.
    // Refine body rows after finding headers: a second baseline in an occupied
    // column is a distinct text line. A per-column map avoids quadratic scans
    // of long/untrusted text lines. The first pass only locates table headers.
    const column = columnAt?.(item), previous = column === undefined ? undefined : columnBaselines.get(column);
    const collision = previous !== undefined && previous-item.y > 1;
    if (!line || collision || Math.abs(line[0].y - item.y) > Math.max(3, Math.min(item.height, line[0].height) * .65)) { line = []; result.push(line);columnBaselines.clear(); }
    line.push(item);
    if (column !== undefined && !columnBaselines.has(column)) columnBaselines.set(column,item.y);
  }
  return result.sort((a,b) => b[0].y - a[0].y);
}
function joined(items: PdfTextItem[]) {
  // PDF.js supplies logical strings (including Arabic). Sort fragments by their
  // visual position; never reverse letters or mixed-script values heuristically.
  const rtl = items.some(item => item.dir === "rtl");
  return [...items].sort((a,b) => rtl ? b.x - a.x : a.x - b.x).map(item => item.text).join(" ").trim();
}
function footerText(value: string, labelOnly = false) {
  const text = clean(digits(value)).replace(/\s+/g, " ");
  // Classify complete footer records, never a keyword inside academic text.
  // Totals consist of a label and scalar value/units; legends contain only
  // known weekday names/codes after their label. Retain unfamiliar prose.
  if (/^(?:الصفحه|page)\s+\d+\s+(?:من|of)\s*\d+$/i.test(text)) return true;
  const total = "(?:total(?: (?:registered )?(?:credit )?hours)?|مجموع(?: الساعات(?: المسجله)?)?)";
  const amount = "\\d+(?:\\.\\d+)?(?:\\s*(?:credit hours?|hours?|ساعه(?:\\s*[/،]\\s*ساعات)?|ساعات))?";
  if (labelOnly && new RegExp(`^${total}\\s*[:：=-]?$`, "i").test(text)) return true;
  if (new RegExp(`^(?:${total}\\s*[:：=-]?\\s*${amount}|${amount}\\s*[:：=-]?\\s*${total})$`, "i").test(text)) return true;
  const legend = /^(?:legend|day codes|رموز(?: الايام)?)\s*[:：-]?\s*(.*)$/i.exec(text);
  if (!legend) return false;
  const tokens = legend[1].split(/[\s\p{P}\p{S}]+/u).filter(Boolean);
  return tokens.every(token => Object.hasOwn(weekdays, token.toLowerCase()));
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
  const values = [...digits(text).matchAll(/(?<![\p{L}\p{N}])(\d{1,2}):([0-5]\d)(?![\p{L}\p{N}])/gu)].map(match => match[1].padStart(2,"0")+":"+match[2]);
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
  const dateSources: {courseKey:string;sourceText:string;value:string}[] = [];
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
    const columnAt = (item: PdfTextItem) => columns.findIndex((column,index) => {
      const low = index ? (columns[index-1].x+column.x)/2 : -Infinity;
      const high = index<columns.length-1 ? (column.x+columns[index+1].x)/2 : Infinity;
      return item.x+item.width/2 >= low && item.x+item.width/2 < high;
    });
    const cell = (row: PdfTextItem[], column: Column) => {
      const index = columns.findIndex(item => item.column === column);
      if (index < 0) return "";
      const low = index ? (columns[index-1].x+columns[index].x)/2 : -Infinity;
      const high = index<columns.length-1 ? (columns[index].x+columns[index+1].x)/2 : Infinity;
      return joined(row.filter(item => item.x+item.width/2 >= low && item.x+item.width/2 < high));
    };
    const body = lines(rows.slice(headerIndex+headerRows(headerIndex).length).flat(),columnAt);
    const textColumns = new Set<Column>(["name","instructor","room"]);
    const continuationColumns = new Set<Column>([...textColumns,"day","time","start","end"]);
    const footer = (row: PdfTextItem[]) => {
      // A label inside an academic text cell may be wrapped content rather
      // than a footer, including a line sharing a day/time cell. Preserve those
      // column-owned fragments even when their joined text resembles a legend.
      if (row.some(item => textColumns.has(columns[columnAt(item)].column)) &&
        row.every(item => continuationColumns.has(columns[columnAt(item)].column))) return false;
      const code = cell(row,"code");
      // A course identifier is not footer prose. Numeric totals may occupy
      // this column, but an actual course row must never be removed by its title.
      if (code && !/^\d+(\.\d+)?$/.test(digits(code)) && !footerText(code,true)) return false;
      return footerText(joined(row));
    };
    let hasCourseRow = false;
    const anchors = body.flatMap((row,index) => {
      const code = digits(cell(row,"code")).trim();
      if (footer(row)) return [];
      // Even a code-only row is academic evidence: keep an incomplete course
      // for correction instead of appending its identity to the previous one.
      // Likewise retain leading unowned cells as an invalid draft row; never
      // silently discard them or attach them to the next course's identity.
      const startsCourse = code || !hasCourseRow ||
        (cell(row,"name") && (/^\d+(\.\d+)?$/.test(digits(cell(row,"hours"))) || /:/.test(cell(row,"time")+cell(row,"start"))));
      if (!startsCourse) return [];
      hasCourseRow = true;
      return [index];
    });
    // Overlapping baseline-tolerance windows cannot safely assign offset text
    // to a parent. Aligned close rows are distinct; mixed-baseline close rows
    // fail closed, including wrapped cells that could belong to either course.
    const codeColumn = columns.findIndex(column => column.column === "code");
    for (let i=0;i<anchors.length-1;i++) {
      const upper = body[anchors[i]].find(item => columnAt(item) === codeColumn);
      const lower = body[anchors[i+1]].find(item => columnAt(item) === codeColumn);
      if (!upper || !lower || upper.y-lower.y > 2*Math.max(3,Math.min(upper.height,lower.height)*.65)) continue;
      const uncertain = body.slice(anchors[i],anchors[i+1]).flat().some(item => Math.abs(item.y-upper.y) > 1) ||
        body.slice(anchors[i+1],anchors[i+2] ?? body.length).flat().some(item => Math.abs(item.y-lower.y) > 1);
      if (uncertain) throw new PdfImportError("scanned");
    }
    for (let i=0; i<anchors.length; i++) {
      const group = body.slice(anchors[i],anchors[i+1] ?? body.length);
      // Stop at totals/footer, rather than importing arbitrary trailing text.
      const footerIndex = group.findIndex(footer);
      const usable = group.slice(0, footerIndex < 0 ? group.length : footerIndex);
      const value = (column: Column) => usable.map(row => cell(row,column)).filter(Boolean).join(" ").trim();
      const code = digits(value("code"));
      const name = value("name").normalize("NFKC");
      const activity = clean(value("activity")).toLowerCase();
      const activityType: DraftCourse["activityType"] = /^(نظري|theory|theoretical)$/.test(activity) ? "theory" : /^(عملي|practical)$/.test(activity) ? "practical" : /^(مختبر|lab|laboratory)$/.test(activity) ? "lab" : null;
      const rawHours = digits(value("hours"));
      const registeredHours = /^\d+(\.\d+)?$/.test(rawHours) ? Number(rawHours) : NaN;
      const registrationDate = digits(value("date")) || null;
      // Repeated course rows collapse only if their course-level values agree.
      const candidate = {code,name,activityType,registeredHours,instructor:value("instructor").normalize("NFKC")||null,section:digits(value("section"))||null,registrationDate,description:activity && !activityType ? value("activity") : null};
      let course = courses.find(row => JSON.stringify([row.code,row.name,row.activityType,row.registeredHours,row.instructor,row.section,row.registrationDate,row.description]) === JSON.stringify(Object.values(candidate)));
      if (!course) {
        const unconfirmed = Object.entries(candidate).filter(([k,v]) => k !== "description" && (v === null || v === "" || typeof v === "number" && !Number.isFinite(v))).map(([k])=>k);
        if (registrationDate && !/^\d{4}-\d{2}-\d{2}$/.test(registrationDate)) unconfirmed.push("registrationDate");
        // Some RTL fonts expose mirrored numeric brackets. Retain the source
        // value for manual correction rather than guessing a character reversal.
        if (/\)\s*[\d٠-٩۰-۹]+\s*\(/.test(name)) unconfirmed.push("name");
        course = { ...candidate, key:"pdf-course:"+crypto.randomUUID(), unconfirmed };
        courses.push(course);
      }
      // Additional text baselines have uncertain ownership (wrapped content or
      // unfamiliar trailing prose). Reuse the existing field-review contract.
      for (const field of ["name","instructor","section"] as const)
        if (usable.slice(1).some(row => cell(row,field)) && !course.unconfirmed.includes(field)) course.unconfirmed.push(field);
      if (registrationDate && !dateSources.some(row => row.courseKey === course.key && row.sourceText === value("date")))
        dateSources.push({courseKey:course.key,sourceText:value("date"),value:registrationDate});
      let meetingFound = false;
      const meetingRows: PdfTextItem[][] = [];
      const uncertainRooms = new Set<PdfTextItem[]>();
      for (const row of usable) {
        const fragment = cell(row,"time") + " " + cell(row,"day") + " " + cell(row,"start") + " " + cell(row,"end");
        if (!fragment.trim()) {
          if (cell(row,"room") && meetingRows.length) {
            meetingRows.at(-1)!.push(...row); uncertainRooms.add(meetingRows.at(-1)!);
          }
          continue;
        }
        if (!/\d:\d/.test(digits(fragment)) && meetingRows.length) {
          meetingRows.at(-1)!.push(...row);
          if (cell(row,"room")) uncertainRooms.add(meetingRows.at(-1)!);
        }
        else meetingRows.push([...row]);
      }
      // Only a location detached from every meeting can be a shared candidate.
      // Never fill one meeting's missing room from another meeting's own cell.
      const sharedRoom = meetingRows.every(row => !cell(row,"room")) ? value("room") || null : null;
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
        const room = cell(row,"room") || sharedRoom;
        const online = /online|الكتروني|عن بعد/i.test(clean(room ?? "")+" "+clean(timeText));
        const invalidRange = !slot || slot[0] >= slot[1];
        const unknown = [invalidRange && "startTime", invalidRange && "endTime", !weeklyDays.length && "dayOfWeek", (!room || uncertainRooms.has(row) || !cell(row,"room") && !!sharedRoom) && "room", !room && !online && "deliveryMode"].filter((v): v is string => !!v);
        for (const dayOfWeek of weeklyDays.length ? weeklyDays : [0]) {
          sessions.push({ key:"pdf-session:"+crypto.randomUUID(), courseKey:course.key, dayOfWeek, startTime:slot?.[0]??"", endTime:slot?.[1]??"", room, deliveryMode:online?"online":room?"in-person":"", notes:unknown.length ? timeText : null, unconfirmed:[...unknown] });
        }
      }
      if (!meetingFound) sessions.push({key:"pdf-session:"+crypto.randomUUID(),courseKey:course.key,dayOfWeek:0,startTime:"",endTime:"",room:value("room")||null,deliveryMode:"",unconfirmed:["dayOfWeek","startTime","endTime","deliveryMode"]});
    }
  }
  if (!courses.length) throw new PdfImportError("scanned");
  // Never silently discard duplicate slots; analyzeDraft requires their resolution.
  const dateReviews = interpretPdfDates(courses,dateSources);
  return {...base, courses, sessions, weekdayReviews, dateReviews};
}
