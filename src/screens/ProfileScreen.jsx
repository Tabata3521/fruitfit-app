import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, ChevronDown, Copy, CreditCard, Gift, Settings, Share2, Watch, X } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import CustomSelect from "../components/CustomSelect";
import { useHealth } from "../data/healthStore";
import { normalizeProfile, profileOptions, profileSummary, saveProfile, validateProfile } from "../data/profileStore";
import { cancelPaymentSubscription, createPaymentSession, fetchAccess, fetchMeasurements, fetchPaymentSubscription, fetchReferralInfo, getAuthToken, loadAuthUser, saveMeasurement, saveServerProfile } from "../data/authStore";
import { accessTier } from "../data/accessRules";
import { healthProviderStates, healthSourceShortcuts, openHealthSource } from "../services/health/healthProvider";

const MEASUREMENTS_KEY = "fruitfit.measurements";
const AVATAR_STORAGE_KEY = "fruitfit.avatar";
const PAYMENT_PAGE_URL = String(import.meta.env.VITE_FRUITFIT_PAYMENT_URL || "https://tagirfruit.ru/payment");

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

function loadAvatar(profile = {}, user = null) {
  if (typeof window === "undefined") return validAvatarDataUrl(profile?.avatar);
  return validAvatarDataUrl(localStorage.getItem(AVATAR_STORAGE_KEY))
    || validAvatarDataUrl(profile?.avatar)
    || validAvatarDataUrl(user?.profile?.avatar)
    || validAvatarDataUrl(user?.avatar)
    || "";
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
    localStorage.setItem(AVATAR_STORAGE_KEY, dataUrl);
    return true;
  } catch (error) {
    console.warn("[FruitFit Profile] avatar local save failed", error);
    return false;
  }
}

function healthPermissionSummary(availability) {
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "Активность подключена";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Можно расширить доступ для точности";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Настройте доступ к показателям";
  if (state === healthProviderStates.NOT_INSTALLED) return "Health Connect можно установить для синхронизации";
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
  if (availability?.state === healthProviderStates.NOT_INSTALLED) return "Появится после настройки Health Connect";
  if (availability?.state === healthProviderStates.NOT_SUPPORTED) return "Доступно в приложении на Android";
  return "Нужен доступ в Health Connect";
}

function healthConnectionHint(availability, syncing) {
  if (syncing) return "Обновляем показатели. Обычно это занимает несколько секунд.";
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "FruitFit использует активность, сон и пульс, чтобы точнее подбирать нагрузку.";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Часть данных уже подключена. Сон и пульс сделают восстановление точнее.";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Разрешите доступ к активности, сну и пульсу. Данные не передаются третьим лицам.";
  if (state === healthProviderStates.NOT_INSTALLED) return "Установите или откройте Health Connect, чтобы синхронизировать данные часов.";
  return "Подключите Health Connect, чтобы FruitFit мог учитывать вашу активность и восстановление.";
}

function formatHealthSyncTime(value) {
  if (!value) return "ещё не было";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "ещё не было";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function paymentGenderLabel(gender) {
  if (gender === "male") return "Мужчина";
  if (gender === "female") return "Женщина";
  return "";
}

function buildPaymentProfileSnapshot(profile = {}) {
  return {
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    gender: paymentGenderLabel(profile.gender),
    height: profile.height ? `${profile.height} см` : "",
    weight: profile.weight ? `${profile.weight} кг` : "",
    age: profile.age ? `${profile.age}` : "",
    goal: profile.goal || "",
    dietType: profile.dietType || "",
    restrictions: profile.restrictions || "",
  };
}

function buildPaymentProgramParams(profile = {}) {
  return {
    experience: profile.experience || "",
    trainingFrequency: profile.trainingFrequency || "",
    recommendedCaloriesTarget: profile.recommendedCaloriesTarget || null,
    calculatedCalories: profile.calculatedCalories || null,
  };
}

function paymentPageUrl(sessionId) {
  const url = new URL(PAYMENT_PAGE_URL, window.location.origin);
  url.searchParams.set("ps", sessionId);
  return url.toString();
}

function subscriptionIsActive(subscription = null) {
  const status = String(subscription?.status || "").toLowerCase();
  return Boolean(subscription?.recurringEnabled || status === "active" || status === "pending");
}

function formatSubscriptionDate(value) {
  if (!value) return "не назначена";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "не назначена";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function subscriptionStatusLabel(subscription = null) {
  const status = String(subscription?.status || "").toLowerCase();
  if (status === "active") return "Активно";
  if (status === "cancel_requested") return "Отмена запрошена";
  if (status === "cancelled" || status === "canceled") return "Продление отключено";
  if (status === "failed") return "Ошибка списания";
  if (status === "expired") return "Истекла";
  return "Не активно";
}

function subscriptionLine(subscription = null, loaded = false) {
  if (!loaded) return "Проверяем статус автопродления...";
  if (!subscription) return "Активное автопродление не найдено";
  return `Статус: ${subscriptionStatusLabel(subscription)} · Следующая оплата: ${formatSubscriptionDate(subscription.nextChargeAt)}`;
}

const stepSourceOptionsBase = [
  { value: "", label: "Auto", hint: "Health Connect aggregate total" },
  { value: "com.google.android.apps.fitness", label: "Google Fit", hint: "Diagnostics only; dashboard uses aggregate" },
  { value: "android", label: "Android / phone", hint: "Системный источник телефона" },
  { value: "com.xiaomi.wearable", label: "Mi Fitness", hint: "Использовать только если вы доверяете Mi Fitness" },
  { value: "zepp", label: "Zepp / Amazfit", hint: "Для Amazfit / Zepp" },
  { value: "fitbit", label: "Fitbit", hint: "Для Fitbit" },
  { value: "com.sec.android.app.shealth", label: "Samsung Health", hint: "Для Samsung Health", onlyWhenPresent: true },
];

function profileSourceKind(source = {}) {
  const raw = `${String(source.sourcePackage || "").toLowerCase()} ${String(source.sourceName || "").toLowerCase()}`;
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "google";
  if (!source.sourcePackage || raw.includes("android") || raw.includes("health connect aggregate")) return "android";
  if (raw.includes("com.xiaomi.wearable") || raw.includes("xiaomi") || raw.includes("mi fitness")) return "mi";
  if (raw.includes("huami") || raw.includes("zepp") || raw.includes("amazfit")) return "zepp";
  if (raw.includes("fitbit")) return "fitbit";
  if (raw.includes("samsung") || raw.includes("shealth")) return "samsung";
  return "other";
}

function profileSourceMatchesPreference(source = {}, value = "") {
  const rawValue = String(value || "").toLowerCase();
  const rawPackage = String(source.sourcePackage || "").toLowerCase();
  const kind = profileSourceKind(source);
  if (!rawValue) return true;
  if (rawPackage === rawValue) return true;
  if (rawValue === "android" && kind === "android") return true;
  if (rawValue.includes("google") && kind === "google") return true;
  if ((rawValue.includes("xiaomi") || rawValue.includes("mi")) && kind === "mi") return true;
  if ((rawValue.includes("zepp") || rawValue.includes("huami") || rawValue.includes("amazfit")) && kind === "zepp") return true;
  if (rawValue.includes("fitbit") && kind === "fitbit") return true;
  if ((rawValue.includes("samsung") || rawValue.includes("shealth")) && kind === "samsung") return true;
  return false;
}

function stepSourceOptionTotal(option, sources = []) {
  if (!option.value) return null;
  const source = sources.find((item) => profileSourceMatchesPreference(item, option.value));
  return source ? Number(source.total || source.convertedValue || source.value || 0) : null;
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
    return JSON.parse(localStorage.getItem(MEASUREMENTS_KEY) || "[]");
  } catch (_) {
    return [];
  }
}

function saveMeasurements(items) {
  localStorage.setItem(MEASUREMENTS_KEY, JSON.stringify(items));
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
        <motion.section initial={{ y: 34 }} animate={{ y: 0 }} exit={{ y: 34 }} className="max-h-[88vh] w-full max-w-[393px] overflow-y-auto rounded-t-[30px] border border-appBorder bg-appCard p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-soft">
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
      console.error("[FruitFit Profile] save measurement failed", error);
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

function normalizePromoInput(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9_-]/g, "");
}

function firstReferralNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function referralSummary(info) {
  const user = info?.user || info?.me || {};
  const referralCode = info?.referralCode || info?.referral_code || user.referralCode || user.referral_code || info?.code || {};
  const stats = info?.stats || info?.summary || {};
  const rawCode = typeof referralCode === "string" ? referralCode : referralCode?.code;
  return {
    code: String(rawCode || info?.referral_code || user.referralCode || user.referral_code || "").trim(),
    invitedCount: firstReferralNumber(stats.invitedCount, stats.referralsCount, stats.invitesCount, info?.invitedCount, info?.referralsCount),
    paidCount: firstReferralNumber(stats.paidCount, stats.paymentsCount, stats.qualifiedCount, info?.paidCount, referralCode?.usesCount),
    bonusDays: firstReferralNumber(info?.bonusDays, info?.bonus_days, info?.bonusInfo?.days, info?.bonus?.days) || 14,
  };
}

function formatReferralCount(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : "0";
}

function accessExpiryDate(access = {}) {
  return access?.expiresAt || access?.expires_at || access?.premiumUntil || access?.premium_until || access?.validUntil || access?.valid_until || null;
}

function formatAccessDate(value) {
  if (!value) return "Доступ активен";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Доступ активен";
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

function accessCardInfo(access = {}, user = {}) {
  const tier = accessTier(access);
  const status = String(access?.status || access?.plan || "").toLowerCase();
  const role = String(access?.role || "").toLowerCase();
  const expiresAt = accessExpiryDate(access);
  const daysLeft = daysUntil(expiresAt);

  if (isAdminAccess(access, user)) {
    return {
      kind: "admin",
      title: "FruitFit Admin",
      subtitle: "Админ-доступ",
      meta: "Доступ активен",
      ringLabel: "∞",
      ringCaption: "",
      ringFull: true,
    };
  }

  if (tier === "vip") {
    return {
      kind: "vip",
      title: "FruitFit VIP",
      subtitle: "Персональное сопровождение",
      meta: formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? "∞" : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "дней",
    };
  }

  if (tier === "paid" || tier === "full") {
    const adminLike = status === "admin" || status === "trainer" || role === "admin" || role === "trainer";
    return {
      kind: "paid",
      title: "FruitFit Pro",
      subtitle: adminLike ? "Полный доступ" : "Полная программа",
      meta: adminLike && !expiresAt ? "Доступ активен" : formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? "∞" : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "дней",
    };
  }

  return {
    kind: "free",
    title: "FruitFit Free",
    subtitle: "Стартовый доступ",
    meta: "Preview программы",
    ringLabel: "∞",
    ringCaption: "",
  };
}

function AccessMembershipCard({
  access,
  authUser,
  hasAuth,
  paymentLoading,
  paymentStatus,
  subscription,
  subscriptionActive,
  subscriptionLoaded,
  subscriptionLoading,
  subscriptionStatus,
  onOpenPayment,
  onCancelSubscription,
}) {
  const info = accessCardInfo(access, authUser);
  const showSubscriptionBlock = Boolean(hasAuth && info.kind !== "free");

  return (
    <div className="mt-4 rounded-[24px] border border-appBorder bg-appBg p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-appMuted">Статус доступа</p>
          <h3 className="mt-1 text-[20px] font-black leading-tight text-appText">{info.title}</h3>
          <p className="mt-1 text-[13px] font-bold text-appMuted">{info.subtitle}</p>
          <p className="mt-1 text-[12px] font-semibold text-appMuted">{info.meta}</p>
        </div>
        <div className={`access-days-ring ${info.ringFull ? "is-full" : ""} grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full text-center`}>
          <span>
            <span className="block text-[22px] font-black leading-none text-appText">{info.ringLabel}</span>
            {info.ringCaption && <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">{info.ringCaption}</span>}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpenPayment}
        disabled={paymentLoading}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen text-[14px] font-black text-[#181F19] shadow-sm transition active:scale-[0.98] disabled:opacity-70"
      >
        <CreditCard size={18} />
        {paymentLoading ? "Готовим оплату..." : "Перейти к оплате"}
      </button>
      {showSubscriptionBlock && (
        <div className="mt-2 rounded-[18px] border border-appBorder bg-appCard/70 px-3 py-2">
          <p className="text-[11px] font-black text-appText">Автоматическое продление программы</p>
          <p className="mt-1 text-[11px] font-semibold text-appMuted">
            {subscriptionLine(subscription, subscriptionLoaded)}
          </p>
        </div>
      )}
      {showSubscriptionBlock && (
        <button
          type="button"
          onClick={onCancelSubscription}
          disabled={subscriptionLoading || !subscriptionLoaded || !subscriptionActive}
          className={`mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full border text-[13px] font-black transition active:scale-[0.98] disabled:opacity-70 ${subscriptionActive ? "border-red-500/35 bg-red-500/10 text-red-500" : "border-appBorder bg-appCard/70 text-appMuted"}`}
        >
          <X size={16} />
          {subscriptionLoading ? "Отключаем..." : "Отключить продление"}
        </button>
      )}
      {paymentStatus && <p className="mt-2 text-center text-[12px] font-bold text-appOrange">{paymentStatus}</p>}
      {subscriptionStatus && <p className="mt-2 text-center text-[12px] font-bold text-appMuted">{subscriptionStatus}</p>}
    </div>
  );
}

function ReferralProgramSection({
  hasAuth,
  referralInfo,
  referralLoading,
  copyStatus,
  shareStatus,
  onCopyCode,
  onShareCode,
}) {
  const summary = referralSummary(referralInfo);
  const codeText = referralLoading
    ? "Готовим код..."
    : summary.code
      ? summary.code
      : hasAuth
        ? "Код создаётся"
        : "После входа";
  const canUseCode = Boolean(summary.code);

  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-appGreen/20 text-appGreen">
          <Gift size={21} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-black text-appText">Реферальная программа</h2>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-appMuted">
            Пригласи друга: он получит скидку 1000 ₽ на оплату, а ты получишь 2 недели платного доступа после его оплаты.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">Ваш код</p>
          <p className="mt-1 truncate text-[14px] font-black text-appText">{codeText}</p>
        </div>
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">Приглашено</p>
          <p className="mt-1 text-[14px] font-black text-appText">{formatReferralCount(summary.invitedCount)}</p>
        </div>
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">Бонус: 14 дней</p>
          <p className="mt-1 text-[14px] font-black text-appText">{formatReferralCount(summary.bonusDays)} дней</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onCopyCode?.(summary.code)}
          disabled={!canUseCode}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-appGreen px-3 text-[12px] font-black text-[#181F19] disabled:bg-appBorder disabled:text-appMuted"
        >
          <Copy size={15} /> {copyStatus || "Скопировать"}
        </button>
        <button
          type="button"
          onClick={() => onShareCode?.(summary.code)}
          disabled={!canUseCode}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-appBorder bg-appBg px-3 text-[12px] font-black text-appText disabled:opacity-55"
        >
          <Share2 size={15} /> {shareStatus || "Поделиться"}
        </button>
      </div>

      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg p-3">
        <p className="text-[12px] font-black text-appText">Бонус за приглашение</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">
          Друг вводит твой код на странице оплаты. Скидку применяет backend, а бонус доступа начисляется после успешной оплаты.
        </p>
      </div>
    </section>
  );
}

export default function ProfileScreen({ profile, access, onProfileChange, theme, onThemeChange, onNavigate, onRestartQuiz, onRequireAuth }) {
  const { health, availability, syncing, requestConnection, syncNativeHealth, buildHealthDebugReport } = useHealth();
  const [avatar, setAvatar] = useState(() => loadAvatar(profile, loadAuthUser()));
  const [draft, setDraft] = useState(() => normalizeProfile(profile));
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [healthDebug, setHealthDebug] = useState(null);
  const [healthDebugStatus, setHealthDebugStatus] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [subscription, setSubscription] = useState(null);
  const [subscriptionLoaded, setSubscriptionLoaded] = useState(false);
  const [subscriptionLoading, setSubscriptionLoading] = useState(false);
  const [subscriptionStatus, setSubscriptionStatus] = useState("");
  const authUser = loadAuthUser();
  const hasAuth = Boolean(getAuthToken());
  const subscriptionActive = subscriptionIsActive(subscription);
  const [referralInfo, setReferralInfo] = useState(null);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralCopyStatus, setReferralCopyStatus] = useState("");
  const [referralShareStatus, setReferralShareStatus] = useState("");
  const [pendingSourceScan, setPendingSourceScan] = useState(false);
  const [preferredSourcePackage, setPreferredSourcePackage] = useState(() => localStorage.getItem("fruitfit.health.preferredSourcePackage") || "");
  const [permissions, setPermissions] = useState(() => {
    try {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: false, ...JSON.parse(localStorage.getItem("fruitfit.permissions") || "{}") };
    } catch (_) {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: false };
    }
  });

  useEffect(() => {
    const normalized = normalizeProfile(profile);
    setDraft(normalized);
    const nextAvatar = loadAvatar(normalized, loadAuthUser());
    setAvatar(nextAvatar);
  }, [profile]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAuth) {
      setReferralInfo(null);
      setReferralLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setReferralLoading(true);
    fetchReferralInfo()
      .then((info) => {
        if (!cancelled) setReferralInfo(info);
      })
      .finally(() => {
        if (!cancelled) setReferralLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hasAuth, authUser?.id, authUser?.email]);

  useEffect(() => {
    function syncReferral(event) {
      if (event?.detail) {
        setReferralInfo(event.detail);
        return;
      }
      if (hasAuth) {
        setReferralLoading(true);
        fetchReferralInfo()
          .then((info) => setReferralInfo(info))
          .finally(() => setReferralLoading(false));
      }
    }
    window.addEventListener("fruitfit:referral-updated", syncReferral);
    return () => window.removeEventListener("fruitfit:referral-updated", syncReferral);
  }, [hasAuth]);

  useEffect(() => {
    let cancelled = false;
    if (!hasAuth) {
      setSubscription(null);
      setSubscriptionLoaded(false);
      return () => {
        cancelled = true;
      };
    }

    setSubscriptionLoaded(false);
    fetchPaymentSubscription()
      .then((nextSubscription) => {
        if (!cancelled) setSubscription(nextSubscription);
      })
      .catch(() => {
        if (!cancelled) setSubscription(null);
      })
      .finally(() => {
        if (!cancelled) setSubscriptionLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [hasAuth, access?.updatedAt, access?.status, access?.plan]);

  useEffect(() => {
    localStorage.setItem("fruitfit.permissions", JSON.stringify(permissions));
  }, [permissions]);

  useEffect(() => {
    if (preferredSourcePackage) {
      localStorage.setItem("fruitfit.health.preferredSourcePackage", preferredSourcePackage);
    } else {
      localStorage.removeItem("fruitfit.health.preferredSourcePackage");
    }
  }, [preferredSourcePackage]);

  useEffect(() => {
    function rescanAfterReturn() {
      if (!pendingSourceScan) return;
      setPendingSourceScan(false);
      refreshHealthData();
    }
    window.addEventListener("focus", rescanAfterReturn);
    document.addEventListener("visibilitychange", rescanAfterReturn);
    return () => {
      window.removeEventListener("focus", rescanAfterReturn);
      document.removeEventListener("visibilitychange", rescanAfterReturn);
    };
  }, [pendingSourceScan, requestConnection, syncNativeHealth]);

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
      console.warn("[FruitFit Profile] avatar update failed", error);
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

  async function handleCopyReferralCode(code) {
    const value = normalizePromoInput(code);
    if (!value) return;
    try {
      await Promise.resolve(navigator.clipboard?.writeText(value));
    } catch (_) {
      const input = document.createElement("input");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      document.body.removeChild(input);
    }
    setReferralCopyStatus("Скопировано");
    window.setTimeout(() => setReferralCopyStatus(""), 1600);
  }

  async function handleShareReferralCode(code) {
    const value = normalizePromoInput(code);
    if (!value) return;
    const text = `Мой код FruitFit: ${value}. Друг получает скидку 1000 ₽ на оплату, а мне начислят 14 дней доступа после его оплаты.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "FruitFit", text });
        setReferralShareStatus("Готово");
      } else {
        await handleCopyReferralCode(value);
        setReferralShareStatus("Скопировано");
      }
    } catch (_) {
      setReferralShareStatus("");
      return;
    }
    window.setTimeout(() => setReferralShareStatus(""), 1600);
  }

  async function openPayment() {
    if (!getAuthToken()) {
      setPaymentStatus("Войдите или создайте аккаунт, затем нажмите оплату снова.");
      onRequireAuth?.({ reason: "payment" });
      return;
    }

    setPaymentLoading(true);
    setPaymentStatus("");
    try {
      const savedProfile = saveProfile(draft);
      onProfileChange?.(savedProfile);
      await saveServerProfile(savedProfile);

      const session = await createPaymentSession({
        productCode: "individual_program",
        recurringEnabled: false,
      });
      if (!session?.id) throw new Error("Backend не вернул номер платежной сессии");
      window.location.href = paymentPageUrl(session.id);
    } catch (error) {
      setPaymentStatus(error?.message || "Не удалось открыть оплату");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function cancelSubscription() {
    if (!getAuthToken()) {
      setSubscriptionStatus("Войдите в аккаунт, чтобы отменить подписку.");
      onRequireAuth?.({ reason: "subscription-cancel" });
      return;
    }
    if (!subscriptionActive) {
      setSubscriptionStatus("Активная подписка не найдена.");
      return;
    }
    if (!window.confirm("Вы отключите автоматическое продление. Доступ к программе сохранится до конца оплаченного периода.")) return;

    setSubscriptionLoading(true);
    setSubscriptionStatus("");
    try {
      const cancelResult = await cancelPaymentSubscription("client_request");
      const cancelUrl = cancelResult?.cancelUrl || cancelResult?.cancel_url || cancelResult?.url || "";
      if (cancelUrl) {
        const opened = window.open(cancelUrl, "_blank", "noopener,noreferrer");
        if (!opened) window.location.href = cancelUrl;
      }
      const nextSubscription = cancelResult?.subscription || cancelResult || null;
      setSubscription(nextSubscription);
      setSubscriptionLoaded(true);
      await fetchAccess();
      const paidUntil = formatSubscriptionDate(nextSubscription?.paidUntil || accessExpiryDate(access));
      setSubscriptionStatus(`Автоматическое продление отключено. Доступ сохранится до ${paidUntil}.`);
    } catch (error) {
      setSubscriptionStatus(error?.message || "Не удалось отменить подписку");
    } finally {
      setSubscriptionLoading(false);
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
    setPermissions((current) => ({ ...current, [item.id]: shouldEnable }));
    if (shouldEnable && ["watch", "heart", "sleep", "steps", "calories"].includes(item.id)) {
      await requestConnection?.();
    }
  }

  async function refreshHealthDebug() {
    if (!buildHealthDebugReport) return;
    setHealthDebugStatus("Собираю диагностику...");
    try {
      const report = await buildHealthDebugReport();
      setHealthDebug(report);
      setHealthDebugStatus("Диагностика обновлена");
    } catch (error) {
      setHealthDebugStatus(error?.message || "Не удалось собрать диагностику");
    }
  }

  async function openSource(sourceId) {
    setHealthDebugStatus("");
    try {
      const result = await openHealthSource(sourceId);
      setHealthDebugStatus(result?.message || "Открыл источник данных");
      setPendingSourceScan(true);
      window.setTimeout(() => requestConnection?.(), 900);
    } catch (error) {
      setHealthDebugStatus(error?.message || "Не удалось открыть источник данных");
    }
  }

  async function copyHealthDebug() {
    try {
      const report = healthDebug || await buildHealthDebugReport?.();
      if (!report) return;
      await Promise.resolve(navigator.clipboard?.writeText(JSON.stringify(report, null, 2)));
      setHealthDebug(report);
      setHealthDebugStatus("JSON скопирован");
    } catch (_) {
      setHealthDebugStatus("Не удалось скопировать JSON");
    }
  }

  async function shareHealthDebug() {
    try {
      const report = healthDebug || await buildHealthDebugReport?.();
      if (!report) return;
      const json = JSON.stringify(report, null, 2);
      const fileName = report.fileName || "fruitfit_health_debug.json";
      setHealthDebug(report);
      if (navigator.share && window.File) {
        const file = new File([json], fileName, { type: "application/json" });
        await navigator.share({ title: "FruitFit health debug", files: [file] });
        setHealthDebugStatus("Отчёт передан в системное меню");
        return;
      }
      await Promise.resolve(navigator.clipboard?.writeText(json));
      setHealthDebugStatus("Share недоступен, JSON скопирован");
    } catch (_) {
      setHealthDebugStatus("Не удалось поделиться JSON");
    }
  }

  const stepSources = health?.steps?.sources || [];
  const stepSourceOptions = stepSourceOptionsBase.filter((option) => !option.onlyWhenPresent || stepSources.some((source) => profileSourceMatchesPreference(source, option.value)));
  const selectedStepSource = stepSourceOptions.find((option) => option.value === preferredSourcePackage)
    || stepSourceOptions.find((option) => preferredSourcePackage && stepSources.some((source) => profileSourceMatchesPreference(source, preferredSourcePackage) && profileSourceMatchesPreference(source, option.value)))
    || stepSourceOptions[0];
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
            paymentLoading={paymentLoading}
            paymentStatus={paymentStatus}
            subscription={subscription}
            subscriptionActive={subscriptionActive}
            subscriptionLoaded={subscriptionLoaded}
            subscriptionLoading={subscriptionLoading}
            subscriptionStatus={subscriptionStatus}
            onOpenPayment={openPayment}
            onCancelSubscription={cancelSubscription}
          />
        </section>

        <ReferralProgramSection
          hasAuth={hasAuth}
          referralInfo={referralInfo}
          referralLoading={referralLoading}
          copyStatus={referralCopyStatus}
          shareStatus={referralShareStatus}
          onCopyCode={handleCopyReferralCode}
          onShareCode={handleShareReferralCode}
        />

        <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
          <h2 className="text-[16px] font-black text-appText">Данные профиля</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextField label="Имя" value={draft.firstName} onChange={(value) => updateDraft("firstName", value)} placeholder="Тагир" />
            <TextField label="Фамилия" value={draft.lastName} onChange={(value) => updateDraft("lastName", value)} placeholder="Мейвалиев" />
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
                        <p className="text-[12px] font-black text-appText">Health Connect</p>
                        <p className="mt-1 text-[11px] leading-4 text-appMuted">{healthConnectionHint(availability, syncing)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${availability?.state === healthProviderStates.CONNECTED ? "accent-readable-shadow bg-appGreen/20 text-appGreen" : "bg-appCard text-appMuted"}`}>
                        {healthPermissionSummary(availability)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-appMuted">
                      FruitFit использует данные активности для расчёта восстановления и рекомендаций. Основной источник на Android — Health Connect.
                    </p>
                    <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-bold text-appMuted">
                      Последняя синхронизация: {formatHealthSyncTime(health?.lastFruitFitRefreshAt || health?.generatedAt)}
                    </p>
                    <button type="button" onClick={refreshHealthData} className="mt-3 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
                      {syncing ? "Обновляем..." : "Подключить или обновить"}
                    </button>
                  </div>
                  <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-black text-appText">Расширенная диагностика</p>
                        <p className="mt-1 text-[11px] leading-4 text-appMuted">
                          Источники, raw JSON и технические проверки скрыты из обычного режима.
                        </p>
                      </div>
                      {healthDebug?.fileName && <span className="shrink-0 rounded-full bg-appCard px-2 py-1 text-[10px] font-bold text-appMuted">JSON</span>}
                    </div>
                    <button type="button" onClick={() => setDiagnosticsOpen((value) => !value)} className="mt-3 h-10 w-full rounded-full border border-appBorder bg-appCard text-[12px] font-black text-appText">
                      {diagnosticsOpen ? "Скрыть диагностику" : "Расширенная диагностика"}
                    </button>
                    {diagnosticsOpen && (
                      <>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {healthSourceShortcuts.map((source) => (
                            <button
                              key={source.id}
                              type="button"
                              onClick={() => openSource(source.id)}
                              className="min-h-11 rounded-2xl border border-appBorder bg-appCard px-3 text-left transition active:scale-[0.98]"
                            >
                              <span className="block text-[11px] font-black text-appText">{source.label}</span>
                              <span className="mt-0.5 block text-[10px] leading-3 text-appMuted">{source.hint}</span>
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 rounded-[16px] border border-appBorder bg-appCard/70 p-2">
                          <div className="flex items-start justify-between gap-2 px-1">
                            <div>
                              <p className="text-[11px] font-black uppercase tracking-[0.08em] text-appMuted">Источник шагов</p>
                              <p className="mt-0.5 text-[10px] leading-3 text-appMuted">Сейчас: {selectedStepSource?.label || "Auto"}</p>
                            </div>
                            {health.steps?.today > 0 && <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] font-black text-appText">{Number(health.steps.today || 0).toLocaleString("ru-RU")}</span>}
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-1.5">
                            {stepSourceOptions.map((option) => {
                              const total = stepSourceOptionTotal(option, stepSources);
                              const active = preferredSourcePackage === option.value || (!preferredSourcePackage && !option.value);
                              return (
                                <button
                                  key={option.value || "auto"}
                                  type="button"
                                  onClick={() => setPreferredSourcePackage(option.value)}
                                  className={`min-h-12 rounded-xl px-3 py-2 text-left transition active:scale-[0.98] ${active ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appText"}`}
                                >
                                  <span className="block truncate text-[11px] font-black">{option.label}</span>
                                  <span className="mt-0.5 block truncate text-[10px] font-semibold opacity-75">{total == null ? option.hint : total.toLocaleString("ru-RU")}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {health?.steps?.selectedSourceReason && (
                          <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-semibold text-appMuted">
                            {health.steps.selectedSourceReason}
                          </p>
                        )}
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <button type="button" onClick={refreshHealthDebug} className="min-h-10 rounded-2xl border border-appBorder bg-appCard px-2 text-[11px] font-black text-appText">
                            Обновить
                          </button>
                          <button type="button" onClick={copyHealthDebug} className="min-h-10 rounded-2xl border border-appBorder bg-appCard px-2 text-[11px] font-black text-appText">
                            Скопировать
                          </button>
                          <button type="button" onClick={shareHealthDebug} className="min-h-10 rounded-2xl bg-appGreen px-2 text-[11px] font-black text-[#181F19]">
                            Поделиться
                          </button>
                        </div>
                        {healthDebugStatus && <p className="mt-2 text-[11px] font-bold text-appMuted">{healthDebugStatus}</p>}
                        {healthDebug && (
                          <pre className="mt-3 max-h-36 overflow-auto rounded-2xl bg-black/10 p-3 text-[10px] leading-4 text-appMuted">
                            {JSON.stringify({
                              fileName: healthDebug.fileName,
                              status: healthDebug.healthConnect?.healthConnectSdkStatus,
                              heartRate: healthDebug.heartRate,
                              steps: {
                                preferredSource: healthDebug.steps?.preferredSource,
                                aggregateToday: healthDebug.steps?.aggregateToday,
                                finalDashboardValue: healthDebug.steps?.finalDashboardValue,
                                selectedSource: healthDebug.steps?.selectedSource,
                                selectedSourceReason: healthDebug.steps?.selectedSourceReason,
                                autoStrategy: healthDebug.steps?.autoStrategy,
                                suspiciousHighSources: healthDebug.steps?.suspiciousHighSources,
                                rejectedSources: healthDebug.steps?.rejectedSources,
                                sourcesToday: healthDebug.steps?.sourcesToday,
                              },
                            }, null, 2)}
                          </pre>
                        )}
                      </>
                    )}
                  </div>
                  <p className="rounded-[18px] border border-appBorder bg-appBg px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                    Тумблеры ниже управляют тем, какие подключённые данные FruitFit учитывает в рекомендациях. Разрешения на чтение меняются в самом Health Connect.
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
