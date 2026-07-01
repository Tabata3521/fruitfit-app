import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, ChevronDown, Copy, CreditCard, Gift, Settings, Share2, Watch, X } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import CustomSelect from "../components/CustomSelect";
import { useHealth } from "../data/healthStore";
import { PROFILE_FIRST_NAME_PLACEHOLDER, PROFILE_LAST_NAME_PLACEHOLDER, normalizeProfile, profileOptions, profileSummary, saveProfile, validateProfile } from "../data/profileStore";
import { cancelPaymentSubscription, createPaymentSession, fetchAccess, fetchMeasurements, fetchPaymentSubscription, fetchPaymentSubscriptionCancelUrl, fetchReferralInfo, getAuthToken, loadAuthUser, saveMeasurement, saveServerProfile } from "../data/authStore";
import { accessTier } from "../data/accessRules";
import { readUserCoreField, writeUserCoreField } from "../data/dataContainers";
import { currentUserId } from "../data/userScopedCache";
import { healthProviderStates } from "../services/health/healthProvider";
import { registerFirebaseMessagingPush } from "../services/notifications/firebaseMessagingPush";

const MEASUREMENTS_KEY = "fruitfit.measurements";
const AVATAR_STORAGE_KEY = "fruitfit.avatar";
const IOS_PUSH_TOKEN_KEY = "fruitfit.push.fcmToken.ios.v1";
const CAPACITOR_PLATFORM = Capacitor.getPlatform?.() || "web";
const IS_IOS_PLATFORM = CAPACITOR_PLATFORM === "ios";
const HEALTH_PROVIDER_NAME = IS_IOS_PLATFORM ? "Apple Health" : "Health Connect";
const HEALTH_PROVIDER_DEVICE_COPY = IS_IOS_PLATFORM ? "iPhone" : "Android";

const permissionItems = [
  { id: "watch", label: "РЎРјР°СЂС‚-С‡Р°СЃС‹", permissionKey: null },
  { id: "heart", label: "РџСѓР»СЊСЃ", permissionKey: "heartRate" },
  { id: "sleep", label: "РЎРѕРЅ", permissionKey: "sleep" },
  { id: "steps", label: "РЁР°РіРё", permissionKey: "steps" },
  { id: "calories", label: "РљР°Р»РѕСЂРёРё", permissionKey: "calories" },
  { id: "cycle", label: "Р¦РёРєР»" },
  { id: "notifications", label: "РЈРІРµРґРѕРјР»РµРЅРёСЏ" },
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

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕС‡РёС‚Р°С‚СЊ С„РѕС‚Рѕ"));
    reader.readAsDataURL(file);
  });
}

function loadAvatarImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР±СЂР°Р±РѕС‚Р°С‚СЊ С„РѕС‚Рѕ"));
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
    console.warn("[FruitFit Profile] avatar local save failed", error);
    return false;
  }
}

function healthPermissionSummary(availability) {
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "РђРєС‚РёРІРЅРѕСЃС‚СЊ РїРѕРґРєР»СЋС‡РµРЅР°";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "РњРѕР¶РЅРѕ СЂР°СЃС€РёСЂРёС‚СЊ РґРѕСЃС‚СѓРї РґР»СЏ С‚РѕС‡РЅРѕСЃС‚Рё";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "РќР°СЃС‚СЂРѕР№С‚Рµ РґРѕСЃС‚СѓРї Рє РїРѕРєР°Р·Р°С‚РµР»СЏРј";
  if (state === healthProviderStates.NOT_INSTALLED) return "Apple Health РЅРµРґРѕСЃС‚СѓРїРµРЅ РЅР° СЌС‚РѕРј СѓСЃС‚СЂРѕР№СЃС‚РІРµ";
  if (state === healthProviderStates.NO_DATA) return "Р–РґС‘Рј РїРµСЂРІСѓСЋ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЋ";
  return "РџРѕРґРєР»СЋС‡РёС‚Рµ С‚СЂРµРєРµСЂ РґР»СЏ РїРµСЂСЃРѕРЅР°Р»РёР·Р°С†РёРё";
}

function permissionLine(item, availability, active) {
  if (item.id === "notifications") return active ? "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹" : "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІС‹РєР»СЋС‡РµРЅС‹";
  if (item.id === "cycle") return "Р”Р°РЅРЅС‹Рµ С†РёРєР»Р° РІРІРѕРґСЏС‚СЃСЏ РІСЂСѓС‡РЅСѓСЋ";
  if (!active) return item.id === "watch" ? "РќРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ FruitFit" : "РќРµ СѓС‡РёС‚С‹РІР°РµС‚СЃСЏ РІ СЂРµРєРѕРјРµРЅРґР°С†РёСЏС…";
  if (!item.permissionKey) return healthPermissionSummary(availability);
  const granted = Boolean(availability?.permissionStatus?.[item.permissionKey]);
  if (granted) return "РџРѕРґРєР»СЋС‡РµРЅРѕ Рё СѓС‡РёС‚С‹РІР°РµС‚СЃСЏ";
  if (availability?.state === healthProviderStates.NOT_INSTALLED) return "РџРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ РЅР°СЃС‚СЂРѕР№РєРё Apple Health";
  if (availability?.state === healthProviderStates.NOT_SUPPORTED) return "Р”РѕСЃС‚СѓРїРЅРѕ РІ РїСЂРёР»РѕР¶РµРЅРёРё РЅР° Android";
  return "РќСѓР¶РµРЅ РґРѕСЃС‚СѓРї РІ Apple Health";
}

function notificationRegistrationMessage(result) {
  if (!result) return "";
  if (result.ok) {
    if (result.data?.fcmConfigured === false) {
      return "РЈРІРµРґРѕРјР»РµРЅРёСЏ СЂР°Р·СЂРµС€РµРЅС‹, РЅРѕ РѕС‚РїСЂР°РІРєР° РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРЅР°.";
    }
    return "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹.";
  }
  if (result.status === "UNAUTHENTICATED") return "Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РІРєР»СЋС‡РёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёСЏ.";
  if (result.status === "native_push_unavailable") return "РЈРІРµРґРѕРјР»РµРЅРёСЏ РґРѕСЃС‚СѓРїРЅС‹ С‚РѕР»СЊРєРѕ РІ РїСЂРёР»РѕР¶РµРЅРёРё РЅР° С‚РµР»РµС„РѕРЅРµ.";
  if (result.status === "NO_FCM_TOKEN") return "РќРµ СѓРґР°Р»РѕСЃСЊ РІРєР»СЋС‡РёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёСЏ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РµС‰С‘ СЂР°Р·.";
  if (result.status === "permission_missing") {
    if (result.permissions?.receive === "denied") {
      return "РћС‚РєСЂРѕР№С‚Рµ РќР°СЃС‚СЂРѕР№РєРё > FruitFit > РЈРІРµРґРѕРјР»РµРЅРёСЏ Рё РІРєР»СЋС‡РёС‚Рµ СЂР°Р·СЂРµС€РµРЅРёРµ.";
    }
    return "Р Р°Р·СЂРµС€РµРЅРёРµ РЅРµ РІС‹РґР°РЅРѕ. РќР°Р¶РјРёС‚Рµ РµС‰С‘ СЂР°Р· Рё РІС‹Р±РµСЂРёС‚Рµ В«Р Р°Р·СЂРµС€РёС‚СЊВ».";
  }
  return "РќРµ СѓРґР°Р»РѕСЃСЊ РІРєР»СЋС‡РёС‚СЊ СѓРІРµРґРѕРјР»РµРЅРёСЏ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.";
}

function healthConnectionHint(availability, syncing) {
  if (syncing) return "РћР±РЅРѕРІР»СЏРµРј РїРѕРєР°Р·Р°С‚РµР»Рё. РћР±С‹С‡РЅРѕ СЌС‚Рѕ Р·Р°РЅРёРјР°РµС‚ РЅРµСЃРєРѕР»СЊРєРѕ СЃРµРєСѓРЅРґ.";
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "FruitFit РёСЃРїРѕР»СЊР·СѓРµС‚ Р°РєС‚РёРІРЅРѕСЃС‚СЊ, СЃРѕРЅ Рё РїСѓР»СЊСЃ, С‡С‚РѕР±С‹ С‚РѕС‡РЅРµРµ РїРѕРґР±РёСЂР°С‚СЊ РЅР°РіСЂСѓР·РєСѓ.";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Р§Р°СЃС‚СЊ РґР°РЅРЅС‹С… СѓР¶Рµ РїРѕРґРєР»СЋС‡РµРЅР°. РЎРѕРЅ Рё РїСѓР»СЊСЃ СЃРґРµР»Р°СЋС‚ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ С‚РѕС‡РЅРµРµ.";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Р Р°Р·СЂРµС€РёС‚Рµ РґРѕСЃС‚СѓРї Рє Р°РєС‚РёРІРЅРѕСЃС‚Рё, СЃРЅСѓ Рё РїСѓР»СЊСЃСѓ. Р”Р°РЅРЅС‹Рµ РЅРµ РїРµСЂРµРґР°СЋС‚СЃСЏ С‚СЂРµС‚СЊРёРј Р»РёС†Р°Рј.";
  if (state === healthProviderStates.NOT_INSTALLED) return "РћС‚РєСЂРѕР№С‚Рµ Apple Health Рё РїСЂРѕРІРµСЂСЊС‚Рµ, С‡С‚Рѕ С‡Р°СЃС‹ СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓСЋС‚ РґР°РЅРЅС‹Рµ.";
  return "РџРѕРґРєР»СЋС‡РёС‚Рµ Apple Health, С‡С‚РѕР±С‹ FruitFit РјРѕРі СѓС‡РёС‚С‹РІР°С‚СЊ РІР°С€Сѓ Р°РєС‚РёРІРЅРѕСЃС‚СЊ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.";
}

function formatHealthSyncTime(value) {
  if (!value) return "РµС‰С‘ РЅРµ Р±С‹Р»Рѕ";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "РµС‰С‘ РЅРµ Р±С‹Р»Рѕ";
  return date.toLocaleString("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function paymentGenderLabel(gender) {
  if (gender === "male") return "РњСѓР¶С‡РёРЅР°";
  if (gender === "female") return "Р–РµРЅС‰РёРЅР°";
  return "";
}

function buildPaymentProfileSnapshot(profile = {}) {
  return {
    firstName: profile.firstName || "",
    lastName: profile.lastName || "",
    gender: paymentGenderLabel(profile.gender),
    height: profile.height ? `${profile.height} СЃРј` : "",
    weight: profile.weight ? `${profile.weight} РєРі` : "",
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

function subscriptionIsActive(subscription = null) {
  const status = String(subscription?.status || "").toLowerCase();
  return Boolean(subscription?.recurringEnabled || status === "active" || status === "pending");
}

function formatSubscriptionDate(value) {
  if (!value) return "РЅРµ РЅР°Р·РЅР°С‡РµРЅР°";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "РЅРµ РЅР°Р·РЅР°С‡РµРЅР°";
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
}

function subscriptionStatusLabel(subscription = null) {
  const status = String(subscription?.status || "").toLowerCase();
  if (status === "active") return "РђРєС‚РёРІРЅРѕ";
  if (status === "cancel_requested") return "РћС‚РјРµРЅР° Р·Р°РїСЂРѕС€РµРЅР°";
  if (status === "cancelled" || status === "canceled") return "РџСЂРѕРґР»РµРЅРёРµ РѕС‚РєР»СЋС‡РµРЅРѕ";
  if (status === "failed") return "РћС€РёР±РєР° СЃРїРёСЃР°РЅРёСЏ";
  if (status === "expired") return "РСЃС‚РµРєР»Р°";
  return "РќРµ Р°РєС‚РёРІРЅРѕ";
}

function subscriptionLine(subscription = null, loaded = false) {
  if (!loaded) return "РџСЂРѕРІРµСЂСЏРµРј СЃС‚Р°С‚СѓСЃ Р°РІС‚РѕРїСЂРѕРґР»РµРЅРёСЏ...";
  if (!subscription) return "РђРєС‚РёРІРЅРѕРµ Р°РІС‚РѕРїСЂРѕРґР»РµРЅРёРµ РЅРµ РЅР°Р№РґРµРЅРѕ";
  return `РЎС‚Р°С‚СѓСЃ: ${subscriptionStatusLabel(subscription)} В· РЎР»РµРґСѓСЋС‰Р°СЏ РѕРїР»Р°С‚Р°: ${formatSubscriptionDate(subscription.nextChargeAt)}`;
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
    ["weight", "Р’РµСЃ", "#8BBE3D", "РєРі"],
    ["waist", "РўР°Р»РёСЏ", "#FF7A2F", "СЃРј"],
    ["chest", "Р“СЂСѓРґСЊ", "#5FA8FF", "СЃРј"],
    ["hips", "Р‘РµРґСЂР°", "#B394FF", "СЃРј"],
  ];

  if (rows.length < 2) {
    return (
      <div className="rounded-[20px] border border-appBorder bg-appBg p-4 text-center">
        <p className="text-[13px] font-bold text-appText">Р“СЂР°С„РёРє РїРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ РґРІСѓС… Р·Р°РјРµСЂРѕРІ</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">РњРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ Р·Р°РјРµСЂС‹ РІСЂСѓС‡РЅСѓСЋ. РџРѕСЃР»Рµ РІС…РѕРґР° РёСЃС‚РѕСЂРёСЏ СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓРµС‚СЃСЏ СЃ Р°РєРєР°СѓРЅС‚РѕРј.</p>
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
        <p className="text-[11px] font-bold uppercase text-appMuted">{active?.date || "Р”Р°С‚Р°"}</p>
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
            <h2 className="text-[24px] font-black text-appText">РСЃС‚РѕСЂРёСЏ Р·Р°РјРµСЂРѕРІ</h2>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-appBg text-appText"><X size={18} /></button>
          </div>
          <div className="mt-4 space-y-2">
            {[...items].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((item) => (
              <div key={item.id} className="rounded-[18px] border border-appBorder bg-appBg p-3 text-[12px]">
                <input type="date" value={item.date} onChange={(event) => onDateChange(item.id, event.target.value)} className="mb-2 h-10 w-full rounded-2xl border border-appBorder bg-appCard px-3 font-bold text-appText outline-none" />
                <p className="leading-5 text-appMuted">Р’РµСЃ {item.weight || "-"} РєРі вЂў РўР°Р»РёСЏ {item.waist || "-"} вЂў Р“СЂСѓРґСЊ {item.chest || "-"} вЂў Р‘РµРґСЂР° {item.hips || "-"}</p>
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
      setSyncStatus("Р—Р°РјРµСЂС‹ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅС‹ СЃ Р°РєРєР°СѓРЅС‚РѕРј");
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
      setSyncStatus("Р’РІРµРґРёС‚Рµ С…РѕС‚СЏ Р±С‹ РѕРґРёРЅ РїРѕРєР°Р·Р°С‚РµР»СЊ Р·Р°РјРµСЂР°.");
      return;
    }
    const next = { ...draft, id: crypto.randomUUID?.() || String(Date.now()) };
    setItems((current) => mergeMeasurements([next, ...current.filter((item) => item.date !== next.date)]));
    setDraft({ date: today, weight: "", chest: "", waist: "", hips: "" });
    if (!getAuthToken() && !loadAuthUser()) {
      setSyncStatus("Р—Р°РјРµСЂ СЃРѕС…СЂР°РЅС‘РЅ РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРµ. Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°С‚СЊ РёСЃС‚РѕСЂРёСЋ.");
      return;
    }
    try {
      const saved = await saveMeasurement(next);
      if (saved) setItems((current) => mergeMeasurements([saved, ...current.filter((item) => item.date !== next.date)]));
      setSyncStatus("Р—Р°РјРµСЂ СЃРѕС…СЂР°РЅС‘РЅ Рё СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°РЅ");
    } catch (error) {
      console.error("[FruitFit Profile] save measurement failed", error);
      setSyncStatus("Р—Р°РјРµСЂ СЃРѕС…СЂР°РЅС‘РЅ РЅР° СѓСЃС‚СЂРѕР№СЃС‚РІРµ. РЎРµСЂРІРµСЂРЅР°СЏ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РїРѕРІС‚РѕСЂРёС‚СЃСЏ РїРѕР·Р¶Рµ.");
    }
  }

  function updateDate(id, date) {
    setItems((current) => mergeMeasurements(current.map((item) => item.id === id ? { ...item, date } : item)));
  }

  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-black text-appText">Р—Р°РјРµСЂС‹</h2>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} className="h-11 rounded-2xl border border-appBorder bg-appBg px-3 text-[12px] font-bold text-appText outline-none" />
        {[
          ["weight", "Р’РµСЃ, РєРі"],
          ["chest", "Р“СЂСѓРґСЊ, СЃРј"],
          ["waist", "РўР°Р»РёСЏ, СЃРј"],
          ["hips", "Р‘РµРґСЂР°, СЃРј"],
        ].map(([key, label]) => (
          <input key={key} value={draft[key]} placeholder={label} inputMode="decimal" onChange={(event) => update(key, event.target.value.replace(/[^\d.]/g, ""))} className="h-11 rounded-2xl border border-appBorder bg-appBg px-3 text-[12px] font-bold text-appText outline-none placeholder:text-appMuted" />
        ))}
      </div>
      <button type="button" onClick={addMeasurement} className="mt-3 h-11 w-full rounded-full bg-appDark text-[13px] font-black text-appGreen">Р”РѕР±Р°РІРёС‚СЊ Р·Р°РјРµСЂ</button>
      {syncStatus && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">{syncStatus}</p>}
      <div className="mt-4 grid grid-cols-4 gap-1 rounded-full bg-appBg p-1">
        {[
          ["week", "РќРµРґРµР»СЏ"],
          ["month", "РњРµСЃСЏС†"],
          ["quarter", "3 РјРµСЃ"],
          ["all", "Р’СЃРµ"],
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
            <p className="text-appMuted">Р’РµСЃ {item.weight || "-"} РєРі вЂў РўР°Р»РёСЏ {item.waist || "-"} вЂў Р“СЂСѓРґСЊ {item.chest || "-"} вЂў Р‘РµРґСЂР° {item.hips || "-"}</p>
          </div>
        ))}
      </div>
      {items.length > 3 && (
        <button type="button" onClick={() => setHistoryOpen(true)} className="mt-3 h-11 w-full rounded-full border border-appBorder bg-appBg text-[13px] font-black text-appText">
          РЎРјРѕС‚СЂРµС‚СЊ РІСЃСЋ РёСЃС‚РѕСЂРёСЋ
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
  if (!value) return "Р”РѕСЃС‚СѓРї Р°РєС‚РёРІРµРЅ";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Р”РѕСЃС‚СѓРї Р°РєС‚РёРІРµРЅ";
  return `РґРѕ ${date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })}`;
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
      subtitle: "РђРґРјРёРЅ-РґРѕСЃС‚СѓРї",
      meta: "Р”РѕСЃС‚СѓРї Р°РєС‚РёРІРµРЅ",
      ringLabel: "в€ћ",
      ringCaption: "",
      ringFull: true,
      ringProgress: 1,
    };
  }

  if (tier === "vip") {
    const hasFiniteAccess = daysLeft != null;
    return {
      kind: "vip",
      title: "FruitFit VIP",
      subtitle: "РџРµСЂСЃРѕРЅР°Р»СЊРЅРѕРµ СЃРѕРїСЂРѕРІРѕР¶РґРµРЅРёРµ",
      meta: formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? "в€ћ" : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "РґРЅРµР№",
      ringFull: !hasFiniteAccess,
      ringProgress: hasFiniteAccess ? accessRingProgress(access, expiresAt, daysLeft) : 1,
    };
  }

  if (tier === "paid" || tier === "full") {
    const adminLike = status === "admin" || status === "trainer" || role === "admin" || role === "trainer";
    const hasFiniteAccess = daysLeft != null;
    return {
      kind: "paid",
      title: "FruitFit Pro",
      subtitle: adminLike ? "РџРѕР»РЅС‹Р№ РґРѕСЃС‚СѓРї" : "РџРѕР»РЅР°СЏ РїСЂРѕРіСЂР°РјРјР°",
      meta: adminLike && !expiresAt ? "Р”РѕСЃС‚СѓРї Р°РєС‚РёРІРµРЅ" : formatAccessDate(expiresAt),
      ringLabel: daysLeft == null ? "в€ћ" : String(Math.min(daysLeft, 999)),
      ringCaption: daysLeft == null ? "" : "РґРЅРµР№",
      ringFull: !hasFiniteAccess,
      ringProgress: hasFiniteAccess ? accessRingProgress(access, expiresAt, daysLeft) : 1,
    };
  }

  return {
    kind: "free",
    title: "FruitFit Free",
    subtitle: "РЎС‚Р°СЂС‚РѕРІС‹Р№ РґРѕСЃС‚СѓРї",
    meta: "Preview РїСЂРѕРіСЂР°РјРјС‹",
    ringLabel: "в€ћ",
    ringCaption: "",
    ringFull: true,
    ringProgress: 1,
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
  const isFreeAccess = info.kind === "free";
  const isPaidAccess = info.kind === "paid";
  const showSubscriptionBlock = Boolean(hasAuth && info.kind !== "free" && !IS_IOS_PLATFORM);
  const paidRenewalAvailable = Boolean(isPaidAccess && subscriptionLoaded && !subscriptionActive);
  const showPaymentButton = isFreeAccess || paidRenewalAvailable || (!isPaidAccess && !isFreeAccess);
  const showCancelButton = Boolean(showSubscriptionBlock && subscriptionActive);
  const paymentButtonText = "РћС„РѕСЂРјРёС‚СЊ РїРµСЂСЃРѕРЅР°Р»СЊРЅСѓСЋ РїСЂРѕРіСЂР°РјРјСѓ";
  const accessUntilText = formatSubscriptionDate(subscription?.paidUntil || subscription?.paid_until || accessExpiryDate(access));
  const ringDegrees = info.ringFull ? 360 : Math.round(Math.max(0, Math.min(1, info.ringProgress ?? 1)) * 360);

  return (
    <div className="mt-4 rounded-[24px] border border-appBorder bg-appBg p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.14em] text-appMuted">РЎС‚Р°С‚СѓСЃ РґРѕСЃС‚СѓРїР°</p>
          <h3 className="mt-1 text-[20px] font-black leading-tight text-appText">{info.title}</h3>
          <p className="mt-1 text-[13px] font-bold text-appMuted">{info.subtitle}</p>
          <p className="mt-1 text-[12px] font-semibold text-appMuted">{info.meta}</p>
        </div>
        <div className={`access-days-ring ${info.ringFull ? "is-full" : ""} grid h-[74px] w-[74px] shrink-0 place-items-center rounded-full text-center`} style={{ "--access-ring-deg": `${ringDegrees}deg` }}>
          <span>
            <span className="block text-[22px] font-black leading-none text-appText">{info.ringLabel}</span>
            {info.ringCaption && <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">{info.ringCaption}</span>}
          </span>
        </div>
      </div>

      {showPaymentButton && (
        <button
          type="button"
          onClick={onOpenPayment}
          disabled={paymentLoading}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen text-[14px] font-black text-[#181F19] shadow-sm transition active:scale-[0.98] disabled:opacity-70"
        >
          <CreditCard size={18} />
          {paymentLoading ? "Р“РѕС‚РѕРІРёРј РѕС„РѕСЂРјР»РµРЅРёРµ..." : paymentButtonText}
        </button>
      )}
      {showSubscriptionBlock && (
        <div className="mt-2 rounded-[18px] border border-appBorder bg-appCard/70 px-3 py-2">
          <p className="text-[11px] font-black text-appText">РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РїСЂРѕРґР»РµРЅРёРµ РїСЂРѕРіСЂР°РјРјС‹</p>
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
          {subscriptionLoading ? "РћС‚РєР»СЋС‡Р°РµРј..." : "РћС‚РєР»СЋС‡РёС‚СЊ РїСЂРѕРґР»РµРЅРёРµ"}
        </button>
      )}
      {paymentStatus && <p className="mt-2 text-center text-[12px] font-bold text-appOrange">{paymentStatus}</p>}
      {showSubscriptionBlock && subscriptionStatus && <p className="mt-2 text-center text-[12px] font-bold text-appMuted">{subscriptionStatus}</p>}
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
    ? "Р“РѕС‚РѕРІРёРј РєРѕРґ..."
    : summary.code
      ? summary.code
      : hasAuth
        ? "РљРѕРґ СЃРѕР·РґР°С‘С‚СЃСЏ"
        : "РџРѕСЃР»Рµ РІС…РѕРґР°";
  const canUseCode = Boolean(summary.code);

  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-appGreen/20 text-appGreen">
          <Gift size={21} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[20px] font-black leading-tight text-appText">Р”РµР»РёСЃСЊ РїСЂРѕРјРѕРєРѕРґРѕРј: С‚РµР±Рµ 14 РґРЅРµР№, РґСЂСѓРіСѓ 1000 в‚Ѕ!</h2>
          </div>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">
            РџСЂРёРіР»Р°СЃРё РґСЂСѓРіР° вЂ” РїРѕРґРµР»РёСЃСЊ РїСЂРѕРјРѕРєРѕРґРѕРј. РљРѕРіРґР° РѕРЅ РёСЃРїРѕР»СЊР·СѓРµС‚ С‚РІРѕР№ РєРѕРґ РґР»СЏ РїРµСЂРІРѕР№ РѕРїР»Р°С‚С‹, РѕРЅ РїРѕР»СѓС‡РёС‚ СЃРєРёРґРєСѓ 1000 в‚Ѕ, Р° С‚РµР±Рµ Р·Р°С‡РёСЃР»РёС‚СЃСЏ 14 РґРЅРµР№ РїСЂРµРјРёСѓРј-РґРѕСЃС‚СѓРїР°.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">Р’Р°С€ РєРѕРґ</p>
          <p className="mt-1 truncate text-[14px] font-black text-appText">{codeText}</p>
        </div>
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">РџСЂРёРіР»Р°С€РµРЅРѕ</p>
          <p className="mt-1 text-[14px] font-black text-appText">{formatReferralCount(summary.invitedCount)}</p>
        </div>
        <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
          <p className="text-[10px] font-black uppercase tracking-[0.1em] text-appMuted">Р’Р°С€ Р±РѕРЅСѓСЃ</p>
          <p className="mt-1 text-[14px] font-black leading-tight text-appText">{formatReferralCount(summary.bonusDays)} РґРЅРµР№ РїСЂРµРјРёСѓРјР°</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onCopyCode?.(summary.code)}
          disabled={!canUseCode}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-appGreen px-3 text-[12px] font-black text-[#181F19] disabled:bg-appBorder disabled:text-appMuted"
        >
          <Copy size={15} /> {copyStatus || "РЎРєРѕРїРёСЂРѕРІР°С‚СЊ"}
        </button>
        <button
          type="button"
          onClick={() => onShareCode?.(summary.code)}
          disabled={!canUseCode}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-appBorder bg-appBg px-3 text-[12px] font-black text-appText disabled:opacity-55"
        >
          <Share2 size={15} /> {shareStatus || "РџРѕРґРµР»РёС‚СЊСЃСЏ"}
        </button>
      </div>

      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg p-3">
        <p className="text-[12px] font-black text-appText">Р‘РѕРЅСѓСЃ Р·Р° РїСЂРёРіР»Р°С€РµРЅРёРµ</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">
          РљР°Рє СЌС‚Рѕ СЂР°Р±РѕС‚Р°РµС‚: РґСЂСѓРі РІРІРѕРґРёС‚ С‚РІРѕР№ РїСЂРѕРјРѕРєРѕРґ РїСЂРё РѕРїР»Р°С‚Рµ, СЃРєРёРґРєР° РїСЂРёРјРµРЅСЏРµС‚СЃСЏ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРё, Р° С‚РІРѕР№ Р±РѕРЅСѓСЃ Р·Р°С‡РёСЃР»СЏРµС‚СЃСЏ РїРѕСЃР»Рµ РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ.
        </p>
      </div>
    </section>
  );
}

export default function ProfileScreen({ profile, access, onProfileChange, theme, onThemeChange, onNavigate, onRestartQuiz, onRequireAuth }) {
  const { health, availability, syncing, requestConnection, syncNativeHealth } = useHealth();
  const [avatar, setAvatar] = useState(() => loadAvatar(profile, loadAuthUser()));
  const [draft, setDraft] = useState(() => normalizeProfile(profile));
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
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
  const [permissions, setPermissions] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("fruitfit.permissions") || "{}");
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, ...stored, notifications: Boolean(stored.notifications || hasStoredIosPushToken()) };
    } catch (_) {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: hasStoredIosPushToken() };
    }
  });
  const [notificationStatus, setNotificationStatus] = useState(() => (
    hasStoredIosPushToken() ? "РЈРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹." : ""
  ));

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
    setReferralCopyStatus("РЎРєРѕРїРёСЂРѕРІР°РЅРѕ");
    window.setTimeout(() => setReferralCopyStatus(""), 1600);
  }

  async function handleShareReferralCode(code) {
    const value = normalizePromoInput(code);
    if (!value) return;
    const text = `РњРѕР№ РєРѕРґ FruitFit: ${value}. Р”СЂСѓРі РїРѕР»СѓС‡Р°РµС‚ СЃРєРёРґРєСѓ 1000 в‚Ѕ РЅР° РѕРїР»Р°С‚Сѓ, Р° РјРЅРµ РЅР°С‡РёСЃР»СЏС‚ 14 РґРЅРµР№ РґРѕСЃС‚СѓРїР° РїРѕСЃР»Рµ РµРіРѕ РѕРїР»Р°С‚С‹.`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "FruitFit", text });
        setReferralShareStatus("Р“РѕС‚РѕРІРѕ");
      } else {
        await handleCopyReferralCode(value);
        setReferralShareStatus("РЎРєРѕРїРёСЂРѕРІР°РЅРѕ");
      }
    } catch (_) {
      setReferralShareStatus("");
      return;
    }
    window.setTimeout(() => setReferralShareStatus(""), 1600);
  }

  async function openPayment() {
    if (!getAuthToken()) {
      setPaymentStatus("Р’РѕР№РґРёС‚Рµ РёР»Рё СЃРѕР·РґР°Р№С‚Рµ Р°РєРєР°СѓРЅС‚, Р·Р°С‚РµРј РЅР°Р¶РјРёС‚Рµ РѕРїР»Р°С‚Сѓ СЃРЅРѕРІР°.");
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
        productCode: "program_subscription",
        recurringEnabled: true,
      });
      if (!session?.id) throw new Error("РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРіРѕС‚РѕРІРёС‚СЊ РѕРїР»Р°С‚Сѓ. РџРѕРїСЂРѕР±СѓР№С‚Рµ РїРѕР·Р¶Рµ.");
      window.location.href = paymentPageUrl(session.id);
    } catch (error) {
      setPaymentStatus(error?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РѕРїР»Р°С‚Сѓ");
    } finally {
      setPaymentLoading(false);
    }
  }

  async function cancelSubscription() {
    if (!getAuthToken()) {
      setSubscriptionStatus("Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РѕС‚РјРµРЅРёС‚СЊ РїРѕРґРїРёСЃРєСѓ.");
      onRequireAuth?.({ reason: "subscription-cancel" });
      return;
    }
    if (!subscriptionActive) {
      setSubscriptionStatus("РђРєС‚РёРІРЅР°СЏ РїРѕРґРїРёСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°.");
      return;
    }
    if (!window.confirm("Р’С‹ РѕС‚РєР»СЋС‡РёС‚Рµ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РїСЂРѕРґР»РµРЅРёРµ. Р”РѕСЃС‚СѓРї Рє РїСЂРѕРіСЂР°РјРјРµ СЃРѕС…СЂР°РЅРёС‚СЃСЏ РґРѕ РєРѕРЅС†Р° РѕРїР»Р°С‡РµРЅРЅРѕРіРѕ РїРµСЂРёРѕРґР°.")) return;

    setSubscriptionLoading(true);
    setSubscriptionStatus("");
    try {
      const cancelResult = await cancelPaymentSubscription("client_request", cancelInfo);
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
      setSubscriptionStatus(`РђРІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РїСЂРѕРґР»РµРЅРёРµ РѕС‚РєР»СЋС‡РµРЅРѕ. Р”РѕСЃС‚СѓРї СЃРѕС…СЂР°РЅРёС‚СЃСЏ РґРѕ ${paidUntil}.`);
    } catch (error) {
      setSubscriptionStatus(error?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ РїРѕРґРїРёСЃРєСѓ");
    } finally {
      setSubscriptionLoading(false);
    }
  }

  async function handleCancelSubscription() {
    if (!getAuthToken()) {
      setSubscriptionStatus("Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РѕС‚РјРµРЅРёС‚СЊ РїРѕРґРїРёСЃРєСѓ.");
      onRequireAuth?.({ reason: "subscription-cancel" });
      return;
    }
    if (!subscriptionActive) {
      setSubscriptionStatus("РђРєС‚РёРІРЅР°СЏ РїРѕРґРїРёСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°.");
      return;
    }

    setSubscriptionLoading(true);
    setSubscriptionStatus("");
    try {
      const cancelInfo = await fetchPaymentSubscriptionCancelUrl();
      if (cancelInfo?.subscription) {
        setSubscription(cancelInfo.subscription);
        setSubscriptionLoaded(true);
      }
      if (cancelInfo?.canCancel === false) {
        setSubscriptionStatus(cancelInfo.message || "РђРІС‚РѕРїСЂРѕРґР»РµРЅРёРµ СѓР¶Рµ РѕС‚РєР»СЋС‡РµРЅРѕ РёР»Рё Р°РєС‚РёРІРЅР°СЏ РїРѕРґРїРёСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°.");
        return;
      }

      const needsExternalCancel = Boolean(cancelInfo?.externalCancelRequired || cancelInfo?.external_cancel_required);
      const confirmText = needsExternalCancel
        ? "РћС‚РєР»СЋС‡РёРј РїСЂРѕРґР»РµРЅРёРµ РІ FruitFit, Р·Р°С‚РµРј РѕС‚РєСЂРѕРµС‚СЃСЏ СЃС‚СЂР°РЅРёС†Р° Robokassa РґР»СЏ РїРѕР»РЅРѕР№ РѕС‚РјРµРЅС‹ СЃРїРёСЃР°РЅРёР№. РЈР¶Рµ РѕРїР»Р°С‡РµРЅРЅС‹Р№ РґРѕСЃС‚СѓРї СЃРѕС…СЂР°РЅРёС‚СЃСЏ."
        : "РћС‚РєР»СЋС‡РёС‚СЊ Р°РІС‚РѕРјР°С‚РёС‡РµСЃРєРѕРµ РїСЂРѕРґР»РµРЅРёРµ? РЈР¶Рµ РѕРїР»Р°С‡РµРЅРЅС‹Р№ РґРѕСЃС‚СѓРї СЃРѕС…СЂР°РЅРёС‚СЃСЏ РґРѕ РєРѕРЅС†Р° РїРµСЂРёРѕРґР°.";
      if (!window.confirm(confirmText)) return;

      const cancelResult = await cancelPaymentSubscription("client_request");
      if (cancelResult?.skipped) {
        setSubscription(cancelResult.subscription || null);
        setSubscriptionLoaded(true);
        setSubscriptionStatus(cancelResult.message || "РђРІС‚РѕРїСЂРѕРґР»РµРЅРёРµ СѓР¶Рµ РѕС‚РєР»СЋС‡РµРЅРѕ РёР»Рё Р°РєС‚РёРІРЅР°СЏ РїРѕРґРїРёСЃРєР° РЅРµ РЅР°Р№РґРµРЅР°.");
        return;
      }

      const cancelUrl = cancelResult?.robokassaUnsubscribeUrl || cancelResult?.robokassa_unsubscribe_url || cancelResult?.cancelUrl || cancelResult?.cancel_url || "";
      const nextSubscription = cancelResult?.subscription || cancelResult || null;
      setSubscription(nextSubscription);
      setSubscriptionLoaded(true);
      await fetchAccess();
      if (cancelUrl) await openExternalUrl(cancelUrl);

      const paidUntil = formatSubscriptionDate(nextSubscription?.paidUntil || nextSubscription?.paid_until || accessExpiryDate(access));
      setSubscriptionStatus(cancelUrl
        ? `РџСЂРѕРґР»РµРЅРёРµ РѕС‚РєР»СЋС‡РµРЅРѕ РІ FruitFit. Р—Р°РІРµСЂС€РёС‚Рµ РѕС‚РјРµРЅСѓ РЅР° СЃС‚СЂР°РЅРёС†Рµ Robokassa. Р”РѕСЃС‚СѓРї СЃРѕС…СЂР°РЅС‘РЅ РґРѕ ${paidUntil}.`
        : `РџРѕРґРїРёСЃРєР° РѕС‚РјРµРЅРµРЅР°. Р”РѕСЃС‚СѓРї СЃРѕС…СЂР°РЅС‘РЅ РґРѕ ${paidUntil}.`);
    } catch (error) {
      setSubscriptionStatus(error?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РјРµРЅРёС‚СЊ РїРѕРґРїРёСЃРєСѓ");
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

    if (item.id === "notifications") {
      if (!shouldEnable) {
        setPermissions((current) => ({ ...current, notifications: false }));
        setNotificationStatus("РЈРІРµРґРѕРјР»РµРЅРёСЏ РІС‹РєР»СЋС‡РµРЅС‹ РІ FruitFit. РЎРёСЃС‚РµРјРЅРѕРµ СЂР°Р·СЂРµС€РµРЅРёРµ РјРѕР¶РЅРѕ РёР·РјРµРЅРёС‚СЊ РІ РЅР°СЃС‚СЂРѕР№РєР°С… iPhone.");
        return;
      }
      setNotificationStatus("Р—Р°РїСЂР°С€РёРІР°РµРј СЂР°Р·СЂРµС€РµРЅРёРµ РЅР° СѓРІРµРґРѕРјР»РµРЅРёСЏ...");
      const result = await registerFirebaseMessagingPush({ force: true }).catch((error) => ({
        ok: false,
        status: "CLIENT_ERROR",
        message: error?.message || String(error || "client error"),
      }));
      const connected = Boolean(result?.ok);
      setPermissions((current) => ({ ...current, notifications: connected }));
      setNotificationStatus(notificationRegistrationMessage(result));
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
    .join(" ") || "РџСЂРѕС„РёР»СЊ FruitFit";

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header className="flex items-center justify-between">
          <h1 className="text-[26px] font-black text-appText">РџСЂРѕС„РёР»СЊ</h1>
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
            onCancelSubscription={handleCancelSubscription}
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
          <h2 className="text-[16px] font-black text-appText">Р”Р°РЅРЅС‹Рµ РїСЂРѕС„РёР»СЏ</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <TextField label="РРјСЏ" value={draft.firstName} onChange={(value) => updateDraft("firstName", value)} placeholder={PROFILE_FIRST_NAME_PLACEHOLDER} />
            <TextField label="Р¤Р°РјРёР»РёСЏ" value={draft.lastName} onChange={(value) => updateDraft("lastName", value)} placeholder={PROFILE_LAST_NAME_PLACEHOLDER} />
            <SelectField label="РџРѕР»" value={draft.gender} options={profileOptions.gender} error={errors.gender} onChange={(value) => updateDraft("gender", value)} />
            <SelectField label="Р¦РµР»СЊ" value={draft.goal} options={profileOptions.goal} error={errors.goal} onChange={(value) => updateDraft("goal", value)} />
            <SelectField label="РћРїС‹С‚ С‚СЂРµРЅРёСЂРѕРІРѕРє" value={draft.experience} options={profileOptions.experience} error={errors.experience} onChange={(value) => updateDraft("experience", value)} />
            <SelectField label="Р§Р°СЃС‚РѕС‚Р°" value={draft.trainingFrequency} options={profileOptions.trainingFrequency} error={errors.trainingFrequency} onChange={(value) => updateDraft("trainingFrequency", value)} />
            <SelectField label="РћРіСЂР°РЅРёС‡РµРЅРёСЏ" value={draft.restrictions} options={profileOptions.restrictions} error={errors.restrictions} onChange={(value) => updateDraft("restrictions", value)} />
            <SelectField label="РўРёРї РїРёС‚Р°РЅРёСЏ" value={draft.dietType} options={profileOptions.dietType} error={errors.dietType} onChange={(value) => updateDraft("dietType", value)} />
            <NumberField label="Р’РѕР·СЂР°СЃС‚" value={draft.age} suffix="Р»РµС‚" error={errors.age} onChange={(value) => updateDraft("age", value)} />
            <NumberField label="Р РѕСЃС‚" value={draft.height} suffix="СЃРј" error={errors.height} onChange={(value) => updateDraft("height", value)} />
            <NumberField label="Р’РµСЃ" value={draft.weight} suffix="РєРі" error={errors.weight} onChange={(value) => updateDraft("weight", value)} />
          </div>
          <button type="button" onClick={submit} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appDark text-[14px] font-black text-appGreen">
            <CheckCircle2 size={17} /> РЎРѕС…СЂР°РЅРёС‚СЊ РїСЂРѕС„РёР»СЊ
          </button>
          {saved && <p className="mt-3 text-center text-[12px] font-bold text-[#86B936]">РџСЂРѕС„РёР»СЊ СЃРѕС…СЂР°РЅРµРЅ, СЂРµРєРѕРјРµРЅРґР°С†РёРё РѕР±РЅРѕРІР»РµРЅС‹.</p>}
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
                <span className="block text-[16px] font-black text-appText">Р—РґРѕСЂРѕРІСЊРµ Рё Р°РєС‚РёРІРЅРѕСЃС‚СЊ</span>
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
                        <p className="text-[12px] font-black text-appText">Apple Health</p>
                        <p className="mt-1 text-[11px] leading-4 text-appMuted">{healthConnectionHint(availability, syncing)}</p>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${availability?.state === healthProviderStates.CONNECTED ? "accent-readable-shadow bg-appGreen/20 text-appGreen" : "bg-appCard text-appMuted"}`}>
                        {healthPermissionSummary(availability)}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-4 text-appMuted">
                      FruitFit РёСЃРїРѕР»СЊР·СѓРµС‚ РґР°РЅРЅС‹Рµ Р°РєС‚РёРІРЅРѕСЃС‚Рё РґР»СЏ СЂР°СЃС‡С‘С‚Р° РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЏ Рё СЂРµРєРѕРјРµРЅРґР°С†РёР№. РћСЃРЅРѕРІРЅРѕР№ РёСЃС‚РѕС‡РЅРёРє РЅР° iPhone вЂ” Apple Health.
                    </p>
                    <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-bold text-appMuted">
                      РџРѕСЃР»РµРґРЅСЏСЏ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ: {formatHealthSyncTime(health?.lastFruitFitRefreshAt || health?.generatedAt)}
                    </p>
                    <button type="button" onClick={refreshHealthData} className="mt-3 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
                      {syncing ? "РћР±РЅРѕРІР»СЏРµРј..." : "РџРѕРґРєР»СЋС‡РёС‚СЊ РёР»Рё РѕР±РЅРѕРІРёС‚СЊ"}
                    </button>
                  </div>
                  <p className="rounded-[18px] border border-appBorder bg-appBg px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                    РўСѓРјР±Р»РµСЂС‹ РЅРёР¶Рµ СѓРїСЂР°РІР»СЏСЋС‚ С‚РµРј, РєР°РєРёРµ РїРѕРґРєР»СЋС‡С‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ FruitFit СѓС‡РёС‚С‹РІР°РµС‚ РІ СЂРµРєРѕРјРµРЅРґР°С†РёСЏС…. Р Р°Р·СЂРµС€РµРЅРёСЏ РЅР° С‡С‚РµРЅРёРµ РјРµРЅСЏСЋС‚СЃСЏ РІ СЃР°РјРѕРј Apple Health.
                  </p>
                  {permissionItems.filter((item) => draft.gender !== "male" || item.id !== "cycle").map((item) => {
                    const disabled = item.id === "cycle" && draft.gender === "male";
                    const active = Boolean(permissions[item.id]) && !disabled;
                    return (
                      <button key={item.id} type="button" onClick={() => togglePermission(item)} className={`flex min-h-12 w-full items-center justify-between rounded-2xl border px-3 text-left transition active:scale-[0.99] ${active ? "border-appGreen/50 bg-appGreen/20" : "border-appBorder bg-appBg"} ${disabled ? "opacity-60" : ""}`}>
                        <span>
                          <span className="block text-[13px] font-bold text-appText">{item.label}</span>
                          <span className="block text-[11px] text-appMuted">{disabled ? "Р”РѕСЃС‚СѓРїРЅРѕ РґР»СЏ Р¶РµРЅСЃРєРѕРіРѕ РїСЂРѕС„РёР»СЏ" : permissionLine(item, availability, active)}</span>
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
