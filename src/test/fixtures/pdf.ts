/** A genuine, small PDF with positioned text, xref, and a Unicode font map.
 * All academic and header data is synthetic. No PDF-generation dependency. */
export function syntheticTimetablePdf({empty=false,scanned=false,arabic=false,shuffled=false,weekdayText="Sun Tue"}={}) {
  const glyphs=[...new Set([...(arabic?"مقرر تجريبي مختبر":"")])];
  const encode=(text:string)=>[...text].map(c=>(128+glyphs.indexOf(c)).toString(16).padStart(2,"0")).join("");
  const text=(x:number,y:number,value:string,rtl=false)=>`BT /${rtl?"F2":"F1"} 10 Tf 1 0 0 1 ${x} ${y} Tm ${rtl?"<"+encode([...value].reverse().join(""))+">":"("+value+")"} Tj ET`;
  const headers=[text(25,750,"Course code"),text(120,750,"Course name"),text(270,750,"Activity"),text(340,750,"Credits"),text(400,750,"Section"),text(465,750,"Time"),text(650,750,"Room"),text(740,750,"Instructor"),text(870,750,"Registration date")];
  const rows=[
    text(25,710,"SYN101"),text(120,710,arabic?"مقرر تجريبي":"Synthetic Algebra",arabic),text(270,710,"Theory"),text(340,710,"3"),text(400,710,"2"),text(465,710,"09:00-10:00 "+weekdayText),text(650,710,"R-101"),text(740,710,"Synthetic Teacher"),text(870,710,"2038-09-01"),
    text(25,670,"SYN102"),text(120,670,"Synthetic Lab"),text(270,670,"Lab"),text(340,670,"1"),text(400,670,"1"),text(465,670,"12:00-14:00 Mon"),text(650,670,"online"),text(740,670,"Synthetic Instructor"),
  ];
  const content=scanned?"q 100 0 0 100 25 600 cm /Im1 Do Q":empty?"":text(25,800,"Synthetic Student ID: 00000000")+"\n"+(shuffled?[...headers,...rows].reverse():[...headers,...rows]).join("\n");
  const cmap=`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Synthetic def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange ${glyphs.length} beginbfchar ${glyphs.map((c,i)=>`<${(128+i).toString(16)}> <${c.charCodeAt(0).toString(16).padStart(4,"0")}>`).join("\n")} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`;
  const stream=(data:string)=>`<< /Length ${data.length} >>\nstream\n${data}\nendstream`;
  const objects=["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>",`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1000 850] /Resources << /Font << /F1 4 0 R /F2 6 0 R >> ${scanned?"/XObject << /Im1 8 0 R >>":""} >> /Contents 5 0 R >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",stream(content),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 7 0 R >>",stream(cmap)];
  if(scanned) objects.push("<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\n000000>\nendstream");
  let pdf="%PDF-1.7\n";const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});
  const xref=pdf.length;
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(offset=>String(offset).padStart(10,"0")+" 00000 n \n").join("")+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
