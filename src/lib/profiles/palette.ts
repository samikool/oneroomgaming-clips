/**
 * The colours a person can give their name. A fixed palette rather than a
 * picker, so chat stays readable and on-theme however wild people get. Pure:
 * the realtime process may import it.
 */
export const SURFACE = "#14161b";

export const ACCENTS = {
  cyan: "#1ec8e8",
  yellow: "#ffc21a",
  pink: "#ff6fb5",
  lime: "#9be15d",
  orange: "#ff9f43",
  violet: "#b69cff",
  red: "#ff6b6b",
  teal: "#2ee6b8",
  sky: "#6cb8ff",
  peach: "#ffb199",
  mint: "#a6f4c5",
  gold: "#e8c872",
} as const;

export type AccentKey = keyof typeof ACCENTS;
export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && Object.hasOwn(ACCENTS, value);
}

/** FNV-1a: stable across runs and processes, which Math.random is not. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function defaultAccent(username: string): AccentKey {
  return ACCENT_KEYS[hash(username) % ACCENT_KEYS.length];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
