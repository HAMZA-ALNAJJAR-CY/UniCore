import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { TimetableDraft } from "../../data";
import { PdfDraftTable } from "../../components/PdfDraftTable";
import { emptyDraft } from "../../features/timetable/draft";
import { setLanguage, useLanguage } from "../../i18n/locale";
import { checkPdfPreviewLayout } from "./pdf-preview-layout";
import "../../styles.css";

const fixture: TimetableDraft = {
  ...emptyDraft(),
  courses: Array.from({length:7}, (_, index) => ({
    key: `c${index+1}`, code: `SYN${101+index}`,
    name: index%2 ? "SyntheticCourseWithAnUnbrokenNameForLayoutTesting" : "مقرر تجريبي طويل الاسم لاختبار معاينة الجدول الجامعي",
    instructor: index%2 ? "SyntheticInstructorWithALongUnbrokenName" : "مدرس تجريبي ذو اسم طويل لاختبار العرض",
    registeredHours: 3, activityType: index===5 ? "practical" : "theory",
    section: "2", registrationDate: index===6 ? null : "2038-09-01", unconfirmed: index===6 ? ["registrationDate"] : [],
  })),
  // Same one/two/three-meeting geometry as the acceptance document. All values
  // are synthetic, including the deliberately incomplete final course meeting.
  sessions: [1,2,3,3,2,1,3].flatMap((count, courseIndex) => Array.from({length:count}, (_, meetingIndex) => ({
    key: `s${courseIndex+1}-${meetingIndex+1}`, courseKey: `c${courseIndex+1}`,
    dayOfWeek: courseIndex===6 && meetingIndex===2 ? 0 : [7,2,4][meetingIndex],
    startTime: "09:00", endTime: "10:00", room: courseIndex===6 ? null : "R-101",
    deliveryMode: courseIndex===6 ? "" : "in-person",
    notes: courseIndex===6 && meetingIndex===2 ? "Sun X: review original source" : null,
    unconfirmed: courseIndex===6 ? ["dayOfWeek", "room", "deliveryMode"] : [],
  }))),
  weekdayReviews: [{ key: "w1", courseKey: "c7", sourceText: "Sun X", recognizedDays: [7], unknownTokens: ["X"], acknowledged: false }],
};

export function PreviewLayoutTest() {
  const language = useLanguage();
  const [draft, setDraft] = useState(fixture);
  const [result, setResult] = useState<ReturnType<typeof checkPdfPreviewLayout>>();
  return <main style={{padding: 24, minWidth: 0}}>
    <h1>PDF preview layout regression — synthetic data only</h1>
    <label>Test language <select value={language} onChange={event => setLanguage(event.target.value === "ar" ? "ar" : "en")}><option value="en">English</option><option value="ar">العربية</option></select></label>
    <button onClick={() => setResult(checkPdfPreviewLayout())}>Run layout regression checks</button>
    <output aria-label="Layout regression result"><pre style={{whiteSpace: "pre-wrap", overflowWrap: "anywhere"}}>{result ? JSON.stringify(result, null, 2) : "Not run"}</pre></output>
    <div className="timetable-review"><PdfDraftTable draft={draft} onChange={setDraft}/></div>
  </main>;
}

setLanguage("en");
const root = createRoot(document.getElementById("root")!);
root.render(<PreviewLayoutTest/>);
import.meta.hot?.dispose(() => root.unmount());
