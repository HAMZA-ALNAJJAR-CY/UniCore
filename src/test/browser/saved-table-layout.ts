/** Run in Chromium against the saved Courses page, not the PDF draft.
 * Rows are measured by course UUID; zero-session courses have one placeholder.
 * Limits describe the normal fixture content, never constrain production CSS. */
export function checkSavedTableLayout() {
  const scroll = document.querySelector<HTMLElement>(".academic-table-scroll:not(.editable-timetable)");
  const table = scroll?.querySelector("table");
  if (!scroll || !table) throw new Error("Saved timetable is missing");
  const groups = [...table.tBodies];
  const failures: string[] = [];
  const check = (value: boolean, message: string) => { if (!value) failures.push(message); };
  const measured = groups.map((group,index) => ({
    id: group.id, rows: group.rows.length,
    height: group.getBoundingClientRect().height,
    maxRowHeight: Math.max(...[...group.rows].map(row => row.getBoundingClientRect().height)),
    gap: index ? group.getBoundingClientRect().top - groups[index-1].getBoundingClientRect().bottom : 0,
  }));
  check(new Set(measured.map(group => group.id)).size === groups.length, "Duplicate course target/identity");
  check(measured.every(group => group.maxRowHeight > 0 && group.maxRowHeight <= 160 && group.height <= Math.max(160,group.rows * 80)), "Oversized saved course/session rows");
  check(measured.every(group => Math.abs(group.gap) <= 1), "Gap between course groups");
  check(groups.every(group => group.tabIndex === -1 && group.querySelector('th[scope="rowgroup"]')?.getAttribute("rowspan") === String(group.rows.length)), "Course headers/anchor semantics lost");
  check(groups.every(group => !group.rows[0].cells[0].querySelector("button") && !group.querySelector('th[scope="rowgroup"]')?.querySelector("button")), "Management controls inside course code/name");
  check(groups.every(group => {
    const first = group.rows[0];
    return first.cells[first.cells.length-2].querySelectorAll(".saved-course-actions button").length === 3 &&
      [...group.rows].every(row => row.lastElementChild?.querySelectorAll(".table-actions button").length === (row.dataset.sessionId ? 2 : 0));
  }), "Actions detached from final course/session columns");
  check([...table.querySelectorAll("tbody tr")].every(row => getComputedStyle(row).display === "table-row"), "Native table layout lost");
  check(groups.every(group => [...group.rows].slice(1).every((row,index) => Math.abs(row.getBoundingClientRect().top - group.rows[index].getBoundingClientRect().bottom) <= 1)), "Gap between a course's meeting rows");
  check([...table.querySelectorAll<HTMLElement>("th, td")].every(cell => cell.scrollWidth <= cell.clientWidth + 1), "Text/control content overflows a saved table cell");
  check([...table.querySelectorAll("button")].every(button => {
    const box = button.getBoundingClientRect(), cell = button.closest("td, th")!.getBoundingClientRect();
    return box.left >= cell.left + 2 && box.right <= cell.right - 2 && box.top >= cell.top + 2 && box.bottom <= cell.bottom - 2 && box.width <= scroll.clientWidth - 8;
  }), "Clipped/unreachable saved table action");
  check(scroll.tabIndex === 0 && !!scroll.getAttribute("aria-label") && getComputedStyle(scroll).overflowX === "auto" && scroll.scrollWidth > scroll.clientWidth, "Named keyboard scroll region lost");
  check(document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1, "Page-level horizontal overflow");
  return { passed: failures.length === 0, failures, groups: measured, width: innerWidth, direction: document.documentElement.dir, page: document.documentElement.scrollWidth, viewport: scroll.clientWidth, table: scroll.scrollWidth };
}
