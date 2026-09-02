/**
 * SVG badge renderer.
 *
 * A pure function. No network, no fonts embedded. Text width is estimated from a
 * fixed Verdana 11px table, the same approach Shields uses, so the label never
 * clips. Four styles are supported.
 */

/** Badge visual style. */
export type BadgeStyle = "flat" | "flat-square" | "plastic" | "for-the-badge";

/** Inputs for {@link renderBadge}. */
export interface BadgeOptions {
  label: string;
  value: string;
  /** Right side colour. Named or hex. */
  color?: string;
  /** Left side colour. Named or hex. */
  labelColor?: string;
  style?: BadgeStyle;
}

// Verdana 11px advance widths in tenths of a pixel, char codes 32 to 126.
const W = [
  34,
  34,
  43,
  84,
  68,
  109,
  84,
  23,
  43,
  43,
  68,
  84,
  34,
  43,
  34,
  34,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  68,
  34,
  34,
  84,
  84,
  84,
  56,
  124,
  75,
  74,
  77,
  83,
  68,
  62,
  85,
  84,
  34,
  34,
  73,
  59,
  97,
  84,
  88,
  68,
  88,
  76,
  69,
  65,
  82,
  73,
  109,
  73,
  69,
  69,
  43,
  34,
  43,
  84,
  55,
  68,
  66,
  69,
  57,
  69,
  66,
  39,
  69,
  69,
  30,
  30,
  63,
  30,
  107,
  69,
  68,
  69,
  69,
  46,
  54,
  41,
  69,
  63,
  90,
  63,
  63,
  55,
  68,
  34,
  68,
  84,
];

const NAMED: Record<string, string> = {
  brightgreen: "#4c1",
  green: "#97ca00",
  yellowgreen: "#a4a61d",
  yellow: "#dfb317",
  orange: "#fe7d37",
  red: "#e05d44",
  blue: "#007ec6",
  grey: "#555",
  gray: "#555",
  lightgrey: "#9f9f9f",
  lightgray: "#9f9f9f",
  success: "#4c1",
  informational: "#007ec6",
  critical: "#e05d44",
  inactive: "#9f9f9f",
};

/** Normalise a colour name or hex string to a CSS hex value. */
export function resolveColor(input: string | undefined, fallback: string): string {
  if (!input) return fallback;
  const s = input.trim().toLowerCase();
  if (NAMED[s]) return NAMED[s];
  if (/^#?[0-9a-f]{3}$/.test(s) || /^#?[0-9a-f]{6}$/.test(s) || /^#?[0-9a-f]{8}$/.test(s)) {
    return s.startsWith("#") ? s : `#${s}`;
  }
  return fallback;
}

function textWidth(s: string, tracking = 0): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    total += (code >= 32 && code <= 126 ? W[code - 32] : 70) / 10;
    total += tracking;
  }
  return total;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Format a count for badge display. `1234` becomes `1.2k`, `3400000` becomes `3.4M`. */
export function abbreviate(n: bigint): string {
  const abs = n < 0n ? -n : n;
  if (abs < 1000n) return n.toString();
  const units: [bigint, string][] = [
    [1_000_000_000_000n, "T"],
    [1_000_000_000n, "B"],
    [1_000_000n, "M"],
    [1_000n, "k"],
  ];
  for (const [size, suffix] of units) {
    if (abs >= size) {
      const whole = abs / size;
      const frac = ((abs % size) * 10n) / size;
      const body = whole >= 100n || frac === 0n ? `${whole}` : `${whole}.${frac}`;
      return `${n < 0n ? "-" : ""}${body}${suffix}`;
    }
  }
  return n.toString();
}

/**
 * Render a badge to an SVG string.
 */
export function renderBadge(opts: BadgeOptions): string {
  const style: BadgeStyle = opts.style ?? "flat";
  const forBadge = style === "for-the-badge";
  const height = style === "plastic" ? 18 : forBadge ? 28 : 20;
  const rounded = style === "flat" || style === "plastic";
  const tracking = forBadge ? 1 : 0;

  const label = forBadge ? opts.label.toUpperCase() : opts.label;
  const value = forBadge ? opts.value.toUpperCase() : opts.value;

  const pad = forBadge ? 18 : 10;
  const leftW = Math.round(textWidth(label, tracking)) + pad;
  const rightW = Math.round(textWidth(value, tracking)) + pad;
  const totalW = leftW + rightW;

  const labelColor = resolveColor(opts.labelColor, "#555");
  const color = resolveColor(opts.color, "#4c1");

  const fontSize = forBadge ? 10 : 11;
  const textY = forBadge ? Math.round(height / 2) + 3 : 14;
  const shadowY = textY + 1;
  const midLeft = leftW / 2;
  const midRight = leftW + rightW / 2;
  const weight = forBadge ? ' font-weight="bold"' : "";
  const trackAttr = tracking ? ` letter-spacing="${tracking}"` : "";

  const gradient = style === "flat-square" || forBadge
    ? ""
    : `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>`;
  const gradientRect = gradient
    ? `<rect width="${totalW}" height="${height}" fill="url(#s)"/>`
    : "";
  const clip = rounded
    ? `<clipPath id="r"><rect width="${totalW}" height="${height}" rx="3" fill="#fff"/></clipPath>`
    : "";
  const groupOpen = rounded ? `<g clip-path="url(#r)">` : `<g>`;

  const aria = escapeXml(`${opts.label}: ${opts.value}`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" role="img" aria-label="${aria}">` +
    `<title>${aria}</title>` +
    `<defs>${gradient}${clip}</defs>` +
    groupOpen +
    `<rect width="${leftW}" height="${height}" fill="${labelColor}"/>` +
    `<rect x="${leftW}" width="${rightW}" height="${height}" fill="${color}"/>` +
    gradientRect +
    `</g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="${fontSize}"${weight}${trackAttr}>` +
    `<text x="${midLeft}" y="${shadowY}" fill="#010101" fill-opacity=".3">${
      escapeXml(label)
    }</text>` +
    `<text x="${midLeft}" y="${textY}">${escapeXml(label)}</text>` +
    `<text x="${midRight}" y="${shadowY}" fill="#010101" fill-opacity=".3">${
      escapeXml(value)
    }</text>` +
    `<text x="${midRight}" y="${textY}">${escapeXml(value)}</text>` +
    `</g></svg>`;
}
