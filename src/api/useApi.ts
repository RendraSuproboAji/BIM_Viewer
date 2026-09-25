import { useCallback, useEffect, useState } from "react";
import { useViewer } from "../bim/store";

/**
 * Loads data from the API and reloads it whenever library data changes
 * (libraryVersion) or any of `deps` change.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const libraryVersion = useViewer((s) => s.libraryVersion);
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    run().then(
      (data) => !cancelled && setState({ data, error: null, loading: false }),
      (e: unknown) => !cancelled && setState({ data: null, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
    return () => {
      cancelled = true;
    };
  }, [run, libraryVersion]);

  return state;
}
