// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { extractTimetablePdf } from "../features/timetable/pdf";
import { parseTimetablePages, type PdfTextItem } from "../features/timetable/pdf-layout";
import { emptyDraft, analyzeDraft } from "../features/timetable/draft";
import { syntheticTimetablePdf } from "./fixtures/pdf";
import { UniCoreDatabase } from "../data/database";
import { AcademicStore } from "../data/store";
import type { TimetableReview, ImportMapping } from "../data";

beforeAll(async()=>{
  // Real PDF.js parser in Node; browsers use the bundled worker thread.
  // @ts-expect-error PDF.js ships worker runtime without a declaration module.
  Object.assign(globalThis,{pdfjsWorker:await import("pdfjs-dist/legacy/build/pdf.worker.mjs")});
});
let db:UniCoreDatabase,store:AcademicStore;
beforeEach(()=>{db=new UniCoreDatabase("pdf-import-"+crypto.randomUUID());store=new AcademicStore(db);});
afterEach(async()=>{vi.restoreAllMocks();store.close();await db.delete();});
const base=()=>({...emptyDraft(),term:{key:"term",name:"Synthetic term",academicYear:"2038/2039",semester:1,unconfirmed:[]}});
const confirm=(r:TimetableReview)=>({confirmed:true,keepExistingKeys:r.differences.map(d=>d.key)});
async function extract(options={}) {return extractTimetablePdf(new File([syntheticTimetablePdf(options)],"synthetic.pdf",{type:"application/pdf"}),base(),new AbortController().signal);}

it("keeps offset meeting baselines bound to their own course through real PDF extraction",async()=>{
  const draft=await extract({offsetRows:true});
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[0].key)).toEqual([
    expect.objectContaining({dayOfWeek:7,startTime:"09:00",endTime:"10:00",room:"R-101"}),
    expect.objectContaining({dayOfWeek:2,startTime:"09:00",endTime:"10:00",room:"R-101"}),
  ]);
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[1].key)).toEqual([expect.objectContaining({dayOfWeek:1,startTime:"12:00",endTime:"14:00",room:"online"})]);
},20000);

it("reads Arabic credit and lecturer columns separately from section and room in a real PDF",async()=>{
  const draft=await extract({arabicHeaders:true});
  expect(draft.courses[0]).toMatchObject({registeredHours:3,section:"2",instructor:"Synthetic Teacher"});
  expect(draft.courses[1]).toMatchObject({registeredHours:1,section:"1",instructor:"Synthetic Instructor"});
  expect(draft.sessions[0].room).toBe("R-101");
});

it("extracts underscore-separated times without swapping endpoints or swallowing unknown weekdays",async()=>{
  const draft=await extract({underscoreTimes:true,weekdayText:"Sun Tue X"});
  expect(draft.sessions[0]).toMatchObject({startTime:"09:00",endTime:"10:00"});
  expect(draft.weekdayReviews![0].unknownTokens).toEqual(["X"]);
  expect(analyzeDraft(draft).errors.length).toBeGreaterThan(0);
});

it.each(["Page 1 of 1","الصفحة 1 من1"])("excludes a page footer from the final course's academic fields: %s",async(pageFooter)=>{
  const draft=await extract({pageFooter});
  expect(draft.courses[1].section).toBe("1");
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[1].key)).toHaveLength(1);
});

it("normalizes presentation forms but retains and flags reversed numeric title brackets for human review",async()=>{
  const draft=await extract({arabic:true,arabicTitle:"ﻣﻘﺮﺭ ﺗﺠﺮﻳﺒﻲ )2("});
  expect(draft.courses[0].name).toBe("مقرر تجريبي )2(");
  expect(draft.courses[0].unconfirmed).toContain("name");
});

it("does not execute a PDF document's JavaScript open action",async()=>{
  const globals=globalThis as typeof globalThis & {__unicorePdfScriptExecuted?:boolean};
  delete globals.__unicorePdfScriptExecuted;
  const draft=await extract({pdfScript:true});
  expect(draft.courses).toHaveLength(2);
  expect(globals.__unicorePdfScriptExecuted).toBeUndefined();
});

function dayCell(dayText:string, separate=true) {
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  return parseTimetablePages([{items:[
    text("Course code",0,100),text("Course name",120,100),text("Credits",230,100),text("Time",330,100),...(separate?[text("Day",500,100)]:[]),text("Room",620,100),
    text("SYN123",0,70),text("Synthetic",120,70),text("3",230,70),text(separate?"09:00-10:00":"09:00-10:00 "+dayText,330,70),...(separate?[text(dayText,500,70)]:[]),text("R1",620,70),
  ]}],base());
}

it("blocks confirmation of mixed known and unknown weekdays instead of silently losing meeting information",async()=>{
  const draft=dayCell("ح ث X");
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([7,2]);
  expect(analyzeDraft(draft).errors.length).toBeGreaterThan(0);
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it.each([
  ["ح ث",[7,2]], ["س ن ر خ ج",[6,1,3,4,5]],
  ["الأحد الاثنين الثلاثاء الأربعاء الخميس الجمعة السبت",[7,1,2,3,4,5,6]],
  ["Sunday MON tuesday Wed Thursday Fri Saturday",[7,1,2,3,4,5,6]],
  ["Sun|Tue؛Wed،Thu / Fri • Sat_ Mon",[7,2,3,4,5,6,1]],
  ["(Sun-Tue) 09:00–10:00 وجا online in-person",[7,2]],
] as const)("recognizes weekday forms and separators without spurious uncertainty: %s",(text,expected)=>{
  const draft=dayCell(text);
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual(expected);
  expect(draft.weekdayReviews).toEqual([]);
  expect(analyzeDraft(draft).errors).toEqual([]);
});

it("preserves original mixed text and every unknown token without inventing an extra session",()=>{
  const sourceText="ح؛ ث | X / ZZ";
  const draft=dayCell(sourceText);
  expect(draft.weekdayReviews).toEqual([expect.objectContaining({sourceText,unknownTokens:["X","ZZ"],recognizedDays:[7,2],acknowledged:false,courseKey:draft.courses[0].key})]);
  expect(draft.sessions).toHaveLength(2);
  for(const row of [...draft.courses,...draft.sessions])row.unconfirmed=[];
  expect(analyzeDraft(draft).errors).not.toEqual([]);
  expect(dayCell("Mon constructor").weekdayReviews![0].unknownTokens).toEqual(["constructor"]);
});

it("preserves the original day-cell presentation forms while normalizing weekday recognition",()=>{
  const sourceText="ﺡ ﺙ X";
  const draft=dayCell(sourceText);
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([7,2]);
  expect(draft.weekdayReviews![0].sourceText).toBe(sourceText);
});

it("keeps entirely unknown days invalid even after acknowledgment, until a valid manual correction",async()=>{
  const draft=dayCell("X ZZ");
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([0]);
  expect(draft.sessions[0].unconfirmed).toContain("dayOfWeek");
  draft.weekdayReviews![0].acknowledged=true;
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  draft.sessions[0].dayOfWeek=3;
  expect((await store.reviewTimetable(draft)).draft.sessions[0].dayOfWeek).toBe(3);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("does not interpret time numbers or attendance annotations as weekday tokens",()=>{
  for(const text of ["09:00–10:00", "٠٩:٠٠–١٠:٠٠", "09:00-10:00 online عن بعد وجا"]){
    const draft=dayCell(text);
    expect(draft.weekdayReviews).toEqual([]);
    expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([0]);
    expect(analyzeDraft(draft).errors).not.toEqual([]);
  }
  const draft=dayCell("Mon online وجا",false);
  expect(draft.sessions[0]).toMatchObject({dayOfWeek:1,startTime:"09:00",endTime:"10:00"});
  expect(draft.weekdayReviews).toEqual([]);
});

it("requires fresh acknowledgment on extraction and persists only corrected valid academic meetings",async()=>{
  const draft=await extract({weekdayText:"Sun Tue X"});
  expect(draft.weekdayReviews![0]).toMatchObject({sourceText:"09:00-10:00 Sun Tue X",unknownTokens:["X"],recognizedDays:[7,2],acknowledged:false});
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  draft.weekdayReviews![0].acknowledged=true;
  const invalid=structuredClone(draft);invalid.courses[0].code="";
  await expect(store.reviewTimetable(invalid)).rejects.toMatchObject({code:"VALIDATION"});
  const badTime=structuredClone(draft);badTime.sessions[0].endTime="08:00";
  await expect(store.reviewTimetable(badTime)).rejects.toMatchObject({code:"VALIDATION"});
  const r=await store.reviewTimetable(draft);
  expect((await store.saveTimetable(r,confirm(r))).committed).toBe(true);
  expect((await store.getTimetable()).sessions).toHaveLength(3);
  for(const table of db.tables)for(const row of await table.toArray())expect(row).not.toHaveProperty("weekdayReviews");
  const reopened=await store.reopenImportSource(draft.sourceId);
  expect(reopened.weekdayReviews).toBeUndefined();
  const again=await extractTimetablePdf(new File([syntheticTimetablePdf({weekdayText:"Sun Tue X"})],"again.pdf",{type:"application/pdf"}),r.draft,new AbortController().signal);
  expect(again.weekdayReviews).toHaveLength(1);
  expect(again.weekdayReviews![0].acknowledged).toBe(false);
  const clear=await extractTimetablePdf(new File([syntheticTimetablePdf()],"clear.pdf",{type:"application/pdf"}),r.draft,new AbortController().signal);
  expect(clear.weekdayReviews).toEqual([]);
});

it("extracts a genuine text PDF with disordered content and multiple sessions without persisting PII or writing",async()=>{
  const draft=await extract({shuffled:true});
  expect(draft.courses).toHaveLength(2);expect(draft.sessions).toHaveLength(3);
  expect(draft.courses[0]).toMatchObject({code:"SYN101",name:"Synthetic Algebra",registeredHours:3,section:"2",instructor:"Synthetic Teacher",registrationDate:"2038-09-01",activityType:"theory"});
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[0].key).map(s=>s.dayOfWeek).sort()).toEqual([2,7]);
  expect(draft.courses[1].activityType).toBe("lab");expect(draft.sessions[2].deliveryMode).toBe("online");
  expect(JSON.stringify(draft)).not.toMatch(/Student|00000000/);
  expect(analyzeDraft(draft).errors).toEqual([]);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});
it("extracts mixed Arabic/English from a real Unicode-mapped PDF",async()=>{
  const draft=await extract({arabic:true,shuffled:true});
  expect(draft.courses[0].name).toMatch(/مقرر/);expect(draft.courses[1].code).toBe("SYN102");
});
it.each([{name:"wrong.txt",type:"text/plain",bytes:new Uint8Array([1])},{name:"broken.pdf",type:"application/pdf",bytes:new TextEncoder().encode("nonsense")},{name:"broken.pdf",type:"application/pdf",bytes:new TextEncoder().encode("%PDF-1.7\nbroken")}])("rejects malformed/type-invalid PDFs ($name)",async({name,type,bytes})=>{
  await expect(extractTimetablePdf(new File([bytes],name,{type}),base(),new AbortController().signal)).rejects.toMatchObject({reason:expect.stringMatching(/invalid|malformed/)});
});
it("rejects image-only/no-text PDFs rather than fabricating rows",async()=>{
  await expect(extract({empty:true})).rejects.toMatchObject({reason:"scanned"});
  await expect(extract({scanned:true})).rejects.toMatchObject({reason:"scanned"});
});
it("rejects oversized files and already-cancelled work",async()=>{
  await expect(extractTimetablePdf(new File([new Uint8Array(10*1024*1024+1)],"large.pdf"),base(),new AbortController().signal)).rejects.toMatchObject({reason:"invalid"});
  const c=new AbortController();c.abort();await expect(extractTimetablePdf(new File([syntheticTimetablePdf()],"x.pdf"),base(),c.signal)).rejects.toMatchObject({name:"AbortError"});
});
it("saves preview edits through the existing transaction, preserves user edits/aliases and supports repeated re-import",async()=>{
  const draft=await extract();draft.courses[0].name="Edited preview";
  const first=await store.reviewTimetable(draft);expect((await store.saveTimetable(first,confirm(first))).committed).toBe(true);
  const saved=first.draft;await store.scheduleSessions.update(saved.sessions[0].id!,{startTime:"08:30"},1);
  const lecture=await store.lectures.create({courseId:saved.courses[0].id!,scheduleSessionId:saved.sessions[0].id!,date:"2038-09-02"});
  const attachment=await store.lectureFiles.create({lectureId:lecture.id,fileName:"synthetic.txt",blob:new Blob([new Uint8Array([0,255,17,33])])});
  const material=await store.materials.create({courseId:saved.courses[0].id!,title:"Synthetic material"});
  const materialFile=await store.materialFiles.create({materialId:material.id,fileName:"synthetic.bin",blob:new Blob([new Uint8Array([7,8,9])])});
  const originalMappings=await db.table<ImportMapping>("importMappings").toArray();
  const edited=await db.records("scheduleSessions").get(saved.sessions[0].id!);
  const source=await store.reopenImportSource(saved.sourceId);
  const incoming=await extractTimetablePdf(new File([syntheticTimetablePdf()],"again.pdf"),source,new AbortController().signal);
  // Changed time cannot silently match: explicitly select the intended saved identity.
  await expect(store.reviewTimetable(incoming)).rejects.toMatchObject({code:"CONFLICT"});
  incoming.sessions[0].id=saved.sessions[0].id;
  const review=await store.reviewTimetable(incoming);expect(review.differences.some(d=>d.fields.some(f=>f.existing==="08:30"))).toBe(true);
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(true);
  expect(await db.records("scheduleSessions").get(saved.sessions[0].id!)).toEqual(edited);
  const mappings=await db.table<ImportMapping>("importMappings").toArray();
  for(const original of originalMappings)expect(mappings.find(m=>m.key===original.key)).toEqual(original);
  expect(await store.lectures.get(lecture.id)).toEqual(lecture);
  const file=await store.lectureFiles.get(attachment.id);expect(file).toEqual(attachment);expect([...new Uint8Array(await file!.blob.arrayBuffer())]).toEqual([0,255,17,33]);
  const binary=await store.materialFiles.get(materialFile.id);expect(binary).toEqual(materialFile);expect([...new Uint8Array(await binary!.blob.arrayBuffer())]).toEqual([7,8,9]);
  const again=await store.reviewTimetable(await store.reopenImportSource(saved.sourceId));
  expect((await store.saveTimetable(again,confirm(again))).committed).toBe(true);
  expect(await db.table("importMappings").toArray()).toEqual(mappings);
  expect((await store.getTimetable()).courses).toHaveLength(2);expect((await store.getTimetable()).sessions).toHaveLength(3);
});
it("does not resurrect removed identities; F-02 reopen and F-01 explicit restoration remain compatible",async()=>{
  const r=await store.reviewTimetable(await extract());await store.saveTimetable(r,confirm(r));
  const course=r.draft.courses[0];await store.deleteManagedCourse(course.id!,1,await store.courses.previewDelete(course.id!));
  const deleted=await db.records("courses").get(course.id!);const mappings=await db.table("importMappings").toArray();
  const reopened=await store.reopenImportSource(r.draft.sourceId);expect(reopened.omittedDeletedRows).toHaveLength(3);
  const incoming=await extractTimetablePdf(new File([syntheticTimetablePdf()],"again.pdf"),reopened,new AbortController().signal);
  await expect(store.reviewTimetable(incoming)).rejects.toMatchObject({code:"CONFLICT"});
  expect(await db.records("courses").get(course.id!)).toEqual(deleted);expect(await db.table("importMappings").toArray()).toEqual(mappings);
  const preview=await store.previewCourseRestore(course.id!);await store.restoreCourse(course.id!,deleted!.revision,preview.snapshot);
  expect((await store.reopenImportSource(r.draft.sourceId)).courses).toHaveLength(2);
  expect((await store.getTimetable()).sessions).toHaveLength(1);
});
it("rolls back all academic/mapping writes if PDF confirmation fails at storage",async()=>{
  const r=await store.reviewTimetable(await extract());vi.spyOn(db.table("importMappings"),"put").mockRejectedValueOnce(new DOMException("full","QuotaExceededError"));
  expect((await store.saveTimetable(r,confirm(r))).committed).toBe(false);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("groups positioned Arabic headers/days, wrapped cells and missing fields conservatively",()=>{
  const item=(text:string,x:number,y:number,dir="rtl"):PdfTextItem=>({text,x,y,width:50,height:10,dir});
  const items=[item("رقم المقرر",900,700),item("اسم المقرر",780,700),item("النشاط",660,700),item("س",580,700),item("الشعبة",500,700),item("الوقت",360,700),item("القاعة",220,700),item("اسم المدرس",80,700),
    item("SYN123",900,660,"ltr"),item("مقرر",780,660),item("مختبر",660,660),item("١",580,660),item("٢",500,660),item("09:00-10:00 ح - ث",360,660,"ltr"),item("online",220,660,"ltr"),item("تجريبي",780,645)];
  const draft=parseTimetablePages([{items:items.reverse()}],base());
  expect(draft.courses[0]).toMatchObject({name:"مقرر تجريبي",registeredHours:1,section:"2",activityType:"lab",instructor:null});
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([7,2]);
  expect(draft.courses[0].unconfirmed).toContain("instructor");expect(draft.courses[0].registrationDate).toBeNull();
});
it("does not silently correct reversed times or discard duplicate meetings",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const items=[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),text("SYN123",0,80),text("Synthetic",120,80),text("10:00-09:00 Mon Mon",300,80)];
  const draft=parseTimetablePages([{items}],base());expect(draft.sessions[0]).toMatchObject({startTime:"10:00",endTime:"09:00"});expect(draft.sessions[0].unconfirmed).toEqual(expect.arrayContaining(["startTime","endTime"]));expect(analyzeDraft(draft).errors.length).toBeGreaterThan(0);
});

it("preserves old optional-field absence and validates new registration dates without a database version change",async()=>{
  const term=await store.academicTerms.create({name:"Synthetic legacy term",academicYear:"2037/2038",semester:1});
  const course=await store.courses.create({academicTermId:term.id,code:"OLD101",name:"Old synthetic course",registeredHours:1});
  const before=await db.records("courses").get(course.id);
  expect((await store.getTimetable(term.id)).courses[0]).toEqual(before);expect(before).not.toHaveProperty("registrationDate");
  await expect(store.courses.update(course.id,{registrationDate:"2038-02-31"},1)).rejects.toMatchObject({code:"VALIDATION"});
  expect(await db.records("courses").get(course.id)).toEqual(before);expect(db.verno).toBe(3);
  const updated=await store.courses.update(course.id,{registrationDate:"2038-09-01",activityType:"lab"},1);
  expect(updated).toMatchObject({id:course.id,registrationDate:"2038-09-01",activityType:"lab",revision:2});
});

it("keeps missing and wrapped meeting fields unresolved rather than guessing delivery or silently dropping a page",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const items=[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),text("SYN123",0,80),text("Synthetic",120,80),text("09:00-10:00",300,80),text("Mon Wed",300,66)];
  const draft=parseTimetablePages([{items}],base());
  expect(draft.sessions.map(s=>s.dayOfWeek)).toEqual([1,3]);expect(draft.sessions[0].deliveryMode).toBe("");
  expect(analyzeDraft(draft).errors.length).toBeGreaterThan(0);
  expect(()=>parseTimetablePages([{items},{items:[]}],base())).toThrow();
});

it("retains exact duplicate meetings for explicit exclusion rather than duplicating course identities or silently deduplicating",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const items=[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),
    text("SYN123",0,80),text("Synthetic",120,80),text("09:00-10:00 Mon",300,80),
    text("SYN123",0,60),text("Synthetic",120,60),text("09:00-10:00 Mon",300,60)];
  const draft=parseTimetablePages([{items}],base());expect(draft.courses).toHaveLength(1);expect(draft.sessions).toHaveLength(2);
  expect(draft.sessions.every(s=>s.courseKey===draft.courses[0].key)).toBe(true);
  expect(analyzeDraft(draft).errors.some(e=>e.includes("09:00"))).toBe(true);
});

it("recognizes wrapped column headers without consuming a nearby first academic row",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const columns=[text("Course",0,100),text("Course",120,100),text("Time",300,100),text("code",0,88),text("name",120,88)];
  const body=[text("SYN123",0,76),text("Synthetic",120,76),text("09:00-10:00 Mon",300,76)];
  expect(parseTimetablePages([{items:[...columns,...body]}],base()).courses[0].code).toBe("SYN123");
  const close=[text("Course code",0,90),text("Course name",120,90),text("Time",300,90),...body];
  expect(parseTimetablePages([{items:close}],base()).courses).toHaveLength(1);
});
