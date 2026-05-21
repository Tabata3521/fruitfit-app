import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class BootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", padding: 24, background: "#07110A", color: "#F7F7EF", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>FruitFit</h1>
        <p style={{ marginTop: 12, lineHeight: 1.5, color: "#DDF7B4" }}>Не удалось запустить экран приложения.</p>
        <p style={{ marginTop: 8, lineHeight: 1.5, color: "#A8B0A8" }}>{String(this.state.error?.message || this.state.error || "Runtime error")}</p>
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem("fruitfit.health");
            window.location.reload();
          }}
          style={{ marginTop: 18, height: 44, border: 0, borderRadius: 999, padding: "0 18px", background: "#BFF36B", color: "#101711", fontWeight: 900 }}
        >
          Очистить health cache и перезапустить
        </button>
      </main>
    );
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BootErrorBoundary>
      <App />
    </BootErrorBoundary>
  </React.StrictMode>,
);

const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());

if ("serviceWorker" in navigator && isNativeApp) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => caches?.keys?.())
      .then((keys) => Promise.all((keys || []).map((key) => caches.delete(key))))
      .catch(() => {});
  });
} else if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
