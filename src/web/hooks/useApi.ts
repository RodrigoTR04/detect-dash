import { useEffect, useState, useCallback } from "react";
import { useLive } from "./live";
import { api } from "../api";
export function useApi<T>(
  path: string | null,
  revision = 0,
  fetcher: (path: string, signal?: AbortSignal) => Promise<T> = api<T>,
) {
  const { reconnectRevision } = useLive();
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, error: undefined, loading: true }));
    fetcher(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            error: error instanceof Error ? error.message : String(error),
            loading: false,
          });
      });
    return () => controller.abort();
  }, [path, revision, retry, fetcher, reconnectRevision]);
  return { ...state, retry: useCallback(() => setRetry((n) => n + 1), []) };
}
