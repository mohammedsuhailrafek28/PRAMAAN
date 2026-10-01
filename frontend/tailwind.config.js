import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "sans-serif",
        ],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          50: "#eef3ff",
          100: "#dfe8ff",
          200: "#c1d1ff",
          300: "#98b1ff",
          400: "#6b87fa",
          500: "#3f5eee",
          600: "#2541d6",
          700: "#1c33b0",
          800: "#182c8c",
          900: "#0f1c5c",
          950: "#0a1440",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Semantic status palette. One meaning per colour:
        // positive = current / cross-checked / active, info = in progress,
        // warning = stale / expiring, negative = conflict / missing / revoked / expired.
        positive: {
          DEFAULT: "#059669",
          bg: "#ecfdf5",
          border: "#a7f3d0",
          foreground: "#065f46",
        },
        negative: {
          DEFAULT: "#dc2626",
          bg: "#fef2f2",
          border: "#fecaca",
          foreground: "#991b1b",
        },
        info: {
          DEFAULT: "#2541d6",
          bg: "#eef3ff",
          border: "#c1d1ff",
          foreground: "#182c8c",
        },
        verified: {
          DEFAULT: "#059669",
          bg: "#ecfdf5",
          border: "#a7f3d0",
          foreground: "#065f46",
        },
        warning: {
          DEFAULT: "#d97706",
          bg: "#fffbeb",
          border: "#fde68a",
          foreground: "#92400e",
        },
        surface: {
          DEFAULT: "#f8fafc",
          hover: "#f1f5f9",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        subtle: "0 1px 2px 0 rgb(15 23 42 / 0.04)",
        card: "0 1px 3px 0 rgb(15 23 42 / 0.06), 0 1px 2px -1px rgb(15 23 42 / 0.06)",
        panel: "0 4px 16px -4px rgb(15 23 42 / 0.08), 0 2px 6px -2px rgb(15 23 42 / 0.06)",
        raised: "0 12px 32px -12px rgb(15 23 42 / 0.18), 0 2px 6px -2px rgb(15 23 42 / 0.06)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        shimmer: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        shimmer: "shimmer 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
