import { Capacitor } from "@capacitor/core";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Bell, ChevronRight, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { healthProviderStates, openHealthSettings } from "../services/health/healthProvider";
import { useHealth } from "../data/healthStore";
import {
  healthOnboardingDue,
  markHealthOnboardingSessionHandled,
  readHealthOnboardingState,
  updateHealthOnboardingState,
} from "../data/healthOnboarding";
import {
  getFirebaseMessagingPermissionStatus,
  openFirebaseMessagingSettings,
  registerFirebaseMessagingPush,
} from "../services/notifications/firebaseMessagingPush";
import { trackAnalyticsEvent } from "../services/attribution";

const ACTIVE_USE_DELAY_MS = 20 * 1000;
const READABLE_HEALTH_STATES = new Set([
  healthProviderStates.CONNECTED,
  healthProviderStates.PARTIALLY_GRANTED,
  healthProviderStates.NO_DATA,
]);
const FULLY_CONNECTED_HEALTH_STATES = new Set([
  healthProviderStates.CONNECTED,
  healthProviderStates.NO_DATA,
]);

export default function HealthConnectionOnboarding({ user, blocked = false }) {
  const { availability, requestConnection } = useHealth();
  const [stage, setStage] = useState(null);
  const [notification, setNotification] = useState({ status: "unknown", ok: false });
  const [healthMessage, setHealthMessage] = useState("");
  const [notificationMessage, setNotificationMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [foreignModalOpen, setForeignModalOpen] = useState(false);
  const elapsedRef = useRef(0);
  const startedAtRef = useRef(0);
  const lastErrorAtRef = useRef(0);

  const native = Capacitor.isNativePlatform?.() && ["android", "ios"].includes(Capacitor.getPlatform?.());
  const healthReadable = READABLE_HEALTH_STATES.has(availability?.state);
  const healthConnected = FULLY_CONNECTED_HEALTH_STATES.has(availability?.state);
  const notificationConnected = notification?.permissions?.receive === "granted" || notification?.ok;
  const fullyConnected = healthConnected && notificationConnected;

  useEffect(() => {
    if (!native) return undefined;
    let alive = true;
    getFirebaseMessagingPermissionStatus()
      .then((result) => {
        if (alive) setNotification(result || { status: "unknown", ok: false });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [native]);

  useEffect(() => {
    const onModalState = (event) => setForeignModalOpen(Boolean(event?.detail?.open));
    window.addEventListener("fruitfit:modal-state", onModalState);
    return () => window.removeEventListener("fruitfit:modal-state", onModalState);
  }, []);

  useEffect(() => {
    const rememberError = () => {
      lastErrorAtRef.current = Date.now();
    };
    window.addEventListener("error", rememberError);
    window.addEventListener("unhandledrejection", rememberError);
    window.addEventListener("fruitfit:app-error", rememberError);
    return () => {
      window.removeEventListener("error", rememberError);
      window.removeEventListener("unhandledrejection", rememberError);
      window.removeEventListener("fruitfit:app-error", rememberError);
    };
  }, []);

  useEffect(() => {
    if (!native || !user || blocked || foreignModalOpen || fullyConnected || !healthOnboardingDue(user)) return undefined;
    let timer;
    const schedule = () => {
      if (document.visibilityState !== "visible") return;
      startedAtRef.current = Date.now();
      const remaining = Math.max(0, ACTIVE_USE_DELAY_MS - elapsedRef.current);
      timer = window.setTimeout(() => {
        if (Date.now() - lastErrorAtRef.current < 30 * 1000) {
          elapsedRef.current = Math.max(0, ACTIVE_USE_DELAY_MS - 5000);
          schedule();
          return;
        }
        markHealthOnboardingSessionHandled(user);
        updateHealthOnboardingState(user, { shownAt: new Date().toISOString() });
        trackAnalyticsEvent("health_onboarding_shown", { screen: "home", source: "active_use" });
        setStage("intro");
      }, remaining);
    };
    const pause = () => {
      if (timer) window.clearTimeout(timer);
      if (startedAtRef.current) elapsedRef.current += Date.now() - startedAtRef.current;
      startedAtRef.current = 0;
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
      else pause();
    };
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      pause();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [blocked, foreignModalOpen, fullyConnected, native, user]);

  useEffect(() => {
    if (!fullyConnected || !user) return;
    updateHealthOnboardingState(user, { completedAt: new Date().toISOString() });
  }, [fullyConnected, user]);

  const healthStatus = useMemo(() => {
    if (healthReadable) return availability?.state === healthProviderStates.PARTIALLY_GRANTED ? "Подключено частично" : "Подключено";
    if (availability?.state === healthProviderStates.NOT_INSTALLED) {
      return Capacitor.getPlatform?.() === "ios" ? "Apple Health недоступен" : "Health Connect не установлен";
    }
    if (availability?.state === healthProviderStates.NOT_SUPPORTED) return "Недоступно на устройстве";
    if (availability?.state === healthProviderStates.ERROR) return "Не удалось проверить";
    return "Не подключено";
  }, [availability?.state, healthReadable]);

  function later() {
    updateHealthOnboardingState(user, { laterAt: new Date().toISOString() });
    markHealthOnboardingSessionHandled(user);
    trackAnalyticsEvent("health_onboarding_later_clicked", { screen: "home" });
    setStage(null);
  }

  function openChoices() {
    trackAnalyticsEvent("health_onboarding_connect_clicked", { screen: "home" });
    setStage("choices");
  }

  function finishChoices() {
    if (!fullyConnected) updateHealthOnboardingState(user, { laterAt: new Date().toISOString() });
    setStage(null);
  }

  async function connectHealth() {
    if (busy) return;
    setBusy("health");
    setHealthMessage("");
    await trackAnalyticsEvent("health_permission_requested", { screen: "health_onboarding" });
    try {
      const result = await requestConnection?.({ openSettingsOnMissing: false });
      if (READABLE_HEALTH_STATES.has(result?.state)) {
        setHealthMessage(result?.state === healthProviderStates.PARTIALLY_GRANTED ? "Часть данных активности подключена." : "Данные активности подключены.");
        updateHealthOnboardingState(user, { healthGrantedAt: new Date().toISOString() });
        trackAnalyticsEvent("health_permission_granted", { screen: "health_onboarding" });
      } else {
        setHealthMessage(result?.message || "Разрешение не выдано. Его можно включить в системных настройках.");
        trackAnalyticsEvent("health_permission_denied", { screen: "health_onboarding", source: result?.state || "unknown" });
      }
    } catch (error) {
      setHealthMessage(error?.message || "Не удалось подключить данные активности.");
      trackAnalyticsEvent("health_permission_denied", { screen: "health_onboarding", source: "client_error" });
    } finally {
      setBusy("");
    }
  }

  async function connectNotifications() {
    if (busy) return;
    setBusy("notifications");
    setNotificationMessage("");
    await trackAnalyticsEvent("notification_permission_requested", { screen: "health_onboarding" });
    try {
      const result = await registerFirebaseMessagingPush({ force: true, prompt: true });
      setNotification(result || { status: "unknown", ok: false });
      if (result?.ok) {
        setNotificationMessage("Уведомления включены.");
        updateHealthOnboardingState(user, { notificationGrantedAt: new Date().toISOString() });
        trackAnalyticsEvent("notification_permission_granted", { screen: "health_onboarding" });
      } else {
        const denied = result?.status === "permission_denied" || result?.permissions?.receive === "denied";
        setNotificationMessage(denied
          ? "Уведомления запрещены в системе. Их можно включить в настройках FruitFit."
          : result?.status === "UNAUTHENTICATED"
            ? "Войди в аккаунт, чтобы включить уведомления."
            : "Не удалось включить уведомления.");
        trackAnalyticsEvent("notification_permission_denied", { screen: "health_onboarding", source: result?.status || "unknown" });
      }
    } catch (error) {
      setNotificationMessage(error?.message || "Не удалось включить уведомления.");
      trackAnalyticsEvent("notification_permission_denied", { screen: "health_onboarding", source: "client_error" });
    } finally {
      setBusy("");
    }
  }

  function openActivitySettings() {
    if (Capacitor.getPlatform?.() === "ios") {
      openFirebaseMessagingSettings().catch(() => {});
      return;
    }
    openHealthSettings().catch(() => {});
  }

  if (!native) return null;

  return (
    <AnimatePresence>
      {stage && (
        <motion.div
          className="fixed inset-0 z-[105] flex items-end justify-center bg-black/50 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-16 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={later}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="health-onboarding-title"
            className="w-full max-w-[390px] rounded-[24px] border border-appBorder bg-appCard p-5 shadow-2xl"
            initial={{ y: 28, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="health-onboarding-title" className="text-[19px] font-black leading-6 text-appText">
                  {stage === "intro" ? "Сделать FruitFit точнее?" : "Подключение"}
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-appMuted">
                  {stage === "intro"
                    ? "Подключите данные активности, чтобы учитывать шаги, сон и тренировки. Включите напоминания, чтобы не пропускать занятия."
                    : "Выбери, что подключить. Каждое системное разрешение запрашивается отдельно."}
                </p>
              </div>
              <button type="button" onClick={later} aria-label="Закрыть" className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-appMuted">
                <X size={18} />
              </button>
            </div>

            {stage === "intro" ? (
              <>
                <button type="button" onClick={openChoices} className="mt-5 h-12 w-full rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">
                  Подключить
                </button>
                <button type="button" onClick={later} className="mt-2 h-10 w-full text-[12px] font-bold text-appMuted">
                  Не сейчас
                </button>
              </>
            ) : (
              <div className="mt-5 grid gap-3">
                <ConnectionAction
                  icon={<Activity size={18} />}
                  title="Подключить данные активности"
                  status={healthMessage || healthStatus}
                  connected={healthConnected}
                  busy={busy === "health"}
                  onClick={connectHealth}
                />
                {healthMessage && !healthConnected && (
                  <button type="button" onClick={openActivitySettings} className="flex h-10 items-center justify-center gap-2 rounded-full border border-appBorder text-[12px] font-black text-appText">
                    <Settings size={15} /> Открыть настройки активности
                  </button>
                )}
                <ConnectionAction
                  icon={<Bell size={18} />}
                  title="Включить уведомления"
                  status={notificationMessage || (notificationConnected ? "Подключено" : notification.status === "denied" ? "Запрещено в системе" : "Не подключено")}
                  connected={notificationConnected}
                  busy={busy === "notifications"}
                  onClick={connectNotifications}
                />
                {notificationMessage && !notificationConnected && notification.status === "permission_denied" && (
                  <button type="button" onClick={() => openFirebaseMessagingSettings().catch(() => {})} className="flex h-10 items-center justify-center gap-2 rounded-full border border-appBorder text-[12px] font-black text-appText">
                    <Settings size={15} /> Открыть настройки FruitFit
                  </button>
                )}
                <button type="button" onClick={finishChoices} className="h-10 text-[12px] font-bold text-appMuted">
                  Готово
                </button>
              </div>
            )}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConnectionAction({ icon, title, status, connected, busy, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || connected}
      className="flex min-h-[64px] w-full items-center gap-3 rounded-[18px] border border-appBorder bg-appBg px-3 text-left disabled:opacity-70"
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${connected ? "bg-appGreen text-[#181F19]" : "bg-appCard text-appText"}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-black text-appText">{title}</span>
        <span className="mt-0.5 block text-[11px] font-semibold text-appMuted">{busy ? "Подключаем..." : status}</span>
      </span>
      {!connected && <ChevronRight size={17} className="shrink-0 text-appMuted" />}
    </button>
  );
}
