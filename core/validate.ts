/**
 * Input validation for namespace and key path segments.
 */

import type { Config } from "./types.ts";

/** Outcome of {@link validateName}. */
export type NameCheck =
  | { ok: true; namespace: string; key: string; name: string }
  | { ok: false; code: "bad_namespace" | "bad_key" | "namespace_not_allowed"; field: string };

/**
 * Validate a `namespace` and `key` pair against the configured pattern and the
 * optional namespace allow list. On success returns the joined store name.
 */
export function validateName(namespace: string, key: string, config: Config): NameCheck {
  if (!config.keyPattern.test(namespace)) {
    return { ok: false, code: "bad_namespace", field: "namespace" };
  }
  if (!config.keyPattern.test(key)) {
    return { ok: false, code: "bad_key", field: "key" };
  }
  if (config.namespaceAllowlist && !config.namespaceAllowlist.includes(namespace)) {
    return { ok: false, code: "namespace_not_allowed", field: "namespace" };
  }
  return { ok: true, namespace, key, name: `${namespace}/${key}` };
}

/** Split a store name back into its parts. */
export function splitName(name: string): { namespace: string; key: string } {
  const i = name.indexOf("/");
  if (i < 0) return { namespace: name, key: "" };
  return { namespace: name.slice(0, i), key: name.slice(i + 1) };
}

/** Parse and bound the `by` query parameter for the hit route. */
export function parseIncrement(
  raw: string | null,
  max: number,
): { ok: true; value: bigint } | { ok: false } {
  if (raw === null || raw === "") return { ok: true, value: 1n };
  if (!/^[0-9]+$/.test(raw)) return { ok: false };
  const value = BigInt(raw);
  if (value < 1n || value > BigInt(max)) return { ok: false };
  return { ok: true, value };
}
