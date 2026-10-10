/**
 * Navy Command theme tokens for places that need raw color values (inline styles, canvas,
 * maps, SVG). Tailwind classes use the same values from tailwind.config.ts; iOS mirrors
 * them in Theme.swift. Never hard-code colors elsewhere — import from here.
 */
export const THEME = {
  canvas: "#0F172A",
  canvasDeep: "#0B1220",
  surface: "#1E293B",
  raised: "#273449",
  line: "#334155",
  lineStrong: "#475569",
  ink: "#F8FAFC",
  ink2: "#CBD5E1",
  ink3: "#94A3B8",
  primary: "#2563EB",
  primaryHover: "#1D4ED8",
  link: "#60A5FA",
  success: "#22C55E",
  warning: "#F59E0B",
  danger: "#DC2626",
  dangerInk: "#F87171",
} as const;
