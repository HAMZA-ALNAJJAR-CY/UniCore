import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";
import { createAcademicStore, type RelatedBatch } from "../../data";
import { Courses } from "../../pages/Courses";
import { setLanguage, useLanguage } from "../../i18n/locale";
import { checkSavedTableLayout } from "./saved-table-layout";
import "../../styles.css";

// A dedicated test database, never the default UniCore database. Seed only via
// the explicit button and existing atomic service. Refresh/term switches read it.
const store = createAcademicStore("UniCore-saved-table-layout-fixture-v3");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const counts = [1,2,3,3,2,1,3,0];
// Deliberately not chronological: persisted insertion/code order must not win.
const startHours = [12,8,10,9,14,11,13];
const batch: RelatedBatch = {
  academicTerms: [1,2].map(n => ({ id:id(n), name:`Synthetic layout term ${n}`, academicYear:`203${n}/203${n+1}`, semester:1 })),
  courses: Array.from({length:9}, (_,i) => ({id:id(10+i),academicTermId:id(i===8?2:1),code:`SYN${101+i}`,name:i===3?"SyntheticUnbrokenCourseNameForTestingWrappingWithoutChangingOtherGroups":i===6?"مقرر تجريبي طويل الاسم للتحقق من التفاف النص دون تمديد بقية المجموعات التعليمية":"مقرر تجريبي "+(i+1),instructor:i===4?"SyntheticInstructorNameRepeatedForWrappingVerificationInTheSavedTable":i===5?"مدرس تجريبي طويل الاسم للتحقق من التفاف النص داخل خلية المدرس دون تمديد المجموعات الأخرى":"مدرس تجريبي",registeredHours:3,activityType:"theory" as const,section:"2"})),
  scheduleSessions: counts.flatMap((count,i) => Array.from({length:count},(_,j)=>({id:id(100+i*3+j),academicTermId:id(1),courseId:id(10+i),dayOfWeek:[7,2,4][j],startTime:`${String(startHours[i]).padStart(2,"0")}:00`,endTime:`${String(startHours[i]+1).padStart(2,"0")}:00`,room:`TEST-${i+1}-${j+1}`,deliveryMode:"in-person" as const}))),
};
const snapshot = async () => JSON.stringify(await Promise.all([store.academicTerms.list(),store.courses.list(),store.scheduleSessions.list(),store.lectures.list(),store.materials.list(),store.lectureFiles.list(),store.materialFiles.list()]));

export function SavedTableLayoutTest() {
  const language = useLanguage(), navigate = useNavigate(), location = useLocation();
  const [version,setVersion] = useState(0), [result,setResult] = useState("");
  async function seed() {
    const saved = await store.createRelated(batch);
    if (!saved.committed || saved.rejected.length) { setResult("Fixture rejected"); return; }
    sessionStorage.setItem("saved-layout-baseline",await snapshot());
    navigate({pathname:location.pathname,search:location.search || "?term="+id(1)},{replace:true});
    setVersion(value=>value+1);
    setResult("Synthetic fixture ready: first term has eight courses including one without meetings; second term has one without meetings.");
  }
  return <main>
    <h1>Saved table browser regression — synthetic data only</h1>
    <label>Test language <select value={language} onChange={event=>setLanguage(event.target.value==="ar"?"ar":"en")}><option value="en">English</option><option value="ar">العربية</option></select></label>
    <button onClick={()=>void seed()}>Create isolated fixture</button>
    <button onClick={()=>setResult(JSON.stringify(checkSavedTableLayout()))}>Run saved layout checks</button>
    <button onClick={()=>void snapshot().then(value=>setResult(value===sessionStorage.getItem("saved-layout-baseline")?"All persisted records unchanged":"Records differ"))}>Check persisted records</button>
    <output aria-label="Saved layout result" style={{display:"block",overflowWrap:"anywhere"}}>{result}</output>
    <Courses key={version} store={store}/>
  </main>;
}

setLanguage("en");
const root = createRoot(document.getElementById("root")!);
root.render(<BrowserRouter><SavedTableLayoutTest/></BrowserRouter>);
import.meta.hot?.dispose(()=>{root.unmount();store.close();});
