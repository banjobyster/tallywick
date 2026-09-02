import { useTallywick } from "../react.js";

const BASE = "https://tallywick-xxxx.deno.dev";

export function ViewCount() {
  const { count } = useTallywick(BASE, "example-site", "home");

  // Render nothing until the count loads, and nothing at zero.
  if (!count) return null;

  return <span className="views">{count.toLocaleString()} views</span>;
}
