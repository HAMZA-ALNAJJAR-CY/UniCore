import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { createAcademicStore } from "../../data";
const store = createAcademicStore();
export type TimetableStore = Pick<
  ReturnType<typeof createAcademicStore>,
  "getTimetable"
>;
export function useTimetable(
  source: TimetableStore = store,
  initialTermId?: string,
) {
  const [params, setParams] = useSearchParams();
  const selectedTermId = params.get("term") ?? initialTermId;
  const [data, setData] = useState<Awaited<
    ReturnType<TimetableStore["getTimetable"]>
  > | null>(null);
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [request, setRequest] = useState(0);
  useEffect(() => {
    let active = true;
    source
      .getTimetable(selectedTermId)
      .then((value) => {
        if (active) {
          setData(value);
          setError(false);
        }
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [source, request, selectedTermId]);
  return {
    data,
    error,
    loading,
    refresh: (termId = data?.termId) => {
      setLoading(true);
      if (termId) setParams(current => { current.set("term", termId); return current; });
      if (termId === selectedTermId || !termId) setRequest(current => current + 1);
    },
  };
}
