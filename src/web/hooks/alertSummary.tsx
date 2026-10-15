import { createContext, useContext, type ReactNode } from "react";
import type { AlertSummary } from "../api";
import { useApi } from "./useApi";
import { useRefresh } from "./live";
const Context = createContext<ReturnType<typeof useApi<AlertSummary>> & { revision: number }>({ loading: true, retry: () => {}, revision: 0 });
export function AlertSummaryProvider({ children }: { children: ReactNode }) {
  const revision = useRefresh();
  const result = useApi<AlertSummary>("/alerts/summary", revision);
  return <Context value={{ ...result, revision }}>{children}</Context>;
}
export const useAlertSummary = () => useContext(Context);
