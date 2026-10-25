import { useEffect, useId, useRef, useState } from "react";
import type { TimetableDraft } from "../data";
import { pdfText as p, type PdfFailure } from "../i18n/pdf";
import { PdfImportError } from "../features/timetable/pdf-layout";

export function PdfUpload({draft,disabled,onParsed,onPendingChange}: {draft:TimetableDraft;disabled:boolean;onPendingChange:(value:boolean)=>void;onParsed:(draft:TimetableDraft)=>void}) {
  const id=useId(), operation=useRef<AbortController|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<PdfFailure|null>(null);
  useEffect(()=>()=>operation.current?.abort(),[]);
  function cancel() { operation.current?.abort(); operation.current=null; setBusy(false); onPendingChange(false); }
  async function read(file:File) {
    if ((draft.courses.length || draft.sessions.length) && !window.confirm(p.replace)) return;
    operation.current?.abort();
    const controller=new AbortController(); operation.current=controller;
    setBusy(true);onPendingChange(true);setError(null);
    try {
      const {extractTimetablePdf}=await import("../features/timetable/pdf");
      if(controller.signal.aborted) return;
      const parsed=await extractTimetablePdf(file,draft,controller.signal);
      if(operation.current===controller && !controller.signal.aborted) onParsed(parsed);
    } catch(failure) {
      if(operation.current===controller && !controller.signal.aborted) setError(failure instanceof PdfImportError?failure.reason:"malformed");
    } finally { if(operation.current===controller) {operation.current=null;setBusy(false);onPendingChange(false);} }
  }
  return <section className="review-card pdf-upload" aria-label={p.import}>
    <h2>{p.import}</h2><p>{p.local}</p><p className="review-note">{p.sourceHint}</p>
    <label htmlFor={id}>{p.choose}</label>
    <input id={id} type="file" accept="application/pdf,.pdf" disabled={disabled||busy} onChange={e=>{const file=e.target.files?.[0];e.target.value="";if(file)void read(file);}}/>
    {busy && <><p role="status">{p.reading}</p><button onClick={cancel}>{p.cancel}</button></>}
    {error && <p role="alert">{p[error]}</p>}
  </section>;
}
