import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        agent: "rgb(var(--color-agent) / <alpha-value>)",
        git: "rgb(var(--color-git) / <alpha-value>)",
      },
    },
  },
  plugins: [
    require("@tailwindcss/typography"),
    // Adds a `light:` variant, active whenever an ancestor has class="light".
    // The app is dark-by-default (all existing unprefixed utility classes
    // ARE the dark theme, unchanged) — `light:` classes are additive
    // overrides layered on top, toggled by adding/removing `.light` on
    // <html>. This means enabling the light theme can never regress the
    // dark theme, since no existing class name changes meaning.
    function ({ addVariant }: { addVariant: (name: string, definition: string) => void }) {
      addVariant("light", ".light &");
    },
  ],
};
export default config;
