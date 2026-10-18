import { PdfImportError, parseTimetablePages, type PdfTextPage } from "./pdf-layout";
import type { TimetableDraft } from "../../data";

const MAX_BYTES = 10 * 1024 * 1024;
/** No persistence/network endpoints. The PDF engine and worker are loaded only on demand. */
export async function extractTimetablePdf(file: File, base: TimetableDraft, signal: AbortSignal): Promise<TimetableDraft> {
  const abort = () => { if (signal.aborted) throw new DOMException("Cancelled", "AbortError"); };
  abort();
  if (file.size === 0 || file.size > MAX_BYTES || !/\.pdf$/i.test(file.name) ||
    (file.type && file.type !== "application/pdf" && file.type !== "application/octet-stream")) throw new PdfImportError("invalid");
  const bytes = new Uint8Array(await file.arrayBuffer());
  abort();
  if (!new TextDecoder("ascii").decode(bytes.subarray(0,8)).startsWith("%PDF-")) throw new PdfImportError("invalid");
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")]);
  abort();
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({data:bytes,disableFontFace:true,useSystemFonts:false,stopAtErrors:true});
  const cancel = () => { void task.destroy().catch(() => {}); };
  signal.addEventListener("abort",cancel,{once:true});
  try {
    const doc = await task.promise;
    abort();
    if (doc.numPages > 20) throw new PdfImportError("limit");
    const pages: PdfTextPage[] = [];
    let count = 0;
    for (let number=1;number<=doc.numPages;number++) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      abort();
      count += content.items.length;
      if (count > 50_000) throw new PdfImportError("limit");
      pages.push({items:content.items.flatMap(item => "str" in item ? [{text:item.str,x:item.transform[4],y:item.transform[5],width:item.width,height:item.height,dir:item.dir}] : [])});
      page.cleanup();
    }
    return parseTimetablePages(pages,base);
  } catch(error) {
    abort();
    if (error instanceof PdfImportError) throw error;
    throw new PdfImportError("malformed", {cause:error});
  } finally {
    signal.removeEventListener("abort",cancel);
    await task.destroy();
  }
}
