import { useCallback, useEffect, useState } from "react";
import { useLive } from "./live";
import { api } from "../api";
import { mergeRows } from "../logic";
import { useApi } from "./useApi";
type Page<T> = { path: string; rows: T[]; next_cursor: string | null };
export function usePagedList<
  T extends { id: number },
  P extends { next_cursor: string | null },
>(
  path: string,
  select: (data: P) => T[],
) {
  const { reconnectRevision } = useLive();
  const fetchPage = useCallback(
    async (path: string, signal?: AbortSignal): Promise<Page<T>> => {
      const data = await api<P>(path, signal);
      return { path, rows: select(data), next_cursor: data.next_cursor };
    },
    [select],
  );
  const result = useApi(path, 0, fetchPage);
  const [extra, setExtra] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  const [request, setRequest] = useState<{
    path: string;
    cursor: string;
    nonce: number;
  } | null>(null);
  useEffect(() => {
    setRequest(null);
    setExtra([]);
    setCursor(null);
    setMoreError("");
    setLoadingMore(false);
  }, [path, reconnectRevision]);
  useEffect(() => {
    setCursor(result.data?.path === path ? result.data.next_cursor : null);
  }, [result.data, path]);
  useEffect(() => {
    if (!request || request.path !== path) return;
    const controller = new AbortController();
    setLoadingMore(true);
    setMoreError("");
    fetchPage(
      path + (path.includes("?") ? "&" : "?") +
        new URLSearchParams({ cursor: request.cursor }),
      controller.signal,
    )
      .then((page) => {
        if (controller.signal.aborted) return;
        setExtra((rows) => mergeRows(rows, page.rows));
        setCursor(page.next_cursor);
        setLoadingMore(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setMoreError(error instanceof Error ? error.message : String(error));
        setLoadingMore(false);
      });
    return () => controller.abort();
  }, [request, path, fetchPage, reconnectRevision]);
  function loadMore() {
    if (!cursor || loadingMore) return;
    setRequest((r) => ({ path, cursor, nonce: (r?.nonce ?? 0) + 1 }));
  }
  const data = result.data?.path === path ? result.data : undefined;
  return {
    ...result,
    data,
    rows: mergeRows(data?.rows ?? [], extra),
    hasMore: !!cursor,
    loadingMore,
    moreError,
    loadMore,
    retryMore: loadMore,
  };
}
