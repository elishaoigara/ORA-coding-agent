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
  plugins: [require("@tailwindcss/typography")],
};
export default config;
