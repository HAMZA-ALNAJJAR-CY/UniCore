import type { createAcademicStore } from "../data";

export type ManualSetupStore = Pick<ReturnType<typeof createAcademicStore>, "academicTerms">;
type Fields = { name: string; year: string; semester: string };
type State = Fields & { status: "idle" | "pending" | "failed" | "saved"; termId?: string };
const empty = (): State => ({ name: "", year: "", semester: "1", status: "idle" });

/** One explicit setup operation per repository, shared across route mounts.
 * Single-flight promises survive departure. No natural-key/time-based dedup:
 * only consuming/cancelling this operation starts a separate setup operation.
 * Memory lifetime is this document; cross-tab/reload recovery is not provided.
 */
const operations = new WeakMap<ManualSetupStore["academicTerms"], ReturnType<typeof operation>>();
function operation(source: ManualSetupStore) {
  let state = empty();
  const listeners = new Set<() => void>();
  const publish = (next: State) => { state = next; listeners.forEach(listener => listener()); };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    edit: (fields: Partial<Fields>) => {
      if (state.status !== "pending" && state.status !== "saved") publish({ ...state, ...fields });
    },
    clear: () => { if (state.status !== "pending") publish(empty()); },
    submit: async () => {
      if (state.status === "pending" || state.status === "saved") return null;
      const input = { name: state.name, academicYear: state.year, semester: Number(state.semester) };
      publish({ ...state, status: "pending" });
      try {
        const term = await source.academicTerms.create(input);
        publish({ ...state, status: "saved", termId: term.id });
        return term.id;
      } catch {
        // Repository create is transactional: rejection leaves no partial term.
        publish({ ...state, status: "failed" });
        return null;
      }
    },
  };
}
export function manualSetupOperation(source: ManualSetupStore) {
  let current = operations.get(source.academicTerms);
  if (!current) { current = operation(source); operations.set(source.academicTerms, current); }
  return current;
}
