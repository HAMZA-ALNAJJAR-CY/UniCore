import "fake-indexeddb/auto";
import { File as NodeFile } from "node:buffer";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { UniCoreDatabase } from "../data/database";
import { createAcademicStore, type TimetableDraft } from "../data";
import { TimetableImport } from "../pages/TimetableImport";
import { Courses } from "../pages/Courses";
import { setLanguage } from "../i18n/locale";
import { emptyDraft } from "../features/timetable/draft";
import { PdfDraftTable } from "../components/PdfDraftTable";
import { PdfUpload } from "../components/PdfUpload";
import { syntheticTimetablePdf } from "./fixtures/pdf";
import { useState } from "react";

beforeAll(async()=>{
  // @ts-expect-error PDF.js worker runtime lacks a declaration module.
  Object.assign(globalThis,{pdfjsWorker:await import("pdfjs-dist/legacy/build/pdf.worker.mjs")});
});
const stores:ReturnType<typeof createAcademicStore>[]=[],names:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();act(()=>setLanguage("ar"));for(const store of stores.splice(0))store.close();for(const name of names.splice(0))await new UniCoreDatabase(name).delete();});
function mount(){
  act(()=>setLanguage("en"));
  const name="pdf-ui-"+crypto.randomUUID(),store=createAcademicStore(name);names.push(name);stores.push(store);
  const save=vi.spyOn(store,"saveTimetable");
  render(<MemoryRouter initialEntries={["/courses/import"]}><Routes>
    <Route path="/courses/import" element={<TimetableImport store={store}/>}/>
    <Route path="/" element={<Courses store={store}/>}/>
    <Route path="/courses" element={<Courses store={store}/>}/>
  </Routes></MemoryRouter>);
  return {store,save};
}
async function upload(weekdayText="Sun Tue",options={}){
  const input=await screen.findByLabelText("Choose a text PDF");await waitFor(()=>expect(input).toBeEnabled());
  fireEvent.change(input,{target:{files:[new NodeFile([syntheticTimetablePdf({...options,weekdayText})],"synthetic.pdf",{type:"application/pdf"})]}});
  await waitFor(()=>expect(screen.queryByText("Reading PDF locally…")).not.toBeInTheDocument(),{timeout:10000});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}
const click=(name:string)=>fireEvent.click(screen.getByRole("button",{name}));

it("D1.2 exposes uncertain imported text bilingually and saves only the student's corrected draft",async()=>{
  const {store,save}=mount();
  const trailing="Advising information: synthetic notice";
  await upload("Sun Tue",{pageFooter:trailing,footerX:120});
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic uncertainty review"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2038/2039"}});
  click("Next");
  expect(screen.getByRole("status")).toHaveTextContent("Highlighted fields may be missing or include wrapped or unassigned PDF text.");
  const input=screen.getByLabelText("Course name · 2");
  expect(input.closest("label")).toHaveAttribute("data-uncertain","true");
  expect(input).toHaveValue("Synthetic Lab "+trailing);
  act(()=>setLanguage("ar"));
  expect(screen.getByRole("status")).toHaveTextContent("قد تكون الحقول المميزة ناقصة أو تتضمن نصاً ملتفاً أو غير محسوم الارتباط من ملف PDF.");
  expect(screen.getByLabelText("اسم المقرر · 2")).toHaveValue("Synthetic Lab "+trailing);
  act(()=>setLanguage("en"));
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Course name · 2"),{target:{value:"Synthetic Lab"}});
  const groups=screen.getByRole("table",{name:"Editable timetable preview"}).querySelectorAll("tbody");
  fireEvent.click(within(groups[1]).getByRole("button",{name:"Mark fields in this row reviewed"}));
  expect(screen.getByLabelText("Course name · 2").closest("label")).not.toHaveAttribute("data-uncertain");
  click("Next");click("Next");await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("(0)");
  expect(save).not.toHaveBeenCalled();click("Next");
  fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));click("Confirm and save timetable locally");
  await screen.findByRole("table",{name:"University timetable"});
  const saved=await store.getTimetable();expect(saved.courses.map(course=>course.name)).toEqual(expect.arrayContaining(["Synthetic Algebra","Synthetic Lab"]));
  expect(saved.sessions).toHaveLength(3);expect(save).toHaveBeenCalledOnce();
},20000);

it("shows both conflicting course dates bilingually and blocks save until explicit duplicate resolution",async()=>{
  const {store,save}=mount();
  await upload("Sun Tue",{registrationDates:["31-08-2026","2038-10-02"],repeatedCourseDates:["05-10-2026"]});
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic repeated-course dates"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2026/2027"}});
  click("Next");
  expect(screen.getByLabelText("Registration date · 1")).toHaveValue("2026-08-31");
  expect(screen.getByLabelText("Registration date · 2")).toHaveValue("2026-10-05");
  for(const language of ["ar","en"] as const){
    act(()=>setLanguage(language));
    const notice=screen.getByRole("region",{name:language==="ar"?"تفسير تاريخ التسجيل":"Registration date interpretation"});
    for(const value of ["31-08-2026","05-10-2026","2026-08-31","2026-10-05"])
      expect(within(notice).getByText(value)).toBeInTheDocument();
    const first=within(notice).getByText("31-08-2026").closest("div")!;
    const second=within(notice).getByText("05-10-2026").closest("div")!;
    expect(first).not.toBe(second);
    expect(first).toHaveTextContent("SYN101");expect(first).toHaveTextContent("2026-08-31");
    expect(second).toHaveTextContent("SYN101");expect(second).toHaveTextContent("2026-10-05");
  }
  for(const button of screen.getAllByRole("button",{name:"Mark fields in this row reviewed"}))fireEvent.click(button);
  click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("Course code SYN101 is duplicated");
  click("Next");expect(screen.queryByRole("button",{name:"Confirm and save timetable locally"})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
  click("Previous");click("Previous");
  // The student deliberately omits the uncertain date and excludes the other
  // draft course AND its meeting using the explicitly named existing action.
  fireEvent.change(screen.getByLabelText("Registration date · 1"),{target:{value:""}});
  const groups=screen.getByRole("table",{name:"Editable timetable preview"}).querySelectorAll("tbody");
  fireEvent.click(within(groups[1]).getByRole("button",{name:"Exclude draft course and meetings"}));
  const notice=screen.getByRole("region",{name:"Registration date interpretation"});
  expect(notice).toHaveTextContent("31-08-2026");expect(notice).toHaveTextContent("Date left unknown");
  expect(notice).not.toHaveTextContent("05-10-2026");
  expect(screen.getByLabelText("Registration date · 2")).toHaveValue("2038-10-02");
  click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("(0)");
  click("Next");const confirm=screen.getByRole("button",{name:"Confirm and save timetable locally"});
  expect(confirm).toBeDisabled();expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));fireEvent.click(confirm);
  await screen.findByRole("table",{name:"University timetable"});
  const saved=await store.getTimetable();
  expect(saved.courses).toHaveLength(2);expect(saved.sessions).toHaveLength(3);
  expect(saved.courses.find(row=>row.code==="SYN101")!.registrationDate).toBeNull();
  expect(saved.courses.find(row=>row.code==="SYN102")!.registrationDate).toBe("2038-10-02");
  expect(save).toHaveBeenCalledOnce();
},20000);

it("shows ambiguous date evidence in both languages, blocks generic acknowledgment, and saves only explicit ISO corrections",async()=>{
  const {store,save}=mount();await upload("Sun Tue",{registrationDates:["05-10-2026","06-11-2026"]});
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic date review"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2026/2027"}});
  click("Next");
  let notice=screen.getByRole("region",{name:"Registration date interpretation"});
  expect(within(notice).getAllByText("05-10-2026")).toHaveLength(2);
  expect(within(notice).getAllByText(/does not safely establish/)).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button",{name:"Mark fields in this row reviewed"})[0]);
  click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).not.toHaveTextContent("(0)");
  click("Next");expect(screen.queryByRole("button",{name:"Confirm and save timetable locally"})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
  click("Previous");click("Previous");
  fireEvent.change(screen.getByLabelText("Registration date · 1"),{target:{value:"2026-10-05"}});
  fireEvent.change(screen.getByLabelText("Registration date · 2"),{target:{value:"2026-11-06"}});
  act(()=>setLanguage("ar"));notice=screen.getByRole("region",{name:"تفسير تاريخ التسجيل"});
  expect(within(notice).getByText("05-10-2026")).toBeInTheDocument();expect(within(notice).getByText("2026-10-05")).toBeInTheDocument();
  act(()=>setLanguage("en"));click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("(0)");
  expect(screen.getByRole("region",{name:"Registration date interpretation"})).toHaveTextContent("05-10-2026");
  expect(save).not.toHaveBeenCalled();click("Next");
  const confirm=screen.getByRole("button",{name:"Confirm and save timetable locally"});expect(confirm).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));fireEvent.click(confirm);
  await screen.findByRole("table",{name:"University timetable"});
  expect((await store.getTimetable()).courses.map(c=>c.registrationDate).sort()).toEqual(["2026-10-05","2026-11-06"]);
  expect(save).toHaveBeenCalledOnce();
},20000);

it("accepts repeated selections of the same file and clears a failed read on retry",async()=>{
  act(()=>setLanguage("en"));
  const parsed=vi.fn(),pending=vi.fn(),draft=emptyDraft();
  render(<PdfUpload draft={draft} disabled={false} onParsed={parsed} onPendingChange={pending}/>);
  const input=screen.getByLabelText("Choose a text PDF");
  const file=new NodeFile([syntheticTimetablePdf()],"same.pdf",{type:"application/pdf"});
  vi.spyOn(file,"arrayBuffer").mockRejectedValueOnce(new Error("Synthetic read failure"));
  fireEvent.change(input,{target:{files:[file]}});
  await screen.findByRole("alert");expect(parsed).not.toHaveBeenCalled();expect(input).toBeEnabled();
  for(let attempt=1;attempt<=2;attempt++) {
    fireEvent.change(input,{target:{files:[file]}});
    await waitFor(()=>expect(parsed).toHaveBeenCalledTimes(attempt),{timeout:10000});
    expect(input).toHaveValue("");expect(input).toBeEnabled();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(parsed.mock.lastCall![0].sourceId).toBe(draft.sourceId);
  }
  expect(pending.mock.calls.map(args=>args[0])).toEqual([true,false,true,false,true,false]);
},20000);

it("ignores a failed old read after cancel/retry and a late result after unmount",async()=>{
  act(()=>setLanguage("en"));
  const parsed=vi.fn(),pending=vi.fn();
  const view=render(<PdfUpload draft={emptyDraft()} disabled={false} onParsed={parsed} onPendingChange={pending}/>);
  let fail!:(error:Error)=>void;
  const old=new NodeFile([syntheticTimetablePdf()],"old.pdf",{type:"application/pdf"});
  const gate=new Promise<ArrayBuffer>((_,reject)=>{fail=reject;});
  const read=vi.spyOn(old,"arrayBuffer").mockReturnValue(gate);
  fireEvent.change(screen.getByLabelText("Choose a text PDF"),{target:{files:[old]}});
  await waitFor(()=>expect(read).toHaveBeenCalledOnce());click("Cancel PDF reading");
  const fresh=new NodeFile([syntheticTimetablePdf()],"fresh.pdf",{type:"application/pdf"});
  fireEvent.change(screen.getByLabelText("Choose a text PDF"),{target:{files:[fresh]}});
  await waitFor(()=>expect(parsed).toHaveBeenCalledOnce(),{timeout:10000});
  await act(async()=>{fail(new Error("Old result"));await gate.catch(()=>{});});
  expect(parsed).toHaveBeenCalledOnce();expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  let finish!:(value:ArrayBuffer)=>void;
  const late=new NodeFile([syntheticTimetablePdf()],"late.pdf",{type:"application/pdf"});
  const lastGate=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});
  const lastRead=vi.spyOn(late,"arrayBuffer").mockReturnValue(lastGate);
  fireEvent.change(screen.getByLabelText("Choose a text PDF"),{target:{files:[late]}});
  await waitFor(()=>expect(lastRead).toHaveBeenCalledOnce());view.unmount();
  await act(async()=>{finish(syntheticTimetablePdf().buffer as ArrayBuffer);await lastGate;});
  expect(parsed).toHaveBeenCalledOnce();
},20000);

it("does not navigate back or apply a late PDF result after leaving during file reading",async()=>{
  const {store,save}=mount();
  const input=await screen.findByLabelText("Choose a text PDF");await waitFor(()=>expect(input).toBeEnabled());
  const bytes=syntheticTimetablePdf(),file=new NodeFile([bytes],"navigation.pdf",{type:"application/pdf"});
  let finish!:(value:ArrayBuffer)=>void;
  const gate=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});
  const read=vi.spyOn(file,"arrayBuffer").mockReturnValue(gate);
  fireEvent.change(input,{target:{files:[file]}});
  await waitFor(()=>expect(read).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("link",{name:"Cancel import"}));
  await screen.findByRole("heading",{name:"Courses",level:1});
  await act(async()=>{finish(bytes.buffer as ArrayBuffer);await gate;});
  expect(screen.queryByRole("heading",{name:"Timetable review",level:1})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
},20000);

const acknowledge=()=>fireEvent.click(screen.getByRole("checkbox",{name:/I checked the original day text/}));
async function mixedPreview(weekdayText="Sun Tue X"){
  const result=mount();await upload(weekdayText);
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic uncertain term"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2038/2039"}});
  click("Next");await screen.findByRole("table",{name:"Editable timetable preview"});
  return result;
}

it("shows the original uncertain day text, blocks generic review, then accepts specific acknowledgment",async()=>{
  const {store,save}=await mixedPreview();
  const notice=screen.getByRole("region",{name:"Incomplete weekday interpretation"});
  expect(within(notice).getByText("09:00-10:00 Sun Tue X")).toBeInTheDocument();
  expect(within(notice).getByText("X")).toBeInTheDocument();
  expect(screen.getAllByLabelText(/Meeting day ·/)).toHaveLength(3);
  fireEvent.click(screen.getAllByRole("button",{name:"Mark fields in this row reviewed (Meeting day)"})[0]);
  expect(screen.getByRole("checkbox",{name:/I checked the original day text/})).not.toBeChecked();
  click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("Review and explicitly acknowledge");
  click("Next");expect(screen.queryByRole("button",{name:"Confirm and save timetable locally"})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
  click("Previous");acknowledge();
  act(()=>setLanguage("ar"));
  expect(screen.getByText("09:00-10:00 Sun Tue X")).toBeInTheDocument();
  expect(screen.getByRole("checkbox",{name:/راجعت نص الأيام الأصلي/})).toBeChecked();
  act(()=>setLanguage("en"));click("Next");
  await screen.findByText("Weekday interpretation explicitly reviewed");
  click("Next");fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));click("Confirm and save timetable locally");
  await screen.findByRole("table",{name:"University timetable"});
  expect(save).toHaveBeenCalledOnce();expect((await store.getTimetable()).sessions).toHaveLength(3);
},20000);

it("supports preview correction and adding a missing meeting before explicit weekday acknowledgment",async()=>{
  const {store,save}=await mixedPreview();
  fireEvent.change(screen.getByLabelText("Meeting day · 1 / 2"),{target:{value:"3"}});
  fireEvent.click(screen.getAllByRole("button",{name:"Add draft meeting"})[0]);
  fireEvent.change(screen.getByLabelText("Meeting day · 1 / 3"),{target:{value:"4"}});
  fireEvent.change(screen.getByLabelText("Start time (24 hour) · 1 / 3"),{target:{value:"09:00"}});
  fireEvent.change(screen.getByLabelText("End time (24 hour) · 1 / 3"),{target:{value:"10:00"}});
  acknowledge();click("Next");click("Next");
  await screen.findByText("Weekday interpretation explicitly reviewed");
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent("(0)");
  click("Next");fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));click("Confirm and save timetable locally");
  await screen.findByRole("table",{name:"University timetable"});
  expect(save).toHaveBeenCalledOnce();
  const data=await store.getTimetable(),course=data.courses.find(c=>c.code==="SYN101")!;
  expect(data.sessions.filter(s=>s.courseId===course.id).map(s=>s.dayOfWeek).sort()).toEqual([3,4,7]);
},20000);

it("does not let weekday acknowledgment bypass unknown days or invalid required course fields",async()=>{
  const {store,save}=await mixedPreview("X ZZ");
  expect(screen.getByLabelText("Meeting day · 1 / 1")).toHaveValue("0");
  acknowledge();fireEvent.change(screen.getByLabelText("Course code · 1"),{target:{value:""}});
  click("Next");click("Next");await screen.findByRole("heading",{name:"Final review",level:2});
  const errors=screen.getByRole("heading",{name:/Errors blocking save/}).parentElement!;
  expect(errors).toHaveTextContent(/valid day|invalid day/);
  expect(errors).toHaveTextContent("name, code and credits are required");
  click("Next");expect(screen.queryByRole("checkbox",{name:/I reviewed/})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
},20000);

it("uploads a real PDF, edits the preview, switches language without loss, confirms once and displays the saved table",async()=>{
  const {store,save}=mount();await upload();
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic PDF term"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2038/2039"}});
  click("Next");
  const table=await screen.findByRole("table",{name:"Editable timetable preview"});
  expect(within(table).getAllByRole("rowgroup")).toHaveLength(3);
  expect(screen.getByLabelText("Course code · 1")).toHaveAttribute("dir","ltr");expect(save).not.toHaveBeenCalled();
  expect((await store.getTimetable()).terms).toHaveLength(0);
  fireEvent.change(screen.getByLabelText("Course name · 1"),{target:{value:"Edited preview course"}});
  fireEvent.change(screen.getByLabelText("Registration date · 1"),{target:{value:"2038-09-02"}});
  act(()=>setLanguage("ar"));expect(screen.getByLabelText("اسم المقرر · 1")).toHaveValue("Edited preview course");
  act(()=>setLanguage("en"));click("Next");click("Next");
  await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();click("Next");
  const saveButton=screen.getByRole("button",{name:"Confirm and save timetable locally"});expect(saveButton).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox",{name:/I reviewed/}));fireEvent.click(saveButton);
  const savedTable=await screen.findByRole("table",{name:"University timetable"});
  expect(within(savedTable).getByText("Edited preview course")).toBeInTheDocument();expect(within(savedTable).getByText("2038-09-02")).toBeInTheDocument();
  expect(save).toHaveBeenCalledTimes(1);expect((await store.getTimetable()).sessions).toHaveLength(3);
},20000);
it("cancelling an extracted draft leaves every academic store empty",async()=>{
  const {store,save}=mount();await upload();fireEvent.click(screen.getByRole("link",{name:"Cancel import"}));
  await screen.findByRole("heading",{name:"Courses"});expect(save).not.toHaveBeenCalled();
  const db=new UniCoreDatabase(names.at(-1));for(const table of db.tables)expect(await table.count()).toBe(0);db.close();
  expect((await store.getTimetable()).courses).toHaveLength(0);
},15000);
it("adds/excludes draft rows without deleting academic records and highlights unknown cells",()=>{
  act(()=>setLanguage("en"));
  function Harness(){const [draft,setDraft]=useState<TimetableDraft>(emptyDraft());return <PdfDraftTable draft={draft} onChange={setDraft}/>;}
  render(<Harness/>);click("Add draft course");
  expect(screen.getByLabelText("Course code · 1").parentElement).toHaveAttribute("data-uncertain","true");
  fireEvent.change(screen.getByLabelText("Course name · 1"),{target:{value:"Synthetic row"}});click("Add draft meeting");
  expect(screen.getByLabelText("Meeting day · 1 / 1")).toHaveValue("0");click("Exclude draft meeting");
  expect(screen.queryByLabelText("Meeting day · 1 / 1")).not.toBeInTheDocument();
  click("Exclude draft course and meetings");expect(screen.queryByLabelText("Course name · 1")).not.toBeInTheDocument();
});

it("keeps paired preview times accessible and every compact cell editable without mutating the incoming draft",()=>{
  act(()=>setLanguage("en"));
  const incoming:TimetableDraft={...emptyDraft(),courses:[{key:"c",code:"SYN101",name:"Synthetic course",registeredHours:3,activityType:"theory",unconfirmed:["name"]}],sessions:[{key:"s",courseKey:"c",dayOfWeek:1,startTime:"09:00",endTime:"10:00",room:"R-1",deliveryMode:"in-person",unconfirmed:["startTime"]}]};
  const original=structuredClone(incoming);
  const change=vi.fn();
  function Harness(){const [draft,setDraft]=useState(incoming);return <PdfDraftTable draft={draft} onChange={next=>{change(next);setDraft(next);}}/>;}
  render(<Harness/>);
  const start=screen.getByLabelText("Start time (24 hour) · 1 / 1"),end=screen.getByLabelText("End time (24 hour) · 1 / 1");
  expect(start.closest("td")).toBe(end.closest("td"));
  expect(start.closest(".table-time-range")).toHaveAttribute("dir","ltr");
  expect(start.closest(".table-time-range")).toContainElement(end);
  expect(screen.getByLabelText("Course name · 1").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Instructor · 1").tagName).toBe("TEXTAREA");
  const reveal=vi.fn();
  Object.defineProperty(start,"scrollIntoView",{configurable:true,value:reveal});
  fireEvent.focus(start);
  expect(reveal).toHaveBeenCalledExactlyOnceWith({block:"nearest",inline:"nearest"});
  const values:Record<string,string>={"Course code · 1":"SYN202","Course name · 1":"مقرر تجريبي طويل","Credit hours · 1":"2","Section · 1":"4","Instructor · 1":"Synthetic long instructor name","Registration date · 1":"2038-09-02","Start time (24 hour) · 1 / 1":"11:00","End time (24 hour) · 1 / 1":"12:00","Room / online location · 1 / 1":"Online room"};
  for(const [label,value] of Object.entries(values))fireEvent.change(screen.getByLabelText(label),{target:{value}});
  fireEvent.change(screen.getByLabelText("Activity · 1"),{target:{value:"practical"}});
  fireEvent.change(screen.getByLabelText("Meeting day · 1 / 1"),{target:{value:"4"}});
  fireEvent.change(screen.getByLabelText("Delivery mode · 1 / 1"),{target:{value:"online"}});
  const edited=change.mock.lastCall![0] as TimetableDraft;
  expect(edited.courses[0]).toMatchObject({key:"c",code:"SYN202",name:"مقرر تجريبي طويل",registeredHours:2,section:"4",instructor:"Synthetic long instructor name",registrationDate:"2038-09-02",activityType:"practical",unconfirmed:["name"]});
  expect(edited.sessions[0]).toMatchObject({key:"s",courseKey:"c",dayOfWeek:4,startTime:"11:00",endTime:"12:00",room:"Online room",deliveryMode:"online",unconfirmed:["startTime"]});
  click("Mark fields in this row reviewed");click("Mark fields in this row reviewed (Meeting day)");
  expect(change.mock.lastCall![0].courses[0].unconfirmed).toEqual([]);
  expect(change.mock.lastCall![0].sessions[0].unconfirmed).toEqual([]);
  expect(incoming).toEqual(original);
});

it("keeps course actions separate from every meeting across all seven course groups",()=>{
  act(()=>setLanguage("en"));
  const counts=[1,2,3,3,2,1,3];
  const incoming:TimetableDraft={...emptyDraft(),courses:counts.map((_,i)=>({key:`c${i}`,code:`SYN${i}`,name:`Synthetic ${i}`,registeredHours:3,unconfirmed:["name"]})),sessions:counts.flatMap((count,i)=>Array.from({length:count},(_,j)=>({key:`s${i}-${j}`,courseKey:`c${i}`,dayOfWeek:[7,2,4][j],startTime:"09:00",endTime:"10:00",room:"R-1",deliveryMode:"in-person" as const,unconfirmed:["startTime"]})))};
  const original=structuredClone(incoming),change=vi.fn();
  function Harness(){const [draft,setDraft]=useState(incoming);return <PdfDraftTable draft={draft} onChange={next=>{change(next);setDraft(next);}}/>;}
  render(<Harness/>);
  const groups=screen.getByRole("table").querySelectorAll("tbody");
  expect(groups).toHaveLength(7);
  groups.forEach((group,i)=>{
    expect(group.rows).toHaveLength(counts[i]);
    const courseActions=group.querySelector(".table-course-actions")!;
    expect(courseActions.closest("td")).toHaveAttribute("rowspan",String(counts[i]));
    expect(within(courseActions as HTMLElement).getAllByRole("button")).toHaveLength(3);
    for(const row of group.rows)expect(within(row.querySelector(".table-actions") as HTMLElement).getAllByRole("button")).toHaveLength(2);
  });
  const last=groups[6];
  fireEvent.click(within(last).getByRole("button",{name:"Add draft meeting"}));
  fireEvent.change(screen.getByLabelText("Start time (24 hour) · 7 / 4"),{target:{value:"13:15"}});
  fireEvent.change(screen.getByLabelText("End time (24 hour) · 7 / 4"),{target:{value:"14:15"}});
  expect(change.mock.lastCall![0].sessions.at(-1)).toMatchObject({courseKey:"c6",startTime:"13:15",endTime:"14:15"});
  fireEvent.click(within(last).getAllByRole("button",{name:"Exclude draft meeting"}).at(-1)!);
  expect(change.mock.lastCall![0]).toEqual(original);
  fireEvent.click(within(last).getByRole("button",{name:"Mark fields in this row reviewed"}));
  expect(change.mock.lastCall![0].courses[6].unconfirmed).toEqual([]);
  expect(change.mock.lastCall![0].courses[5].unconfirmed).toEqual(["name"]);
  fireEvent.click(within(last).getByRole("button",{name:"Exclude draft course and meetings"}));
  expect(change.mock.lastCall![0].courses).toHaveLength(6);
  expect(change.mock.lastCall![0].sessions).toHaveLength(12);
  expect(incoming).toEqual(original);
});

it("cancels a controlled in-flight PDF read, ignores its late result, and accepts a later upload",async()=>{
  const {store,save}=mount();
  const input=await screen.findByLabelText("Choose a text PDF");await waitFor(()=>expect(input).toBeEnabled());
  let finish!:(value:ArrayBuffer)=>void;
  const bytes=syntheticTimetablePdf();
  const file=new NodeFile([bytes],"slow.pdf",{type:"application/pdf"});
  const gate=new Promise<ArrayBuffer>(resolve=>{finish=resolve;});
  const read=vi.spyOn(file,"arrayBuffer").mockReturnValue(gate);
  fireEvent.change(input,{target:{files:[file]}});
  await waitFor(()=>expect(read).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("Term name")).toBeDisabled();expect(screen.getByRole("button",{name:"Next"})).toBeDisabled();
  click("Cancel PDF reading");
  await act(async()=>{finish(bytes.buffer as ArrayBuffer);await gate;});
  expect(screen.getByLabelText("Term name")).toBeEnabled();click("Next");
  expect(screen.queryByRole("table",{name:"Editable timetable preview"})).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).terms).toHaveLength(0);
  await upload();click("Next");
  await screen.findByRole("table",{name:"Editable timetable preview"});
},15000);

it("failed validation can return to the editable PDF rows without academic writes",async()=>{
  const {store,save}=mount();await upload();
  fireEvent.change(screen.getByLabelText("Term name"),{target:{value:"Synthetic failed review"}});
  fireEvent.change(screen.getByLabelText("Academic year"),{target:{value:"2038/2039"}});
  click("Next");
  fireEvent.change(screen.getByLabelText("Course code · 1"),{target:{value:"SYN102"}});
  click("Next");click("Next");await screen.findByRole("heading",{name:"Final review",level:2});
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent(/Course code SYN102 is duplicated/);
  click("Previous");click("Previous");
  expect(screen.getByLabelText("Course code · 1")).toHaveValue("SYN102");
  fireEvent.change(screen.getByLabelText("Course code · 1"),{target:{value:"SYN101"}});
  expect(save).not.toHaveBeenCalled();expect((await store.getTimetable()).courses).toHaveLength(0);
},15000);

it("does not label an unresolved delivery mode as in-person in the final summary",async()=>{
  act(()=>setLanguage("en"));
  const name="pdf-unknown-mode-"+crypto.randomUUID(),store=createAcademicStore(name);names.push(name);stores.push(store);
  const draft:TimetableDraft={...emptyDraft(),term:{key:"term",name:"Synthetic unknown term",academicYear:"2038/2039",semester:1,unconfirmed:[]},courses:[{key:"c",code:"SYN101",name:"Synthetic unknown course",registeredHours:1,unconfirmed:[]}],sessions:[{key:"s",courseKey:"c",dayOfWeek:1,startTime:"09:00",endTime:"10:00",deliveryMode:"",unconfirmed:["deliveryMode"]}]};
  render(<MemoryRouter><TimetableImport store={store} initialDraft={draft}/></MemoryRouter>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Next"})).toBeEnabled());
  click("Next");click("Next");click("Next");
  const summary=screen.getByRole("table",{name:"Sessions you reviewed"});
  expect(within(summary).queryByText("In person")).not.toBeInTheDocument();
  expect(within(summary).getAllByText("Not provided").length).toBeGreaterThan(0);
  expect(screen.getByRole("heading",{name:/Errors blocking save/}).parentElement).toHaveTextContent(/invalid delivery mode/);
  expect((await store.getTimetable()).terms).toHaveLength(0);
});
