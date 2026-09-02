import type { TallywickOptions } from "./tallywick";

export interface UseTallywickResult {
  /** The count, null until loaded, and null when the service is unreachable. */
  count: number | null;
  loading: boolean;
  error: Error | null;
}

/** Call a counter once on mount. Re-runs only when baseUrl, namespace, or key change. */
export function useTallywick(
  baseUrl: string,
  namespace: string,
  key: string,
  options?: TallywickOptions,
): UseTallywickResult;
