import { useEffect, useState } from "react";
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
  const [data, setData] = useState<Awaited<
    ReturnType<TimetableStore["getTimetable"]>
  > | null>(null);
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [request, setRequest] = useState({
      termId: initialTermId,
      version: 0,
    });
  useEffect(() => {
    let active = true;
    source
      .getTimetable(request.termId)
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
  }, [source, request]);
  return {
    data,
    error,
    loading,
    refresh: (termId = data?.termId) => {
      setLoading(true);
      setRequest((current) => ({ termId, version: current.version + 1 }));
    },
  };
}
