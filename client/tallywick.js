/**
 * tallywick browser client.
 *
 * No dependencies. Works in browsers, Workers, and Deno. Every call resolves,
 * never rejects. On any failure it resolves to null so the host page is never
 * blocked or broken.
 *
 * @module
 */

/**
 * @typedef {object} TallywickOptions
 * @property {"hit"|"get"} [mode="hit"]   Increment then read, or read only.
 * @property {number}      [by=1]         Amount to add on a hit, 1 to the server MAX_INCREMENT.
 * @property {"GET"|"POST"}[method="GET"] Use POST when the server sets REQUIRE_POST.
 * @property {number}      [timeoutMs=3000] Abort and resolve null after this long.
 * @property {AbortSignal} [signal]       Caller supplied abort signal.
 */

/**
 * Call a tallywick counter.
 *
 * @param {string} baseUrl   The deployment origin, for example https://tallywick-xxxx.deno.dev
 * @param {string} namespace Counter namespace, for example your site name
 * @param {string} key       Counter key, for example the page path
 * @param {TallywickOptions} [options]
 * @returns {Promise<number|null>} The count, or null when the service could not be reached.
 */
export async function tallywick(baseUrl, namespace, key, options = {}) {
  const { mode = "hit", by = 1, method = "GET", timeoutMs = 3000, signal } = options;

  const root = String(baseUrl).replace(/\/+$/, "");
  const verb = mode === "get" ? "get" : "hit";
  const ns = encodeURIComponent(namespace);
  const k = encodeURIComponent(key);
  let url = `${root}/v1/${verb}/${ns}/${k}`;
  if (verb === "hit" && by !== 1) url += `?by=${encodeURIComponent(by)}`;

  const controller = timeoutMs && !signal ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const res = await fetch(url, {
      method: verb === "get" ? "GET" : method,
      cache: "no-store",
      signal: signal ?? controller?.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.count === "number") return data.count;
    if (typeof data.countString === "string") return Number(data.countString);
    return null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Call a counter and write the result into a DOM node, but only when the count
 * is greater than zero. Useful for a footer view count.
 *
 * The view is recorded with one `hit`. If that request does not land, because
 * the visitor is briefly offline, a proxy hiccups, or the hit path is rate
 * limited, this falls back to a read (which is never rate limited) and retries
 * it a few times with backoff, so one transient failure does not leave the
 * counter blank for the whole visit.
 *
 * @param {string|Element} target   A selector or element to fill.
 * @param {string} baseUrl
 * @param {string} namespace
 * @param {string} key
 * @param {TallywickOptions & { format?: (n: number) => string }} [options]
 * @returns {Promise<number|null>}
 */
export async function mountTallywick(target, baseUrl, namespace, key, options = {}) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  if (!el) return null;

  const format = options.format ?? ((n) => n.toLocaleString());
  const apply = (count) => {
    if (typeof count !== "number" || count <= 0) return null;
    el.textContent = format(count);
    if ("hidden" in el) el.hidden = false;
    return count;
  };

  // First attempt records the view.
  const hit = apply(await tallywick(baseUrl, namespace, key, options));
  if (hit !== null) return hit;

  // The hit did not land. Read instead, and retry the read with backoff.
  for (const delay of [800, 2500, 6000, 15000]) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const read = apply(await tallywick(baseUrl, namespace, key, { ...options, mode: "get" }));
    if (read !== null) return read;
  }
  return null;
}
