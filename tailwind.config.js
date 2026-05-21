/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        appBg: "var(--bg)",
        appCard: "var(--card)",
        appDark: "var(--dark)",
        appGreen: "var(--green)",
        appOrange: "var(--orange)",
        appSoftOrange: "var(--soft-orange)",
        appText: "var(--text)",
        appMuted: "var(--muted)",
        appBorder: "var(--border)",
      },
      boxShadow: {
        soft: "0 18px 50px rgba(24, 31, 25, 0.10)",
        card: "0 12px 34px rgba(24, 31, 25, 0.08)",
        glow: "0 16px 32px rgba(221, 247, 180, 0.30)",
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Display", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
