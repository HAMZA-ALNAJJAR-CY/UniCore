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

const footerLikeTitles = ["Total Quality Management", "Legend Of Software Design", "نظرية المجموعات", "رموز البرمجة"];

it.each([
  {field:"name",meeting:"day",fragment:"Legend",day:"Mon",expectedDay:1},
  {field:"name",meeting:"time",fragment:"Legend",day:"Mon",expectedDay:1},
  {field:"instructor",meeting:"day",fragment:"Legend",day:"Mon",expectedDay:1},
  {field:"room",meeting:"time",fragment:"Legend",day:"Mon",expectedDay:1},
  {field:"name",meeting:"day",fragment:"رموز",day:"ح",expectedDay:7},
] as const)("D1.2 P2 preserves mixed academic $field/$meeting fragments: $fragment $day",({field,meeting,fragment,day,expectedDay})=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,160),text("Course name",140,160),text("Credits",280,160),
    ...(meeting==="day"?[text("Day",380,160)]:[]),text("Time",500,160),text("Room",740,160),text("Instructor",900,160),
    text("SYN101",0,140),text("Synthetic course",140,140),text("3",280,140),text("09:00-10:00",500,140),text("R-1",740,140),text("Synthetic Teacher",900,140),
    text(fragment,{name:140,instructor:900,room:740}[field],120),text(day,meeting==="day"?380:500,120),
    text(meeting==="day"?"11:00-12:00":"11:00-12:00 Tue",500,100),...(meeting==="day"?[text("Tue",380,100)]:[]),text("R-2",740,100),
  ]}],base());
  expect(draft.courses).toHaveLength(1);
  expect(draft.sessions).toHaveLength(2);
  expect(draft.sessions[0]).toMatchObject({courseKey:draft.courses[0].key,dayOfWeek:expectedDay,startTime:"09:00",endTime:"10:00",room:field==="room"?"R-1 "+fragment:"R-1"});
  expect(draft.sessions[1]).toMatchObject({courseKey:draft.courses[0].key,dayOfWeek:2,startTime:"11:00",endTime:"12:00",room:"R-2"});
  expect(draft.weekdayReviews).toEqual([]);
  if(field==="room")expect(draft.sessions[0].unconfirmed).toContain("room");
  else {
    expect(draft.courses[0][field]).toBe((field==="name"?"Synthetic course":"Synthetic Teacher")+" "+fragment);
    expect(draft.courses[0].unconfirmed).toContain(field);
  }
});

it.each(["legend","total","page"] as const)("D1.2 P2 still excludes structurally separate %s rows",kind=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const footer=kind==="legend"?[text("Legend:",0,70),text("Mon = Monday",380,70),text("Tue = Tuesday",500,70)]
    :kind==="total"?[text("Total credit hours:",0,70),text("3",280,70)]:[text("Page 1 of 1",0,70)];
  const draft=parseTimetablePages([{items:[
    text("Course code",0,160),text("Course name",140,160),text("Credits",280,160),text("Day",380,160),text("Time",500,160),text("Room",740,160),
    text("SYN101",0,140),text("Synthetic course",140,140),text("3",280,140),text("Mon",380,140),text("09:00-10:00",500,140),text("R-1",740,140),
    ...footer,
  ]}],base());
  expect(draft.courses).toHaveLength(1);
  expect(draft.courses[0]).toMatchObject({code:"SYN101",name:"Synthetic course",registeredHours:3});
  expect(draft.sessions).toHaveLength(1);
  expect(draft.sessions[0]).toMatchObject({dayOfWeek:1,startTime:"09:00",endTime:"10:00",room:"R-1"});
  expect(draft.weekdayReviews).toEqual([]);
});

it.each(["Advising information: synthetic notice","معلومات إضافية تجريبية"])("D1.2 flags retained unfamiliar trailing text for review: %s",async(pageFooter)=>{
  const draft=await extract({pageFooter,footerX:120});
  expect(draft.courses).toHaveLength(2);expect(draft.sessions).toHaveLength(3);
  expect(draft.courses[1].name).toBe("Synthetic Lab "+pageFooter);
  expect(draft.courses[1].unconfirmed).toContain("name");
  expect(draft.courses[0].unconfirmed).not.toContain("name");
  expect(analyzeDraft(draft).unconfirmed.some(value=>value.includes(draft.courses[1].name))).toBe(true);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it.each(["name","instructor","room"] as const)("D1.2 preserves footer-like wrapped %s text and subsequent meetings",(field)=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,130),text("Course name",140,130),text("Credits",280,130),text("Time",400,130),text("Room",650,130),text("Instructor",800,130),
    text("SYN101",0,110),text("Synthetic course",140,110),text("3",280,110),text("09:00-10:00 Mon",400,110),text("R-1",650,110),text("Synthetic Teacher",800,110),
    text("Legend",{name:140,instructor:800,room:650}[field],95),
    text("11:00-12:00 Tue",400,75),text("R-2",650,75),
  ]}],base());
  expect(draft.courses).toHaveLength(1);
  expect(draft.sessions.map(session=>session.dayOfWeek)).toEqual([1,2]);
  if(field==="room") {
    expect(draft.sessions[0].room).toBe("R-1 Legend");
    expect(draft.sessions[0].unconfirmed).toContain("room");
    expect(draft.sessions[1].room).toBe("R-2");
  } else {
    expect(draft.courses[0][field]).toBe((field==="name"?"Synthetic course":"Synthetic Teacher")+" Legend");
    expect(draft.courses[0].unconfirmed).toContain(field);
  }
});

it("D1.2 preserves wrapped location text through actual PDF.js extraction",async()=>{
  const draft=await extract({wrappedRoom:true});
  expect(draft.courses).toHaveLength(2);expect(draft.sessions).toHaveLength(3);
  expect(draft.sessions.slice(0,2).map(session=>session.room)).toEqual(["R-101 Level 2","R-101 Level 2"]);
  expect(draft.sessions.slice(0,2).every(session=>session.unconfirmed.includes("room"))).toBe(true);
  expect(draft.sessions[2].room).toBe("online");expect(draft.sessions[2].unconfirmed).not.toContain("room");
});

it("D1.2 does not fill a missing meeting room from a different meeting",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,100),text("Course name",140,100),text("Time",400,100),text("Room",650,100),
    text("SYN101",0,80),text("Synthetic course",140,80),text("09:00-10:00 Mon",400,80),text("R-1",650,80),
    text("11:00-12:00 Tue",400,60),
  ]}],base());
  expect(draft.sessions[0].room).toBe("R-1");
  expect(draft.sessions[1].room).toBeNull();
  expect(draft.sessions[1].unconfirmed).toContain("room");
  expect(draft.sessions[1].deliveryMode).toBe("");
});

it.each(["name","instructor"] as const)("D1.2 retains leading unassigned %s text in an incomplete draft row",async(field)=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,100),text("Course name",140,100),text("Credits",280,100),text("Time",400,100),text("Room",650,100),text("Instructor",800,100),
    text(field==="name"?"Synthetic incomplete course":"Synthetic Teacher",field==="name"?140:800,80),
    text("SYN101",0,55),text("Synthetic complete course",140,55),text("3",280,55),text("09:00-10:00 Mon",400,55),text("R-1",650,55),
  ]}],base());
  expect(draft.courses).toHaveLength(2);
  expect(draft.courses[0][field]).toBe(field==="name"?"Synthetic incomplete course":"Synthetic Teacher");
  expect(draft.courses[0]).toMatchObject({code:"",registeredHours:NaN});
  expect(draft.courses[1]).toMatchObject({code:"SYN101",name:"Synthetic complete course",registeredHours:3});
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("D1.2 keeps a code-only incomplete course separate and blocks acknowledgment of missing required values",async()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,100),text("Course name",140,100),text("Credits",280,100),text("Time",400,100),text("Room",650,100),
    text("SYN101",0,80),text("Synthetic course",140,80),text("3",280,80),text("09:00-10:00 Mon",400,80),text("R-1",650,80),
    text("SYN102",0,55),
  ]}],base());
  expect(draft.courses.map(course=>course.code)).toEqual(["SYN101","SYN102"]);
  expect(draft.courses[1]).toMatchObject({name:"",registeredHours:NaN});
  expect(draft.courses[1].unconfirmed).toEqual(expect.arrayContaining(["name","registeredHours"]));
  expect(draft.sessions[1]).toMatchObject({courseKey:draft.courses[1].key,dayOfWeek:0,startTime:"",endTime:""});
  for(const row of [...draft.courses,...draft.sessions])row.unconfirmed=[];
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  for(const table of db.tables)expect(await table.count()).toBe(0);
  Object.assign(draft.courses[1],{name:"Synthetic corrected course",registeredHours:1});
  Object.assign(draft.sessions[1],{dayOfWeek:2,startTime:"11:00",endTime:"12:00",room:"R-2",deliveryMode:"in-person"});
  const review=await store.reviewTimetable(draft);
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(true);
  const reopened=await store.reopenImportSource(draft.sourceId);
  expect(reopened.courses).toHaveLength(2);expect(reopened.sessions).toHaveLength(2);
  for(const course of reopened.courses)expect(course.id).toBe(review.draft.courses.find(row=>row.code===course.code)!.id);
});

it("D1.2 retains uncertainty in review snapshots and rolls back stale confirmation before a corrected retry",async()=>{
  const draft=await extract({pageFooter:"Synthetic advising notice",footerX:120});
  expect(draft.courses[1].unconfirmed).toContain("name");
  const original=await store.reviewTimetable(draft);
  original.draft.courses[1].name="Synthetic corrected lab";
  expect((await store.saveTimetable(original,confirm(original))).committed).toBe(false);
  for(const table of db.tables)expect(await table.count()).toBe(0);
  draft.courses[1].name="Synthetic corrected lab";draft.courses[1].unconfirmed=[];
  const review=await store.reviewTimetable(draft);
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(true);
  const reopened=await store.reopenImportSource(draft.sourceId);
  expect(reopened.courses.find(course=>course.code==="SYN102")).toMatchObject({id:review.draft.courses[1].id,name:"Synthetic corrected lab",unconfirmed:[]});
});

it.each(footerLikeTitles)("retains legitimate footer-like course titles through PDF.js extraction: %s",async(name)=>{
  const draft=await extract({englishTitle:name,arabicTitle:name,arabic:/\p{Script=Arabic}/u.test(name),shuffled:true,registrationDates:["31-08-2026","05-10-2026"]});
  expect(draft.courses.map(course=>course.code)).toEqual(["SYN101","SYN102"]);
  expect(draft.courses[0]).toMatchObject({name,registeredHours:3,section:"2",registrationDate:"2026-08-31"});
  expect(draft.courses[1].registrationDate).toBe("2026-10-05");
  expect(draft.sessions.filter(session=>session.courseKey===draft.courses[0].key)).toEqual([
    expect.objectContaining({dayOfWeek:7,startTime:"09:00",endTime:"10:00",room:"R-101"}),
    expect.objectContaining({dayOfWeek:2,startTime:"09:00",endTime:"10:00",room:"R-101"}),
  ]);
  expect(draft.sessions).toHaveLength(3);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it.each(footerLikeTitles)("keeps footer-like wrapped title content and following courses: %s",(name)=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,100),text("Course name",140,100),text("Time",400,100),
    text("SYN101",0,80),text("Synthetic",140,80),text("09:00-10:00 Mon",400,80),
    text(name,140,66),
    text("SYN102",0,45),text("Next course",140,45),text("11:00-12:00 Tue",400,45),
  ]}],base());
  expect(draft.courses.map(course=>course.name)).toEqual(["Synthetic "+name,"Next course"]);
  expect(draft.sessions.map(session=>[session.courseKey,session.dayOfWeek,session.startTime])).toEqual([
    [draft.courses[0].key,1,"09:00"],[draft.courses[1].key,2,"11:00"],
  ]);
});

it.each([
  "Total credit hours: 4", "مجموع الساعات المسجلة: ٤ ساعة / ساعات",
  "Legend: Sun = Sunday; Tue = Tuesday", "رموز الأيام: ح = الأحد؛ ث = الثلاثاء", "Day codes: Mon = Monday",
])("excludes complete summary and weekday-legend footer rows: %s",async(pageFooter)=>{
  const draft=await extract({pageFooter});
  expect(draft.courses).toHaveLength(2);expect(draft.sessions).toHaveLength(3);
  expect(draft.courses[1]).toMatchObject({code:"SYN102",name:"Synthetic Lab",section:"1",registeredHours:1,instructor:"Synthetic Instructor"});
  expect(draft.sessions[2]).toMatchObject({courseKey:draft.courses[1].key,dayOfWeek:1,startTime:"12:00",endTime:"14:00",room:"online"});
  expect(draft.weekdayReviews).toEqual([]);
});

it("classifies split total cells without importing a fake course or trailing legend rows",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:50,height:10,dir:"ltr"});
  const draft=parseTimetablePages([{items:[
    text("Course code",0,130),text("Course name",140,130),text("Credits",300,130),text("Time",450,130),
    text("SYN101",0,110),text("Total Quality Management",140,110),text("3",300,110),text("09:00-10:00 Mon",450,110),
    text("SYN102",0,90),text("Legend Of Software Design",140,90),text("1",300,90),text("11:00-12:00 Tue",450,90),
    text("Total credit hours:",0,70),text("4",300,70),
    text("Legend",140,55),text("Sun = Sunday",450,40),
  ]}],base());
  expect(draft.courses.map(course=>[course.code,course.name,course.registeredHours])).toEqual([
    ["SYN101","Total Quality Management",3],["SYN102","Legend Of Software Design",1],
  ]);
  expect(draft.sessions.map(session=>session.dayOfWeek)).toEqual([1,2]);
  expect(draft.weekdayReviews).toEqual([]);
});

it.each(["2038-09-01","31-08-2026"])("reuses one course for repeated meeting rows with the identical date %s",async(date)=>{
  const draft=await extract({registrationDates:[date,"2038-10-02"],repeatedCourseDates:[date]});
  expect(draft.courses).toHaveLength(2);expect(draft.sessions).toHaveLength(4);
  const course=draft.courses.find(row=>row.code==="SYN101")!;
  expect(course.registrationDate).toBe(date==="31-08-2026"?"2026-08-31":date);
  expect(draft.sessions.filter(row=>row.courseKey===course.key).map(row=>row.dayOfWeek)).toEqual([7,2,3]);
  expect(draft.dateReviews!.filter(row=>row.courseKey===course.key)).toEqual([expect.objectContaining({sourceText:date})]);
  const review=await store.reviewTimetable(draft);
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(true);
  const reopened=await store.reopenImportSource(draft.sourceId);
  expect(reopened.courses).toHaveLength(2);expect(reopened.sessions).toHaveLength(4);
  expect(reopened.courses.find(row=>row.code==="SYN101")!.id).toBe(review.draft.courses.find(row=>row.code==="SYN101")!.id);
});

it.each([
  {dates:["2038-09-01","2038-09-02"],expected:["2038-09-01","2038-09-02"]},
  {dates:["31-08-2026","05-10-2026"],expected:["2026-08-31","2026-10-05"]},
])("blocks contradictory dates on repeated course rows instead of choosing either value: $dates",async({dates,expected})=>{
  const draft=await extract({registrationDates:[dates[0],"2038-10-02"],repeatedCourseDates:[dates[1]]});
  const rows=draft.courses.filter(row=>row.code==="SYN101");
  // Raw registrationDate participates in parser equality, before date inference.
  // Divergent values cannot share a key or repeatedly overwrite one course.
  expect(rows).toHaveLength(2);expect(new Set(rows.map(row=>row.key)).size).toBe(2);
  expect(rows.map(row=>row.registrationDate)).toEqual(expected);
  rows.forEach((row,index)=>{
    expect(draft.dateReviews!.filter(review=>review.courseKey===row.key)).toEqual([expect.objectContaining({sourceText:dates[index]})]);
    expect(draft.sessions.filter(session=>session.courseKey===row.key).map(session=>session.dayOfWeek)).toEqual(index===0?[7,2]:[3]);
  });
  const unaffected=draft.courses.find(row=>row.code==="SYN102")!;
  expect(unaffected.registrationDate).toBe("2038-10-02");
  expect(draft.dateReviews!.filter(row=>row.courseKey===unaffected.key)).toEqual([expect.objectContaining({sourceText:"2038-10-02",status:"iso"})]);
  for(const row of draft.courses)row.unconfirmed=[];
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION",message:expect.stringContaining("SYN101")});
  // Omitting dates alone must not turn the two ambiguous course rows into
  // independently savable records; explicit course/meeting resolution is needed.
  for(const row of rows)row.registrationDate=null;
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION",message:expect.stringContaining("SYN101")});
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("retains distinct original digit forms only when they denote the same raw course date",async()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const page=(date:string,day:string)=>({items:[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),text("Registration date",600,100),text("SYN101",0,70),text("Synthetic",120,70),text("09:00-10:00 "+day,300,70),text(date,600,70)]});
  const draft=parseTimetablePages([page("٣١-٠٨-٢٠٢٦","Mon"),page("31-08-2026","Wed")],base());
  expect(draft.courses).toHaveLength(1);expect(draft.courses[0].registrationDate).toBe("2026-08-31");
  expect(draft.dateReviews!.map(row=>row.sourceText)).toEqual(["٣١-٠٨-٢٠٢٦","31-08-2026"]);
  expect(draft.dateReviews!.every(row=>row.courseKey===draft.courses[0].key&&row.status==="inferred-dmy")).toBe(true);
  expect(draft.sessions.map(row=>row.courseKey)).toEqual([draft.courses[0].key,draft.courses[0].key]);
});

it("rolls back explicit duplicate-date resolution atomically before a successful retry",async()=>{
  const draft=await extract({registrationDates:["31-08-2026","2038-10-02"],repeatedCourseDates:["05-10-2026"]});
  await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  const excluded=draft.courses[1].key;
  draft.courses=draft.courses.filter(row=>row.key!==excluded);
  draft.sessions=draft.sessions.filter(row=>row.courseKey!==excluded);
  draft.dateReviews=draft.dateReviews!.filter(row=>row.courseKey!==excluded);
  draft.courses[0].registrationDate=null; // explicit omission, not parser inference
  const review=await store.reviewTimetable(draft);
  const failure=vi.spyOn(db.table("importMappings"),"put").mockRejectedValueOnce(new DOMException("full","QuotaExceededError"));
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(false);
  for(const table of db.tables)expect(await table.count()).toBe(0);
  failure.mockRestore();
  const retry=await store.reviewTimetable(draft);
  expect((await store.saveTimetable(retry,confirm(retry))).committed).toBe(true);
  const reopened=await store.reopenImportSource(draft.sourceId);
  expect(reopened.courses).toHaveLength(2);
  expect(reopened.courses.map(row=>[row.code,row.registrationDate])).toEqual(expect.arrayContaining([["SYN101",null],["SYN102","2038-10-02"]]));
  expect(reopened.sessions).toHaveLength(3);
  for(const course of reopened.courses)expect(course.id).toBe(retry.draft.courses.find(row=>row.code===course.code)!.id);
});

it("preserves seven synthetic course dates and fifteen meetings under the established day-first format",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const counts=[1,2,3,3,2,1,3];
  const pages=counts.map((count,index)=>({items:[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),text("Registration date",600,100),
    text("SYN"+(index+1),0,70),text("Synthetic "+(index+1),120,70),text("09:00-10:00 "+["Sun","Tue","Thu"].slice(0,count).join(" "),300,70),text(index<5?"31-08-2026":"05-10-2026",600,70)]}));
  const draft=parseTimetablePages(pages,base());
  expect(draft.courses).toHaveLength(7);expect(draft.sessions).toHaveLength(15);
  expect(draft.courses.map(row=>row.registrationDate)).toEqual([...Array(5).fill("2026-08-31"),...Array(2).fill("2026-10-05")]);
  draft.courses.forEach((course,index)=>{
    expect(draft.sessions.filter(row=>row.courseKey===course.key)).toHaveLength(counts[index]);
    expect(draft.dateReviews!.filter(row=>row.courseKey===course.key)).toEqual([expect.objectContaining({sourceText:index<5?"31-08-2026":"05-10-2026",status:"inferred-dmy"})]);
  });
});

it("infers document-wide day-month-year from valid unambiguous evidence through actual PDF.js extraction",async()=>{
  const draft=await extract({registrationDates:["31-08-2026","05-10-2026"]});
  expect(draft.courses.map(c=>c.registrationDate)).toEqual(["2026-08-31","2026-10-05"]);
  expect(draft.courses.every(c=>!c.unconfirmed.includes("registrationDate"))).toBe(true);
});

it("keeps aligned close independent PDF rows and their own meetings separate",async()=>{
  const draft=await extract({rowGap:6});
  expect(draft.courses.map(c=>c.code)).toEqual(["SYN101","SYN102"]);
  expect(draft.courses.map(c=>c.registeredHours)).toEqual([3,1]);
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[0].key).map(s=>s.startTime)).toEqual(["09:00","09:00"]);
  expect(draft.sessions.filter(s=>s.courseKey===draft.courses[1].key)).toEqual([expect.objectContaining({dayOfWeek:1,startTime:"12:00",endTime:"14:00",room:"online"})]);
});

it("fails closed when close PDF course anchors have overlapping mixed-baseline windows",async()=>{
  await expect(extract({rowGap:6,offsetRows:true})).rejects.toMatchObject({reason:"scanned"});
});

it("preserves wrapped Arabic course and instructor cells with offset meeting baselines",async()=>{
  const draft=await extract({arabic:true,wrappedArabic:true,offsetRows:true});
  expect(draft.courses[0]).toMatchObject({name:"مقرر تجريبي عنوان مكمل",instructor:"مدرس تجريبي اسم إضافي",registeredHours:3,section:"2"});
  expect(draft.courses[1].instructor).toBe("Synthetic Instructor");
  expect(draft.sessions).toHaveLength(3);
});

it.each([
  {dates:["05-10-2026","06-11-2026"],expected:["05-10-2026","06-11-2026"],status:["ambiguous","ambiguous"]},
  {dates:["31-08-2026","08-31-2026"],expected:["31-08-2026","08-31-2026"],status:["conflicting","conflicting"]},
  {dates:["2026-08-31","05-10-2026"],expected:["2026-08-31","05-10-2026"],status:["iso","ambiguous"]},
  {dates:["31-02-2026","05-10-2026"],expected:["31-02-2026","05-10-2026"],status:["invalid","ambiguous"]},
  {dates:["29-02-1900","29-02-2000"],expected:["29-02-1900","2000-02-29"],status:["invalid","inferred-dmy"]},
  {dates:["2026-02-29","2028-02-29"],expected:["2026-02-29","2028-02-29"],status:["invalid","iso"]},
  {dates:["31-08-2026","2026-10-05"],expected:["2026-08-31","2026-10-05"],status:["inferred-dmy","iso"]},
])("keeps date evidence and refuses guessing/invalid calendars: $dates",async({dates,expected,status})=>{
  const draft=await extract({registrationDates:dates});
  expect(draft.courses.map(c=>c.registrationDate)).toEqual(expected);
  expect(draft.dateReviews!.map(r=>r.sourceText)).toEqual(dates);
  expect(draft.dateReviews!.map(r=>r.status)).toEqual(status);
  draft.courses.forEach((course,i)=>expect(course.unconfirmed.includes("registrationDate")).toBe(status[i]!=="iso"&&status[i]!=="inferred-dmy"));
  if(status.some(s=>s==="invalid"||s==="ambiguous"||s==="conflicting")) {
    for(const course of draft.courses)course.unconfirmed=[];
    await expect(store.reviewTimetable(draft)).rejects.toMatchObject({code:"VALIDATION"});
  }
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("uses valid evidence across pages and retains Arabic date source text",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const page=(code:string,date:string)=>({items:[text("Course code",0,100),text("Course name",120,100),text("Time",300,100),text("Registration date",600,100),text(code,0,70),text("Synthetic",120,70),text("09:00-10:00 Mon",300,70),text(date,600,70)]});
  const draft=parseTimetablePages([page("SYN1","٠٥-١٠-٢٠٢٦"),page("SYN2","٣١-٠٨-٢٠٢٦")],base());
  expect(draft.courses.map(c=>c.registrationDate)).toEqual(["2026-10-05","2026-08-31"]);
  expect(draft.dateReviews![0].sourceText).toBe("٠٥-١٠-٢٠٢٦");
});

it("rejects an offset meeting whose closely spaced course parent cannot be determined",()=>{
  const text=(text:string,x:number,y:number):PdfTextItem=>({text,x,y,width:45,height:10,dir:"ltr"});
  const items=[text("Course code",0,100),text("Course name",120,100),text("Credits",230,100),text("Time",330,100),
    text("SYN1",0,80),text("Synthetic A",120,80),text("3",230,80),
    text("09:00-10:00 Mon",330,77),
    text("SYN2",0,74),text("Synthetic B",120,74),text("3",230,74)];
  expect(()=>parseTimetablePages([{items}],base())).toThrow(expect.objectContaining({reason:"scanned"}));
});

it("keeps date evidence in independent review snapshots and rejects stale evidence before writing",async()=>{
  const draft=await extract({registrationDates:["31-08-2026","05-10-2026"]});
  const review=await store.reviewTimetable(draft);
  draft.dateReviews![0].sourceText="Changed caller-owned draft";
  expect(review.draft.dateReviews![0].sourceText).toBe("31-08-2026");
  review.draft.dateReviews![0].sourceText="Changed reviewed evidence";
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(false);
  for(const table of db.tables)expect(await table.count()).toBe(0);
});

it("preserves saved registration-date edits, UUID associations and mappings when the same source is re-imported",async()=>{
  const options={registrationDates:["31-08-2026","05-10-2026"]};
  const review=await store.reviewTimetable(await extract(options));
  expect((await store.saveTimetable(review,confirm(review))).committed).toBe(true);
  const course=review.draft.courses[0];
  const edited=await store.courses.update(course.id!,{registrationDate:"2026-12-17"},1);
  const originalMappings=await db.table<ImportMapping>("importMappings").toArray();
  const incoming=await extractTimetablePdf(new File([syntheticTimetablePdf(options)],"same.pdf"),await store.reopenImportSource(review.draft.sourceId),new AbortController().signal);
  const again=await store.reviewTimetable(incoming);
  expect(again.differences.some(row=>row.fields.some(field=>field.incoming==="2026-08-31"&&field.existing==="2026-12-17"))).toBe(true);
  expect((await store.saveTimetable(again,confirm(again))).committed).toBe(true);
  expect(await store.courses.get(course.id!)).toEqual(edited);
  const mappings=await db.table<ImportMapping>("importMappings").toArray();
  for(const original of originalMappings)expect(mappings.find(row=>row.key===original.key)).toEqual(original);
  const saved=await store.getTimetable();expect(saved.courses).toHaveLength(2);expect(saved.sessions).toHaveLength(3);
  expect(saved.courses.every(row=>!("dateReviews" in row))).toBe(true);expect(db.verno).toBe(3);
});

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
