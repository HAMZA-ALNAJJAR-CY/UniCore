/** Real-browser assertions, not jsdom geometry. Open pdf-preview.html through
 * Vite and run at 360, 390, 430, 1280 and 1440px, in both languages.
 * The fixture includes long names, multiple meetings and uncertain/empty cells.
 * No database or PDF parsing is involved in this presentation regression. */
export function checkPdfPreviewLayout() {
  const table = document.querySelector<HTMLTableElement>(".editable-timetable table");
  if (!table) throw new Error("Editable preview is missing");
  const scroll = table.parentElement!;
  const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")];
  const courses = [...table.tBodies];
  const failures: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) failures.push(message); };
  const heights = rows.map(row => row.getBoundingClientRect().height);
  const courseHeights = courses.map(course => course.getBoundingClientRect().height);
  check(courses.length === 7 && courses.map(course => course.rows.length).join() === "1,2,3,3,2,1,3", "Seven-course/multi-meeting fixture is incomplete");
  check(courseHeights.every(height => height > 0 && height <= 220), "A whole course group exceeds 220px");
  check(courses.slice(1).every((course,index) => Math.abs(course.getBoundingClientRect().top - courses[index].getBoundingClientRect().bottom) <= 1), "Unexplained gap between courses");
  // Five actions must not force a normal meeting row to hundreds of pixels.
  check(heights.every(height => height > 0 && height <= 220), "Meeting row exceeds 220px");
  check(rows.every(row => getComputedStyle(row).display === "table-row"), "Native table rows lost");
  check(rows.slice(1).every((row,index) => Math.abs(row.getBoundingClientRect().top - rows[index].getBoundingClientRect().bottom) <= 1), "Unexplained gap between rows");
  const controls = [...table.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")];
  check(controls.every(control => Math.abs(control.getBoundingClientRect().height - 44) <= 1), "Input/select heights are inconsistent");
  check([...table.querySelectorAll("textarea")].every(control => control.scrollHeight <= control.clientHeight + 1), "Long name/instructor text is clipped");
  check([...table.querySelectorAll<HTMLElement>("input, select, textarea, button")].every(control => control.getBoundingClientRect().width <= scroll.clientWidth - 8), "A control is too wide to reveal inside the scroll viewport");
  check([...table.querySelectorAll<HTMLElement>("input, select, textarea, button")].every(control => {
    const cell = control.closest("td")!.getBoundingClientRect(), rect = control.getBoundingClientRect();
    return rect.left >= cell.left + 2 && rect.right <= cell.right - 2 && rect.top >= cell.top + 2 && rect.bottom <= cell.bottom - 2;
  }), "Control extends outside its table cell");
  check(rows.every(row => {
    const times = [...row.querySelectorAll<HTMLInputElement>('input[aria-label*="24"]')];
    return times.length === 0 || times.length === 2 && Math.abs(times[0].getBoundingClientRect().top - times[1].getBoundingClientRect().top) <= 1;
  }), "Start/end controls are not aligned in one time cell");
  check(document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, "Table causes page-level horizontal overflow");
  check(scroll.scrollWidth > scroll.clientWidth && getComputedStyle(scroll).overflowX === "auto", "Table is not internally scrollable");
  check(scroll.tabIndex === 0 && !!scroll.getAttribute("aria-label"), "Scroll region is not keyboard accessible/named");
  return { passed: failures.length === 0, failures, courseHeights, rowHeights: heights, viewport: innerWidth, direction: document.documentElement.dir, pageWidth: document.documentElement.scrollWidth, scrollWidth: scroll.scrollWidth, viewportWidth: scroll.clientWidth };
}
