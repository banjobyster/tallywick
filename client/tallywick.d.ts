export interface TallywickOptions {
  /** Increment then read (`hit`, default), or read only (`get`). */
  mode?: "hit" | "get";
  /** Amount to add on a hit. 1 to the server `MAX_INCREMENT`. Default 1. */
  by?: number;
  /** Request method for a hit. Use `POST` when the server sets `REQUIRE_POST`. Default `GET`. */
  method?: "GET" | "POST";
  /** Abort and resolve null after this many milliseconds. Default 3000. */
  timeoutMs?: number;
  /** Caller supplied abort signal. Overrides the internal timeout. */
  signal?: AbortSignal;
}

/**
 * Call a tallywick counter. Always resolves. Returns the count, or null when
 * the service could not be reached.
 */
export function tallywick(
  baseUrl: string,
  namespace: string,
  key: string,
  options?: TallywickOptions,
): Promise<number | null>;

/**
 * Call a counter and write the result into a DOM node, but only when the count
 * is greater than zero.
 */
export function mountTallywick(
  target: string | Element,
  baseUrl: string,
  namespace: string,
  key: string,
  options?: TallywickOptions & { format?: (n: number) => string },
): Promise<number | null>;
