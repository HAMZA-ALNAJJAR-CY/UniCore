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
async function upload(weekdayText="Sun Tue"){
  const input=await screen.findByLabelText("Choose a text PDF");await waitFor(()=>expect(input).toBeEnabled());
  fireEvent.change(input,{target:{files:[new NodeFile([syntheticTimetablePdf({weekdayText})],"synthetic.pdf",{type:"application/pdf"})]}});
  await waitFor(()=>expect(screen.queryByText("Reading PDF locally…")).not.toBeInTheDocument(),{timeout:10000});
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
}
const click=(name:string)=>fireEvent.click(screen.getByRole("button",{name}));

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
