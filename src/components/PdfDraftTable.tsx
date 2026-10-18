import type { DraftCourse, DraftSession, TimetableDraft } from "../data";
import { TimetableTableFrame } from "./TimetableTable";
import { pdfText as p } from "../i18n/pdf";
import { timetableText as t } from "../features/timetable/messages";

/** A notice about source text, not an invented meeting or a persisted entity. */
export function PdfWeekdayReview({draft,onChange}: {draft:TimetableDraft;onChange?:(draft:TimetableDraft)=>void}) {
  if (!draft.weekdayReviews?.length) return null;
  return <section className="review-findings finding-danger" aria-label={p.weekdayTitle}>
    <h3>{p.weekdayTitle}</h3>
    <p>{p.weekdayHelp}</p>
    {draft.weekdayReviews.map((review,index)=><div key={review.key}>
      <p><bdi>{draft.courses.find(c=>c.key===review.courseKey)?.name}</bdi> · {index+1}</p>
      <p>{p.weekdayOriginal}: <bdi>{review.sourceText}</bdi></p>
      <p>{p.weekdayUnknown}: <bdi>{review.unknownTokens.join(" / ")}</bdi></p>
      {onChange ? <label><input type="checkbox" checked={review.acknowledged} onChange={e=>onChange({...draft,weekdayReviews:draft.weekdayReviews!.map(row=>row.key===review.key?{...row,acknowledged:e.target.checked}:row)})}/>{p.weekdayAck} ({index+1})</label>
        : <p>{review.acknowledged?p.weekdayReviewed:p.weekdayBlocked}</p>}
    </div>)}
  </section>;
}

export function PdfDraftTable({draft,onChange}: {draft:TimetableDraft;onChange:(draft:TimetableDraft)=>void}) {
  const courseEdit = (key:string,patch:Partial<DraftCourse>) => onChange({...draft,courses:draft.courses.map(c=>c.key===key?{...c,...patch}:c)});
  const sessionEdit = (key:string,patch:Partial<DraftSession>) => onChange({...draft,sessions:draft.sessions.map(s=>s.key===key?{...s,...patch}:s)});
  const newSession = (courseKey:string):DraftSession => ({key:"added-"+crypto.randomUUID(),identity:"new",courseKey,dayOfWeek:0,startTime:"",endTime:"",room:null,deliveryMode:"in-person",unconfirmed:["dayOfWeek","startTime","endTime"]});
  function input(row:DraftCourse|DraftSession,field:string,label:string,value:string|number|null|undefined,change:(value:string)=>void,type="text") {
    const unknown = row.unconfirmed.includes(field);
    return <label className="table-field" data-uncertain={unknown || undefined}>
      <span className="sr-only">{label}</span>
      <input type={type} dir={["code","registrationDate","registeredHours","section","startTime","endTime"].includes(field) ? "ltr" : undefined} placeholder={field === "registrationDate" ? "YYYY-MM-DD" : undefined} value={typeof value === "number" && !Number.isFinite(value) ? "" : value ?? ""} onChange={e=>change(e.target.value)} aria-label={label} aria-description={unknown?p.uncertain:undefined} />
    </label>;
  }
  return <>
    <p className="review-note">{p.extracted}</p>
    <PdfWeekdayReview draft={draft} onChange={onChange}/>
    <TimetableTableFrame caption={p.preview} editable>
      {draft.courses.map((course,ci)=>{
        const meetings:(DraftSession|null)[]=draft.sessions.filter(s=>s.courseKey===course.key);
        if(!meetings.length) meetings.push(null);
        const suffix=" · "+(ci+1);
        return <tbody key={course.key} aria-label={(course.code || p.name)+" ("+(ci+1)+")"}>{meetings.map((session,si)=><tr key={session?.key??course.key}>
          {si===0 && <>
            <td rowSpan={meetings.length}>{input(course,"code",p.code+suffix,course.code,code=>courseEdit(course.key,{code}))}</td>
            <td rowSpan={meetings.length}>{input(course,"name",p.name+suffix,course.name,name=>courseEdit(course.key,{name}))}</td>
            <td rowSpan={meetings.length}><select aria-label={p.activity+suffix} data-uncertain={course.unconfirmed.includes("activityType")||undefined} value={course.activityType??""} onChange={e=>courseEdit(course.key,{activityType:(e.target.value||null) as DraftCourse["activityType"]})}>
              <option value="">{p.unknown}</option><option value="theory">{t.theory}</option><option value="practical">{t.practical}</option><option value="lab">{p.lab}</option>
            </select>{course.description && <p className="review-note"><bdi>{course.description}</bdi></p>}</td>
            <td rowSpan={meetings.length}>{input(course,"registeredHours",p.hours+suffix,course.registeredHours,v=>courseEdit(course.key,{registeredHours:v===""?NaN:Number(v)}),"number")}</td>
            <td rowSpan={meetings.length}>{input(course,"section",p.section+suffix,course.section,section=>courseEdit(course.key,{section:section||null}))}</td>
          </>}
          <td>{session && <select aria-label={p.day+suffix+" / "+(si+1)} data-uncertain={session.unconfirmed.includes("dayOfWeek")||undefined} value={session.dayOfWeek} onChange={e=>sessionEdit(session.key,{dayOfWeek:Number(e.target.value)})}>
            <option value={0}>{p.unknown}</option>{[7,1,2,3,4,5,6].map(day=><option value={day} key={day}>{t.days[day]}</option>)}
          </select>}</td>
          <td>{session && <div dir="ltr">{input(session,"startTime",t.start+suffix+" / "+(si+1),session.startTime,startTime=>sessionEdit(session.key,{startTime}))}{input(session,"endTime",t.end+suffix+" / "+(si+1),session.endTime,endTime=>sessionEdit(session.key,{endTime}))}{session.notes && <p className="review-note"><bdi>{session.notes}</bdi></p>}</div>}</td>
          {si===0 && <td rowSpan={meetings.length}>{input(course,"instructor",p.instructor+suffix,course.instructor,instructor=>courseEdit(course.key,{instructor:instructor||null}))}</td>}
          <td>{session && <>{input(session,"room",p.room+suffix+" / "+(si+1),session.room??session.location,room=>sessionEdit(session.key,{room:room||null}))}<select aria-label={t.mode+suffix+" / "+(si+1)} data-uncertain={session.unconfirmed.includes("deliveryMode")||undefined} value={session.deliveryMode} onChange={e=>sessionEdit(session.key,{deliveryMode:e.target.value as DraftSession["deliveryMode"]})}><option value="">{p.unknown}</option><option value="in-person">{t.inPerson}</option><option value="online">{t.online}</option></select></>}</td>
          {si===0 && <td rowSpan={meetings.length}>{input(course,"registrationDate",p.registrationDate+suffix,course.registrationDate,registrationDate=>courseEdit(course.key,{registrationDate:registrationDate||null}))}</td>}
          <td><div className="table-actions">
            {si===0 && <>
              <button onClick={()=>onChange({...draft,sessions:[...draft.sessions,newSession(course.key)]})}>{p.addSession}</button>
              <button onClick={()=>onChange({...draft,courses:draft.courses.filter(c=>c.key!==course.key),sessions:draft.sessions.filter(s=>s.courseKey!==course.key),weekdayReviews:draft.weekdayReviews?.filter(r=>r.courseKey!==course.key)})}>{p.removeCourse}</button>
              <button onClick={()=>courseEdit(course.key,{unconfirmed:[]})}>{p.confirmField}</button>
            </>}
            {session && <><button onClick={()=>onChange({...draft,sessions:draft.sessions.filter(s=>s.key!==session.key)})}>{p.removeSession}</button><button onClick={()=>sessionEdit(session.key,{unconfirmed:[]})}>{p.confirmField} ({p.day})</button></>}
          </div></td>
        </tr>)}</tbody>;
      })}
    </TimetableTableFrame>
    <button onClick={()=>onChange({...draft,courses:[...draft.courses,{key:"added-"+crypto.randomUUID(),identity:"new",name:"",code:"",registeredHours:NaN,unconfirmed:["name","code","registeredHours"]}]})}>{p.addCourse}</button>
  </>;
}
