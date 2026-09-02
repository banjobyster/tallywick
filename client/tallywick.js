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
 * @param {string} baseUrl   The deployment origin, for example https://tallywick-xxx.deno.dev
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
 * @param {string|Element} target   A selector or element to fill.
 * @param {string} baseUrl
 * @param {string} namespace
 * @param {string} key
 * @param {TallywickOptions & { format?: (n: number) => string }} [options]
 * @returns {Promise<number|null>}
 */
export async function mountTallywick(target, baseUrl, namespace, key, options = {}) {
  const el = typeof target === "string" ? document.querySelector(target) : target;
  const count = await tallywick(baseUrl, namespace, key, options);
  if (el && typeof count === "number" && count > 0) {
    const format = options.format ?? ((n) => n.toLocaleString());
    el.textContent = format(count);
    if ("hidden" in el) el.hidden = false;
  }
  return count;
}
