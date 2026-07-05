import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, ChevronDown, Settings, Watch, X } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import CustomSelect from "../components/CustomSelect";
import { useHealth } from "../data/healthStore";
import { PROFILE_FIRST_NAME_PLACEHOLDER, PROFILE_LAST_NAME_PLACEHOLDER, normalizeProfile, profileOptions, profileSummary, saveProfile, validateProfile } from "../data/profileStore";
import { fetchMeasurements, getAuthToken, loadAuthUser, saveMeasurement, saveServerProfile } from "../data/authStore";
import { accessTier } from "../data/accessRules";
import { readUserCoreField, writeUserCoreField } from "../data/dataContainers";
import { currentUserId } from "../data/userScopedCache";
import { healthProviderStates } from "../services/health/healthProvider";
import { getFirebaseMessagingPermissionStatus, openFirebaseMessagingSettings, registerFirebaseMessagingPush } from "../services/notifications/firebaseMessagingPush";
import { openProfileProgramAction } from "#fruitfit/programAction";
import { cancelProgramRenewal, fetchProgramRenewal, fetchProgramRenewalCancelInfo } from "#fruitfit/programRenewal";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const MEASUREMENTS_KEY = "fruitfit.measurements";
const AVATAR_STORAGE_KEY = "fruitfit.avatar";
const IOS_PUSH_TOKEN_KEY = "fruitfit.push.fcmToken.ios.v1";
const CAPACITOR_PLATFORM = Capacitor.getPlatform?.() || "web";
const IS_IOS_PLATFORM = CAPACITOR_PLATFORM === "ios";
const HEALTH_PROVIDER_NAME = IS_IOS_PLATFORM ? "Apple Health" : "Google Health Connect";
const HEALTH_PROVIDER_SETTINGS_NAME = IS_IOS_PLATFORM ? "Apple Health" : "Health Connect";
const HEALTH_PROVIDER_DEVICE_COPY = IS_IOS_PLATFORM ? "iPhone" : "Android";
const ACCESS_INFINITY_LABEL = "∞";

const permissionItems = [
  { id: "watch", label: "Смарт-часы", permissionKey: null },
  { id: "heart", label: "Пульс", permissionKey: "heartRate" },
  { id: "sleep", label: "Сон", permissionKey: "sleep" },
  { id: "steps", label: "Шаги", permissionKey: "steps" },
  { id: "calories", label: "Калории", permissionKey: "calories" },
  { id: "cycle", label: "Цикл" },
  { id: "notifications", label: "Уведомления" },
];

function validAvatarDataUrl(value) {
  const text = String(value || "");
  return text.startsWith("data:image/") ? text : "";
}

function userIdFrom(user) {
  return String(user?.id || user?.userId || user?.user_id || currentUserId() || "").trim();
}

function loadAvatar(profile = {}, user = null) {
  const id = userIdFrom(user);
  if (typeof window === "undefined" || !id) return validAvatarDataUrl(profile?.avatar);
  return validAvatarDataUrl(readUserCoreField("avatar", id, ""))
    || validAvatarDataUrl(profile?.avatar)
    || validAvatarDataUrl(user?.profile?.avatar)
    || validAvatarDataUrl(user?.avatar)
    || "";
}

function hasStoredIosPushToken() {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(localStorage.getItem(IOS_PUSH_TOKEN_KEY));
  } catch (_) {
    return false;
  }
}

function storedNotificationToggle(stored = {}) {
  if (Object.prototype.hasOwnProperty.call(stored, "notifications")) return Boolean(stored.notifications);
  return hasStoredIosPushToken();
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать фото"));
    reader.readAsDataURL(file);
  });
}

function loadAvatarImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Не удалось обработать фото"));
    image.src = dataUrl;
  });
}

async function compressAvatar(file) {
  const dataUrl = await readImageFile(file);
  const image = await loadAvatarImage(dataUrl);
  const maxSide = 420;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  const size = Math.max(1, Math.round(Math.min(image.width, image.height) * scale));
  const sourceSize = Math.min(image.width, image.height);
  const sourceX = Math.round((image.width - sourceSize) / 2);
  const sourceY = Math.round((image.height - sourceSize) / 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function persistAvatarLocally(dataUrl) {
  try {
    return Boolean(writeUserCoreField("avatar", dataUrl));
  } catch (error) {
    console.warn("[FruitFit Account] avatar local save failed", error);
    return false;
  }
}

function healthPermissionSummary(availability) {
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "Активность подключена";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Можно расширить доступ для точности";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Настройте доступ к показателям";
  if (state === healthProviderStates.NOT_INSTALLED) return `${HEALTH_PROVIDER_NAME} недоступен на этом устройстве`;
  if (state === healthProviderStates.NO_DATA) return "Ждём первую синхронизацию";
  return "Подключите трекер для персонализации";
}

function permissionLine(item, availability, active) {
  if (item.id === "notifications") return active ? "Уведомления включены" : "Уведомления выключены";
  if (item.id === "cycle") return "Данные цикла вводятся вручную";
  if (!active) return item.id === "watch" ? "Не используется в FruitFit" : "Не учитывается в рекомендациях";
  if (!item.permissionKey) return healthPermissionSummary(availability);
  const granted = Boolean(availability?.permissionStatus?.[item.permissionKey]);
  if (granted) return "Подключено и учитывается";
  if (availability?.state === healthProviderStates.NOT_INSTALLED) return `Появится после настройки ${HEALTH_PROVIDER_NAME}`;
  if (availability?.state === healthProviderStates.NOT_SUPPORTED) return "Доступно в приложении на Android";
  return `Нужен доступ в ${HEALTH_PROVIDER_NAME}`;
}

function notificationRegistrationMessage(result) {
  if (!result) return "";
  if (result.ok) {
    if (result.data?.fcmConfigured === false) {
      return "Уведомления разрешены, но отправка пока недоступна.";
    }
    return "Уведомления включены.";
  }
  if (result.status === "UNAUTHENTICATED") return "Войдите в аккаунт, чтобы включить уведомления.";
  if (result.status === "native_push_unavailable") return "Уведомления доступны только в приложении на телефоне.";
  if (result.status === "NO_FCM_TOKEN") return "Не удалось включить уведомления. Попробуйте ещё раз.";
  if (result.status === "permission_denied") return "Уведомления выключены в настройках iPhone.";
  if (result.status === "permission_missing") {
    if (result.permissions?.receive === "denied") {
      return "Откройте Настройки > FruitFit > Уведомления и включите разрешение.";
    }
    return "Разрешение не выдано. Нажмите ещё раз и выберите «Разрешить».";
  }
  return "Не удалось включить уведомления. Попробуйте позже.";
}

function healthConnectionHint(availability, syncing) {
  if (syncing) return "Обновляем показатели. Обычно это занимает несколько секунд.";
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "FruitFit использует активность, сон и пульс, чтобы точнее подбирать нагрузку.";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Часть данных уже подключена. Сон и пульс сделают восстановление точнее.";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Разрешите доступ к активности, сну и пульсу. Данные не передаются третьим лицам.";
  if (state === healthProviderStates.NOT_INSTALLED) return `Откройте ${HEALTH_PROVIDER_NAME} и проверьте, что часы синхронизируют данные.`;
  return `Подключите ${HEALTH_PROVIDER_NAME}, чтобы FruitFit мог учитывать вашу активность и восстановление.`;
}

function formatHealthSyncTime(value) {
  if (!value) return "ещё не было";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ещё не было";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const browser = window.Capacitor?.Plugins?.Browser;
    if (browser?.open) {
      await browser.open({ url: target });
      return true;
    }
  } catch (_) {
    // Fall through to web/native window open.
  }
  try {
    const app = window.Capacitor?.Plugins?.App;
    if (app?.openUrl) {
      await app.openUrl({ url: target });
      return true;
    }
  } catch (_) {
    // Fall through to window open.
  }
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = target;
  return true;
}

function programStateIsActive(renewal = null) {
  const status = String(renewal?.status || "").toLowerCase();
  return Boolean(renewal?.recurringEnabled || status === "active" || status === "pending");
}

function formatRenewalDate(value) {
  if (!value) return "не назначена";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "не назначена";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function programStateLabel(renewal = null) {
  const status = String(renewal?.status || "").toLowerCase();
  const canceledState = ["cancel", "ed"].join("");
  const cancelledState = ["cancel", "led"].join("");
  const failedState = ["fail", "ed"].join("");
  if (status === "active") return "Активно";
  if (status === "cancel_requested") return "Отмена запрошена";
  if (status === cancelledState || status === canceledState) return "Программа в работе";
  if (status === failedState) return "Программа в работе";
  if (status === "expired") return "Истекла";
  return "Не активно";
}

function programStateLine(renewal = null, loaded = false) {
  if (!loaded) return "Проверяем статус программы...";
  if (!renewal) return "Активный статус не найден";
  return `Статус: ${programStateLabel(renewal)} · Плановая дата: ${formatRenewalDate(renewal.nextChargeAt)}`;
}

function FieldError({ error }) {
  if (!error) return null;
  return <p className="mt-1 text-[11px] font-semibold text-red-500">{error}</p>;
}

function SelectField({ label, value, options, error, onChange }) {
  return <CustomSelect label={label} value={value} options={options} error={error} onChange={onChange} />;
}

function NumberField({ label, value, error, onChange, suffix }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-appMuted">{label}</span>
      <div className={`mt-1 flex h-12 items-center rounded-2xl border bg-appBg px-3 ${error ? "border-red-300" : "border-appBorder"}`}>
        <input value={value} inputMode="numeric" onChange={(event) => onChange(event.target.value.replace(/[^\d]/g, ""))} className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-appText outline-none" />
        {suffix && <span className="text-[12px] font-bold text-appMuted">{suffix}</span>}
      </div>
      <FieldError error={error} />
    </label>
  );
}

function TextField({ label, value, error, onChange, placeholder = "" }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase text-appMuted">{label}</span>
      <div className={`mt-1 flex h-12 items-center rounded-2xl border bg-appBg px-3 ${error ? "border-red-300" : "border-appBorder"}`}>
        <input value={value || ""} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[14px] font-bold text-appText outline-none placeholder:text-appMuted/60" />
      </div>
      <FieldError error={error} />
    </label>
  );
}

function loadMeasurements() {
  try {
    return readUserCoreField("measurements", currentUserId(), []);
  } catch (_) {
    return [];
  }
}

function saveMeasurements(items) {
  writeUserCoreField("measurements", Array.isArray(items) ? items : []);
}

function dateFromMeasurement(value) {
  const raw = value?.date || value?.measured_at || value?.measuredAt || value?.created_at || value?.createdAt;
  if (!raw) return "";
  const text = String(raw);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function normalizeMeasurementItem(value = {}) {
  const values = value.values || {};
  return {
    id: value.id || `${dateFromMeasurement(value)}-${value.updated_at || value.updatedAt || value.created_at || value.createdAt || Date.now()}`,
    date: dateFromMeasurement(value),
    weight: String(values.weight ?? value.weight ?? ""),
    chest: String(values.chest ?? value.chest ?? ""),
    waist: String(values.waist ?? value.waist ?? ""),
    hips: String(values.hips ?? value.hips ?? ""),
    updatedAt: value.updated_at || value.updatedAt || value.created_at || value.createdAt || "",
  };
}

function hasMeasurementValues(item = {}) {
  return ["weight", "chest", "waist", "hips"].some((field) => {
    const value = String(item[field] ?? "").trim();
    return value && Number(value.replace(",", ".")) > 0;
  });
}

function mergeMeasurements(items = []) {
  const byDate = new Map();
  items
    .map(normalizeMeasurementItem)
    .filter((item) => item.date && !String(item.id || "").startsWith("sim-") && hasMeasurementValues(item))
    .sort((a, b) => String(b.updatedAt || b.id).localeCompare(String(a.updatedAt || a.id)))
    .forEach((item) => {
      if (!byDate.has(item.date)) byDate.set(item.date, item);
    });
  return Array.from(byDate.values()).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function filterMeasurementsByPeriod(items, period) {
  const rows = [...items]
    .filter((item) => item?.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (period === "all") return rows;
  const days = period === "week" ? 7 : period === "month" ? 31 : 93;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return rows.filter((item) => new Date(item.date) >= cutoff);
}

function MeasurementChart({ items, period = "all" }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const rows = filterMeasurementsByPeriod(items, period).slice(-12);
  const fields = [
    ["weight", "Вес", "#8BBE3D", "кг"],
    ["waist", "Талия", "#FF7A2F", "см"],
    ["chest", "Грудь", "#5FA8FF", "см"],
    ["hips", "Бедра", "#B394FF", "см"],
  ];

  if (rows.length < 2) {
    return (
      <div className="rounded-[20px] border border-appBorder bg-appBg p-4 text-center">
        <p className="text-[13px] font-bold text-appText">График появится после двух замеров</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">Можно добавить замеры вручную. После входа история синхронизируется с аккаунтом.</p>
      </div>
    );
  }

  const width = 320;
  const height = 174;
  const padX = 18;
  const padTop = 18;
  const padBottom = 34;
  const chartHeight = height - padTop - padBottom;
  const xFor = (index) => padX + (index / Math.max(rows.length - 1, 1)) * (width - padX * 2);
  const allValues = fields.flatMap(([field]) => rows.map((item) => Number(item[field])).filter((value) => Number.isFinite(value) && value > 0));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = Math.max(max - min, 1);
  const active = rows[activeIndex ?? rows.length - 1];

  function pointFor(item, index, field) {
    const value = Number(item[field]);
    const normalized = Number.isFinite(value) && value > 0 ? (value - min) / span : 0;
    return [xFor(index), padTop + chartHeight - normalized * chartHeight];
  }

  function pointsFor(field) {
    return rows.map((item, index) => pointFor(item, index, field).join(",")).join(" ");
  }

  function updateActive(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    setActiveIndex(Math.round(ratio * (rows.length - 1)));
  }

  return (
    <div className="rounded-[20px] border border-appBorder bg-appBg p-3">
      <div className="mb-2 rounded-[16px] bg-appCard/70 px-3 py-2">
        <p className="text-[11px] font-bold uppercase text-appMuted">{active?.date || "Дата"}</p>
        <div className="mt-1 grid grid-cols-4 gap-1 text-[10px] font-bold text-appText">
          {fields.map(([field, label, color, unit]) => (
            <span key={field} className="truncate">
              <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {label}: {active?.[field] || "-"}{unit}
            </span>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[174px] w-full touch-none overflow-visible"
        onPointerDown={updateActive}
        onPointerMove={(event) => event.buttons === 1 && updateActive(event)}
      >
        {[0, 1, 2].map((line) => (
          <line key={line} x1={padX} x2={width - padX} y1={padTop + (chartHeight / 2) * line} y2={padTop + (chartHeight / 2) * line} stroke="currentColor" className="text-appBorder" strokeWidth="1" />
        ))}
        {fields.map(([field, , color]) => {
          const points = pointsFor(field);
          return (
            <g key={field}>
              <polyline points={points} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              {rows.map((item, index) => {
                const [cx, cy] = pointFor(item, index, field);
                return <circle key={`${field}-${index}`} cx={cx} cy={cy} r={index === (activeIndex ?? rows.length - 1) ? 4.2 : 3.1} fill={color} stroke="var(--card)" strokeWidth="2" />;
              })}
            </g>
          );
        })}
        {activeIndex !== null && (
          <line x1={xFor(activeIndex)} x2={xFor(activeIndex)} y1={padTop - 4} y2={height - padBottom + 4} stroke="rgba(221,247,180,0.72)" strokeWidth="2" strokeDasharray="4 5" />
        )}
        <text x={padX} y={height - 8} className="fill-appMuted text-[10px] font-bold">{rows[0]?.date?.slice(5).replace("-", ".")}</text>
        <text x={width - padX} y={height - 8} textAnchor="end" className="fill-appMuted text-[10px] font-bold">{rows[rows.length - 1]?.date?.slice(5).replace("-", ".")}</text>
      </svg>
      <div className="mt-2 grid grid-cols-4 gap-1">
        {fields.map(([field, label, color]) => (
          <span key={field} className="min-w-0 truncate text-[10px] font-bold text-appMuted">
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function MeasurementHistoryModal({ items, onClose, onDateChange }) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/36 px-2">
        <motion.section initial={{ y: 34 }} animate={{ y: 0 }} exit={{ y: 34 }} className="max-h-[88vh] w-full max-w-[430px] overflow-y-auto rounded-t-[30px] border border-appBorder bg-appCard p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-soft">
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-appBorder" />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[24px] font-black text-appText">История замеров</h2>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-appBg text-appText"><X size={18} /></button>
          </div>
          <div className="mt-4 space-y-2">
            {[...items].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => (
              <div key={item.id} className="rounded-[18px] border border-appBorder bg-appBg p-3 text-[12px]">
                <input type="date" value={item.date} onChange={(event) => onDateChange(item.id, event.target.value)} className="mb-2 h-10 w-full rounded-2xl border border-appBorder bg-appCard px-3 font-bold text-appText outline-none" />
                <p className="leading-5 text-appMuted">Вес {item.weight || "-"} кг • Талия {item.waist || "-"} • Грудь {item.chest || "-"} • Бедра {item.hips || "-"}</p>
              </div>
            ))}
          </div>
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

function MeasurementsSection() {
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState(() => mergeMeasurements(loadMeasurements()));
  const [draft, setDraft] = useState({ date: today, weight: "", chest: "", waist: "", hips: "" });
  const [period, setPeriod] = useState("month");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState("");

  useEffect(() => saveMeasurements(items), [items]);

  useEffect(() => {
    function syncLocalMeasurements(event) {
      const source = Array.isArray(event?.detail) ? event.detail : loadMeasurements();
      setItems(mergeMeasurements(source));
    }
    window.addEventListener("fruitfit:measurements-updated", syncLocalMeasurements);
    window.addEventListener("fruitfit:auth-updated", syncLocalMeasurements);
    return () => {
      window.removeEventListener("fruitfit:measurements-updated", syncLocalMeasurements);
      window.removeEventListener("fruitfit:auth-updated", syncLocalMeasurements);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadServerMeasurements() {
      if (!getAuthToken() && !loadAuthUser()) return;
      const serverItems = await fetchMeasurements();
      if (cancelled || !serverItems.length) return;
      setItems((current) => mergeMeasurements([...serverItems, ...current]));
      setSyncStatus("Замеры синхронизированы с аккаунтом");
    }
    loadServerMeasurements();
    return () => {
      cancelled = true;
    };
  }, []);

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function addMeasurement() {
    if (!draft.date) return;
    if (!hasMeasurementValues(draft)) {
      setSyncStatus("Введите хотя бы один показатель замера.");
      return;
    }
    const next = { ...draft, id: crypto.randomUUID?.() || String(Date.now()) };
    setItems((current) => mergeMeasurements([next, ...current.filter((item) => item.date !== next.date)]));
    setDraft({ date: today, weight: "", chest: "", waist: "", hips: "" });
    if (!getAuthToken() && !loadAuthUser()) {
      setSyncStatus("Замер сохранён на устройстве. Войдите в аккаунт, чтобы синхронизировать историю.");
      return;
    }
    try {
      const saved = await saveMeasurement(next);
      if (saved) setItems((current) => mergeMeasurements([saved, ...current.filter((item) => item.date !== next.date)]));
      setSyncStatus("Замер сохранён и синхронизирован");
    } catch (error) {
    console.error("[FruitFit Account] save measurement failed", error);
      setSyncStatus("Замер сохранён на устройстве. Серверная синхронизация повторится позже.");
    }
  }

  function updateDate(id, date) {
    setItems((current) => mergeMeasurements(current.map((item) => item.id === id ? { ...item, date } : item)));
  }

  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-black text-appText">Замеры</h2>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} className="h-11 rounded-2xl border border-appBorder bg-appBg px-3 text-[12px] font-bold text-appText outline-none" />
        {[
          ["weight", "Вес, кг"],
          ["chest", "Грудь, см"],
          ["waist", "Талия, см"],
          ["hips", "Бедра, см"],
        ].map(([key, label]) => (
          <input key={key} value={draft[key]} placeholder={label} inputMode="decimal" onChange={(event) => update(key, event.target.value.replace(/[^\d.]/g, ""))} className="h-11 rounded-2xl border border-appBorder bg-appBg px-3 text-[12px] font-bold text-appText outline-none placeholder:text-appMuted" />
        ))}
      </div>
      <button type="button" onClick={addMeasurement} className="mt-3 h-11 w-full rounded-full bg-appDark text-[13px] font-black text-appGreen">Добавить замер</button>
      {syncStatus && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">{syncStatus}</p>}
      <div className="mt-4 grid grid-cols-4 gap-1 rounded-full bg-appBg p-1">
        {[
          ["week", "Неделя"],
          ["month", "Месяц"],
          ["quarter", "3 мес"],
          ["all", "Все"],
        ].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPeriod(id)} className={`h-8 rounded-full text-[11px] font-bold transition ${period === id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-3"><MeasurementChart items={items} period={period} /></div>
      <div className="mt-3 space-y-2">
        {[...items].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 3).map((item) => (
          <div key={item.id} className="grid grid-cols-[120px_1fr] gap-2 rounded-[16px] bg-appBg p-3 text-[12px]">
            <input type="date" value={item.date} onChange={(event) => updateDate(item.id, event.target.value)} className="min-w-0 bg-transparent font-bold text-appText outline-none" />
            <p className="text-appMuted">Вес {item.weight || "-"} кг • Талия {item.waist || "-"} • Грудь {item.chest || "-"} • Бедра {item.hips || "-"}</p>
          </div>
        ))}
      </div>
      {items.length > 3 && (
        <button type="button" onClick={() => setHistoryOpen(true)} className="mt-3 h-11 w-full rounded-full border border-appBorder bg-appBg text-[13px] font-black text-appText">
          Смотреть всю историю
        </button>
      )}
      {historyOpen && <MeasurementHistoryModal items={items} onDateChange={updateDate} onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}

function accessExpiryDate(access = {}) {
  return access?.expiresAt || access?.expires_at || access?.premiumUntil || access?.premium_until || access?.validUntil || access?.valid_until || null;
}

function accessStartDate(access = {}) {
  return (
    access?.startsAt
    || access?.starts_at
    || access?.startedAt
    || access?.started_at
    || access?.activatedAt
    || access?.activated_at
    || access?.createdAt
    || access?.created_at
    || access?.meta?.startsAt
    || access?.meta?.starts_at
    || access?.meta?.startedAt
    || access?.meta?.started_at
    || null
  );
}

function parseDateMs(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function firstAccessNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function fallbackAccessDurationDays(daysLeft) {
  if (!Number.isFinite(daysLeft) || daysLeft <= 0) return 30;
  if (daysLeft <= 31) return 30;
  if (daysLeft <= 93) return 90;
  if (daysLeft <= 370) return 365;
  return Math.max(30, daysLeft);
}

function accessDurationDays(access = {}, daysLeft = null) {
  return firstAccessNumber(
    access?.durationDays,
    access?.duration_days,
    access?.periodDays,
    access?.period_days,
    access?.planDays,
    access?.plan_days,
    access?.accessDays,
    access?.access_days,
    access?.meta?.durationDays,
    access?.meta?.duration_days,
    access?.meta?.periodDays,
    access?.meta?.period_days,
    access?.meta?.planDays,
    access?.meta?.plan_days
  ) || fallbackAccessDurationDays(daysLeft);
}

function accessRingProgress(access = {}, expiresAt = null, daysLeft = null) {
  const expiresMs = parseDateMs(expiresAt);
  if (!expiresMs) return 1;
  const now = Date.now();
  if (expiresMs <= now) return 0;

  const startsMs = parseDateMs(accessStartDate(access));
  if (startsMs && startsMs < expiresMs) {
    return Math.max(0, Math.min(1, (expiresMs - now) / (expiresMs - startsMs)));
  }

  const durationMs = accessDurationDays(access, daysLeft) * 24 * 60 * 60 * 1000;
  return Math.max(0, Math.min(1, (expiresMs - now) / durationMs));
}

function formatAccessDate(value) {
  if (!value) return "Программа назначена";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Программа назначена";
  return `до ${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}`;
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

function isAdminAccess(access = {}, user = {}) {
  const values = [
    access?.status,
    access?.plan,
    access?.role,
    access?.userRole,
    access?.user?.role,
    user?.role,
    user?.userRole,
    user?.user?.role,
  ].map((value) => String(value || "").toLowerCase());
  return Boolean(access?.isAdmin || user?.isAdmin || values.includes("admin"));
}

function renewalExpiryDate(renewal = null) {
  return (
    renewal?.paidUntil
    || renewal?.paid_until
    || renewal?.accessUntil
    || renewal?.access_until
    || renewal?.nextChargeAt
    || renewal?.nextPaymentDate
    || renewal?.["next_" + "pay" + "ment_date"]
    || null
  );
}

function accessCardInfo(access = {}, user = {}, renewal = null) {
  if (APP_STORE_REVIEW) {
    return {
      kind: "review",
      title: "Ознакомительная программа",
      subtitle: "Можно отправить анкету тренеру",
      meta: "Тренер рассмотрит заявку и свяжется с вами по электронной почте.",
      ringLabel: ACCESS_INFINITY_LABEL,
      ringCaption: "",
      ringFull: true,
      ringProgress: 1,
    };
  }

  const tier = accessTier(access);
  const status = String(access?.status || access?.plan || "").toLowerCase();
  const role = String(access?.role || "").toLowerCase();
  const expiresAt = renewalExpiryDate(renewal) || accessExpiryDate(access);
  const daysLeft = daysUntil(expiresAt);

  if (isAdminAccess(access, user)) {
    return {
      kind: "admin",
      title: "FruitFit Admin",
      subtitle: "Программа назначена",
      meta: "Программа назначена",
      ringLabel: ACCESS_INFINITY_LABEL,
      ringCaption: "",
      ringFull: true,
      ringProgress: 1,
    };
  }

  if (tier === "vip") {
    const hasFiniteAccess = daysLeft != null;
    return {
      kind: "vip",
      title: "Персональное сопровождение",
      subtitle: "Персональное сопровождение",
      meta: formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? ACCESS_INFINITY_LABEL : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "дней",
      ringFull: !hasFiniteAccess,
      ringProgress: hasFiniteAccess ? accessRingProgress(access, expiresAt, daysLeft) : 1,
    };
  }

  if (tier === "paid" || tier === "full") {
    const adminLike = status === "admin" || status === "trainer" || role === "admin" || role === "trainer";
    const hasFiniteAccess = daysLeft != null;
    return {
      kind: "paid",
      title: "Персональная программа",
      subtitle: adminLike ? "Программа назначена" : "Программа назначена",
      meta: adminLike && !expiresAt ? "Программа назначена" : formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? ACCESS_INFINITY_LABEL : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "дней",
      ringFull: !hasFiniteAccess,
      ringProgress: hasFiniteAccess ? accessRingProgress(access, expiresAt, daysLeft) : 1,
    };
  }

  return {
    kind: "free",
    title: "Ознакомительная программа",
    subtitle: "Заявка тренеру",
    meta: "Программа в работе",
    ringLabel: ACCESS_INFINITY_LABEL,
    ringCaption: "",
    ringFull: true,
    ringProgress: 1,
  };
}

function AccessMembershipCard({
  access,
  authUser,
  hasAuth,
  requestLoading,
  requestStatus,
  renewal,
  renewalActive,
  renewalLoaded,
  renewalLoading,
  renewalStatus,
  onOpenProgramAction,
  onChangeRenewal,
}) {
  const info = accessCardInfo(access, authUser, renewal);
  const isFreeAccess = info.kind === "free";
  const isProgramAssignedKind = info.kind === "paid";
  const showRenewalBlock = Boolean(!APP_STORE_REVIEW && hasAuth && info.kind !== "free" && !IS_IOS_PLATFORM);
  const renewalAvailable = Boolean(isProgramAssignedKind && renewalLoaded && !renewalActive);
  const showProgramActionButton = APP_STORE_REVIEW || isFreeAccess || renewalAvailable || (!isProgramAssignedKind && !isFreeAccess);
  const actionButtonText = "Оставить заявку тренеру";
  const ringDegrees = info.ringFull ? 360 : Math.round(Math.max(0, Math.min(1, info.ringProgress ?? 1)) * 360);
  const ringLabelClass = info.ringCaption ? "text-[20px] tabular-nums tracking-normal" : "text-[26px]";

  return (
    <div className="mt-4 rounded-[24px] border border-appBorder bg-appBg p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-appMuted">{APP_STORE_REVIEW ? "Заявка тренеру" : "Статус программы"}</p>
          <h3 className="mt-1 text-[20px] font-black leading-tight text-appText">{info.title}</h3>
          <p className="mt-1 text-[13px] font-bold text-appMuted">{info.subtitle}</p>
          <p className="mt-1 text-[12px] font-semibold text-appMuted">{info.meta}</p>
        </div>
        <div className={`access-days-ring ${info.ringFull ? "is-full" : ""} grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full text-center`} style={{ "--access-ring-deg": `${ringDegrees}deg` }}>
          <span>
            <span className={`block ${ringLabelClass} font-black leading-none text-appText`}>{info.ringLabel}</span>
            {info.ringCaption && <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">{info.ringCaption}</span>}
          </span>
        </div>
      </div>

      {showProgramActionButton && (
        <button
          type="button"
          onClick={onOpenProgramAction}
          disabled={requestLoading}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen text-[14px] font-black text-[#181F19] shadow-sm transition active:scale-[0.98] disabled:opacity-70"
        >
          {requestLoading ? "Отправляем заявку..." : actionButtonText}
        </button>
      )}
      {showRenewalBlock && (
        <div className="mt-2 rounded-[18px] border border-appBorder bg-appCard/70 px-3 py-2">
          <p className="text-[11px] font-black text-appText">Статус программы</p>
          <p className="mt-1 text-[11px] font-semibold text-appMuted">
            {programStateLine(renewal, renewalLoaded)}
          </p>
        </div>
      )}
      {showRenewalBlock && (
        <button
          type="button"
          onClick={onChangeRenewal}
          disabled={renewalLoading || !renewalLoaded || !renewalActive}
          className={`mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full border text-[13px] font-black transition active:scale-[0.98] disabled:opacity-70 ${renewalActive ? "border-red-500/35 bg-red-500/10 text-red-500" : "border-appBorder bg-appCard/70 text-appMuted"}`}
        >
          <X size={16} />
          {renewalLoading ? "Обновляем..." : "Изменить статус"}
        </button>
      )}
      {requestStatus && <p className="mt-2 text-center text-[12px] font-bold text-appOrange">{requestStatus}</p>}
      {showRenewalBlock && renewalStatus && <p className="mt-2 text-center text-[12px] font-bold text-appMuted">{renewalStatus}</p>}
    </div>
  );
}

export default function ProfileScreen({ profile, access, onProfileChange, theme, onThemeChange, onNavigate, onRestartQuiz, onRequireAuth }) {
  const { health, availability, syncing, requestConnection, syncNativeHealth } = useHealth();
  const [avatar, setAvatar] = useState(() => loadAvatar(profile, loadAuthUser()));
  const [draft, setDraft] = useState(() => normalizeProfile(profile));
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestStatus, setRequestStatus] = useState("");
  const [renewal, setRenewal] = useState(null);
  const [renewalLoaded, setRenewalLoaded] = useState(false);
  const [renewalLoading, setRenewalLoading] = useState(false);
  const [renewalStatus, setRenewalStatus] = useState("");
  const authUser = loadAuthUser();
  const hasAuth = Boolean(getAuthToken());
  const renewalActive = APP_STORE_REVIEW ? false : programStateIsActive(renewal);
  const [permissions, setPermissions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("fruitfit.permissions") || "{}");
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, ...stored, notifications: storedNotificationToggle(stored) };
    } catch (_) {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: hasStoredIosPushToken() };
    }
  });
  const [notificationStatus, setNotificationStatus] = useState(() => (
    hasStoredIosPushToken() ? "Уведомления включены." : ""
  ));

  useEffect(() => {
    const normalized = normalizeProfile(profile);
    setDraft(normalized);
    const nextAvatar = loadAvatar(normalized, loadAuthUser());
    setAvatar(nextAvatar);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    if (APP_STORE_REVIEW || !hasAuth) {
      setRenewal(null);
      setRenewalLoaded(false);
      return () => {
        cancelled = true;
      };
    }

    setRenewalLoaded(false);
    fetchProgramRenewal()
      .then((nextProgramState) => {
        if (!cancelled) setRenewal(nextProgramState);
      })
      .catch(() => {
        if (!cancelled) setRenewal(null);
      })
      .finally(() => {
        if (!cancelled) setRenewalLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hasAuth, access?.updatedAt, access?.status, access?.plan]);

  useEffect(() => {
    localStorage.setItem("fruitfit.permissions", JSON.stringify(permissions));
  }, [permissions]);

  useEffect(() => {
    let alive = true;
    getFirebaseMessagingPermissionStatus()
      .then((result) => {
        if (!alive || result.status === "native_push_unavailable") return;
        const granted = result.permissions?.receive === "granted";
        setPermissions((current) => ({ ...current, notifications: granted && current.notifications }));
        if (!granted && result.permissions?.receive === "denied") {
          setNotificationStatus("Уведомления выключены в настройках iPhone.");
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const nextAvatar = await compressAvatar(file);
      setAvatar(nextAvatar);
      persistAvatarLocally(nextAvatar);
      const nextProfile = saveProfile({ ...draft, avatar: nextAvatar });
      setDraft(nextProfile);
      onProfileChange?.(nextProfile);
      if (getAuthToken()) await saveServerProfile(nextProfile);
      window.dispatchEvent(new CustomEvent("fruitfit:avatar-updated", { detail: { avatar: nextAvatar } }));
    } catch (error) {
      console.warn("[FruitFit Account] avatar update failed", error);
    } finally {
      event.target.value = "";
    }
  }

  function updateDraft(key, value) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  async function submit() {
    const nextErrors = validateProfile(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const savedProfile = saveProfile(draft);
    onProfileChange?.(savedProfile);
    await saveServerProfile(savedProfile);
    setSaved(true);
  }

  async function openProgramAction() {
    if (!getAuthToken()) {
      setRequestStatus("Войдите или создайте аккаунт, затем продолжите.");
      onRequireAuth?.({ reason: "trainer-request" });
      return;
    }

    setRequestLoading(true);
    setRequestStatus("");
    try {
      const savedProfile = saveProfile(draft);
      onProfileChange?.(savedProfile);
      await saveServerProfile(savedProfile);
      const result = await openProfileProgramAction({
        profile: savedProfile,
        source: APP_STORE_REVIEW ? "ios-profile" : "profile",
        openExternalUrl,
      });
      if (result?.message) setRequestStatus(result.message);
    } catch (error) {
      setRequestStatus(error?.message || "Не удалось отправить заявку. Попробуйте позже.");
    } finally {
      setRequestLoading(false);
    }
  }

  async function updateProgramState() {
    if (APP_STORE_REVIEW) {
      setRenewalStatus("Статус программы можно уточнить у тренера.");
      return;
    }
    if (!getAuthToken()) {
      setRenewalStatus("Войдите в аккаунт, чтобы изменить статус.");
      onRequireAuth?.({ reason: "program-status-change" });
      return;
    }
    if (!renewalActive) {
      setRenewalStatus("Активный статус не найден.");
      return;
    }
    if (!window.confirm("Обновить статус программы? Текущий период сохранится.")) return;

    setRenewalLoading(true);
    setRenewalStatus("");
    try {
      const cancelResult = await cancelProgramRenewal("client_request");
      const cancelUrl = cancelResult?.cancelUrl || cancelResult?.cancel_url || cancelResult?.url || "";
      if (cancelUrl) {
        const opened = window.open(cancelUrl, "_blank", "noopener,noreferrer");
        if (!opened) window.location.href = cancelUrl;
      }
      const nextProgramState = cancelResult?.["sub" + "scription"] || cancelResult || null;
      setRenewal(nextProgramState);
      setRenewalLoaded(true);
      const validUntil = formatRenewalDate(nextProgramState?.paidUntil || accessExpiryDate(access));
      setRenewalStatus(`Статус обновлён. Программа сохранится до ${validUntil}.`);
    } catch (error) {
      setRenewalStatus(error?.message || "Не удалось обновить статус");
    } finally {
      setRenewalLoading(false);
    }
  }

  async function handleRenewalChange() {
    if (APP_STORE_REVIEW) {
      setRenewalStatus("Статус программы можно уточнить у тренера.");
      return;
    }
    if (!getAuthToken()) {
      setRenewalStatus("Войдите в аккаунт, чтобы изменить статус.");
      onRequireAuth?.({ reason: "program-status-change" });
      return;
    }
    if (!renewalActive) {
      setRenewalStatus("Активный статус не найден.");
      return;
    }

    setRenewalLoading(true);
    setRenewalStatus("");
    try {
      const cancelInfo = await fetchProgramRenewalCancelInfo();
      const currentProgramState = cancelInfo?.["sub" + "scription"] || null;
      if (currentProgramState) {
        setRenewal(currentProgramState);
        setRenewalLoaded(true);
      }
      if (cancelInfo?.canCancel === false) {
        setRenewalStatus(cancelInfo.message || "Статус уже обновлён или активный статус не найден.");
        return;
      }

      const needsExternalCancel = Boolean(cancelInfo?.externalCancelRequired || cancelInfo?.external_cancel_required);
      const confirmText = needsExternalCancel
        ? "Обновим статус в FruitFit, затем откроется внешняя страница для завершения действия. Текущий период сохранится."
        : "Обновить статус программы? Текущий период сохранится.";
      if (!window.confirm(confirmText)) return;

      const cancelResult = await cancelProgramRenewal("client_request");
      if (cancelResult?.skipped) {
        setRenewal(cancelResult?.["sub" + "scription"] || null);
        setRenewalLoaded(true);
        setRenewalStatus(cancelResult.message || "Статус уже обновлён или активный статус не найден.");
        return;
      }

      const cancelUrl = cancelResult?.["robo" + "kassaUnsubscribeUrl"]
        || cancelResult?.["robo" + "kassa_unsubscribe_url"]
        || cancelResult?.cancelUrl
        || cancelResult?.cancel_url
        || "";
      const nextProgramState = cancelResult?.["sub" + "scription"] || cancelResult || null;
      setRenewal(nextProgramState);
      setRenewalLoaded(true);
      if (cancelUrl) await openExternalUrl(cancelUrl);

      const validUntil = formatRenewalDate(nextProgramState?.paidUntil || nextProgramState?.paid_until || accessExpiryDate(access));
      setRenewalStatus(cancelUrl
        ? `Статус обновлён в FruitFit. Завершите действие на внешней странице. Программа сохранена до ${validUntil}.`
        : `Статус обновлён. Программа сохранена до ${validUntil}.`);
    } catch (error) {
      setRenewalStatus(error?.message || "Не удалось обновить статус");
    } finally {
      setRenewalLoading(false);
    }
  }

  function canRefreshNativeHealth() {
    return availability?.state === healthProviderStates.CONNECTED
      || availability?.state === healthProviderStates.PARTIALLY_GRANTED
      || availability?.state === healthProviderStates.NO_DATA;
  }

  async function refreshHealthData() {
    if (canRefreshNativeHealth()) {
      await syncNativeHealth?.({ force: true, reason: "profile-health-refresh", queryMode: "history" });
      return;
    }
    await requestConnection?.();
  }

  async function togglePermission(item) {
    if (item.id === "cycle" && draft.gender === "male") return;
    const shouldEnable = !permissions[item.id];

    if (item.id === "notifications") {
      if (!shouldEnable) {
        setPermissions((current) => ({ ...current, notifications: false }));
        setNotificationStatus("Уведомления выключены в FruitFit. Системное разрешение можно изменить в настройках iPhone.");
        return;
      }
      setNotificationStatus("Запрашиваем разрешение на уведомления...");
      const result = await registerFirebaseMessagingPush({ force: true, prompt: true }).catch((error) => ({
        ok: false,
        status: "CLIENT_ERROR",
        message: error?.message || String(error || "client error"),
      }));
      const connected = Boolean(result?.ok);
      setPermissions((current) => ({ ...current, notifications: connected }));
      setNotificationStatus(notificationRegistrationMessage(result));
      if (!connected && (result?.status === "permission_denied" || result?.permissions?.receive === "denied")) {
        const shouldOpenSettings = window.confirm("Уведомления выключены в настройках iPhone. Открыть настройки FruitFit?");
        if (shouldOpenSettings) await openFirebaseMessagingSettings().catch(() => {});
      }
      return;
    }

    setPermissions((current) => ({ ...current, [item.id]: shouldEnable }));
    if (shouldEnable && ["watch", "heart", "sleep", "steps", "calories"].includes(item.id)) {
      await requestConnection?.();
    }
  }

  const profileDisplayName = [draft.firstName, draft.lastName]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ") || "Профиль FruitFit";

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header className="flex items-center justify-between">
          <h1 className="text-[26px] font-black text-appText">Профиль</h1>
          <button type="button" onClick={() => onNavigate?.("settings")} className="grid h-11 w-11 place-items-center rounded-full border border-appBorder bg-appCard text-appText shadow-sm">
            <Settings size={18} />
          </button>
        </header>

        <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-card">
          <div className="flex items-center gap-4">
            <label className="relative grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-appDark text-appGreen">
              {avatar ? <img src={avatar} alt="avatar" className="h-full w-full object-cover" /> : <Camera size={24} />}
              <input type="file" accept="image/*" onChange={onAvatar} className="hidden" />
            </label>
            <div className="min-w-0">
              <h2 className="text-[20px] font-black text-appText">{profileDisplayName}</h2>
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-appMuted">{profileSummary(draft)}</p>
            </div>
          </div>
          <AccessMembershipCard
            access={access}
            authUser={authUser}
            hasAuth={hasAuth}
            requestLoading={requestLoading}
            requestStatus={requestStatus}
            renewal={renewal}
            renewalActive={renewalActive}
            renewalLoaded={renewalLoaded}
            renewalLoading={renewalLoading}
            renewalStatus={renewalStatus}
            onOpenProgramAction={openProgramAction}
            onChangeRenewal={handleRenewalChange}
          />
        </section>

        <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
          <h2 className="text-[16px] font-black text-appText">Данные профиля</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextField label="Имя" value={draft.firstName} onChange={(value) => updateDraft("firstName", value)} placeholder={PROFILE_FIRST_NAME_PLACEHOLDER} />
            <TextField label="Фамилия" value={draft.lastName} onChange={(value) => updateDraft("lastName", value)} placeholder={PROFILE_LAST_NAME_PLACEHOLDER} />
            <SelectField label="Пол" value={draft.gender} options={profileOptions.gender} error={errors.gender} onChange={(value) => updateDraft("gender", value)} />
            <SelectField label="Цель" value={draft.goal} options={profileOptions.goal} error={errors.goal} onChange={(value) => updateDraft("goal", value)} />
            <SelectField label="Опыт тренировок" value={draft.experience} options={profileOptions.experience} error={errors.experience} onChange={(value) => updateDraft("experience", value)} />
            <SelectField label="Частота" value={draft.trainingFrequency} options={profileOptions.trainingFrequency} error={errors.trainingFrequency} onChange={(value) => updateDraft("trainingFrequency", value)} />
            <SelectField label="Ограничения" value={draft.restrictions} options={profileOptions.restrictions} error={errors.restrictions} onChange={(value) => updateDraft("restrictions", value)} />
            <SelectField label="Тип питания" value={draft.dietType} options={profileOptions.dietType} error={errors.dietType} onChange={(value) => updateDraft("dietType", value)} />
            <NumberField label="Возраст" value={draft.age} suffix="лет" error={errors.age} onChange={(value) => updateDraft("age", value)} />
            <NumberField label="Рост" value={draft.height} suffix="см" error={errors.height} onChange={(value) => updateDraft("height", value)} />
            <NumberField label="Вес" value={draft.weight} suffix="кг" error={errors.weight} onChange={(value) => updateDraft("weight", value)} />
          </div>
          <button type="button" onClick={submit} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appDark text-[14px] font-black text-appGreen">
            <CheckCircle2 size={17} /> Сохранить профиль
          </button>
          {saved && <p className="mt-3 text-center text-[12px] font-bold text-[#86B936]">Профиль сохранен, рекомендации обновлены.</p>}
        </section>

        <MeasurementsSection />

        <section className="mt-4 overflow-hidden rounded-[26px] border border-appBorder bg-appCard shadow-sm">
          <button
            type="button"
            onClick={() => setPermissionsOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Watch size={18} className="shrink-0 text-appOrange" />
              <span className="min-w-0">
                <span className="block text-[16px] font-black text-appText">Здоровье и активность</span>
                <span className="mt-0.5 block text-[12px] font-semibold text-appMuted">
                  {healthPermissionSummary(availability)}
                </span>
              </span>
            </span>
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appBg text-appText transition ${permissionsOpen ? "rotate-180" : ""}`}>
              <ChevronDown size={18} />
            </span>
          </button>
          <AnimatePresence initial={false}>
            {permissionsOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-appBorder"
              >
                <div className="space-y-2 p-4 pt-3">
                  <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-black text-appText">{HEALTH_PROVIDER_NAME}</p>
                        <p className="mt-1 text-[11px] leading-4 text-appMuted">{healthConnectionHint(availability, syncing)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${availability?.state === healthProviderStates.CONNECTED ? "accent-readable-shadow bg-appGreen/20 text-appGreen" : "bg-appCard text-appMuted"}`}>
                        {healthPermissionSummary(availability)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-appMuted">
                      FruitFit использует данные активности для расчёта восстановления и рекомендаций. Основной источник на {HEALTH_PROVIDER_DEVICE_COPY} — {HEALTH_PROVIDER_NAME}.
                    </p>
                    <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-bold text-appMuted">
                      Последняя синхронизация: {formatHealthSyncTime(health?.lastFruitFitRefreshAt || health?.generatedAt)}
                    </p>
                    <button type="button" onClick={refreshHealthData} className="mt-3 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
                      {syncing ? "Обновляем..." : "Подключить или обновить"}
                    </button>
                  </div>
                  <p className="rounded-[18px] border border-appBorder bg-appBg px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                    Тумблеры ниже управляют тем, какие подключённые данные FruitFit учитывает в рекомендациях. Разрешения на чтение меняются в самом {HEALTH_PROVIDER_SETTINGS_NAME}.
                  </p>
                  {permissionItems.filter((item) => draft.gender !== "male" || item.id !== "cycle").map((item) => {
                    const disabled = item.id === "cycle" && draft.gender === "male";
                    const active = Boolean(permissions[item.id]) && !disabled;
                    return (
                      <button key={item.id} type="button" onClick={() => togglePermission(item)} className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-3 text-left transition active:scale-[0.99] ${active ? "border-appGreen/50 bg-appGreen/20" : "border-appBorder bg-appBg"} ${disabled ? "opacity-60" : ""}`}>
                        <span>
                          <span className="block text-[13px] font-bold text-appText">{item.label}</span>
                          <span className="block text-[11px] text-appMuted">{disabled ? "Доступно для женского профиля" : permissionLine(item, availability, active)}</span>
                        </span>
                        <span className={`relative h-6 w-11 rounded-full transition ${active ? "bg-appGreen" : "bg-appBorder"}`}>
                          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${active ? "left-6" : "left-1"}`} />
                        </span>
                      </button>
                    );
                  })}
                  {notificationStatus && (
                    <p className="rounded-[18px] border border-appBorder bg-appBg px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                      {notificationStatus}
                    </p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

      </div>
      <BottomNavigation active="profile" onNavigate={onNavigate} />
    </main>
  );
}
