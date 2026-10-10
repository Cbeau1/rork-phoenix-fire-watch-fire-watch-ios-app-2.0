import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ['"IBM Plex Mono"', "ui-monospace", "monospace"],
        crest: ["Cinzel", "serif"],
      },
      colors: {
        /* Navy Command theme — single source of truth for web colors (mirrors iOS Theme.swift). */
        canvas: {
          DEFAULT: "#0F172A",
          deep: "#0B1220",
        },
        rail: "#1E293B",
        surface: {
          DEFAULT: "#1E293B",
          hover: "#243247",
        },
        raised: {
          DEFAULT: "#273449",
          hover: "#2F3D54",
        },
        field: "#0F172A",
        line: {
          DEFAULT: "#334155",
          strong: "#475569",
          hover: "#64748B",
        },
        silver: "#E2E8F0",
        ink: {
          DEFAULT: "#F8FAFC",
          2: "#CBD5E1",
          3: "#94A3B8",
        },
        link: {
          DEFAULT: "#60A5FA",
          hover: "#93C5FD",
        },
        danger: {
          DEFAULT: "#DC2626",
          hover: "#B91C1C",
          ink: "#F87171",
        },
        status: {
          clear: "#22C55E",
          follow: "#F59E0B",
          incident: {
            DEFAULT: "#DC2626",
            ink: "#F87171",
          },
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "#2563EB",
          hover: "#1D4ED8",
          foreground: "#FFFFFF",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "#DC2626",
          foreground: "#FFFFFF",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(2, 6, 23, 0.35), 0 1px 1px rgba(2, 6, 23, 0.2)",
        pop: "0 18px 40px -12px rgba(2, 6, 23, 0.7)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "alert-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(220,38,38,0.55)" },
          "50%": { boxShadow: "0 0 0 5px rgba(220,38,38,0)" },
        },
        "primary-pulse": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(96,165,250,0.55)" },
          "50%": { boxShadow: "0 0 0 5px rgba(96,165,250,0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
        "alert-pulse": "alert-pulse 2.4s ease-in-out infinite",
        "primary-pulse": "primary-pulse 2.4s ease-in-out infinite",
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
} satisfies Config;
