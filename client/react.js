/**
 * React binding for tallywick. Requires React 16.8 or newer as a peer.
 *
 * @module
 */

import { useEffect, useState } from "react";
import { tallywick } from "./tallywick.js";

/**
 * Call a counter once on mount.
 *
 * `count` is null until the request resolves and stays null when the service
 * cannot be reached. Render nothing while it is null or zero.
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
    tallywick(baseUrl, namespace, key, options).then((count) => {
      if (!active) return;
      setState({
        count,
        loading: false,
        error: count === null ? new Error("tallywick unavailable") : null,
      });
    });
    return () => {
      active = false;
    };
    // Re-run only when the counter identity changes.
  }, [baseUrl, namespace, key]);

  return state;
}
