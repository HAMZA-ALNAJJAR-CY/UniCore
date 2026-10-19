import { afterEach, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { Blob as NodeBlob } from "node:buffer";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Course, ScheduleSession } from "../data";
import { AcademicStore } from "../data/store";
import { UniCoreDatabase } from "../data/database";
import { Courses } from "../pages/Courses";
import { sourceDraft } from "./fixtures/timetable";
import { TimetableTable } from "../components/TimetableTable";
import { setLanguage } from "../i18n/locale";
import { timetableText as t } from "../features/timetable/messages";

afterEach(()=>act(()=>setLanguage("ar")));
function mount() {
  act(()=>setLanguage("en"));
  const meta={createdAt:1,updatedAt:1,deletedAt:null,revision:7};
  const courses:Course[]=[0,1,2,3].map((_,i)=>({...meta,id:`course-${i}`,academicTermId:"term",code:`SYN${i}`,name:`Synthetic course ${i}`,instructor:"مدرس تجريبي",registeredHours:3,activityType:"theory"}));
  const sessions:ScheduleSession[]=[0,1,2,3].flatMap((count,i)=>Array.from({length:count},(_,j)=>({...meta,id:`session-${i}-${j}`,academicTermId:"term",courseId:courses[i].id,dayOfWeek:[1,3,5][j],startTime:`${8+i}:00`.padStart(5,"0"),endTime:`${9+i}:00`.padStart(5,"0"),room:`TEST-${i}-${j}`,deliveryMode:j===2?"online" as const:"in-person" as const})));
  const original=structuredClone({courses,sessions});
  courses.forEach(Object.freeze);sessions.forEach(Object.freeze);Object.freeze(courses);Object.freeze(sessions);
  const editCourse=vi.fn(),addSession=vi.fn(),removeCourse=vi.fn(),editSession=vi.fn(),removeSession=vi.fn();
  function Table(){return <TimetableTable courses={courses} sessions={sessions}
    courseActions={course=><><button onClick={()=>editCourse(course)}>Edit course</button><button onClick={()=>removeCourse(course)}>Remove course</button><button onClick={()=>addSession(course)}>Add session</button></>}
    sessionActions={(course,session)=><><button onClick={()=>editSession(course,session)}>Edit session</button><button onClick={()=>removeSession(course,session)}>Remove session</button></>}/>;}
  return {view:render(<Table/>),Table,courses,sessions,original,editCourse,addSession,removeCourse,editSession,removeSession};
}

it("renders one row per saved meeting, one empty row, unique course targets and associated academic fields in both languages",()=>{
  const {view,Table,courses,sessions,original}=mount();
  for(const language of ["en","ar"] as const){
    act(()=>setLanguage(language));view.rerender(<Table/>);
    const table=screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader")).toHaveLength(12);
    expect(table.querySelectorAll("tbody")).toHaveLength(courses.length);
    courses.forEach((course,i)=>{
      const group=document.getElementById("course-"+course.id) as HTMLTableSectionElement;
      expect(group.tagName).toBe("TBODY");expect(group).toHaveAttribute("tabindex","-1");
      expect(group.rows).toHaveLength(Math.max(1,i));
      const header=within(group).getByRole("rowheader",{name:course.name});
      expect(header).toHaveAttribute("scope","rowgroup");expect(header).toHaveAttribute("rowspan",String(Math.max(1,i)));
      expect(within(group).getByRole("heading",{name:course.name})).toBeInTheDocument();
      expect(within(group).getByText(course.code)).toHaveAttribute("dir","ltr");
      const meetings=sessions.filter(session=>session.courseId===course.id);
      if(!meetings.length)expect(group).toHaveTextContent(language==="en"?"No weekly meetings":"لا توجد جلسات أسبوعية");
      meetings.forEach((session,j)=>{
        expect(group.rows[j]).toHaveTextContent(t.days[session.dayOfWeek]);
        expect(group.rows[j]).toHaveTextContent(`${session.startTime}–${session.endTime}`);
        expect(group.rows[j]).toHaveTextContent(session.room!);
      });
    });
  }
  expect({courses,sessions}).toEqual(original);
});

it("retains course and session action identity/revision bindings including courses without meetings",()=>{
  const {courses,sessions,editCourse,removeCourse,addSession,editSession,removeSession}=mount();
  courses.forEach(course=>{
    const group=document.getElementById("course-"+course.id)!;
    const actions=group.querySelector(".saved-course-actions") as HTMLElement;
    expect(within(actions).getAllByRole("button")).toHaveLength(3);
    fireEvent.click(within(actions).getByRole("button",{name:"Edit course"}));expect(editCourse).toHaveBeenLastCalledWith(course);
    fireEvent.click(within(actions).getByRole("button",{name:"Remove course"}));expect(removeCourse).toHaveBeenLastCalledWith(course);
    fireEvent.click(within(actions).getByRole("button",{name:"Add session"}));expect(addSession).toHaveBeenLastCalledWith(course);
    const meetings=sessions.filter(session=>session.courseId===course.id);
    group.querySelectorAll(".table-actions").forEach((cell,j)=>{
      expect(within(cell as HTMLElement).queryAllByRole("button")).toHaveLength(meetings.length?2:0);
      if(!meetings.length)return;
      fireEvent.click(within(cell as HTMLElement).getByRole("button",{name:"Edit session"}));expect(editSession).toHaveBeenLastCalledWith(course,meetings[j]);
      fireEvent.click(within(cell as HTMLElement).getByRole("button",{name:"Remove session"}));expect(removeSession).toHaveBeenLastCalledWith(course,meetings[j]);
    });
  });
});

it("reveals focused saved-table buttons while leaving course anchor focus to the existing page handler",()=>{
  const {courses}=mount();
  const region=screen.getByRole("region",{name:"University timetable"});expect(region).toHaveAttribute("tabindex","0");
  const group=document.getElementById("course-"+courses[3].id)!;
  const button=within(group).getByRole("button",{name:"Edit course"});
  const reveal=vi.fn(),anchorScroll=vi.fn();
  Object.defineProperty(button,"scrollIntoView",{value:reveal});Object.defineProperty(group,"scrollIntoView",{value:anchorScroll});
  fireEvent.focus(button);expect(reveal).toHaveBeenCalledExactlyOnceWith({block:"nearest",inline:"nearest"});
  fireEvent.focus(group);expect(anchorScroll).not.toHaveBeenCalled();
});

it("keeps code/name cells free of controls and puts course/session actions in the final two columns",()=>{
  const {courses}=mount();
  expect(screen.getAllByRole("columnheader").slice(-2).map(cell=>cell.textContent)).toEqual(["Course actions","Session actions"]);
  courses.forEach(course=>{
    const group=document.getElementById("course-"+course.id) as HTMLTableSectionElement;
    const first=group.rows[0];
    expect(first.cells[0]).toHaveTextContent(course.code);
    expect(first.cells[0].querySelector("button")).toBeNull();
    expect(within(first.cells[1]).queryAllByRole("button")).toHaveLength(0);
    expect(first.cells[1].textContent).toBe(course.name);
    const actions=first.cells[first.cells.length-2];
    expect(actions).toHaveAttribute("rowspan",String(group.rows.length));
    expect(within(actions).getAllByRole("button")).toHaveLength(3);
    for(const row of group.rows)expect(row.lastElementChild?.querySelector(".table-actions")).not.toBeNull();
  });
});

function orderingFixture() {
  const meta={createdAt:1,updatedAt:1,deletedAt:null,revision:9};
  const course=(id:string,code=id):Course=>({...meta,id,code,name:id,academicTermId:"term",registeredHours:3});
  const courses=[course("late"),course("empty"),course("early"),course("same-thursday"),course("tie-z","Z"),course("tie-b","A"),course("tie-a","A")];
  const meeting=(id:string,courseId:string,dayOfWeek:number,startTime:string):ScheduleSession=>({...meta,id,courseId,academicTermId:"term",dayOfWeek,startTime,endTime:"18:00",deliveryMode:"online"});
  const sessions=[meeting("late-sun","late",7,"10:00"),meeting("early-thu","early",4,"08:00"),meeting("early-sun","early",7,"12:00"),meeting("same-thursday","same-thursday",4,"09:00"),...['tie-z','tie-b','tie-a'].map(id=>meeting(id,id,7,"09:00")),{...meeting("deleted","empty",7,"00:00"),deletedAt:100}];
  return {courses,sessions};
}
const visibleIds=()=>[...document.querySelectorAll(".saved-timetable tbody")].map(group=>group.id.replace("course-",""));
it("orders unsorted groups by earliest time before weekday, then Sunday-first weekday, code and UUID; empty groups last",()=>{
  const {courses,sessions}=orderingFixture();
  const original=structuredClone({courses,sessions});
  courses.forEach(Object.freeze);sessions.forEach(Object.freeze);Object.freeze(courses);Object.freeze(sessions);
  render(<TimetableTable courses={courses} sessions={sessions} courseActions={()=>null} sessionActions={()=>null}/>);
  expect(visibleIds()).toEqual(["early","tie-a","tie-b","tie-z","same-thursday","late","empty"]);
  const early=document.getElementById("course-early")!;
  expect([...early.querySelectorAll("tr")].map(row=>row.textContent?.match(/\d\d:\d\d–/g)?.[0])).toEqual(["12:00–","08:00–"]);
  expect(document.getElementById("course-empty")).toHaveTextContent("لا توجد جلسات أسبوعية");
  expect({courses,sessions}).toEqual(original);
});

it("recomputes display order after a time edit or removal without changing the incoming records",()=>{
  const {courses,sessions}=orderingFixture();
  const table=(rows:ScheduleSession[])=><TimetableTable courses={courses} sessions={rows} courseActions={()=>null} sessionActions={()=>null}/>;
  const view=render(table(sessions));
  const edited=sessions.map(row=>row.id==="late-sun"?{...row,startTime:"07:00",revision:10}:row);
  view.rerender(table(edited));expect(visibleIds()[0]).toBe("late");
  const removed=edited.map(row=>row.id==="late-sun"?{...row,deletedAt:100}:row);
  view.rerender(table(removed));expect(visibleIds().slice(-2)).toEqual(["empty","late"]);
  expect(sessions.find(row=>row.id==="late-sun")).toMatchObject({startTime:"10:00",revision:9,deletedAt:null});
});

it("sorts meetings by weekday, time and UUID while retaining each session's own action callback",()=>{
  const {courses,sessions}=orderingFixture();
  const first=sessions[0];
  const rows=[{...first,id:"z",startTime:"11:00"},{...first,id:"b"},{...first,id:"a"},{...first,id:"monday",dayOfWeek:1,startTime:"07:00"}];
  const edit=vi.fn();
  render(<TimetableTable courses={[courses[0]]} sessions={rows} courseActions={()=>null} sessionActions={(_,session)=><button onClick={()=>edit(session)}>Edit</button>}/>);
  const rendered=[...document.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  expect(rendered.map(row=>row.dataset.sessionId)).toEqual(["a","b","z","monday"]);
  rendered.forEach(row=>{fireEvent.click(within(row).getByRole("button"));expect(edit).toHaveBeenLastCalledWith(rows.find(session=>session.id===row.dataset.sessionId));});
});

it("uses valid 24-hour slots only for ordering and never repairs or hides an invalid persisted slot",()=>{
  const {courses,sessions}=orderingFixture();
  const invalid={...sessions[0],id:"invalid",courseId:"late",startTime:"5:00"};
  const midnight={...sessions[1],id:"midnight",courseId:"early",startTime:"00:00"};
  render(<TimetableTable courses={courses.slice(0,3)} sessions={[invalid,midnight]} courseActions={()=>null} sessionActions={()=>null}/>);
  expect(visibleIds()).toEqual(["early","late","empty"]);
  expect(document.getElementById("course-late")).toHaveTextContent("5:00–18:00");
  expect(invalid.startTime).toBe("5:00");
});

it("orders saved imports after loading, refresh, session editing and remount without incidental persistence or mapping writes",async()=>{
  act(()=>setLanguage("en"));
  // fake-indexeddb uses Node structuredClone; use its Blob implementation so
  // attachment bytes survive cloning rather than jsdom's wrapper losing data.
  vi.stubGlobal("Blob",NodeBlob);
  const db=new UniCoreDatabase("saved-order-"+crypto.randomUUID()),store=new AcademicStore(db);
  let view:ReturnType<typeof render>|undefined;
  try {
    const review=await store.reviewTimetable(sourceDraft());
    expect((await store.saveTimetable(review,{confirmed:true,keepExistingKeys:review.differences.map(row=>row.key)})).committed).toBe(true);
    const timetable=await store.getTimetable();
    const course=timetable.courses.find(row=>row.code==="SYN101")!;
    const session=timetable.sessions.find(row=>row.courseId===course.id)!;
    const lecture=await store.lectures.create({courseId:course.id,scheduleSessionId:session.id,date:"2030-01-01"});
    const file=await store.lectureFiles.create({lectureId:lecture.id,fileName:"synthetic.txt",blob:new Blob([new Uint8Array([1,3,5,7])],{type:"text/plain"})});
    const bytes=async(blob:Blob)=>[...new Uint8Array(await blob.arrayBuffer())];
    const snapshot=async()=>Object.fromEntries(await Promise.all(db.tables.map(async table=>[table.name,await table.toArray()])));
    const before=await snapshot();
    const show=()=>render(<MemoryRouter initialEntries={["/courses?term="+timetable.termId]}><Courses store={store}/></MemoryRouter>);
    view=show();
    await screen.findByRole("rowgroup",{name:course.name});
    const initial=visibleIds();expect(initial[0]).not.toBe(course.id);
    fireEvent.click(screen.getByRole("button",{name:t.retry}));
    await waitFor(()=>expect(screen.getByRole("button",{name:t.retry})).not.toBeDisabled());
    await screen.findByRole("rowgroup",{name:course.name});
    expect(visibleIds()).toEqual(initial);expect(await snapshot()).toEqual(before);
    const group=screen.getByRole("rowgroup",{name:course.name});
    fireEvent.click(within(group).getByRole("button",{name:t.editSession}));
    fireEvent.change(screen.getByLabelText(t.start,{exact:true}),{target:{value:"06:00"}});
    fireEvent.change(screen.getByLabelText(t.end,{exact:true}),{target:{value:"07:00"}});
    fireEvent.click(screen.getByRole("button",{name:t.save}));
    await screen.findByText(t.saved);
    await waitFor(()=>expect(visibleIds()[0]).toBe(course.id));
    const saved=await store.scheduleSessions.get(session.id);
    expect(saved).toMatchObject({id:session.id,courseId:course.id,startTime:"06:00",endTime:"07:00",revision:session.revision+1});
    const after=await snapshot();
    expect({...after,scheduleSessions:before.scheduleSessions}).toEqual(before);
    expect(after.scheduleSessions.filter((row:ScheduleSession)=>row.id!==session.id)).toEqual(before.scheduleSessions.filter((row:ScheduleSession)=>row.id!==session.id));
    expect(await bytes((await store.lectureFiles.get(file.id))!.blob)).toEqual([1,3,5,7]);
    view.unmount();view=show();await screen.findByRole("rowgroup",{name:course.name});
    expect(visibleIds()[0]).toBe(course.id);expect(await snapshot()).toEqual(after);
  } finally {view?.unmount();store.close();await db.delete();vi.unstubAllGlobals();}
});
