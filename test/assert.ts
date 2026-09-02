/**
 * Minimal assertions. They throw a plain Error on failure, so any test runner
 * that treats a thrown error as a failing test can use them. This keeps the
 * conformance suite runnable under both `deno test` and vitest.
 */

export function assert(cond: unknown, msg = "assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  const a = stringify(actual);
  const e = stringify(expected);
  if (a !== e) throw new Error(msg ?? `expected ${e}, got ${a}`);
}

export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  if (stringify(actual) === stringify(expected)) {
    throw new Error(msg ?? `expected value to differ from ${stringify(expected)}`);
  }
}

export function assertMatch(actual: string, re: RegExp, msg?: string): void {
  if (!re.test(actual)) throw new Error(msg ?? `expected ${JSON.stringify(actual)} to match ${re}`);
}

export async function assertRejects(fn: () => Promise<unknown>, msg?: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(msg ?? "expected the call to reject");
}

function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? `${val}n` : val));
}
