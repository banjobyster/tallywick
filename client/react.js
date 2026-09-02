/**
 * React binding for tallywick. Requires React 16.8 or newer as a peer.
 *
 * @module
 */

import { useEffect, useState } from "react";
import { tallywick } from "./tallywick.js";

/**
 * Call a counter on mount.
 *
 * The view is recorded with one `hit`. If that request does not land, the hook
 * falls back to a read (never rate limited) and retries it a few times with
 * backoff, so a transient failure does not leave `count` null for the whole
 * visit. `count` is null until a value arrives, and stays null only if every
 * attempt fails. Render nothing while it is null or zero.
 *
 * @param {string} baseUrl
 * @param {string} namespace
 * @param {string} key
 * @param {import("./tallywick.js").TallywickOptions} [options]
 * @returns {{ count: number|null, loading: boolean, error: Error|null }}
 */
export function useTallywick(baseUrl, namespace, key, options) {
  const [state, setState] = useState({ count: null, loading: true, error: null });

  useEffect(() => {
    let active = true;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      let count = await tallywick(baseUrl, namespace, key, options);
      for (const delay of [800, 2500, 6000, 15000]) {
        if (!active || typeof count === "number") break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        count = await tallywick(baseUrl, namespace, key, { ...options, mode: "get" });
      }
      if (!active) return;
      setState({
        count,
        loading: false,
        error: count === null ? new Error("tallywick unavailable") : null,
      });
    })();

    return () => {
      active = false;
    };
    // Re-run only when the counter identity changes.
  }, [baseUrl, namespace, key]);

  return state;
}
