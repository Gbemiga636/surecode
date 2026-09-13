/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1d1f",
        paper: "#f5f5f7",
        pitch: "#0d9f6e",
        "pitch-deep": "#087a55",
        flood: "#1d1d1f",
        accent: "#0d9f6e",
        accent2: "#087a55",
        warn: "#b45309",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        app: "42rem",
        stage: "72rem",
      },
    },
  },
  plugins: [],
};
