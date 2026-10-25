const KEY = "unicore.onboarding.complete";
let completedInMemory = false;
export function introductionComplete() {
  try {
    return localStorage.getItem(KEY) === "done" || completedInMemory;
  } catch {
    return completedInMemory;
  }
}
export function finishIntroduction() {
  completedInMemory = true;
  try {
    localStorage.setItem(KEY, "done");
  } catch {
    /* Completion remains usable without storage permission. */
  }
}
export function resetIntroduction() {
  completedInMemory = false;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* An explicit replay remains available in memory. */
  }
}
