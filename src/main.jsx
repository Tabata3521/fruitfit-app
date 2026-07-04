import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const CLIENT_ERROR_STORAGE_KEY = "fruitfit.client.errors";

function saveBootError(entry = {}) {
  try {
    const current = JSON.parse(localStorage.getItem(CLIENT_ERROR_STORAGE_KEY) || "[]");
    const errors = Array.isArray(current) ? current : [];
    localStorage.setItem(CLIENT_ERROR_STORAGE_KEY, JSON.stringify([...errors, {
      at: new Date().toISOString(),
      type: "boot_error",
      ...entry,
    }].slice(-50)));
  } catch (_) {
    // Boot diagnostics must never make startup worse.
  }
}

function clearHealthCacheStorage() {
  if (typeof window === "undefined") return;
  const exactKeys = new Set([
    "fruitfit.health",
    "fruitfit.health.history",
    "fruitfit.health.preferredSourcePackage",
  ]);
  const prefixes = [
    "fruitfit.health:",
    "fruitfit.health.history:",
  ];

  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key) continue;
      if (exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch (_) {
    // Cache cleanup must never block the recovery button.
  }
}

if (typeof window !== "undefined" && !window.__fruitfitBootDiagnosticsInstalled) {
  window.__fruitfitBootDiagnosticsInstalled = true;
  window.addEventListener("error", (event) => {
    saveBootError({
      type: "window_error",
      message: event.message,
      source: event.filename,
      line: event.lineno,
      column: event.colno,
      stack: String(event.error?.stack || ""),
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    saveBootError({
      type: "unhandledrejection",
      message: String(event.reason?.message || event.reason || "Unhandled promise rejection"),
      stack: String(event.reason?.stack || ""),
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  });
}

class BootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    saveBootError({
      message: String(error?.message || error || "Runtime error"),
      stack: String(error?.stack || ""),
      componentStack: String(info?.componentStack || ""),
      url: window.location.href,
      userAgent: navigator.userAgent,
    });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", padding: 24, background: "#07110A", color: "#F7F7EF", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>FruitFit</h1>
        <p style={{ marginTop: 12, lineHeight: 1.5, color: "#DDF7B4" }}>Не удалось открыть этот экран.</p>
        <p style={{ marginTop: 8, lineHeight: 1.5, color: "#A8B0A8" }}>Перезапустите приложение. Если ошибка повторится, отправьте отчёт тренеру.</p>
        <button
          type="button"
          onClick={() => {
            const report = localStorage.getItem(CLIENT_ERROR_STORAGE_KEY) || "[]";
            navigator.clipboard?.writeText?.(report);
          }}
          style={{ marginTop: 18, height: 44, border: "1px solid rgba(191,243,107,0.35)", borderRadius: 999, padding: "0 18px", background: "transparent", color: "#DDF7B4", fontWeight: 900 }}
        >
          Скопировать отчёт
        </button>
        <button
          type="button"
          onClick={() => {
            clearHealthCacheStorage();
            window.location.reload();
          }}
          style={{ marginTop: 18, height: 44, border: 0, borderRadius: 999, padding: "0 18px", background: "#BFF36B", color: "#101711", fontWeight: 900 }}
        >
          Перезапустить приложение
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
