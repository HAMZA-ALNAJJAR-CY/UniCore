/** A genuine, small PDF with positioned text, xref, and a Unicode font map.
 * All academic and header data is synthetic. No PDF-generation dependency. */
export function syntheticTimetablePdf({empty=false,scanned=false,arabic=false,shuffled=false,weekdayText="Sun Tue",offsetRows=false,underscoreTimes=false,arabicHeaders=false,pageFooter="",arabicTitle="مقرر تجريبي",pdfScript=false}={}) {
  const glyphs=[...new Set([...(arabic?arabicTitle+" مختبر":""),...(arabicHeaders?"رمز المقرر اسم المقرر النشاط عدد الساعات الشعبة الوقت القاعة المحاضر تاريخ التسجيل":""),...pageFooter])];
  const encode=(text:string)=>[...text].map(c=>(128+glyphs.indexOf(c)).toString(16).padStart(2,"0")).join("");
  const text=(x:number,y:number,value:string,rtl=false)=>`BT /${rtl?"F2":"F1"} 10 Tf 1 0 0 1 ${x} ${y} Tm ${rtl?"<"+encode([...value].reverse().join(""))+">":"("+value+")"} Tj ET`;
  const label=(x:number,en:string,ar:string)=>text(x,750,arabicHeaders?ar:en,arabicHeaders);
  const headers=[label(25,"Course code","رمز المقرر"),label(120,"Course name","اسم المقرر"),label(270,"Activity","النشاط"),label(340,"Credits","عدد الساعات"),label(400,"Section","الشعبة"),label(465,"Time","الوقت"),label(650,"Room","القاعة"),label(740,"Instructor","المحاضر"),label(870,"Registration date","تاريخ التسجيل")];
  const time=(value:string)=>underscoreTimes?value.replace("-","_"):value;
  const rows=[
    text(25,710,"SYN101"),text(120,710,arabic?arabicTitle:"Synthetic Algebra",arabic),text(270,710,"Theory"),text(340,710,"3"),text(400,710,"2"),text(465,710+(offsetRows?5.75:0),time("09:00-10:00 "+weekdayText)),text(650,710,"R-101"),text(740,710,"Synthetic Teacher"),text(870,710,"2038-09-01"),
    text(25,670,"SYN102"),text(120,670,"Synthetic Lab"),text(270,670,"Lab"),text(340,670,"1"),text(400,670,"1"),text(465,670+(offsetRows?5.75:0),time("12:00-14:00 Mon")),text(650,670,"online"),text(740,670,"Synthetic Instructor"),
    ...(pageFooter?[text(400,620,pageFooter,/[\u0600-\u06ff]/.test(pageFooter))]:[]),
  ];
  const content=scanned?"q 100 0 0 100 25 600 cm /Im1 Do Q":empty?"":text(25,800,"Synthetic Student ID: 00000000")+"\n"+(shuffled?[...headers,...rows].reverse():[...headers,...rows]).join("\n");
  const cmap=`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${glyphs.length} beginbfchar ${glyphs.map((c,i)=>`<${(128+i).toString(16)}> <${c.charCodeAt(0).toString(16).padStart(4,"0")}>`).join("\n")} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream=(data:string)=>`<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const objects=[`<< /Type /Catalog /Pages 2 0 R ${pdfScript?"/OpenAction << /S /JavaScript /JS (globalThis.__unicorePdfScriptExecuted=true) >>":""} >>`,"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 850] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> ${scanned?"/XObject << /Im1 8 0 R >>":""} >> /Contents 5 0 R >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",stream(content),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 7 0 R >>",stream(cmap)];
  if(scanned) objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\n000000>\nendstream");
  let pdf="%PDF-1.7\n";const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
