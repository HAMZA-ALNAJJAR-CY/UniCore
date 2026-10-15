import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createAcademicStore } from "../../data";
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
  const [params, setParams] = useSearchParams();
  const selectedTermId = params.get("term") ?? initialTermId;
  const [request, setRequest] = useState(0);
  const readRequest = useMemo(() => ({ source, selectedTermId, request }), [source, selectedTermId, request]);
  const [result, setResult] = useState<{
    readRequest: typeof readRequest;
    data: Snapshot | null; error: boolean;
  } | null>(null);
  // Bind data and status to the exact request, including history transitions.
  const current = result?.readRequest === readRequest;
  useEffect(() => {
    let active = true;
    source
      .getTimetable(readRequest.selectedTermId)
      .then((value) => {
        if (active) {
          setResult({ readRequest, data: value, error: false });
        }
      })
      .catch(() => {
        if (active) setResult({ readRequest, data: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [source, readRequest]);
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
