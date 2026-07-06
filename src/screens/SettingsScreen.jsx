import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  AtSign,
  Bell,
  CreditCard,
  Download,
  ImagePlus,
  Link2,
  Loader2,
  LogOut,
  MessageCircle,
  Moon,
  Phone,
  RefreshCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Unlink,
  Wallet,
} from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import AppIconSettings from "../components/AppIconSettings";
import { buildClientReportScores, ClientReportSliders, normalizeClientReportScores } from "../components/ClientReportSliders";
import {
  apiUrl,
  deleteAccount,
  deleteProgressPhoto,
  fetchAuthIdentities,
  fetchMeasurements,
  fetchProgressPhotos,
  fetchTrainerReports,
  getAuthToken,
  linkAuthProvider,
  loadAccessState,
  loadAuthUser,
  logoutUser,
  saveServerProfile,
  saveProgressPhoto,
  submitTrainerReport,
  unlinkAuthProvider,
} from "../data/authStore";
import { deviceQueryStringAsync, getDeviceRegistrationPayloadAsync } from "../data/deviceStore";
import { AUTH_RETURN_TO, providerAuthUrl, sanitizeTelegramBot } from "../services/authDeepLinks";
import { checkAndroidAppUpdate, openApkDownload } from "../services/appUpdate";
import { getAppInfo } from "../services/appInfo";
import { getJson } from "../services/nativeHttp";
import { canUseTelegramNativeLogin, startTelegramNativeLogin } from "../services/telegramNativeLogin";
import { useHealth } from "../data/healthStore";
import { readHealthContainer, readUserCoreField } from "../data/dataContainers";
import { loadProfile, saveProfile } from "../data/profileStore";
import { currentUserId } from "../data/userScopedCache";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_URL } from "../data/privacyPolicyText";

const PROVIDER_META = {
  telegram: { label: "Telegram", color: "text-[#229ED9]", dot: "bg-[#229ED9]" },
  yandex: { label: "Яндекс", color: "text-[#FC3F1D]", dot: "bg-[#FC3F1D]" },
  google: { label: "Google", color: "text-[#4285F4]", dot: "bg-[#4285F4]" },
  apple: { label: "Apple", color: "text-appText", dot: "bg-appText" },
};

const PHOTO_TYPES = [
  { id: "front", label: "Спереди" },
  { id: "side", label: "Сбоку" },
  { id: "back", label: "Сзади" },
];
const PHOTO_PREVIEW_CACHE_KEY = "fruitfit.progressPhotoPreviews";
const STEP_SOURCE_STORAGE_KEY = "fruitfit.health.preferredSourcePackage";
const CAPACITOR_PLATFORM = Capacitor.getPlatform?.() || "web";
const IS_IOS_PLATFORM = CAPACITOR_PLATFORM === "ios" || CAPACITOR_PLATFORM === "web";
const HEALTH_PROVIDER_NAME = IS_IOS_PLATFORM ? "Apple Health" : "Google Health Connect";
const FEEDBACK_FORM_URL = "https://forms.gle/MygV9mU445St16ez5";

const androidStepSourceOptions = [
  { value: "", label: "Auto", hint: "Автоматический выбор FruitFit" },
  { value: "com.google.android.apps.fitness", label: "Google Fit", hint: "Если шаги точнее в Google Fit" },
  { value: "android", label: "Android / phone", hint: "Системный источник телефона" },
  { value: "com.xiaomi.wearable", label: "Mi Fitness", hint: "Xiaomi Watch / Mi Fitness" },
  { value: "zepp", label: "Zepp / Amazfit", hint: "Amazfit / Zepp" },
  { value: "fitbit", label: "Fitbit", hint: "Fitbit" },
  { value: "com.sec.android.app.shealth", label: "Samsung Health", hint: "Samsung Health", onlyWhenPresent: true },
  { value: "apple", label: "Apple Health", hint: "iPhone / Apple Watch", onlyWhenPresent: true },
];

const iosStepSourceOptions = [
  { value: "", label: "Auto", hint: "Apple Health выбирает актуальный источник" },
  { value: "apple", label: "Apple Health", hint: "iPhone / Apple Watch" },
  { value: "apple_watch", label: "Apple Watch", hint: "Через Apple Health", missingHint: "Нет данных в Apple Health" },
  { value: "fitbit", label: "Fitbit", hint: "Через Apple Health", missingHint: "Нет данных в Apple Health" },
  { value: "whoop", label: "WHOOP", hint: "Через Apple Health", missingHint: "Нет данных в Apple Health" },
  { value: "garmin", label: "Garmin", hint: "Через Apple Health", missingHint: "Нет данных в Apple Health" },
  { value: "oura", label: "Oura", hint: "Через Apple Health", missingHint: "Нет данных в Apple Health" },
];

const stepSourceOptionsBase = IS_IOS_PLATFORM ? iosStepSourceOptions : androidStepSourceOptions;

function settingsSourceKind(source = {}) {
  const raw = `${String(source.sourcePackage || "").toLowerCase()} ${String(source.sourceName || source.source || "").toLowerCase()}`;
  if (raw.includes("apple watch")) return "apple_watch";
  if (raw.includes("apple") || raw.includes("healthkit")) return "apple";
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "google";
  if (!source.sourcePackage && IS_IOS_PLATFORM) return "apple";
  if (!source.sourcePackage || raw.includes("android") || raw.includes("health connect aggregate")) return "android";
  if (raw.includes("com.xiaomi.wearable") || raw.includes("xiaomi") || raw.includes("mi fitness")) return "mi";
  if (raw.includes("huami") || raw.includes("zepp") || raw.includes("amazfit")) return "zepp";
  if (raw.includes("fitbit")) return "fitbit";
  if (raw.includes("whoop")) return "whoop";
  if (raw.includes("garmin")) return "garmin";
  if (raw.includes("oura")) return "oura";
  if (raw.includes("samsung") || raw.includes("shealth")) return "samsung";
  return "other";
}

function settingsSourceMatchesPreference(source = {}, value = "") {
  const rawValue = String(value || "").toLowerCase();
  const rawPackage = String(source.sourcePackage || "").toLowerCase();
  const kind = settingsSourceKind(source);
  if (!rawValue) return true;
  if (rawPackage === rawValue) return true;
  if (rawValue === "android" && kind === "android") return true;
  if (rawValue.includes("google") && kind === "google") return true;
  if ((rawValue.includes("xiaomi") || rawValue.includes("mi")) && kind === "mi") return true;
  if ((rawValue.includes("zepp") || rawValue.includes("huami") || rawValue.includes("amazfit")) && kind === "zepp") return true;
  if (rawValue.includes("fitbit") && kind === "fitbit") return true;
  if (rawValue.includes("whoop") && kind === "whoop") return true;
  if (rawValue.includes("garmin") && kind === "garmin") return true;
  if (rawValue.includes("oura") && kind === "oura") return true;
  if ((rawValue.includes("samsung") || rawValue.includes("shealth")) && kind === "samsung") return true;
  if ((rawValue.includes("watch") || rawValue.includes("apple_watch")) && kind === "apple_watch") return true;
  if ((rawValue.includes("apple") || rawValue.includes("healthkit")) && kind === "apple") return true;
  return false;
}

function stepSourceOptionTotal(option, sources = []) {
  if (!option.value) return null;
  const source = sources.find((item) => settingsSourceMatchesPreference(item, option.value));
  return source ? Number(source.total || source.convertedValue || source.value || 0) : null;
}

function loadPhotoPreviewCache() {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PHOTO_PREVIEW_CACHE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function savePhotoPreviewCache(next) {
  if (typeof window === "undefined") return;
  try {
    const clean = {};
    PHOTO_TYPES.forEach((type) => {
      const value = next?.[type.id];
      if (typeof value === "string" && value.startsWith("data:image/")) clean[type.id] = value;
    });
    localStorage.setItem(PHOTO_PREVIEW_CACHE_KEY, JSON.stringify(clean));
  } catch (error) {
    console.warn("[FruitFit Settings] progress photo preview cache failed", error);
  }
}

function progressPhotoUrl(photo) {
  const value = String(photo?.public_url || photo?.publicUrl || "").trim();
  if (!value) return "";
  if (/^(data:image\/|blob:|capacitor:\/\/|https?:\/\/)/i.test(value)) return value;
  if (value.startsWith("/")) return apiUrl(value);
  return apiUrl(`/${value}`);
}

function ThemeSection({ theme, onThemeChange }) {
  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <h2 className="text-[16px] font-black text-appText">Тема</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          ["light", "Светлая", Sun],
          ["dark", "Тёмная", Moon],
          ["system", "Системная", Bell],
        ].map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => onThemeChange(id)} className={`grid h-20 place-items-center rounded-[18px] border text-[12px] font-bold ${theme === id ? "border-appGreen bg-appGreen text-[#181F19]" : "border-appBorder bg-appBg text-appMuted"}`}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function normalizeTelegramContact(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^https?:\/\/telegram\.me\//i, "")
    .replace(/^@+/, "")
    .trim();
}

function profileContacts(profile = {}) {
  return {
    phone: String(profile.phone || profile.phoneNumber || profile.phone_number || "").trim(),
    telegram: normalizeTelegramContact(profile.telegram || profile.telegramUsername || profile.telegram_username || ""),
  };
}

async function openSettingsExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const browser = window.Capacitor?.Plugins?.Browser;
    if (browser?.open) {
      await browser.open({ url: target });
      return true;
    }
  } catch (_) {
    // Fall through to native/web open.
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

function FeedbackSettingsSection() {
  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
          <MessageCircle size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-black text-appText">Обратная связь</h2>
          <p className="mt-1 text-[12px] leading-5 text-appMuted">
            Расскажите, что работает неудобно или чего не хватает. Форма откроется в браузере.
          </p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => openSettingsExternalUrl(FEEDBACK_FORM_URL)}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-appBorder bg-appBg text-[14px] font-black text-appText"
      >
        <Link2 size={17} />
        Открыть форму
      </button>
    </section>
  );
}

function PrivacySettingsSection() {
  const [policyOpen, setPolicyOpen] = useState(false);
  const policyLines = useMemo(() => PRIVACY_POLICY_TEXT.split("\n").map((line) => line.trim()).filter(Boolean), []);

  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
          <ShieldCheck size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-black text-appText">Конфиденциальность</h2>
          <p className="mt-1 text-[12px] leading-5 text-appMuted">
            FruitFit использует данные аккаунта, анкету, программу, питание, замеры, отчёты, активность и историю чата только для работы приложения, рекомендаций и поддержки пользователя.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2 rounded-[18px] border border-appBorder bg-appBg p-3 text-[12px] font-semibold leading-5 text-appMuted">
        <p>AI Coach работает с использованием OpenAI. Перед первым запросом приложение отдельно попросит согласие.</p>
        <p>В AI могут передаваться вопрос, последние сообщения, профиль, текущая программа, выбранная тренировка, цель питания и краткая сводка активности, если трекер подключён.</p>
        <p>Данные входа и приватные ключи не передаются в AI. Используется только информация, нужная для работы приложения и рекомендаций.</p>
        <p>Аккаунт можно удалить в настройках: профиль, замеры, прогресс и health-данные будут удалены по запросу.</p>
      </div>

      <button
        type="button"
        onClick={() => (APP_STORE_REVIEW ? setPolicyOpen((value) => !value) : openSettingsExternalUrl(PRIVACY_POLICY_URL))}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-appBorder bg-appBg text-[14px] font-black text-appText"
      >
        <Link2 size={17} />
        {APP_STORE_REVIEW ? (policyOpen ? "Скрыть политику" : "Показать политику") : "Открыть политику"}
      </button>

      {APP_STORE_REVIEW && policyOpen && (
        <div className="mt-3 max-h-[52vh] space-y-2 overflow-y-auto rounded-[18px] border border-appBorder bg-appBg p-3 text-[12px] font-semibold leading-5 text-appMuted">
          {policyLines.map((line, index) => (
            <p key={`${index}-${line.slice(0, 20)}`}>{line}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function ContactSettingsSection({ hasAuth, form, status, onChange, onSave }) {
  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
          <Phone size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-black text-appText">Контакты</h2>
          <p className="mt-1 text-[12px] leading-5 text-appMuted">
            Телефон и Telegram нужны только для связи с тренером.
          </p>
        </div>
      </div>

      <div className="mt-3 grid gap-2">
        <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.1em] text-appMuted">
          Телефон
          <span className="relative">
            <Phone size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-appMuted" />
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => onChange("phone", event.target.value)}
              placeholder="+7 999 123-45-67"
              disabled={!hasAuth || status.loading}
              className="h-12 w-full rounded-2xl border border-appBorder bg-appBg px-10 text-[14px] font-bold text-appText outline-none placeholder:text-appMuted disabled:opacity-60"
            />
          </span>
        </label>
        <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.1em] text-appMuted">
          Telegram
          <span className="relative">
            <AtSign size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-appMuted" />
            <input
              value={form.telegram}
              onChange={(event) => onChange("telegram", event.target.value)}
              placeholder="@username"
              disabled={!hasAuth || status.loading}
              className="h-12 w-full rounded-2xl border border-appBorder bg-appBg px-10 text-[14px] font-bold text-appText outline-none placeholder:text-appMuted disabled:opacity-60"
            />
          </span>
        </label>
      </div>

      <button
        type="button"
        onClick={onSave}
        disabled={!hasAuth || status.loading}
        className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen text-[14px] font-black text-[#181F19] disabled:opacity-60"
      >
        {status.loading ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
        Сохранить контакты
      </button>
      {!hasAuth && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">Войдите в аккаунт, чтобы сохранить контакты.</p>}
      {status.message && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">{status.message}</p>}
    </section>
  );
}

function StepSourceSettingsSection({ health, preferredSourcePackage, onPreferredSourceChange }) {
  const stepSources = health?.steps?.sources || [];
  const stepSourceOptions = stepSourceOptionsBase.filter((option) => IS_IOS_PLATFORM || !option.onlyWhenPresent || stepSources.some((source) => settingsSourceMatchesPreference(source, option.value)));
  const selectedStepSource = stepSourceOptions.find((option) => option.value === preferredSourcePackage)
    || stepSourceOptions.find((option) => preferredSourcePackage && stepSources.some((source) => settingsSourceMatchesPreference(source, preferredSourcePackage) && settingsSourceMatchesPreference(source, option.value)))
    || stepSourceOptions[0];
  const stepsToday = Number(health?.steps?.today || 0);

  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
          <SlidersHorizontal size={18} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-black text-appText">Расширенные настройки активности</h2>
          <p className="mt-1 text-[12px] leading-5 text-appMuted">
            Выберите более точный источник шагов, если часы, браслет или приложение дублируют данные. Обычно можно оставить Auto.
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.08em] text-appMuted">Источник шагов</p>
            <p className="mt-1 text-[12px] font-bold text-appText">Сейчас: {selectedStepSource?.label || "Auto"}</p>
          </div>
          {stepsToday > 0 && <span className="shrink-0 rounded-full bg-appCard px-2 py-1 text-[10px] font-black text-appText">{stepsToday.toLocaleString("ru-RU")}</span>}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          {stepSourceOptions.map((option) => {
            const total = stepSourceOptionTotal(option, stepSources);
            const hint = total == null ? (option.missingHint || option.hint) : total.toLocaleString("ru-RU");
            const active = preferredSourcePackage === option.value || (!preferredSourcePackage && !option.value);
            return (
              <button
                key={option.value || "auto"}
                type="button"
                onClick={() => onPreferredSourceChange(option.value)}
                className={`min-h-14 rounded-2xl px-3 py-2 text-left transition active:scale-[0.98] ${active ? "bg-appGreen text-[#181F19]" : "border border-appBorder bg-appCard text-appText"}`}
              >
                <span className="block truncate text-[12px] font-black">{option.label}</span>
                <span className="mt-1 block truncate text-[10px] font-semibold opacity-75">{hint}</span>
              </button>
            );
          })}
        </div>

        {health?.steps?.selectedSourceReason && (
          <p className="mt-3 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
            {health.steps.selectedSourceReason}
          </p>
        )}
      </div>
    </section>
  );
}

function DeleteAccountModal({ loading, error, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/55 px-4 backdrop-blur-sm">
      <section className="w-full max-w-[360px] rounded-[26px] border border-red-500/30 bg-appCard p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-red-500/12 text-red-500">
            <Trash2 size={20} />
          </span>
          <div>
            <h2 className="text-[18px] font-black text-appText">Вы уверены?</h2>
            <p className="mt-2 text-[13px] leading-5 text-appMuted">
              Профиль, замеры, прогресс и health-данные будут удалены. Это действие нельзя отменить.
            </p>
          </div>
        </div>
        {error && <p className="mt-3 rounded-2xl bg-red-500/10 px-3 py-2 text-[12px] font-bold text-red-500">{error}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="h-11 rounded-full border border-appBorder bg-appBg text-[13px] font-black text-appText disabled:opacity-60">
            Отмена
          </button>
          <button type="button" onClick={onConfirm} disabled={loading} className="flex h-11 items-center justify-center gap-2 rounded-full bg-red-500 text-[13px] font-black text-white disabled:opacity-70">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={15} />}
            Удалить
          </button>
        </div>
      </section>
    </div>
  );
}

function PlaceholderCard({ icon: Icon, title, text, badge = "готовится" }) {
  return (
    <div className="rounded-[20px] border border-appBorder bg-appBg p-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-appCard text-appGreen">
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-black text-appText">{title}</span>
            <span className="rounded-full bg-appGreen/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-appGreen">{badge}</span>
          </span>
          <span className="mt-1 block text-[12px] leading-5 text-appMuted">{text}</span>
        </span>
      </div>
    </div>
  );
}

function normalizeProvider(item) {
  if (typeof item === "string") {
    const provider = item.toLowerCase();
    return { provider, label: PROVIDER_META[provider]?.label || item, enabled: true, status: "ready" };
  }
  const provider = String(item?.provider || item?.id || item?.name || "").toLowerCase();
  return {
    ...item,
    provider,
    label: item?.label || PROVIDER_META[provider]?.label || provider,
    enabled: item?.enabled !== false,
  };
}

function identityProvider(identity) {
  return String(identity?.provider || identity?.provider_name || "").toLowerCase();
}

function identityProviderUserId(identity) {
  return String(identity?.providerUserId || identity?.provider_user_id || identity?.id || "");
}

function providerDisplay(provider) {
  return PROVIDER_META[provider]?.label || provider;
}

function canUseProgressPhotos(user, access) {
  if (APP_STORE_REVIEW) {
    const role = String(access?.role || user?.role || "").toLowerCase();
    return Boolean(access?.isAdmin || role === "admin");
  }

  const status = String(access?.status || access?.plan || "").toLowerCase();
  const role = String(access?.role || user?.role || "").toLowerCase();
  const priority = ["v", "ip"].join("");
  return Boolean(
    status === priority ||
    status === "admin" ||
    role === "admin" ||
    access?.[["is", "V", "ip"].join("")] ||
    access?.isAdmin ||
    access?.features?.[priority] ||
    access?.features?.admin
  );
}

function loadLocalMeasurements() {
  try {
    const items = readUserCoreField("measurements", currentUserId(), []);
    return Array.isArray(items) ? items : [];
  } catch (_) {
    return [];
  }
}

function normalizeReportMeasurement(item = {}) {
  const values = item.values || {};
  const rawDate = item.date || item.measured_at || item.measuredAt || item.created_at || item.createdAt || "";
  const date = String(rawDate).slice(0, 10);
  return {
    id: item.id || "",
    date,
    weight: values.weight ?? item.weight ?? "",
    chest: values.chest ?? item.chest ?? "",
    waist: values.waist ?? item.waist ?? "",
    hips: values.hips ?? item.hips ?? "",
    source: item.values ? "server" : "local",
  };
}

function hasReportMeasurementValues(item = {}) {
  return ["weight", "chest", "waist", "hips"].some((field) => {
    const value = String(item[field] ?? "").trim();
    return value && Number(value.replace(",", ".")) > 0;
  });
}

function reportMeasurementsFrom(items = []) {
  return items
    .map(normalizeReportMeasurement)
    .filter((item) => item.date && !String(item.id || "").startsWith("sim-") && hasReportMeasurementValues(item))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 12);
}

async function compressPhoto(file, options = {}) {
  const dataUrl = await readFileAsDataUrl(file);
  return resizePhotoDataUrl(dataUrl, options);
}

async function resizePhotoDataUrl(dataUrl, options = {}) {
  const img = await loadImage(dataUrl);
  const maxSide = options.maxSide || 1280;
  const quality = options.quality || 0.82;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось обработать изображение"));
    img.src = dataUrl;
  });
}

function photoTypeLabel(type) {
  return PHOTO_TYPES.find((item) => item.id === type)?.label || "Фото";
}

function photoTypeFromItem(item) {
  return String(item?.meta?.type || item?.meta?.view || "front").toLowerCase();
}

function formatDateTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch (_) {
    return "";
  }
}

function localReportDateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return "";
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

function reportNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function optionalReportNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function compactReportSources(sources = []) {
  return (Array.isArray(sources) ? sources : [])
    .slice(0, 8)
    .map((source) => ({
      sourcePackage: source?.sourcePackage || source?.packageName || source?.package || null,
      sourceName: source?.sourceName || source?.name || null,
      value: optionalReportNumber(source?.total ?? source?.value ?? source?.convertedValue),
      recordsCount: optionalReportNumber(source?.recordsCount ?? source?.count),
    }));
}

function compactReportRows(rows = [], valueKeys = ["value"]) {
  return (Array.isArray(rows) ? rows : [])
    .slice(-14)
    .map((row, index) => {
      if (typeof row === "number") {
        return { index, value: reportNumber(row) };
      }
      const valueKey = valueKeys.find((key) => row?.[key] != null);
      return {
        date: row?.date || row?.day || null,
        label: row?.label || row?.dateLabel || null,
        start: row?.start || row?.startTime || row?.time || null,
        end: row?.end || row?.endTime || null,
        sourcePackage: row?.sourcePackage || row?.packageName || null,
        sourceName: row?.sourceName || row?.name || null,
        value: valueKey ? reportNumber(row[valueKey]) : null,
        steps: optionalReportNumber(row?.steps),
        activeCalories: optionalReportNumber(row?.activeCalories ?? row?.calories),
        totalCalories: optionalReportNumber(row?.totalCalories),
        minutes: optionalReportNumber(row?.minutes ?? row?.totalMinutes),
        avg: optionalReportNumber(row?.avg),
        min: optionalReportNumber(row?.min),
        max: optionalReportNumber(row?.max),
        latestBpm: optionalReportNumber(row?.latestBpm),
        heart: optionalReportNumber(row?.heart),
      };
    });
}

function buildReportHealthSnapshot(health = {}) {
  const steps = health?.steps || {};
  const calories = health?.calories || {};
  const sleep = health?.sleep || {};
  const heart = health?.heart_rate || health?.heartRate || health?.heart || {};
  const readiness = health?.readiness || health?.recovery || {};
  const activityWeek = compactReportRows(health?.activity_history?.week || [], ["steps", "value"]);
  const sleepMinutes = reportNumber(
    sleep.minutes
      ?? sleep.latestSleep?.minutes
      ?? readiness.sleepLastNightMinutes
      ?? 0
  );
  const latestBpm = reportNumber(heart.latestBpm ?? heart.current ?? heart.resting ?? 0);
  const activeCaloriesToday = reportNumber(calories.activeToday ?? calories.today ?? 0);
  const totalCaloriesToday = reportNumber(calories.totalToday ?? 0);
  const stepsToday = reportNumber(steps.today ?? 0);
  const summary = {
    date: localReportDateKey(),
    stepsToday,
    activeCaloriesToday,
    totalCaloriesToday,
    sleepMinutes,
    latestBpm,
    readinessScore: optionalReportNumber(readiness.score),
    providerState: health?.providerState || null,
    providerSource: health?.providerSource || null,
    lastSuccessfulNativeReadAt: health?.lastSuccessfulNativeReadAt || null,
  };

  return {
    generatedAt: new Date().toISOString(),
    healthGeneratedAt: health?.generatedAt || null,
    lastFruitFitRefreshAt: health?.lastFruitFitRefreshAt || null,
    lastSuccessfulNativeReadAt: health?.lastSuccessfulNativeReadAt || null,
    providerState: health?.providerState || null,
    providerSource: health?.providerSource || null,
    providerMessage: health?.providerMessage || null,
    cacheReason: health?.cacheReason || null,
    summary,
    steps: {
      today: stepsToday,
      goal: reportNumber(steps.goal ?? 10000),
      week: compactReportRows(steps.week || health?.history7d?.steps || [], ["steps", "value"]),
      history7d: compactReportRows(health?.history7d?.steps || [], ["steps", "value"]),
      selectedSourcePackage: steps.sourcePackage || steps.dashboardSourcePackage || steps.preferredSource || null,
      selectedSourceName: steps.sourceName || steps.dashboardSourceName || null,
      selectedSourceReason: steps.selectedSourceReason || null,
      sources: compactReportSources(steps.sources || steps.allSources || []),
      status: steps.status || null,
    },
    calories: {
      activeToday: activeCaloriesToday,
      totalToday: totalCaloriesToday,
      restingToday: reportNumber(calories.restingToday ?? 0),
      week: compactReportRows(calories.week || health?.history7d?.calories || [], ["activeCalories", "calories", "value"]),
      history7d: compactReportRows(health?.history7d?.calories || [], ["activeCalories", "calories", "value"]),
      selectedSourcePackage: calories.sourcePackage || calories.dashboardSourcePackage || null,
      selectedSourceName: calories.sourceName || calories.dashboardSourceName || null,
      isEstimated: Boolean(calories.isEstimated),
      sources: compactReportSources(calories.sources || []),
      status: calories.status || null,
    },
    sleep: {
      minutes: sleepMinutes,
      nightMinutes: reportNumber(sleep.nightMinutes ?? 0),
      napMinutes: reportNumber(sleep.napMinutes ?? 0),
      quality: optionalReportNumber(sleep.quality),
      week: compactReportRows(health?.history7d?.sleep || sleep.week || [], ["minutes", "totalMinutes", "value"]),
      latestSleep: sleep.latestSleep ? {
        start: sleep.latestSleep.start || null,
        end: sleep.latestSleep.end || null,
        minutes: reportNumber(sleep.latestSleep.minutes ?? 0),
        sourcePackage: sleep.latestSleep.sourcePackage || null,
        sourceName: sleep.latestSleep.sourceName || null,
      } : null,
      sessions: compactReportRows(sleep.mainSleepSessions || sleep.sessions || [], ["minutes", "totalMinutes", "value"]),
      status: sleep.status || null,
      sourceName: sleep.sourceName || null,
    },
    heartRate: {
      latestBpm,
      latestTimestamp: heart.latestTimestamp || null,
      avg24h: optionalReportNumber(heart.avg24h),
      min24h: optionalReportNumber(heart.min24h ?? heart.range24h?.[0]),
      max24h: optionalReportNumber(heart.max24h ?? heart.range24h?.[1]),
      avg7d: optionalReportNumber(heart.avg7d),
      history7d: compactReportRows(health?.history7d?.heartRate || heart.history7d || [], ["latestBpm", "avg", "value"]),
      sourcePackage: heart.latestSourcePackage || heart.sourcePackage || null,
      sourceName: heart.latestSourceName || heart.sourceName || null,
      freshness: heart.freshness || null,
      status: heart.status || null,
    },
    readiness: {
      score: optionalReportNumber(readiness.score),
      status: readiness.status || null,
      sleepLastNightMinutes: reportNumber(readiness.sleepLastNightMinutes ?? 0),
      sleep7dAverageMinutes: reportNumber(readiness.sleep7dAverageMinutes ?? 0),
      heartAvg24h: optionalReportNumber(readiness.heartAvg24h),
      heartAvg7d: optionalReportNumber(readiness.heartAvg7d),
      stepsToday: reportNumber(readiness.stepsToday ?? stepsToday),
      activityStatus: readiness.activityStatus || null,
    },
    activityWeek,
  };
}

function readStoredHealthForReport() {
  if (typeof window === "undefined") return null;
  try {
    const parsed = readHealthContainer(currentUserId(), null);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function formatReportNumber(value, unit = "") {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "нет данных";
  return `${Math.round(number).toLocaleString("ru-RU")}${unit ? ` ${unit}` : ""}`;
}

function formatReportSleep(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "нет данных";
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest} мин`;
  return `${hours} ч ${rest} мин`;
}

function formatReportHealthSource(source) {
  const value = String(source || "").trim();
  if (!value) return "сохранённые данные";
  if (value.toLowerCase().includes("apple")) return "Apple Health";
  return value;
}

export default function SettingsScreen({ theme, onThemeChange, onNavigate, onBack }) {
  const { health, syncNativeHealth } = useHealth();
  const [updateState, setUpdateState] = useState({ status: "idle", result: null, error: "" });
  const [appInfo, setAppInfo] = useState({ versionName: "1.6", buildNumber: "7" });
  const [authUser, setAuthUser] = useState(loadAuthUser);
  const [accessState, setAccessState] = useState(loadAccessState);
  const [providers, setProviders] = useState(null);
  const [identities, setIdentities] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [reports, setReports] = useState([]);
  const [accountStatus, setAccountStatus] = useState({ loading: false, message: "" });
  const [photoStatus, setPhotoStatus] = useState({ loadingType: "", message: "" });
  const [localPhotoPreviews, setLocalPhotoPreviews] = useState(loadPhotoPreviewCache);
  const [brokenPhotoUrls, setBrokenPhotoUrls] = useState(() => new Set());
  const [reportStatus, setReportStatus] = useState({ loading: false, message: "" });
  const [contactForm, setContactForm] = useState(() => profileContacts(loadProfile()));
  const [contactStatus, setContactStatus] = useState({ loading: false, message: "" });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState({ loading: false, message: "" });
  const [telegramWidgetOpen, setTelegramWidgetOpen] = useState(false);
  const [reportForm, setReportForm] = useState({
    selfFeeling: 7,
    strength: 7,
    sleepQuality: 7,
    workoutFeeling: 7,
    comment: "",
  });
  const [preferredSourcePackage, setPreferredSourcePackage] = useState(() => (typeof window === "undefined" ? "" : localStorage.getItem(STEP_SOURCE_STORAGE_KEY) || ""));
  const telegramWidgetRef = useRef(null);
  const preferredSourceMountedRef = useRef(false);
  const telegramBot = sanitizeTelegramBot(import.meta.env.VITE_TELEGRAM_BOT_USERNAME || "fruitfit_auth_bot");
  const hasAuth = Boolean(getAuthToken() || authUser);
  const progressPhotosEnabled = canUseProgressPhotos(authUser, accessState);
  const telegramNativeAvailable = canUseTelegramNativeLogin();

  const providerList = useMemo(
    () => (Array.isArray(providers) ? providers.map(normalizeProvider).filter((item) => item.provider) : []),
    [providers]
  );
  const integrationProviderList = useMemo(() => {
    const map = new Map(providerList.map((item) => [item.provider, item]));
    ["telegram"].forEach((provider) => {
      if (!map.has(provider)) {
        map.set(provider, {
          provider,
          label: PROVIDER_META[provider]?.label || provider,
          enabled: true,
          configured: true,
          status: "ready",
        });
      }
    });
    return ["telegram"].map((provider) => map.get(provider)).filter(Boolean);
  }, [providerList]);
  const linkedByProvider = useMemo(() => {
    const map = new Map();
    identities.forEach((identity) => {
      const provider = identityProvider(identity);
      if (provider && !map.has(provider)) map.set(provider, identity);
    });
    return map;
  }, [identities]);
  const latestPhotosByType = useMemo(() => {
    const map = new Map();
    photos.forEach((photo) => {
      const type = photoTypeFromItem(photo);
      if (!map.has(type)) map.set(type, photo);
    });
    return map;
  }, [photos]);
  const photosByType = useMemo(() => {
    const map = new Map();
    photos.forEach((photo) => {
      const type = photoTypeFromItem(photo);
      if (!map.has(type)) map.set(type, []);
      map.get(type).push(photo);
    });
    return map;
  }, [photos]);
  const localReportMeasurements = useMemo(() => reportMeasurementsFrom(loadLocalMeasurements()), []);
  const latestReport = reports[0]?.report || reports[0] || null;
  const latestReportMeasurements = reportMeasurementsFrom(latestReport?.measurements || []);
  const measurementPreview = latestReportMeasurements.length ? latestReportMeasurements : localReportMeasurements;
  const reportHealthPreview = useMemo(() => buildReportHealthSnapshot(health), [health]);

  useEffect(() => {
    function handleProfileUpdated(event) {
      setContactForm(profileContacts(event?.detail || loadProfile()));
    }
    window.addEventListener("fruitfit:profile-updated", handleProfileUpdated);
    return () => window.removeEventListener("fruitfit:profile-updated", handleProfileUpdated);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (preferredSourcePackage) {
      localStorage.setItem(STEP_SOURCE_STORAGE_KEY, preferredSourcePackage);
    } else {
      localStorage.removeItem(STEP_SOURCE_STORAGE_KEY);
    }
    if (!preferredSourceMountedRef.current) {
      preferredSourceMountedRef.current = true;
      return;
    }
    syncNativeHealth?.({ force: true, reason: "settings-preferred-source-change", queryMode: "history_7d" });
  }, [preferredSourcePackage, syncNativeHealth]);

  useEffect(() => {
    let cancelled = false;
    async function loadSettingsData() {
      getAppInfo().then((info) => {
        if (!cancelled) setAppInfo(info);
      });
      try {
        const query = await deviceQueryStringAsync();
        const response = await getJson(apiUrl(`/api/auth/providers/available?${query}`), {
          credentials: "include",
          cache: "no-store",
        });
        if (!cancelled) setProviders(response.ok && Array.isArray(response.data?.providers) ? response.data.providers : []);
      } catch (error) {
        console.error("[FruitFit Settings] providers failed", error);
        if (!cancelled) setProviders([]);
      }
      if (getAuthToken() || loadAuthUser()) {
        const [nextIdentities, nextPhotos, nextReports] = await Promise.all([
          fetchAuthIdentities(),
          progressPhotosEnabled ? fetchProgressPhotos() : Promise.resolve([]),
          progressPhotosEnabled ? fetchTrainerReports() : Promise.resolve([]),
        ]);
        if (!cancelled) {
          setIdentities(nextIdentities);
          setPhotos(nextPhotos);
          setReports(nextReports);
          setAuthUser(loadAuthUser());
          setAccessState(loadAccessState());
        }
      }
    }
    loadSettingsData();
    return () => {
      cancelled = true;
    };
  }, [progressPhotosEnabled]);

  useEffect(() => {
    const latest = reports[0]?.report || reports[0] || null;
    if (!latest) return;
    setReportForm((current) => ({ ...current, ...normalizeClientReportScores(latest, 7) }));
  }, [reports]);

  useEffect(() => {
    async function refreshReportsAfterSubmit() {
      if (!progressPhotosEnabled) return;
      const nextReports = await fetchTrainerReports();
      setReports(nextReports);
    }
    window.addEventListener("fruitfit:trainer-report-submitted", refreshReportsAfterSubmit);
    return () => window.removeEventListener("fruitfit:trainer-report-submitted", refreshReportsAfterSubmit);
  }, [progressPhotosEnabled]);

  async function refreshAccounts() {
    if (!hasAuth) return;
    setAccountStatus({ loading: true, message: "" });
    try {
      setAuthUser(loadAuthUser());
      setAccessState(loadAccessState());
      setIdentities(await fetchAuthIdentities());
      setAccountStatus({ loading: false, message: "Статусы аккаунтов обновлены" });
    } catch (error) {
      setAccountStatus({ loading: false, message: error?.message || "Не удалось обновить аккаунты" });
    }
  }

  useEffect(() => {
    async function refreshAfterAuthReturn(event) {
      const provider = String(event?.detail?.provider || sessionStorage.getItem("fruitfit.pendingProviderLink") || "").toLowerCase();
      sessionStorage.removeItem("fruitfit.pendingProviderLink");
      if (!provider || !hasAuth) return;
      setAccountStatus({ loading: true, message: "" });
      const nextIdentities = await fetchAuthIdentities();
      setIdentities(nextIdentities);
      const linked = nextIdentities.some((identity) => identityProvider(identity) === provider);
      setAccountStatus({
        loading: false,
        message: linked ? `${providerDisplay(provider)} привязан` : `Не удалось подтвердить привязку ${providerDisplay(provider)}`,
      });
    }
    window.addEventListener("fruitfit:auth-link-returned", refreshAfterAuthReturn);
    return () => window.removeEventListener("fruitfit:auth-link-returned", refreshAfterAuthReturn);
  }, [hasAuth]);

  async function authQueryString() {
    const params = new URLSearchParams(await deviceQueryStringAsync());
    params.set("returnTo", AUTH_RETURN_TO);
    return params.toString();
  }

  async function linkProvider(provider) {
    if (!hasAuth) {
      setAccountStatus({ loading: false, message: "Сначала войдите в FruitFit, затем привяжите дополнительные сервисы." });
      return;
    }
    if (provider === "telegram") {
      if (telegramNativeAvailable) {
        await linkTelegramNative();
        return;
      }
      setTelegramWidgetOpen(true);
      setAccountStatus({ loading: false, message: "Подтвердите Telegram в блоке ниже. Если Telegram не установлен, подключение можно повторить позже." });
      return;
    }
    if (provider === "apple") {
      setAccountStatus({ loading: false, message: "Этот способ входа сейчас недоступен." });
      return;
    }
    sessionStorage.setItem("fruitfit.pendingProviderLink", provider);
    setAccountStatus({ loading: true, message: `Открываем ${providerDisplay(provider)}...` });
    window.location.href = providerAuthUrl(apiUrl, provider, await authQueryString());
  }

  async function linkTelegramNative() {
    setTelegramWidgetOpen(false);
    setAccountStatus({ loading: true, message: "Открываем Telegram для подтверждения..." });
    try {
      const nativeResult = await startTelegramNativeLogin();
      setAccountStatus({ loading: true, message: "Проверяем Telegram..." });
      const updated = await linkAuthProvider("telegram", {
        telegramOidc: { idToken: nativeResult.idToken },
        device: await getDeviceRegistrationPayloadAsync(),
      });
      const nextIdentities = updated || await fetchAuthIdentities();
      setIdentities(nextIdentities);
      setAccountStatus({ loading: false, message: "Telegram привязан" });
    } catch (error) {
      setAccountStatus({ loading: false, message: "Подтвердите Telegram в блоке ниже. Если Telegram не установлен, подключение можно повторить позже." });
    }
  }

  useEffect(() => {
    const container = telegramWidgetRef.current;
    if (telegramNativeAvailable || !telegramWidgetOpen || !container) return undefined;
    container.innerHTML = "";

    window.onTelegramSettingsAuth = async (user) => {
      if (!user) {
        setAccountStatus({ loading: false, message: "Telegram не передал данные пользователя." });
        return;
      }
      setAccountStatus({ loading: true, message: "Проверяем Telegram..." });
      try {
        const updated = await linkAuthProvider("telegram", {
          telegram: user,
          device: await getDeviceRegistrationPayloadAsync(),
        });
        const nextIdentities = updated || await fetchAuthIdentities();
        setIdentities(nextIdentities);
        setTelegramWidgetOpen(false);
        setAccountStatus({ loading: false, message: "Telegram привязан" });
      } catch (error) {
        setAccountStatus({ loading: false, message: error?.message || "Не удалось привязать Telegram" });
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", telegramBot);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramSettingsAuth(user)");
    script.async = true;
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.onTelegramSettingsAuth;
    };
  }, [telegramBot, telegramWidgetOpen, telegramNativeAvailable]);

  async function unlinkProvider(identity) {
    const provider = identityProvider(identity);
    const label = providerDisplay(provider);
    if (!window.confirm(`Отвязать ${label}?`)) return;
    setAccountStatus({ loading: true, message: "" });
    try {
      const updated = await unlinkAuthProvider(provider, identityProviderUserId(identity));
      setIdentities(updated || await fetchAuthIdentities());
      setAccountStatus({ loading: false, message: `${label} отвязан` });
    } catch (error) {
      setAccountStatus({ loading: false, message: error?.message || `Не удалось отвязать ${label}` });
    }
  }

  function updateContactField(field, value) {
    setContactStatus((current) => ({ ...current, message: "" }));
    setContactForm((current) => ({ ...current, [field]: value }));
  }

  async function saveContacts() {
    if (!hasAuth) {
      setContactStatus({ loading: false, message: "Войдите в аккаунт, чтобы сохранить контакты." });
      return;
    }
    setContactStatus({ loading: true, message: "" });
    try {
      const nextContacts = {
        phone: String(contactForm.phone || "").trim(),
        telegram: normalizeTelegramContact(contactForm.telegram),
      };
      const savedProfile = saveProfile({ ...loadProfile(), ...nextContacts });
      setContactForm(profileContacts(savedProfile));
      const serverProfile = await saveServerProfile(savedProfile);
      if (serverProfile) {
        const mergedProfile = saveProfile({ ...savedProfile, ...serverProfile });
        setContactForm(profileContacts(mergedProfile));
        setContactStatus({ loading: false, message: "Контакты сохранены" });
        return;
      }
      setContactStatus({ loading: false, message: "Контакты сохранены на устройстве. Сервер не подтвердил обновление." });
    } catch (error) {
      setContactStatus({ loading: false, message: error?.message || "Не удалось сохранить контакты" });
    }
  }

  async function uploadPhoto(type, file) {
    if (!file) return;
    setPhotoStatus({ loadingType: type, message: "Готовим фото..." });
    try {
      const existingPhotos = photosByType.get(type) || [];
      const sourceDataUrl = await readFileAsDataUrl(file);
      const dataUrl = await resizePhotoDataUrl(sourceDataUrl, { maxSide: 1280, quality: 0.82 });
      const previewDataUrl = await resizePhotoDataUrl(sourceDataUrl, { maxSide: 520, quality: 0.74 });
      setLocalPhotoPreviews((current) => {
        const next = { ...current, [type]: previewDataUrl };
        savePhotoPreviewCache(next);
        return next;
      });
      const savedPhoto = await saveProgressPhoto({
        type,
        dataUrl,
        fileName: file.name,
        takenAt: new Date().toISOString(),
      });
      const savedId = String(savedPhoto?.id || "");
      const stalePhotos = existingPhotos.filter((photo) => photo?.id && String(photo.id) !== savedId);
      if (stalePhotos.length) {
        const results = await Promise.allSettled(stalePhotos.map((photo) => deleteProgressPhoto(photo.id)));
        results.forEach((result) => {
          if (result.status === "rejected") console.warn("[FruitFit Settings] stale progress photo delete failed", result.reason);
        });
      }
      const nextPhotos = await fetchProgressPhotos();
      setPhotos(nextPhotos);
      setPhotoStatus({ loadingType: "", message: "Фото сохранено на сервере" });
    } catch (error) {
      setPhotoStatus({ loadingType: "", message: error?.message || "Не удалось сохранить фото" });
    }
  }

  async function removePhoto(type) {
    const slotPhotos = photosByType.get(type) || [];
    if (!slotPhotos.length && !localPhotoPreviews[type]) return;
    if (!window.confirm("Удалить фото из этого слота?")) return;
    setPhotoStatus({ loadingType: type, message: "" });
    try {
      setLocalPhotoPreviews((current) => {
        const next = { ...current };
        delete next[type];
        savePhotoPreviewCache(next);
        return next;
      });
      if (slotPhotos.length) {
        const results = await Promise.allSettled(slotPhotos.filter((photo) => photo?.id).map((photo) => deleteProgressPhoto(photo.id)));
        const failed = results.find((result) => result.status === "rejected");
        if (failed) throw failed.reason;
      }
      setPhotos(await fetchProgressPhotos());
      setPhotoStatus({ loadingType: "", message: "Фото удалено" });
    } catch (error) {
      setPhotoStatus({ loadingType: "", message: error?.message || "Не удалось удалить фото" });
    }
  }

  async function sendTrainerReport() {
    if (!hasAuth) {
      setReportStatus({ loading: false, message: "Сначала войдите в FruitFit." });
      return;
    }
    setReportStatus({ loading: true, message: "" });
    try {
      let reportHealth = health;
      if (syncNativeHealth) {
        setReportStatus({ loading: true, message: `Обновляем ${HEALTH_PROVIDER_NAME}...` });
        try {
          await syncNativeHealth({ force: true, reason: "trainer-report-submit", queryMode: "history", bypassCooldown: true });
          await new Promise((resolve) => window.setTimeout(resolve, 60));
          reportHealth = readStoredHealthForReport() || reportHealth;
        } catch (error) {
          console.warn("[FruitFit Settings] Health refresh before trainer report failed", error);
        }
      }
      const healthSnapshot = buildReportHealthSnapshot(reportHealth);
      const latestPhotos = PHOTO_TYPES.map((type) => {
        const photo = latestPhotosByType.get(type.id);
        return photo ? {
          id: photo.id,
          type: type.id,
          label: type.label,
          publicUrl: photo.public_url || photo.publicUrl || null,
          storageKey: photo.storage_key || photo.storageKey || null,
          takenAt: photo.taken_at || photo.takenAt || photo.created_at || null,
        } : null;
      }).filter(Boolean);
      const serverMeasurements = await fetchMeasurements();
      const measurements = reportMeasurementsFrom(serverMeasurements.length ? serverMeasurements : loadLocalMeasurements());
      const item = await submitTrainerReport({
        kind: "progress_checkin",
        submittedAt: new Date().toISOString(),
        scores: buildClientReportScores(reportForm),
        comment: String(reportForm.comment || "").trim(),
        photos: latestPhotos,
        measurements,
        health: healthSnapshot,
        healthSummary: healthSnapshot.summary,
        noMedicalConclusions: true,
        source: `${Capacitor.getPlatform?.() || "web"}-client`,
      });
      const nextReports = await fetchTrainerReports();
      setReports(nextReports);
      setReportStatus({ loading: false, message: item ? "Отчёт отправлен тренеру" : "Отчёт отправлен" });
    } catch (error) {
      setReportStatus({ loading: false, message: error?.message || "Не удалось отправить отчёт тренеру" });
    }
  }

  function updateReportField(field, value) {
    setReportForm((current) => ({ ...current, [field]: value }));
  }

  async function logout() {
    await logoutUser();
    window.location.reload();
  }

  async function confirmDeleteAccount() {
    if (!getAuthToken()) {
      setDeleteStatus({ loading: false, message: "Сначала войдите в аккаунт." });
      setDeleteDialogOpen(false);
      return;
    }
    setDeleteStatus({ loading: true, message: "" });
    try {
      await deleteAccount();
      localStorage.removeItem("fruitfit.authSkipped");
      setDeleteStatus({ loading: false, message: "" });
      setDeleteDialogOpen(false);
      onNavigate?.("home");
    } catch (error) {
      setDeleteStatus({ loading: false, message: error?.message || "Не удалось удалить аккаунт" });
    }
  }

  async function checkUpdate() {
    setUpdateState({ status: "loading", result: null, error: "" });
    try {
      const result = await checkAndroidAppUpdate();
      setUpdateState({ status: "done", result, error: "" });
    } catch (error) {
      setUpdateState({ status: "error", result: null, error: error?.message || "Не удалось проверить обновление" });
    }
  }

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="px-4 pt-[max(14px,env(safe-area-inset-top))]">
        <header className="sticky top-0 z-20 -mx-4 flex items-center gap-3 bg-appBg/92 px-4 py-2.5 backdrop-blur">
          <button type="button" onClick={onBack || (() => onNavigate("profile"))} className="grid h-10 w-10 place-items-center rounded-full bg-appCard text-appText shadow-sm">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Профиль</p>
            <h1 className="text-[25px] font-black text-appText">Настройки</h1>
          </div>
        </header>

        <div className="mt-2.5 space-y-3">
          <AppIconSettings compact />
          <ThemeSection theme={theme} onThemeChange={onThemeChange} />
          <StepSourceSettingsSection
            health={health}
            preferredSourcePackage={preferredSourcePackage}
            onPreferredSourceChange={setPreferredSourcePackage}
          />
          <ContactSettingsSection
            hasAuth={hasAuth}
            form={contactForm}
            status={contactStatus}
            onChange={updateContactField}
            onSave={saveContacts}
          />
          <FeedbackSettingsSection />
          <PrivacySettingsSection />

          {progressPhotosEnabled && (
            <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] text-appGreen">Связь с тренером</p>
                  <h2 className="text-[16px] font-black text-appText">Отчёт тренеру</h2>
                  <p className="mt-1 text-[12px] leading-5 text-appMuted">
                    Фото, самочувствие и последние замеры будут отправлены тренеру.
                  </p>
                </div>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
                  <ShieldCheck size={18} />
                </span>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                {PHOTO_TYPES.map((type) => {
                  const latestPhoto = latestPhotosByType.get(type.id);
                  const imageUrl = localPhotoPreviews[type.id] || progressPhotoUrl(latestPhoto);
                  const showImage = Boolean(imageUrl && !brokenPhotoUrls.has(imageUrl));
                  const loading = photoStatus.loadingType === type.id;
                  const slotCount = photosByType.get(type.id)?.length || 0;
                  return (
                    <div key={type.id} className="rounded-[18px] border border-appBorder bg-appBg p-2">
                      <div className="aspect-[3/4] overflow-hidden rounded-[14px] bg-appCard">
                        {showImage ? (
                          <img
                            src={imageUrl}
                            alt={type.label}
                            className="h-full w-full object-cover"
                            onError={() => setBrokenPhotoUrls((current) => new Set([...current, imageUrl]))}
                          />
                        ) : (
                          <div className="grid h-full place-items-center text-appMuted">
                            <ImagePlus size={22} />
                          </div>
                        )}
                      </div>
                      <p className="mt-2 truncate text-center text-[11px] font-black text-appText">{type.label}</p>
                      {latestPhoto?.created_at && <p className="mt-0.5 truncate text-center text-[9px] font-bold text-appMuted">{formatDateTime(latestPhoto.created_at)}</p>}
                      <label className="mt-2 flex h-8 cursor-pointer items-center justify-center rounded-full bg-appCard text-[10px] font-black text-appText">
                        {loading ? <Loader2 size={14} className="animate-spin" /> : slotCount ? "Заменить" : "Добавить"}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => uploadPhoto(type.id, event.target.files?.[0])}
                        />
                      </label>
                      {(slotCount > 0 || localPhotoPreviews[type.id]) && (
                        <button type="button" onClick={() => removePhoto(type.id)} className="mt-1 h-7 w-full rounded-full text-[10px] font-bold text-red-500">
                          Удалить
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {photoStatus.message && <p className="mt-3 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">{photoStatus.message}</p>}

              <div className="mt-4 rounded-[20px] border border-appBorder bg-appBg p-3">
                <ClientReportSliders values={reportForm} onChange={updateReportField} disabled={reportStatus.loading} compact />
                <textarea
                  value={reportForm.comment}
                  onChange={(event) => updateReportField("comment", event.target.value)}
                  placeholder="Комментарий тренеру"
                  className="mt-3 min-h-[88px] w-full resize-none rounded-[16px] border border-appBorder bg-appCard px-3 py-2 text-[12px] font-semibold text-appText outline-none placeholder:text-appMuted"
                />
              </div>

              <div className="mt-3 rounded-[20px] border border-appBorder bg-appBg p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-black text-appText">Замеры в отчёте</p>
                  <span className="rounded-full bg-appCard px-2 py-1 text-[10px] font-black text-appMuted">{measurementPreview.length}</span>
                </div>
                {measurementPreview.length ? (
                  <div className="mt-2 space-y-1.5">
                    {measurementPreview.slice(0, 3).map((item) => (
                      <p key={`${item.date}-${item.id}`} className="rounded-2xl bg-appCard px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                        <span className="font-black text-appText">{item.date}</span> · Вес {item.weight || "-"} · Талия {item.waist || "-"} · Грудь {item.chest || "-"} · Бёдра {item.hips || "-"}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-semibold leading-4 text-appMuted">
                    Реальных замеров пока нет. Добавьте замер в профиле, и он попадёт сюда.
                  </p>
                )}
              </div>

              <div className="mt-3 rounded-[20px] border border-appBorder bg-appBg p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-black text-appText">Health в отчёте</p>
                  <span className="rounded-full bg-appCard px-2 py-1 text-[10px] font-black text-appMuted">
                    {formatReportHealthSource(reportHealthPreview.summary.providerSource)}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl bg-appCard px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">Шаги</p>
                    <p className="mt-1 text-[13px] font-black text-appText">{formatReportNumber(reportHealthPreview.summary.stepsToday)}</p>
                  </div>
                  <div className="rounded-2xl bg-appCard px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">Сон</p>
                    <p className="mt-1 text-[13px] font-black text-appText">{formatReportSleep(reportHealthPreview.summary.sleepMinutes)}</p>
                  </div>
                  <div className="rounded-2xl bg-appCard px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">Пульс</p>
                    <p className="mt-1 text-[13px] font-black text-appText">{formatReportNumber(reportHealthPreview.summary.latestBpm, "уд/мин")}</p>
                  </div>
                  <div className="rounded-2xl bg-appCard px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.08em] text-appMuted">Активные ккал</p>
                    <p className="mt-1 text-[13px] font-black text-appText">{formatReportNumber(reportHealthPreview.summary.activeCaloriesToday, "ккал")}</p>
                  </div>
                </div>
                <p className="mt-2 text-[11px] font-semibold leading-4 text-appMuted">
                  Перед отправкой отчёта приложение попробует обновить {HEALTH_PROVIDER_NAME} и приложит недельную активность.
                </p>
              </div>

              <button
                type="button"
                onClick={sendTrainerReport}
                disabled={reportStatus.loading}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appDark text-[14px] font-black text-appGreen disabled:opacity-70"
              >
                {reportStatus.loading ? <Loader2 size={17} className="animate-spin" /> : <ShieldCheck size={17} />}
                Отправить отчёт
              </button>
              {latestReport && <p className="mt-2 text-center text-[11px] font-bold text-appMuted">Последний отчёт: {formatDateTime(latestReport.submittedAt || latestReport.submitted_at || latestReport.createdAt || latestReport.created_at)}</p>}
              {reportStatus.message && <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-center text-[12px] font-bold text-appMuted">{reportStatus.message}</p>}
            </section>
          )}

          <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Аккаунт</h2>
            <p className="mt-1 text-[12px] leading-5 text-appMuted">
              {hasAuth ? "Можно выйти из текущего аккаунта на этом устройстве." : "Сейчас вход в аккаунт не выполнен."}
            </p>
            <button
              type="button"
              onClick={logout}
              disabled={!hasAuth}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-appBorder bg-appBg text-[14px] font-black text-appText disabled:opacity-50"
            >
              <LogOut size={17} />
              Выйти из аккаунта
            </button>
          </section>

          <section className="rounded-[26px] border border-red-500/30 bg-red-500/10 p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Удаление аккаунта</h2>
            <p className="mt-1 text-[12px] leading-5 text-appMuted">
              Будут удалены профиль, замеры, прогресс и health-данные, связанные с аккаунтом.
            </p>
            <button
              type="button"
              onClick={() => {
                setDeleteStatus({ loading: false, message: "" });
                setDeleteDialogOpen(true);
              }}
              disabled={deleteStatus.loading}
              className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-500 text-[14px] font-black text-white disabled:opacity-70"
            >
              {deleteStatus.loading ? <Loader2 size={17} className="animate-spin" /> : <Trash2 size={17} />}
              Удалить аккаунт
            </button>
            {deleteStatus.message && <p className="mt-3 rounded-2xl bg-appCard px-3 py-2 text-[12px] leading-5 text-red-500">{deleteStatus.message}</p>}
          </section>

        </div>
      </div>
      {deleteDialogOpen && (
        <DeleteAccountModal
          loading={deleteStatus.loading}
          error={deleteStatus.message}
          onCancel={() => {
            if (!deleteStatus.loading) setDeleteDialogOpen(false);
          }}
          onConfirm={confirmDeleteAccount}
        />
      )}
      <BottomNavigation active="profile" onNavigate={onNavigate} />
    </main>
  );
}
