/**
 * Navy Command theme tokens (Dark + Light) for places that need color values outside Tailwind
 * classes (inline styles, canvas, maps, SVG). Tailwind classes resolve the same CSS variables
 * (`--c-*`, defined per theme in index.css); iOS mirrors them in Theme.swift.
 * Never hard-code colors elsewhere — import from here.
 */
const v = (name: string): string => `rgb(var(--c-${name}))`;

/** Theme-aware colors for inline styles (CSS variable references — switch with the theme). */
export const THEME = {
  canvas: v("canvas"),
  surface: v("surface"),
  raised: v("raised"),
  line: v("line"),
  lineStrong: v("line-strong"),
  ink: v("ink"),
  ink2: v("ink-2"),
  ink3: v("ink-3"),
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  link: v("link"),
  success: v("status-clear"),
  warning: v("status-follow"),
  danger: v("status-incident"),
  dangerInk: v("status-incident-ink"),
} as const;

/** Translucent tint of any THEME color (works with CSS variable colors). */
export const tint = (color: string, percent: number): string => `color-mix(in srgb, ${color} ${percent}%, transparent)`;

/**
 * Fixed hex values for renderers that can't read CSS variables (Leaflet SVG attributes, <canvas>).
 * These sit on map tiles / photos, so they're identical in both themes.
 */
export const RAW = {
  primary: "#2563EB",
  link: "#3B82F6",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#DC2626",
  muted: "#94A3B8",
} as const;

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** localStorage key — also read by the inline pre-paint script in index.html. Keep in sync. */
export const THEME_STORAGE_KEY = "pfw-theme";

/** Browser chrome / status-bar color per theme (matches the canvas). */
export const THEME_CHROME: Record<ResolvedTheme, string> = {
  dark: "#0F172A",
  light: "#F1F5F9",
};
