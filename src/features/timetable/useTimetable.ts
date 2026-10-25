import { useContext, useEffect, useMemo, useState } from "react";
import { UNSAFE_DataRouterContext, useLocation, useSearchParams } from "react-router-dom";
import { createAcademicStore, DataError } from "../../data";
const store = createAcademicStore();
export type TimetableStore = Pick<
  ReturnType<typeof createAcademicStore>,
  "getTimetable"
>;
type Snapshot = Awaited<ReturnType<TimetableStore["getTimetable"]>>;
export function useTimetable(
  source: TimetableStore = store,
  initialTermId?: string,
) {
  return useTimetableSnapshot(source, initialTermId);
}

/** Reuse the same request/term-recovery lifecycle for extended read-only snapshots. */
export function useTimetableSnapshot<T extends Snapshot>(
  source: { getTimetable: (termId?: string) => Promise<T> },
  initialTermId?: string,
) {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  const selectedTermId = params.get("term") ?? initialTermId;
  const [request, setRequest] = useState(0);
  const readRequest = useMemo(() => ({ source, selectedTermId, request, location }), [source, selectedTermId, request, location]);
  const [result, setResult] = useState<{
    readRequest: typeof readRequest;
    data: T | null; error: boolean;
  } | null>(null);
  // Bind data and status to the exact request, including history transitions.
  const current = result?.readRequest === readRequest;
  useEffect(() => {
    let active = true;
    const current = () => {
      const next = router?.state.location;
      return active && (!next || (next.key === location.key && next.pathname === location.pathname && next.search === location.search));
    };
    let recovered = false;
    source
      .getTimetable(readRequest.selectedTermId)
      .catch((failure: unknown) => {
        if (current() && selectedTermId && failure instanceof DataError &&
          (failure.code === "VALIDATION" || failure.code === "NOT_FOUND")) {
          recovered = true;
          return source.getTimetable();
        }
        throw failure;
      })
      .then((value) => {
        if (current()) {
          setResult({ readRequest, data: value, error: false });
          if (recovered) setParams(current => {
            const next = new URLSearchParams(current);
            if (value.termId) next.set("term", value.termId);
            else next.delete("term");
            return next;
          }, { replace: true, state: location.state ? { ...location.state, termId: value.termId } : null });
        }
      })
      .catch(() => {
        if (current()) setResult({ readRequest, data: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [source, readRequest, selectedTermId, location, router, setParams]);
  const data = current ? result.data : null;
  return {
    data,
    error: current && result.error,
    loading: !current,
    refresh: (termId = selectedTermId ?? data?.termId) => {
      const actualTerm = selectedTermId ?? data?.termId;
      if (termId && termId !== actualTerm)
        setParams(current => { current.set("term", termId); return current; });
      else setRequest(current => current + 1);
    },
  };
}
