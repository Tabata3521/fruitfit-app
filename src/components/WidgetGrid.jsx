import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  CreditCard,
  Flame,
  Footprints,
  Heart,
  Lock,
  Moon,
  Play,
  RefreshCcw,
  SlidersHorizontal,
  Utensils,
} from "lucide-react";
import NeutralPreview from "./NeutralPreview";
import { useHealth, formatSleepDuration } from "../data/healthStore";
import { readLecturesField, writeLecturesField } from "../data/dataContainers";
import { lecturePlaybackUrl, lectures } from "../data/lectures";
import { canOpenLecture, fetchLectureAccessPolicy, loadLectureAccessPolicy, visibleLecturesForAccess } from "../data/lectureAccess";
import { lectureTextFor } from "../data/lectureTexts";
import { dietTypeToRation } from "../data/profileStore";
import { getMealPlan, useNutritionData } from "../data/useNutritionData";
import { createPaymentSession, getAuthToken } from "../data/authStore";
import { accessTier } from "../data/accessRules";

const widgetStorageKey = "fruitfit.widgets";
const PAYMENT_PAGE_URL = String(import.meta.env.VITE_FRUITFIT_PAYMENT_URL || "https://tagirfruit.ru/payment");

const lecture = lectures[0];

function paymentPageUrl(sessionId) {
  const url = new URL(PAYMENT_PAGE_URL, window.location.origin);
  if (sessionId) url.searchParams.set("ps", sessionId);
  return url.toString();
}

function normalizeLectureProgress(value) {
  const completedIds = Array.isArray(value?.completedIds) ? value.completedIds.filter(Boolean) : [];
  const currentIndex = Math.max(0, Math.min(lectures.length - 1, Number(value?.currentIndex || 0)));
  return { currentIndex, completedIds };
}

function readLectureProgress() {
  try {
    const saved = readLecturesField("progress", undefined, null);
    return normalizeLectureProgress(saved);
  } catch (_) {
    return { currentIndex: 0, completedIds: [] };
  }
}

function saveLectureProgress(next) {
  writeLecturesField("progress", next);
  window.dispatchEvent(new CustomEvent("fruitfit:lecture-progress", { detail: next }));
}

function useLectureProgress() {
  const [progress, setProgress] = useState(readLectureProgress);
  useEffect(() => {
    function sync(event) {
      setProgress(event?.type === "fruitfit:lecture-progress" ? normalizeLectureProgress(event.detail) : readLectureProgress());
    }
    window.addEventListener("fruitfit:lecture-progress", sync);
    window.addEventListener("fruitfit:auth-updated", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("fruitfit:lecture-progress", sync);
      window.removeEventListener("fruitfit:auth-updated", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [progress, setProgress];
}

function writeLectureProgress(update) {
  const previous = readLectureProgress();
  const next = typeof update === "function" ? update(previous) : update;
  const normalized = normalizeLectureProgress({
    ...next,
    completedIds: Array.from(new Set(Array.isArray(next?.completedIds) ? next.completedIds : [])).filter(Boolean),
  });
  saveLectureProgress(normalized);
  return normalized;
}

function progressForLectureState(progress, items = lectures) {
  const safeProgress = normalizeLectureProgress(progress);
  const visibleIds = new Set((items || lectures).map((item) => item.id));
  const completedCount = safeProgress.completedIds.filter((id) => visibleIds.has(id)).length;
  return Math.min(100, Math.round((completedCount / Math.max(1, visibleIds.size || lectures.length)) * 100));
}

function buildLectureEmbedUrl(item, autoplay = false) {
  const params = new URLSearchParams({
    autoplay: autoplay ? "1" : "0",
    controls: "1",
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
    enablejsapi: "1",
  });

  if (typeof window !== "undefined" && window.location?.origin) {
    params.set("origin", window.location.origin);
  }

  return `https://www.youtube.com/embed/${item.videoId}?${params.toString()}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function YouTubeInlinePlayer({ item, title, thumbnailUrl }) {
  const embedSrc = useMemo(() => buildLectureEmbedUrl(item, true), [item]);
  const srcDoc = useMemo(() => {
    const safeTitle = escapeHtml(title || item.title);
    const safeThumb = escapeHtml(thumbnailUrl || item.thumbnailUrl);
    const safeEmbed = escapeHtml(embedSrc);
    return `<!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <style>
            * { box-sizing: border-box; }
            html, body { margin: 0; width: 100%; height: 100%; background: #101811; font-family: Inter, system-ui, sans-serif; }
            a { position: relative; display: block; width: 100%; height: 100%; overflow: hidden; color: #fff; text-decoration: none; }
            img { width: 100%; height: 100%; object-fit: cover; display: block; }
            .shade { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.06), rgba(0,0,0,.48)); }
            .play { position: absolute; left: 50%; top: 50%; width: 82px; height: 58px; transform: translate(-50%, -50%); border-radius: 18px; background: #ff0033; display: grid; place-items: center; box-shadow: 0 18px 48px rgba(0,0,0,.28); }
            .play:before { content: ""; margin-left: 5px; border-left: 20px solid #fff; border-top: 13px solid transparent; border-bottom: 13px solid transparent; }
            .caption { position: absolute; left: 16px; right: 16px; bottom: 15px; font-size: 13px; font-weight: 800; line-height: 1.25; text-shadow: 0 1px 10px rgba(0,0,0,.85); }
          </style>
        </head>
        <body>
          <a href="${safeEmbed}" aria-label="Р’РѕСЃРїСЂРѕРёР·РІРµСЃС‚Рё РІРёРґРµРѕ: ${safeTitle}">
            <img src="${safeThumb}" alt="" />
            <span class="shade"></span>
            <span class="play"></span>
            <span class="caption">РќР°Р¶РјРёС‚Рµ Play, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РїР»РµРµСЂ РІРЅСѓС‚СЂРё РїСЂРёР»РѕР¶РµРЅРёСЏ</span>
          </a>
        </body>
      </html>`;
  }, [embedSrc, item, thumbnailUrl, title]);

  return (
    <iframe
      title={title || item.title}
      srcDoc={srcDoc}
      className="aspect-video w-full bg-appDark"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      loading="eager"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

function LectureVideoPlayer({ item, title, thumbnailUrl }) {
  const url = lecturePlaybackUrl(item);
  if (item?.selectelUrl) {
    return (
      <video
        key={item.selectelUrl}
        className="aspect-video w-full bg-appDark object-cover"
        src={item.selectelUrl}
        poster={thumbnailUrl || item.thumbnailUrl}
        controls
        playsInline
        preload="metadata"
      />
    );
  }
  return <YouTubeInlinePlayer item={item} title={title} thumbnailUrl={thumbnailUrl} />;
}

function openExternalVideo(url) {
  const popup = window.open(url, "_blank");
  if (popup) {
    popup.opener = null;
    popup.focus?.();
    return;
  }
  window.location.assign(url);
}

const defaultWidgets = [
  { id: "lecture", title: "РњРёРЅРё-Р»РµРєС†РёСЏ", type: "lecture", enabled: true, order: 1, dataSource: "content", fallbackState: "РќРµС‚ РґР°РЅРЅС‹С…" },
  { id: "nutrition", title: "РџРёС‚Р°РЅРёРµ", type: "nutrition", enabled: true, order: 2, dataSource: "csv", fallbackState: "РќРµС‚ РґР°РЅРЅС‹С…" },
  { id: "heart", title: "РџСѓР»СЊСЃ", type: "heart", enabled: true, order: 3, dataSource: "tracker", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
  { id: "steps", title: "РЁР°РіРё", type: "steps", enabled: true, order: 4, dataSource: "tracker", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
  { id: "calories", title: "РљР°Р»РѕСЂРёРё", type: "calories", enabled: true, order: 5, dataSource: "tracker", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
  { id: "sleep", title: "РЎРѕРЅ", type: "sleep", enabled: true, order: 6, dataSource: "tracker/manual", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
  { id: "recovery", title: "Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ", type: "recovery", enabled: true, order: 7, dataSource: "tracker/manual", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
  { id: "cycle", title: "Р¦РёРєР»", type: "cycle", enabled: true, order: 8, dataSource: "manual", fallbackState: "РќРµС‚ РґР°РЅРЅС‹С…" },
  { id: "weekly", title: "РђРєС‚РёРІРЅРѕСЃС‚СЊ Р·Р° РЅРµРґРµР»СЋ", type: "weekly", enabled: true, order: 9, dataSource: "tracker", fallbackState: "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ" },
];

const periodTabs = [
  { id: "today", label: "РЎРµРіРѕРґРЅСЏ" },
  { id: "week", label: "РќРµРґРµР»СЏ" },
  { id: "month", label: "РњРµСЃСЏС†" },
];

const WEEKLY_STEPS_GOAL = 70000;
const WEEKLY_ACTIVITY_QUERY_MODE = "history_7d";
const weekLabels = ["РџРЅ", "Р’С‚", "РЎСЂ", "Р§С‚", "РџС‚", "РЎР±", "Р’СЃ"];

function formatCompact(value) {
  const number = Number(value) || 0;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10000 ? 1 : 1).replace(".", ",")}k`;
  return String(Math.round(number));
}

function formatPercent(value, target) {
  if (!target) return 0;
  return Math.min(100, Math.round((Number(value || 0) / target) * 100));
}

function sum(values = []) {
  return values.reduce((acc, value) => acc + (Number(value) || 0), 0);
}

function average(values = []) {
  if (!values.length) return 0;
  return Math.round(sum(values) / values.length);
}

function useWidgetConfig(profile) {
  const [widgets, setWidgets] = useState(defaultWidgets);
  const cycleAvailable = profile?.gender !== "male";

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(widgetStorageKey) || "null");
      if (Array.isArray(saved)) {
        setWidgets(defaultWidgets.map((widget) => {
          const savedWidget = saved.find((item) => item.id === widget.id) || {};
          return {
            ...widget,
            enabled: typeof savedWidget.enabled === "boolean" ? savedWidget.enabled : widget.enabled,
            order: Number(savedWidget.order) || widget.order,
          };
        }));
      }
    } catch (_) {
      setWidgets(defaultWidgets);
    }
  }, []);

  function commit(next) {
    const ordered = next
      .map((widget, index) => ({ ...widget, order: index + 1 }))
      .sort((a, b) => a.order - b.order);
    setWidgets(ordered);
    localStorage.setItem(widgetStorageKey, JSON.stringify(ordered));
  }

  const visible = useMemo(() => widgets
    .filter((widget) => widget.enabled)
    .filter((widget) => widget.type !== "cycle" || cycleAvailable)
    .sort((a, b) => a.order - b.order), [cycleAvailable, widgets]);

  return { widgets, visible, commit, cycleAvailable };
}

function Ring({ value, color = "#8BBE3D", size = 74, children }) {
  const percent = Math.max(0, Math.min(100, value || 0));
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${percent * 3.6}deg, rgba(115,124,116,0.13) 0deg)`,
      }}
    >
      <div className="grid place-items-center rounded-full bg-appCard" style={{ width: size - 10, height: size - 10 }}>
        {children}
      </div>
    </div>
  );
}

function BarChart({ values = [], color = "#8BBE3D", labels = [], height = 132 }) {
  const cleanValues = values.map((value) => Number(value) || 0);
  const max = Math.max(...cleanValues, 1);
  return (
    <div className="rounded-[22px] border border-appBorder bg-appBg/70 p-3">
      <div className="relative" style={{ height }}>
        <div className="absolute inset-x-0 top-1/4 h-px bg-appBorder" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-appBorder" />
        <div className="absolute inset-x-0 top-3/4 h-px bg-appBorder" />
        <div className="relative z-10 flex h-full items-end gap-1.5">
          {cleanValues.map((value, index) => (
            <motion.div
              key={`${index}-${value}`}
              initial={{ height: 6, opacity: 0.35 }}
              animate={{ height: `${Math.max(8, (value / max) * 100)}%`, opacity: 1 }}
              transition={{ type: "spring", stiffness: 170, damping: 22 }}
              className="min-w-0 flex-1 rounded-full"
              style={{ background: color }}
              title={`${labels[index] || index + 1}: ${value}`}
            />
          ))}
        </div>
      </div>
      {labels.length > 0 && (
        <div className="mt-2 flex justify-between text-[10px] font-semibold text-appMuted">
          {labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
        </div>
      )}
    </div>
  );
}

function LineChart({ values = [], color = "#EF4444", height = 132, labels = ["00", "06", "12", "18", "24"] }) {
  const cleanValues = values.map((value) => Number(value) || 0).filter((value) => value > 0);
  const minValue = Math.min(...cleanValues, 0);
  const min = Math.max(0, minValue - 6);
  const max = Math.max(...cleanValues, 1);
  const paddedMax = max + 6;
  const width = 320;
  const range = Math.max(1, paddedMax - min);
  const pointObjects = cleanValues.map((value, index) => {
    const x = cleanValues.length === 1 ? width / 2 : (index / (cleanValues.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 18) - 9;
    return { x, y };
  });
  const points = pointObjects.map((point) => `${point.x},${point.y}`).join(" ");
  const linePath = smoothPath(pointObjects);
  const areaPath = pointObjects.length > 1 ? `${linePath} L ${pointObjects[pointObjects.length - 1].x} ${height} L ${pointObjects[0].x} ${height} Z` : "";

  return (
    <div className="rounded-[22px] border border-appBorder bg-appBg/70 p-3">
      <div className="mb-2 flex justify-between text-[10px] font-semibold text-appMuted">
        <span>{max} СѓРґ/РјРёРЅ</span>
        <span>{Math.round((min + max) / 2)}</span>
        <span>{min}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[132px] w-full overflow-visible">
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="rgba(115,124,116,0.16)" strokeWidth="1" />
        ))}
        {cleanValues.length > 1 ? (
          <>
            <motion.path
              d={areaPath}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, ease: "easeOut" }}
              fill="rgba(239,68,68,0.10)"
            />
            <motion.path
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="4"
              d={linePath}
            />
          </>
        ) : (
          <circle cx={width / 2} cy={height / 2} r="6" fill={color} />
        )}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-appMuted">
        {labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
      </div>
    </div>
  );
}

function StatPill({ label, value, accent = false }) {
  return (
    <div className={`rounded-[18px] border p-3 ${accent ? "border-appGreen/70 bg-appGreen/35" : "border-appBorder bg-appBg/70"}`}>
      <p className="text-[11px] font-bold uppercase tracking-wide text-appMuted">{label}</p>
      <p className="mt-1 text-[17px] font-black text-appText">{value}</p>
    </div>
  );
}

function MiniGuide({ title, items = [] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="mt-4 overflow-hidden rounded-[20px] border border-appBorder bg-appBg/70">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left"
      >
        <span className="text-[13px] font-black text-appText">{title}</span>
        <ChevronRight size={17} className={`text-appMuted transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-appBorder px-3 py-3">
          {items.map((item) => (
            <p key={item} className="text-[12px] leading-5 text-appMuted">{item}</p>
          ))}
        </div>
      )}
    </section>
  );
}

function NutritionWidget({ profile, onOpen }) {
  const { loading, data } = useNutritionData();
  const rations = data?.filters?.rations || [];
  const calorieTargets = data?.filters?.caloriesTargets || [];
  const days = data?.filters?.days || [];
  const preferredRation = dietTypeToRation[profile?.dietType] || rations[0] || "";
  const preferredCalories = Number(profile?.recommendedCaloriesTarget || profile?.calculatedCalories || 1800);
  const caloriesTarget = calorieTargets.length
    ? calorieTargets.reduce((best, current) => Math.abs(Number(current) - preferredCalories) < Math.abs(Number(best) - preferredCalories) ? Number(current) : Number(best), Number(calorieTargets[0]))
    : preferredCalories;
  const filters = {
    ration: rations.includes(preferredRation) ? preferredRation : rations[0] || preferredRation,
    caloriesTarget,
    day: days[0] || "РџРѕРЅРµРґРµР»СЊРЅРёРє",
    mealType: "",
  };
  const plan = getMealPlan(data, filters);
  const totals = plan?.totals || { calories: caloriesTarget, protein: 0, fat: 0, carbs: 0 };

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="col-span-2 overflow-hidden rounded-[24px] border border-appBorder bg-[#FFF0E0] p-3.5 text-left shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 text-[13px] font-bold text-[#181F19]">
            <Utensils size={15} className="text-appOrange" /> РџРёС‚Р°РЅРёРµ
          </span>
          {loading ? (
            <div className="mt-3 h-14 w-36 animate-pulse rounded-2xl bg-white/60" />
          ) : (
            <>
              <p className="mt-3 text-[25px] font-black text-[#181F19]">{totals.calories || caloriesTarget} <span className="text-[12px] font-semibold">РєРєР°Р»</span></p>
              <p className="mt-1 text-[12px] text-[#5f675f]">Р‘ {totals.protein || 0} / Р– {totals.fat || 0} / РЈ {totals.carbs || 0}</p>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-appOrange">{filters.ration || "Р Р°С†РёРѕРЅ РїРѕРґРѕР±СЂР°РЅ"}</p>
            </>
          )}
        </div>
        <div className="grid h-[86px] w-[86px] shrink-0 place-items-center rounded-full bg-[conic-gradient(#DDF7B4_0_42%,#FFD8B5_42%_72%,#FF7A2F_72%_100%)] shadow-sm">
          <div className="h-12 w-12 rounded-full bg-[#FFF0E0]" />
        </div>
      </div>
    </motion.button>
  );
}

function MiniLectureWidget({ access, onOpen }) {
  const [progress] = useLectureProgress();
  const safeProgress = normalizeLectureProgress(progress);
  const [accessPolicy, setAccessPolicy] = useState(loadLectureAccessPolicy);
  const visibleLectures = visibleLecturesForAccess(lectures, access, accessPolicy);
  const currentIndex = Math.max(0, Math.min(safeProgress.currentIndex || 0, Math.max(visibleLectures.length - 1, 0)));
  const currentLecture = visibleLectures[currentIndex] || lecture;
  const visibleIds = new Set(visibleLectures.map((item) => item.id));
  const completed = visibleLectures.length > 0 && safeProgress.completedIds.filter((id) => visibleIds.has(id)).length >= visibleLectures.length;
  const percent = progressForLectureState(safeProgress, visibleLectures);
  const cta = completed ? "РџРµСЂРµСЃРјРѕС‚СЂРµС‚СЊ" : safeProgress.completedIds.length ? "РџСЂРѕРґРѕР»Р¶РёС‚СЊ" : "РќР°С‡Р°С‚СЊ";
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="col-span-2 grid grid-cols-[1fr_112px] gap-3 rounded-[22px] border border-appBorder bg-appCard/90 p-3 text-left shadow-sm"
    >
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold text-appMuted">
          <BookOpen size={14} /> Р›РµРєС†РёСЏ {currentIndex + 1} РёР· {visibleLectures.length || lectures.length}
        </span>
        <h3 className="mt-2 line-clamp-2 text-[15px] font-black leading-tight text-appText">{currentLecture.shortTitle || currentLecture.title}</h3>
        <p className="mt-2 text-[11px] text-appMuted">{completed ? "Р’СЃРµ РґРѕСЃС‚СѓРїРЅС‹Рµ Р»РµРєС†РёРё РїСЂРѕР№РґРµРЅС‹" : currentLecture.subtitle}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-appBg">
          <span className="block h-full rounded-full bg-appGreen" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] font-black text-appGreen">{cta} В· {percent}%</p>
      </div>
      <div className="relative grid h-[86px] place-items-center overflow-hidden rounded-[18px] bg-appDark">
        {currentLecture.thumbnailUrl ? (
          <img src={currentLecture.thumbnailUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
        ) : (
          <NeutralPreview className="h-full w-full rounded-[18px] opacity-80" compact />
        )}
        <span className="absolute inset-0 grid place-items-center text-white">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-black/42 backdrop-blur">
            <Play size={17} fill="currentColor" />
          </span>
        </span>
      </div>
    </motion.button>
  );
}

function EmptyHealthWidget({ title, icon: Icon, color = "#8BBE3D", onOpen, onConnect, onRefresh, headline = "РўСЂРµРєРµСЂ РЅРµ РїРѕРґРєР»СЋС‡С‘РЅ", description = "РџРѕСЃР»Рµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ Apple Health Р·РґРµСЃСЊ РїРѕСЏРІСЏС‚СЃСЏ СЂРµР°Р»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ.", actionLabel = "РџРѕРґРєР»СЋС‡РёС‚СЊ С‚СЂРµРєРµСЂ" }) {
  const runAction = () => {
    if (actionLabel === "РџРѕСЃРјРѕС‚СЂРµС‚СЊ") {
      onOpen?.();
      return;
    }
    if (actionLabel === "РћР±РЅРѕРІРёС‚СЊ" || actionLabel === "РџСЂРѕРІРµСЂРёС‚СЊ") {
      onRefresh?.();
      return;
    }
    onConnect?.();
  };
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm"
    >
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex min-w-0 max-w-full flex-1 items-start gap-2 text-[13px] font-bold leading-4 text-appText">
          <Icon size={15} className="shrink-0" style={{ color }} />
          <span className="min-w-0 break-words">{title}</span>
        </span>
        <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] font-bold text-appMuted">РЅРµС‚ РґР°РЅРЅС‹С…</span>
      </div>
      <p className="mt-3 text-[18px] font-black leading-tight text-appText">{headline}</p>
      <p className="mt-1 text-[11px] leading-4 text-appMuted">{description}</p>
      <span
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          runAction();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            runAction();
          }
        }}
        className="mt-3 inline-flex h-8 items-center rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
      >
        {actionLabel}
      </span>
    </motion.button>
  );
}

function HeartWidget({ health, onOpen, onConnect, onRefresh }) {
  const heart = health.heart_rate || {};
  const hasHeartData = Boolean(
    heart.dataSource
    || heart.current
    || heart.latestBpm
    || heart.samplesToday
    || heart.samples24h
    || heart.samples7d
    || (heart.hourly || []).length
  );
  const rangeInfo = heartRangeInfo(heart);
  const latestLabel = heartLatestLabel(heart);
  const sourceLabel = healthSourceDisplayName(heart.latestSourcePackage || heart.sourcePackage, heart.latestSourceName || heart.sourceName);
  const dashboardValue = rangeInfo.hasRange ? rangeInfo.rangeLabel : (rangeInfo.avg > 0 ? `${rangeInfo.avg} СѓРґ/РјРёРЅ` : rangeInfo.rangeLabel);
  if (!hasHeartData) {
    const copy = friendlyEmptyCopy("heart", heart.status);
    return (
      <EmptyHealthWidget
        title="РџСѓР»СЊСЃ"
        icon={Heart}
        color="#EF4444"
        onOpen={onOpen}
        onConnect={onConnect}
        onRefresh={onRefresh}
        headline={copy.headline}
        description={copy.description}
        actionLabel={copy.actionLabel}
      />
    );
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Heart size={15} className="text-red-500" fill="currentColor" /> РџСѓР»СЊСЃ</span>
        <span className="ml-auto rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-500">24</span>
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black leading-tight text-appText">{dashboardValue}</p>
      <p className="mt-2 text-[11px] font-bold text-appMuted">СЃСЂРµРґРЅРёР№ {rangeInfo.avg > 0 ? rangeInfo.avg : "вЂ”"} В· РґРёР°РїР°Р·РѕРЅ {rangeInfo.hasRange ? `${rangeInfo.min}-${rangeInfo.max}` : "вЂ”"}</p>
      <div className="hidden">
        {rangeInfo.hasRange && <span>{rangeInfo.minLabel}: {rangeInfo.min} СѓРґ/РјРёРЅ</span>}
        {rangeInfo.hasRange && rangeInfo.avg > 0 && <span>{rangeInfo.avgLabel}: {rangeInfo.avg} СѓРґ/РјРёРЅ</span>}
        {rangeInfo.hasRange && <span>{rangeInfo.maxLabel}: {rangeInfo.max} СѓРґ/РјРёРЅ</span>}
        <span>{latestLabel}</span>
      </div>
      <p className="mt-1 truncate text-[10px] font-bold text-appMuted">{sourceLabel}</p>
    </motion.div>
  );
}

function lastSevenDays() {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    const key = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const day = date.getDay();
    const dateLabel = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}`;
    return { key, label: weekLabels[day === 0 ? 6 : day - 1], dateLabel };
  });
}

function localDateKeyFromValue(value) {
  const date = value ? new Date(value) : new Date();
  if (!Number.isFinite(date.getTime())) return "";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function sleepEntryDateKey(entry = {}) {
  return entry.canonicalDate || entry.sleepDate || entry.date || localDateKeyFromValue(entry.end || entry.start);
}

function compactDateLabel(dateKey) {
  const value = dateKey ? new Date(`${dateKey}T12:00:00`) : new Date();
  if (!Number.isFinite(value.getTime())) return "";
  return `${String(value.getDate()).padStart(2, "0")}.${String(value.getMonth() + 1).padStart(2, "0")}`;
}

function dayDateLabel(day = {}) {
  return day.dateLabel || compactDateLabel(day.date || day.key);
}

function metricHistoryDateKey(item = {}) {
  const direct = item.date || item.key || item.canonicalDate || item.sleepDate;
  if (typeof direct === "string" && /^\d{4}-\d{2}-\d{2}/.test(direct)) return direct.slice(0, 10);
  const temporal = item.end || item.start || item.endTime || item.startTime || item.timestamp || item.createdAt;
  return temporal ? localDateKeyFromValue(temporal) : "";
}

function metricHistoryMap(rows = [], keys = ["value"], calendar = lastSevenDays()) {
  const items = Array.isArray(rows) ? rows : [];
  const offset = Math.max(0, calendar.length - items.length);
  const byDate = new Map();
  items.forEach((item, index) => {
    const dateKey = metricHistoryDateKey(item) || calendar[offset + index]?.key;
    if (!dateKey) return;
    byDate.set(dateKey, (byDate.get(dateKey) || 0) + metricHistoryValue(item, keys));
  });
  return byDate;
}

function weekMapByDate(days = [], calendar = lastSevenDays()) {
  const items = Array.isArray(days) ? days : [];
  const offset = Math.max(0, calendar.length - items.length);
  const byDate = new Map();
  items.forEach((item, index) => {
    const dateKey = item?.date || item?.key || calendar[offset + index]?.key;
    if (dateKey) byDate.set(dateKey, item || {});
  });
  return byDate;
}

function buildActivityWeekForUi(health = {}) {
  const calendar = lastSevenDays();
  const existingByDate = weekMapByDate(health.activity_history?.week, calendar);
  const historySteps = Array.isArray(health.history7d?.steps) ? health.history7d.steps : [];
  const historyCalories = Array.isArray(health.history7d?.calories) ? health.history7d.calories : [];
  const stepsByDate = metricHistoryMap(historySteps, ["value", "steps", "totalSteps"], calendar);
  const caloriesByDate = metricHistoryMap(historyCalories, ["activeCalories", "calories", "value", "kcal"], calendar);

  return calendar.map((calendarDay) => {
    const existing = existingByDate.get(calendarDay.key) || {};
    const steps = stepsByDate.has(calendarDay.key)
      ? stepsByDate.get(calendarDay.key)
      : Number(existing.steps || 0);
    const activeCalories = caloriesByDate.has(calendarDay.key)
      ? caloriesByDate.get(calendarDay.key)
      : Number(existing.activeCalories ?? existing.calories ?? 0);
    return {
      ...existing,
      key: calendarDay.key,
      date: calendarDay.key,
      label: existing.label || calendarDay.label,
      dateLabel: existing.dateLabel || calendarDay.dateLabel,
      steps,
      calories: activeCalories,
      activeCalories,
      totalCalories: Number(existing.totalCalories || 0),
      heart: Number(existing.heart || 0),
      suspicious: Boolean(existing.suspicious),
      suspiciousReason: existing.suspiciousReason || null,
    };
  });
}

function hasActivityWeekSource(health = {}) {
  return Boolean(
    (Array.isArray(health.history7d?.steps) && health.history7d.steps.length > 0)
    || (Array.isArray(health.history7d?.calories) && health.history7d.calories.length > 0)
    || (Array.isArray(health.activity_history?.week) && health.activity_history.week.length > 0)
  );
}

function activityDayTitle(day = {}) {
  return [day.label, dayDateLabel(day)].filter(Boolean).join(" ");
}

function localTimeInputValue(value, fallback = "") {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return fallback;
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isManualSleepEntry(entry = {}) {
  return Boolean(entry.manual || entry.sourcePackage === "manual");
}

function sleepDaySourceLabel(day = {}, sleep = {}) {
  const entries = [...(day.sessions || []), ...(day.naps || [])];
  if (!entries.length && !(day.entries || []).length) return sleep.dataSource === "manual" && sleep.minutes > 0 ? "Р СѓС‡РЅР°СЏ Р·Р°РїРёСЃСЊ" : "РќРµС‚ РґР°РЅРЅС‹С…";
  if (day.hasManualNight || entries.some(isManualSleepEntry) || (day.entries || []).some(isManualSleepEntry)) return "Р СѓС‡РЅР°СЏ Р·Р°РїРёСЃСЊ";
  if (entries.length || sleep.dataSource === "tracker") return "Apple Health";
  return "РќРµС‚ РґР°РЅРЅС‹С…";
}

function sleepDuplicateWarning(totalMinutes) {
  return Number(totalMinutes || 0) > 14 * 60 ? "РџСЂРѕРІРµСЂСЊС‚Рµ Р·Р°РїРёСЃСЊ СЃРЅР°: РІРѕР·РјРѕР¶РЅС‹Р№ РґСѓР±Р»СЊ РґР°РЅРЅС‹С…" : "";
}

function formatAxisValue(value, suffix = "") {
  const number = Number(value) || 0;
  const formatted = number >= 1000 ? `${(number / 1000).toFixed(number >= 10000 ? 1 : 1).replace(".", ",")}k` : String(Math.round(number));
  return suffix ? `${formatted} ${suffix}` : formatted;
}

function DualMetricBarChart({ days = [], selectedIndex = 6, onSelect, height = 136 }) {
  const scaleDays = days.filter((item) => !item.suspicious);
  const safeScaleDays = scaleDays.length ? scaleDays : days;
  const stepsMax = Math.max(...safeScaleDays.map((item) => Number(item.steps || 0)), 1);
  const caloriesMax = Math.max(...safeScaleDays.map((item) => Number(item.activeCalories ?? item.calories ?? 0)), 1);
  const axisSteps = [stepsMax, Math.round(stepsMax / 2), 0];
  const axisCalories = [caloriesMax, Math.round(caloriesMax / 2), 0];
  return (
    <div className="rounded-[22px] border border-appBorder bg-appBg/70 p-3">
      <div className="mb-2 grid min-w-0 grid-cols-[28px_minmax(0,1fr)_28px] text-[9px] font-black text-appMuted">
        <div className="space-y-[34px]">
          {axisSteps.map((value) => <p key={`s-${value}`}>{formatAxisValue(value)}</p>)}
        </div>
        <div className="relative min-w-0 overflow-hidden" style={{ height }}>
          <div className="absolute inset-x-0 top-0 h-px bg-appBorder" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-appBorder" />
          <div className="absolute inset-x-0 bottom-0 h-px bg-appBorder" />
          <div className="relative z-10 flex h-full items-end gap-1.5 px-1">
            {days.map((day, index) => {
              const steps = Number(day.steps || 0);
              const calories = Number(day.activeCalories ?? day.calories ?? 0);
              const selected = index === selectedIndex;
              const stepsHeight = Math.min(100, (steps / stepsMax) * 100);
              const caloriesHeight = Math.min(100, (calories / caloriesMax) * 100);
              return (
                <button
                  key={`${day.date || day.key || day.label}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(index);
                  }}
                  className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-2xl px-0.5 py-1 transition ${selected ? "bg-appCard shadow-sm" : "hover:bg-appCard/60"} ${day.suspicious ? "opacity-60 ring-1 ring-red-200" : ""}`}
                  aria-label={`${activityDayTitle(day)}: ${steps} С€Р°РіРѕРІ, ${calories} РєРєР°Р»`}
                >
                  <div className="h-6 text-center text-[8px] font-black leading-3 text-appText">
                    <p>{formatAxisValue(steps)}</p>
                    <p className="text-[#FF7A2F]">{formatAxisValue(calories)}</p>
                  </div>
                  <div className="flex h-[82px] w-full items-end justify-center gap-0.5">
                    <motion.span
                      className="w-[45%] rounded-t-full bg-appGreen"
                      animate={{ height: steps > 0 ? `${Math.max(10, stepsHeight)}%` : "0%" }}
                      transition={{ type: "spring", stiffness: 170, damping: 22 }}
                    />
                    <motion.span
                      className="w-[45%] rounded-t-full bg-[#FF7A2F]"
                      animate={{ height: calories > 0 ? `${Math.max(10, caloriesHeight)}%` : "0%" }}
                      transition={{ type: "spring", stiffness: 170, damping: 22 }}
                    />
                  </div>
                  <span className="text-center text-[10px] font-bold leading-3 text-appMuted">
                    <span className="block">{day.label}</span>
                    <span className="block text-[8px] text-appMuted/80">{dayDateLabel(day)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-[34px] text-right">
          {axisCalories.map((value) => <p key={`c-${value}`}>{formatAxisValue(value)}</p>)}
        </div>
      </div>
      <div className="flex items-center justify-center gap-3 text-[10px] font-bold text-appMuted">
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-appGreen" /> РЁР°РіРё</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#FF7A2F]" /> РђРєС‚РёРІРЅС‹Рµ РєРєР°Р»</span>
      </div>
    </div>
  );
}

function SleepDayBars({ days = [], selectedIndex = 6, onSelect }) {
  const max = 10 * 60;
  return (
    <div className="mt-3 grid grid-cols-7 items-end gap-1.5">
      {days.map((day, index) => {
        const selected = index === selectedIndex;
        const minutes = Number(day.totalMinutes || 0);
        const height = minutes > 0 ? `${Math.max(12, Math.min(100, (minutes / max) * 100))}%` : "0%";
        return (
          <button
            key={day.key || index}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onSelect?.(index);
            }}
            className={`rounded-2xl px-1 py-1.5 transition ${selected ? "bg-appBg shadow-sm" : "hover:bg-appBg/70"}`}
          >
            <span className="mb-1 block text-[9px] font-black text-appText">{day.totalMinutes > 0 ? formatSleepDuration(day.totalMinutes) : "вЂ”"}</span>
            <span className="mx-auto flex h-[58px] w-full max-w-[24px] items-end overflow-hidden rounded-full bg-appBg">
              {minutes > 0 && (
                <motion.span
                  className="block w-full rounded-full bg-blue-400"
                  animate={{ height }}
                />
              )}
            </span>
            <span className="mt-1 block text-[10px] font-bold leading-3 text-appMuted">{day.label}</span>
            <span className="block text-[8px] font-bold leading-3 text-appMuted/80">{day.dateLabel || compactDateLabel(day.date || day.key)}</span>
          </button>
        );
      })}
    </div>
  );
}

const sleepStageMeta = {
  1: { key: "awake", label: "Р‘РѕРґСЂСЃС‚РІРѕРІР°РЅРёРµ", color: "#FBBF24" },
  2: { key: "light", label: "Р›С‘РіРєРёР№ СЃРѕРЅ", color: "#93C5FD" },
  3: { key: "awake", label: "РџСЂРѕР±СѓР¶РґРµРЅРёРµ", color: "#F59E0B" },
  4: { key: "light", label: "Р›С‘РіРєРёР№ СЃРѕРЅ", color: "#60A5FA" },
  5: { key: "deep", label: "Р“Р»СѓР±РѕРєРёР№ СЃРѕРЅ", color: "#1D4ED8" },
  6: { key: "rem", label: "REM", color: "#A78BFA" },
};

function sleepStageMinutes(stage = {}) {
  const start = new Date(stage.start || stage.time || Date.now()).getTime();
  const end = new Date(stage.end || stage.finish || stage.start || Date.now()).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.round((end - start) / 60000);
}

function summarizeSleepStages(sessions = []) {
  const totals = { light: 0, deep: 0, rem: 0, awake: 0, other: 0 };
  const segments = [];
  sessions.forEach((session) => {
    (session.stages || []).forEach((stage) => {
      const meta = sleepStageMeta[Number(stage.type)] || { key: "other", label: "РЎРѕРЅ", color: "#BFDBFE" };
      if (!sleepStageMeta[Number(stage.type)]) return;
      const minutes = sleepStageMinutes(stage);
      if (minutes <= 0) return;
      totals[meta.key] = (totals[meta.key] || 0) + minutes;
      segments.push({ ...stage, ...meta, minutes });
    });
  });
  return { totals, segments };
}

function isLikelyNightSleepSession(session = {}) {
  const start = new Date(session.start || session.date || Date.now());
  const end = new Date(session.end || session.start || Date.now());
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return false;
  const startHour = start.getHours();
  const endHour = end.getHours();
  return startHour >= 18 || startHour <= 6 || endHour <= 11;
}

function buildSleepDays(sleep = {}) {
  if (Array.isArray(sleep.canonicalTimeline) && sleep.canonicalTimeline.length) {
    const canonicalByDate = new Map(sleep.canonicalTimeline.map((day) => [day.date || day.key, day]));
    return lastSevenDays().map((fallback) => {
      const day = canonicalByDate.get(fallback.key) || {};
      return {
        ...fallback,
        key: fallback.key,
        label: day.label || fallback.label,
        dateLabel: day.dateLabel || fallback.dateLabel || compactDateLabel(fallback.key),
        date: fallback.key,
        nightMinutes: Number(day.nightMinutes || 0),
        napMinutes: Number(day.napMinutes || 0),
        fragmentMinutes: Number(day.fragmentMinutes || 0),
        totalMinutes: Number(day.totalMinutes || day.minutes || 0),
        sessions: day.mainSleep ? [day.mainSleep] : (day.sessions || []),
        naps: [...(day.naps || []), ...(day.fragments || [])],
        hasManualNight: Boolean(day.hasManualNight || (day.entries || []).some(isManualSleepEntry)),
        entries: day.entries || [],
      };
    });
  }
  const days = lastSevenDays().map((day) => ({
    ...day,
    dateLabel: day.dateLabel || compactDateLabel(day.key),
    nightMinutes: 0,
    napMinutes: 0,
    totalMinutes: 0,
    sessions: [],
    naps: [],
  }));
  const byDate = new Map(days.map((day) => [day.key, day]));
  const addSession = (session, kind) => {
    const key = localDateKeyFromValue(session.end || session.start);
    const day = byDate.get(key);
    if (!day) return;
    const minutes = Number(session.minutes || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const sleepKind = session.sleepKind || kind;
    if (sleepKind === "fragment") {
      day.totalMinutes += minutes;
      day.naps.push(session);
      return;
    }
    if (sleepKind === "nap" || minutes < 120 || !isLikelyNightSleepSession(session)) {
      day.napMinutes += minutes;
      day.naps.push(session);
    } else {
      day.nightMinutes += minutes;
      day.sessions.push(session);
    }
    day.totalMinutes += minutes;
  };
  (sleep.sessions || []).forEach((session) => addSession(session, session.sleepKind || "night"));
  (sleep.naps || sleep.fragments || []).forEach((session) => addSession(session, "nap"));
  if (!(sleep.sessions || []).length && (sleep.samples || []).length) {
    (sleep.samples || []).forEach((sample) => addSession({ ...sample, minutes: Number(sample.value || sample.minutes || 0) }, "night"));
  }
  days.forEach((day) => {
    const manualEntries = [...day.sessions, ...day.naps].filter(isManualSleepEntry);
    if (!manualEntries.length) return;
    day.sessions = manualEntries.filter((entry) => entry.sleepKind === "night");
    day.naps = manualEntries.filter((entry) => entry.sleepKind !== "night");
    day.nightMinutes = sum(day.sessions.map((entry) => Number(entry.minutes || 0)));
    day.napMinutes = sum(day.naps.map((entry) => Number(entry.minutes || 0)));
    day.totalMinutes = day.nightMinutes + day.napMinutes;
    day.hasManualNight = day.sessions.length > 0;
  });
  return days;
}

function SleepStageBreakdown({ day }) {
  const sessions = [...(day?.sessions || []), ...(day?.naps || [])];
  const { totals, segments } = summarizeSleepStages(sessions);
  const totalStages = sum(Object.values(totals));
  const total = Number(day?.totalMinutes || 0);
  return (
    <div className="mt-3 rounded-[20px] border border-appBorder bg-appBg/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-black text-appText">{day?.label || ""}</p>
          <p className="mt-1 text-[11px] text-appMuted">РќРѕС‡РЅРѕР№ СЃРѕРЅ {formatSleepDuration(day?.nightMinutes || 0)} В· РґСЂРµРјС‹ {formatSleepDuration(day?.napMinutes || 0)}</p>
        </div>
        <p className="text-[18px] font-black text-appText">{formatSleepDuration(total)}</p>
      </div>
      {totalStages > 0 ? (
        <>
          <div className="mt-3 flex h-5 overflow-hidden rounded-full bg-appCard">
            {segments.map((segment, index) => (
              <span
                key={`${segment.start || index}-${segment.type}`}
                className="h-full"
                style={{ width: `${Math.max(2, (segment.minutes / totalStages) * 100)}%`, background: segment.color }}
                title={`${segment.label}: ${formatSleepDuration(segment.minutes)}`}
              />
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ["Р›С‘РіРєРёР№", totals.light, "#60A5FA"],
              ["Р“Р»СѓР±РѕРєРёР№", totals.deep, "#1D4ED8"],
              ["REM", totals.rem, "#A78BFA"],
            ].map(([label, minutes, color]) => (
              <div key={label} className="rounded-[14px] bg-appCard px-2 py-2 text-center">
                <p className="text-[10px] font-bold text-appMuted">{label}</p>
                <p className="mt-1 text-[13px] font-black text-appText" style={{ color }}>{formatSleepDuration(minutes)}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="mt-3 rounded-2xl bg-appCard px-3 py-2 text-[12px] leading-5 text-appMuted">Р¤Р°Р·С‹ СЃРЅР° РЅРµ РїРµСЂРµРґР°РЅС‹ С‚СЂРµРєРµСЂРѕРј. РџРѕРєР°Р·С‹РІР°РµРј С‚РѕР»СЊРєРѕ РґР»РёС‚РµР»СЊРЅРѕСЃС‚СЊ.</p>
      )}
    </div>
  );
}

function sleepKindLabel(kind) {
  if (kind === "night") return "РќРѕС‡РЅРѕР№ СЃРѕРЅ";
  if (kind === "fragment") return "Р¤СЂР°РіРјРµРЅС‚ СЃРЅР°";
  return "Р”СЂРµРјР°";
}

function sleepEntryRange(entry = {}) {
  if (entry.startLocal && entry.endLocal) return `${entry.startLocal}-${entry.endLocal}`;
  const start = entry.start || entry.startTime;
  const end = entry.end || entry.endTime;
  if (!start || !end) return "Р’СЂРµРјСЏ РЅРµ СѓРєР°Р·Р°РЅРѕ";
  return `${new Date(start).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}-${new Date(end).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
}

function SleepEntriesList({ title, entries = [] }) {
  return (
    <div className="mt-4 rounded-[20px] border border-appBorder bg-appBg/70 p-3">
      <p className="text-[12px] font-black text-appText">{title}</p>
      {entries.length ? (
        <div className="mt-3 space-y-2">
          {entries.map((entry, index) => (
            <div key={`${entry.start || entry.date || index}-${entry.sleepKind || "sleep"}`} className="rounded-2xl bg-appCard px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] font-black text-appText">{sleepKindLabel(entry.sleepKind)}</p>
                <p className="text-[13px] font-black text-appText">{formatSleepDuration(entry.minutes || entry.durationMinutes || 0)}</p>
              </div>
              <p className="mt-1 text-[11px] font-bold text-appMuted">{entry.date || localDateKeyFromValue(entry.end || entry.start)}  {sleepEntryRange(entry)}</p>
              <p className="mt-1 text-[11px] text-appMuted">{healthSourceDisplayName(entry.sourcePackage, entry.sourceName)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-5 text-appMuted">Р—Р°РїРёСЃРµР№ РЅРµС‚.</p>
      )}
    </div>
  );
}

function healthSourceDisplayName(packageName, fallback) {
  const rawPackage = String(packageName || "").toLowerCase();
  const rawFallback = String(fallback || "").toLowerCase();
  const raw = `${rawPackage} ${rawFallback}`.trim();
  if (raw.includes("com.xiaomi.wearable") || raw.includes("mi fitness")) return "Mi Fitness";
  if (raw.includes("com.huami.watch.hmwatchmanager") || raw.includes("zepp") || raw.includes("amazfit")) return "Zepp / Amazfit";
  if (raw.includes("com.google.android.apps.fitness") || raw.includes("google fit")) return "Google Fit";
  if (raw.includes("com.sec.android.app.shealth") || raw.includes("samsung")) return "Samsung Health";
  if (packageName && !rawPackage.includes("aggregate") && rawPackage !== "android") return fallback && !rawFallback.includes("aggregate") ? fallback : packageName;
  if (fallback && !rawFallback.includes("aggregate")) return fallback;
  return "Apple Health aggregate";
}

function heartRangeInfo(heart = {}) {
  const range = heart.range24h || heart.dayRange || [];
  const min = Number(range[0] || heart.min24h || 0);
  const max = Number(range[1] || heart.max24h || 0);
  const avg = Number(heart.avg24h || 0);
  if (min > 0 && max > 0) {
    return {
      hasRange: true,
      scope: "24h",
      min,
      avg,
      max,
      rangeLabel: `${min}-${max} СѓРґ/РјРёРЅ`,
      minLabel: "РњРёРЅ. 24С‡",
      avgLabel: "РЎСЂРµРґРЅРёР№ 24С‡",
      maxLabel: "РњР°РєСЃ. 24С‡",
      rangeTitle: "Р”РёР°РїР°Р·РѕРЅ 24С‡",
      avgTitle: "РЎСЂРµРґРЅРёР№ 24С‡",
      hintPrefix: "Р”РёР°РїР°Р·РѕРЅ Р·Р° 24 С‡Р°СЃР°",
    };
  }
  const weekRange = heart.range7d || [];
  const weekMin = Number(weekRange[0] || 0);
  const weekMax = Number(weekRange[1] || 0);
  const weekAvg = Number(heart.avg7d || 0);
  if (weekMin > 0 && weekMax > 0) {
    return {
      hasRange: true,
      scope: "7d",
      min: weekMin,
      avg: weekAvg,
      max: weekMax,
      rangeLabel: `${weekMin}-${weekMax} СѓРґ/РјРёРЅ`,
      minLabel: "РњРёРЅ. Р·Р° 7 РґРЅРµР№",
      avgLabel: "РЎСЂРµРґРЅРёР№ Р·Р° 7 РґРЅРµР№",
      maxLabel: "РњР°РєСЃ. Р·Р° 7 РґРЅРµР№",
      rangeTitle: "Р”РёР°РїР°Р·РѕРЅ 7 РґРЅРµР№",
      avgTitle: "РЎСЂРµРґРЅРёР№ 7 РґРЅРµР№",
      hintPrefix: "Р”РёР°РїР°Р·РѕРЅ Р·Р° 7 РґРЅРµР№",
    };
  }
  return {
    hasRange: false,
    scope: "latest",
    min: null,
    avg: null,
    max: null,
    rangeLabel: heart.latestBpm ? `${heart.latestBpm} СѓРґ/РјРёРЅ` : "РќРµС‚ РґР°РЅРЅС‹С…",
    minLabel: "РњРёРЅ.",
    avgLabel: "РЎСЂРµРґРЅРёР№",
    maxLabel: "РњР°РєСЃ.",
    rangeTitle: "РџСѓР»СЊСЃ",
    avgTitle: "РЎСЂРµРґРЅРёР№",
    hintPrefix: "РџСѓР»СЊСЃ",
  };
}

function heartRangeLabel(heart = {}) {
  return heartRangeInfo(heart).rangeLabel;
}

function heartLatestLabel(heart = {}) {
  if (!heart.latestBpm) return "РїРѕСЃР»РµРґРЅРµРіРѕ РёР·РјРµСЂРµРЅРёСЏ РЅРµС‚";
  const age = heart.updatedAgoText || "";
  return `РїРѕСЃР»РµРґРЅРёР№: ${heart.latestBpm}, ${age}`;
}

function recoveryHeartSummary(heart = {}) {
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return rangeInfo.avg > 0 ? `${rangeInfo.rangeLabel}, ${rangeInfo.avgTitle.toLowerCase()} ${rangeInfo.avg} СѓРґ/РјРёРЅ` : rangeInfo.rangeLabel;
  }
  if (heart.latestBpm) return `${heart.latestBpm} СѓРґ/РјРёРЅ, ${heart.updatedAgoText || "Р±РµР· РІСЂРµРјРµРЅРё"}`;
  return "РЅРµС‚ РґР°РЅРЅС‹С…";
}

function friendlyHealthBadge(status) {
  if (status === "rate_limited") return "РєСЌС€";
  if (status === "fresh") return "СЃРІРµР¶РёРµ";
  if (status === "aging") return "СЃРµРіРѕРґРЅСЏ";
  if (status === "today") return "СЃРµРіРѕРґРЅСЏ";
  if (status === "old_today") return "Р·Р° 24С‡";
  if (status === "stale") return "СѓСЃС‚Р°СЂРµР»Рё";
  return "РґР°РЅРЅС‹Рµ";
}

function isRateLimitedUiStatus(status) {
  return status === "rate_limited" || status === "using_cache" || status === "temporarily_unavailable";
}

function friendlyHeartHint(heart = {}) {
  if (isRateLimitedUiStatus(heart.status) || isRateLimitedUiStatus(heart.widgetState) || heart.freshness === "rate_limited") {
    return heart.dataSource || heart.latestBpm
      ? "Apple Health РІСЂРµРјРµРЅРЅРѕ РѕРіСЂР°РЅРёС‡РёР» Р·Р°РїСЂРѕСЃС‹, РїРѕРєР°Р·С‹РІР°РµРј СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ."
      : "Apple Health РїРѕРєР° РЅРµ РѕС‚РІРµС‚РёР». РџРѕРІС‚РѕСЂРёС‚Рµ РѕР±РЅРѕРІР»РµРЅРёРµ РїРѕР·Р¶Рµ.";
  }
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return `${rangeInfo.hintPrefix}: ${rangeInfo.rangeLabel}. ${heartLatestLabel(heart)}.`;
  }
  if (heart.displayMode === "latest_only" && heart.latestTimestamp) {
    return `Р•СЃС‚СЊ С‚РѕР»СЊРєРѕ РїРѕСЃР»РµРґРЅРµРµ РёР·РјРµСЂРµРЅРёРµ: ${new Date(heart.latestTimestamp).toLocaleDateString("ru-RU")} (${heart.updatedAgoText || ""}).`;
  }
  if (heart.latestBpm) return `РџРѕСЃР»РµРґРЅРёР№ РїСѓР»СЊСЃ: ${heart.latestBpm} СѓРґ/РјРёРЅ, ${heart.updatedAgoText || "РІСЂРµРјСЏ РЅРµРёР·РІРµСЃС‚РЅРѕ"}.`;
  return "РџСѓР»СЊСЃ РїРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚СЂРµРєРµСЂР°.";
}

function friendlySourceHint(metric = {}, type = "metric") {
  if (isRateLimitedUiStatus(metric.status) || isRateLimitedUiStatus(metric.widgetState)) {
    return metric.dataSource
      ? "Apple Health РѕРіСЂР°РЅРёС‡РёР» С‡Р°СЃС‚РѕС‚Сѓ Р·Р°РїСЂРѕСЃРѕРІ, РїРѕРєР°Р·С‹РІР°РµРј СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ."
      : "Apple Health РІСЂРµРјРµРЅРЅРѕ РЅРµРґРѕСЃС‚СѓРїРµРЅ. РџРѕРІС‚РѕСЂРёС‚Рµ РѕР±РЅРѕРІР»РµРЅРёРµ РїРѕР·Р¶Рµ.";
  }
  if (metric.isEstimated || metric.status === "estimated") {
    return "Р—РЅР°С‡РµРЅРёРµ СЂР°СЃСЃС‡РёС‚Р°РЅРѕ РїСЂРёР±Р»РёР·РёС‚РµР»СЊРЅРѕ.";
  }
  if (!metric.dataSource) {
    return type === "sleep"
      ? "Р”Р°РЅРЅС‹С… СЃРЅР° РїРѕРєР° РЅРµС‚. РњРѕР¶РЅРѕ РІРЅРµСЃС‚Рё СЃРѕРЅ РІСЂСѓС‡РЅСѓСЋ."
      : "Р”Р°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚СЂРµРєРµСЂР°.";
  }
  return "Р”Р°РЅРЅС‹Рµ РїРѕР»СѓС‡РµРЅС‹ РёР· Apple Health.";
}

function friendlyEmptyCopy(kind, status, hasPartialData = false) {
  if (isRateLimitedUiStatus(status)) {
    return {
      headline: "РџРѕРєР°Р·С‹РІР°РµРј СЃРѕС…СЂР°РЅС‘РЅРЅС‹Рµ РґР°РЅРЅС‹Рµ",
      description: "Apple Health РІСЂРµРјРµРЅРЅРѕ РѕРіСЂР°РЅРёС‡РёР» Р·Р°РїСЂРѕСЃС‹. FruitFit РѕР±РЅРѕРІРёС‚ РІРёРґР¶РµС‚ РїРѕСЃР»Рµ РїР°СѓР·С‹.",
      actionLabel: "РџСЂРѕРІРµСЂРёС‚СЊ",
    };
  }
  if (status === "permission_required") {
    return {
      headline: "РќСѓР¶РЅРѕ СЂР°Р·СЂРµС€РµРЅРёРµ",
      description: "FruitFit РЅСѓР¶РµРЅ РґРѕСЃС‚СѓРї Apple Health, С‡С‚РѕР±С‹ С‡РёС‚Р°С‚СЊ СЌС‚Рё РґР°РЅРЅС‹Рµ.",
      actionLabel: "РџРѕРґРєР»СЋС‡РёС‚СЊ",
    };
  }
  if (kind === "heart") {
    return {
      headline: "РџСѓР»СЊСЃ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ",
      description: "РЎРёРЅС…СЂРѕРЅРёР·РёСЂСѓР№С‚Рµ С‚СЂРµРєРµСЂ СЃ Apple Health, Рё FruitFit РїРѕРєР°Р¶РµС‚ РґРёР°РїР°Р·РѕРЅ Р·Р° СЃСѓС‚РєРё.",
      actionLabel: "РћР±РЅРѕРІРёС‚СЊ",
    };
  }
  if (kind === "sleep") {
    return {
      headline: "РЎРѕРЅ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ",
      description: "Р•СЃР»Рё С‚СЂРµРєРµСЂ РЅРµ Р·Р°РїРёСЃР°Р» СЃРѕРЅ, РјРѕР¶РЅРѕ РІРЅРµСЃС‚Рё РµРіРѕ РІСЂСѓС‡РЅСѓСЋ.",
      actionLabel: "РџРѕСЃРјРѕС‚СЂРµС‚СЊ",
    };
  }
  if (kind === "recovery" && hasPartialData) {
    return {
      headline: "Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ РїРѕС‡С‚Рё РіРѕС‚РѕРІРѕ",
      description: "Р•СЃС‚СЊ С‡Р°СЃС‚СЊ РґР°РЅРЅС‹С…. Р”РѕР±Р°РІСЊС‚Рµ СЃРѕРЅ РёР»Рё РґРѕР¶РґРёС‚РµСЃСЊ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё, С‡С‚РѕР±С‹ СЂР°СЃС‡С‘С‚ СЃС‚Р°Р» С‚РѕС‡РЅРµРµ.",
      actionLabel: "РџРѕСЃРјРѕС‚СЂРµС‚СЊ",
    };
  }
  return {
    headline: "Р”Р°РЅРЅС‹С… РїРѕРєР° РЅРµС‚",
    description: "Apple Health РїРѕРґРєР»СЋС‡С‘РЅ, РґР°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚СЂРµРєРµСЂР°.",
    actionLabel: "РћР±РЅРѕРІРёС‚СЊ",
  };
}

function isConnectedEmptyStatus(status) {
  return status === "connected_empty_today" || status === "connected_empty" || status === "connected_zero";
}

function hasChartData(values = []) {
  return values.some((value) => Number(value || 0) > 0);
}

function metricHistoryValue(item = {}, keys = ["value"]) {
  for (const key of keys) {
    const value = Number(item?.[key]);
    if (Number.isFinite(value)) return Math.round(value);
  }
  return 0;
}

function historyValues(rows = [], keys = ["value"]) {
  return (Array.isArray(rows) ? rows : []).map((item) => metricHistoryValue(item, keys));
}

function hasHistoryValues(values = []) {
  return values.some((value) => Number(value || 0) > 0);
}

function historyLabels(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((item, index) => item?.label || item?.day || weekLabels[index] || "");
}

function ChartEmptyState({ children }) {
  return (
    <div className="rounded-[22px] border border-dashed border-appBorder bg-appBg/70 p-4 text-center text-[12px] font-semibold leading-5 text-appMuted">
      {children}
    </div>
  );
}

function AggregateProgress({ value, target, color, unit, note }) {
  const percent = formatPercent(value, target);
  return (
    <div className="rounded-[22px] border border-appBorder bg-appBg/70 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-appMuted">Р’СЃРµРіРѕ</p>
          <p className="mt-1 text-[30px] font-black leading-none text-appText">{Number(value || 0).toLocaleString("ru-RU")} <span className="text-[13px]">{unit}</span></p>
        </div>
        <p className="text-[13px] font-black" style={{ color }}>{percent}%</p>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-appBorder/50">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
      <p className="mt-3 text-[12px] leading-5 text-appMuted">{note}</p>
    </div>
  );
}

function MetricWidget({ kind = "metric", status = "no_data", title, icon: Icon, value, target, color, suffix, sourceNote, onOpen, onConnect, onRefresh }) {
  if (kind === "steps" && isConnectedEmptyStatus(status)) {
    const percent = formatPercent(0, target);
    return (
      <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <div className="flex flex-col items-start gap-2">
          <span className="inline-flex min-w-0 max-w-full items-start gap-2 text-[13px] font-bold leading-4 text-appText"><Icon size={15} className="shrink-0" style={{ color }} /> <span className="min-w-0 break-words">{title}</span></span>
          <span className="flex shrink-0 items-center gap-1">
            <span className="text-[10px] font-bold text-appMuted">{percent}%</span>
            <DashboardRefreshButton onRefresh={onRefresh} />
          </span>
        </div>
        <p className="mt-3 text-[26px] font-black text-appText">0</p>
        <p className="text-[11px] text-appMuted">/ {target.toLocaleString("ru-RU")} {suffix}</p>
        <p className="mt-1 text-[10px] font-bold text-appMuted">РЎРµРіРѕРґРЅСЏ С€Р°РіРѕРІ РїРѕРєР° РЅРµС‚. Р”Р°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚СЂРµРєРµСЂР°.</p>
        <div className="mt-3 h-2 rounded-full bg-appBg">
          <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: "0%" }} />
        </div>
      </motion.div>
    );
  }
  if (value == null || value === 0) {
    const copy = friendlyEmptyCopy(kind, status);
    return <EmptyHealthWidget title={title} icon={Icon} color={color} onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  const percent = formatPercent(value, target);
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex flex-col items-start gap-2">
        <span className="inline-flex min-w-0 max-w-full items-start gap-2 text-[13px] font-bold leading-4 text-appText"><Icon size={15} className="shrink-0" style={{ color }} /> <span className="min-w-0 break-words">{title}</span></span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] font-bold text-appMuted">{percent}%</span>
          <DashboardRefreshButton onRefresh={onRefresh} />
        </span>
      </div>
      <p className="mt-3 text-[26px] font-black text-appText">{formatCompact(value)}</p>
      <p className="text-[11px] text-appMuted">/ {target.toLocaleString("ru-RU")} {suffix}</p>
      {sourceNote && <p className="mt-1 text-[10px] font-bold text-appMuted">{sourceNote}</p>}
      <div className="mt-3 h-2 rounded-full bg-appBg">
        <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${percent}%` }} />
      </div>
    </motion.div>
  );
}

function SleepWidget({ health, onOpen, onConnect, onRefresh }) {
  const sleep = health.sleep || {};
  const hasSleepData = Boolean(sleep.dataSource || sleep.minutes > 0 || (sleep.week || []).some((item) => Number(item.minutes || 0) > 0));
  if (!hasSleepData) {
    const copy = friendlyEmptyCopy("sleep", sleep.status);
    copy.headline = "РЎРѕРЅ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ";
    copy.description = "Р•СЃР»Рё С‚СЂРµРєРµСЂ РЅРµ Р·Р°РїРёСЃР°Р» СЃРѕРЅ, РјРѕР¶РЅРѕ РІРЅРµСЃС‚Рё РµРіРѕ РІСЂСѓС‡РЅСѓСЋ.";
    copy.actionLabel = "Р’РЅРµСЃС‚Рё СЃРѕРЅ";
    return <EmptyHealthWidget title="РЎРѕРЅ" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> РЎРѕРЅ</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(health.sleep.minutes)}</p>
      <p className="text-[11px] text-appMuted">РљР°С‡РµСЃС‚РІРѕ: {health.sleep.quality}/5</p>
      <p className="mt-1 text-[11px] leading-4 text-appMuted">{friendlySourceHint(sleep, "sleep")}</p>
      <Sparkline values={health.sleep.week.map((item) => item.minutes)} color="#60A5FA" />
    </motion.div>
  );
}

function SleepWidgetV2({ health, onOpen, onConnect, onRefresh }) {
  const sleep = health.sleep || {};
  const sleepDays = buildSleepDays(sleep);
  const lastDataIndex = sleepDays.map((day) => day.totalMinutes > 0).lastIndexOf(true);
  const [selectedIndex, setSelectedIndex] = useState(lastDataIndex >= 0 ? lastDataIndex : 6);
  useEffect(() => {
    if (lastDataIndex >= 0) setSelectedIndex(lastDataIndex);
  }, [lastDataIndex]);
  const selectedDay = sleepDays[selectedIndex] || sleepDays[6];
  const nightMinutes = Number(sleep.nightMinutes ?? selectedDay?.nightMinutes ?? 0);
  const napMinutes = Number(sleep.napMinutes ?? selectedDay?.napMinutes ?? 0);
  const sourceLabel = sleepDaySourceLabel(selectedDay, sleep);
  const warning = sleepDuplicateWarning(sleep.minutes || selectedDay?.totalMinutes || 0);
  const hasSleepData = Boolean(sleep.dataSource || sleep.minutes > 0 || sleepDays.some((item) => Number(item.totalMinutes || 0) > 0));
  if (!hasSleepData) {
    const copy = friendlyEmptyCopy("sleep", sleep.status);
    return <EmptyHealthWidget title="РЎРѕРЅ" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> РЎРѕРЅ</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(sleep.minutes || selectedDay?.totalMinutes || 0)}</p>
      <p className="mt-1 text-[10px] font-bold text-appMuted">РСЃС‚РѕС‡РЅРёРє: {sourceLabel}</p>
      {warning && <p className="mt-1 text-[10px] font-black text-amber-500">{warning}</p>}
      <p className="text-[11px] text-appMuted">РќРѕС‡РЅРѕР№ СЃРѕРЅ: {formatSleepDuration(nightMinutes)} В· Р”СЂРµРјС‹: {formatSleepDuration(napMinutes)}</p>
    </motion.div>
  );
}

function RecoveryWidget({ health, onOpen, onConnect, onRefresh }) {
  const score = health.readiness.score;
  const readiness = health.readiness || {};
  const factors = (readiness.factors || []).slice(0, 2);
  if (score == null) {
    const hasPartialData = Boolean(health.heart_rate?.latestBpm || health.sleep?.minutes || health.steps?.today);
    const copy = friendlyEmptyCopy("recovery", health.recovery?.status || health.readiness?.status, hasPartialData);
    return <EmptyHealthWidget title="Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ" icon={Activity} color="#8BBE3D" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer overflow-hidden rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex min-w-0 max-w-full items-start gap-2 text-[13px] font-bold leading-4 text-appText"><Activity size={15} className="shrink-0 text-[#8BBE3D]" /> <span className="min-w-0 break-words">Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ</span></span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Ring value={score} size={64}>
          <span className="text-[18px] font-black text-appText">{score}%</span>
        </Ring>
        <div className="min-w-0 overflow-hidden">
          <p className="line-clamp-1 text-[13px] font-black text-appText">{readiness.status || "Р“РѕС‚РѕРІРЅРѕСЃС‚СЊ"}</p>
          <p className="line-clamp-2 overflow-hidden text-[10px] leading-4 text-appMuted">{readiness.recommendation}</p>
        </div>
      </div>
      {factors.length > 0 && (
        <div className="mt-3 max-h-10 space-y-1 overflow-hidden">
          {factors.map((factor) => (
            <p key={factor.id} className="line-clamp-1 overflow-hidden text-[11px] leading-4 text-appMuted"><span className="font-black text-appText">{factor.label}:</span> {factor.value}</p>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CycleWidget({ health, onOpen }) {
  const cycle = health.cycle || {};
  if (!cycle.configured) {
    return (
      <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Р¦РёРєР»</span>
        <p className="mt-3 text-[12px] font-black leading-4 text-appText">РќР°СЃС‚СЂРѕР№С‚Рµ С†РёРєР»</p>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-appMuted">Р”РѕР±Р°РІСЊС‚Рµ РґР°С‚Сѓ РЅР°С‡Р°Р»Р° РїРѕСЃР»РµРґРЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё, С‡С‚РѕР±С‹ FruitFit СЂР°СЃСЃС‡РёС‚Р°Р» РїСЂРѕРіРЅРѕР·.</p>
      </motion.button>
    );
  }
  const progress = cycle.progress || Math.round((cycle.cycleDay / cycle.cycleLengthDays) * 100);
  const nextPeriodText = cycle.daysUntilNextPeriod === 0 ? "СЃРµРіРѕРґРЅСЏ" : `С‡РµСЂРµР· ${cycle.daysUntilNextPeriod} РґРЅ.`;
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Р¦РёРєР»</span>
      <div className="mt-3 grid grid-cols-[1fr_40px] items-center gap-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black leading-4 text-appText">{cycle.cycleDay} РґРµРЅСЊ С†РёРєР»Р°</p>
          <p className="truncate text-[10px] font-bold leading-4 text-violet-500">{cycle.phaseLabel}</p>
          <p className="mt-1 text-[10px] leading-4 text-appMuted">РњРµРЅСЃС‚СЂСѓР°С†РёСЏ РїСЂРёРјРµСЂРЅРѕ {nextPeriodText}</p>
        </div>
        <Ring value={progress} color="#A78BFA" size={40}>
          <span className="text-[11px] font-black text-appText">{cycle.cycleDay}</span>
        </Ring>
      </div>
    </motion.button>
  );
}

function WeeklyWidget({ health, onOpen, onConnect }) {
  const days = useMemo(() => buildActivityWeekForUi(health), [health]);
  const values = days.map((item) => item.steps);
  if (!health.steps?.dataSource && !health.calories?.dataSource && !hasActivityWeekSource(health)) {
    return (
      <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-black text-appText">РђРєС‚РёРІРЅРѕСЃС‚СЊ Р·Р° РЅРµРґРµР»СЋ</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">РќРµС‚ РґР°РЅРЅС‹С… Р°РєС‚РёРІРЅРѕСЃС‚Рё</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">FruitFit РїРѕРєР°Р¶РµС‚ С€Р°РіРё Рё РєР°Р»РѕСЂРёРё РїРѕСЃР»Рµ РїРѕРґРєР»СЋС‡РµРЅРёСЏ С‚СЂРµРєРµСЂР°.</p>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onConnect?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onConnect?.();
            }
          }}
          className="mt-3 inline-flex h-8 items-center rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
        >
          РџРѕРґРєР»СЋС‡РёС‚СЊ
        </span>
      </motion.button>
    );
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-black text-appText">РђРєС‚РёРІРЅРѕСЃС‚СЊ Р·Р° РЅРµРґРµР»СЋ</h3>
        <ChevronRight size={17} className="text-appMuted" />
      </div>
      <div className="mt-3 grid grid-cols-7 items-end gap-2">
        {values.map((value, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <div className="flex h-[98px] w-full items-end rounded-full bg-appBg">
              <motion.div
                className="w-full rounded-full bg-appGreen"
                animate={{ height: `${Math.max(14, (value / Math.max(...values)) * 100)}%` }}
                transition={{ type: "spring", stiffness: 160, damping: 24 }}
              />
            </div>
            <span className="text-center text-[10px] font-semibold leading-3 text-appMuted">
              <span className="block">{days[index]?.label}</span>
              <span className="block text-[8px] text-appMuted/80">{dayDateLabel(days[index])}</span>
            </span>
          </div>
        ))}
      </div>
    </motion.button>
  );
}

function WeeklyWidgetV2({ health, onOpen, onConnect }) {
  const days = useMemo(() => buildActivityWeekForUi(health), [health]);
  const todayKey = localDateKeyFromValue(new Date());
  const todayIndex = days.findIndex((day) => day.date === todayKey);
  const [selectedIndex, setSelectedIndex] = useState(() => todayIndex >= 0 ? todayIndex : Math.max(0, days.length - 1));
  useEffect(() => {
    const nextTodayIndex = days.findIndex((day) => day.date === todayKey);
    setSelectedIndex(nextTodayIndex >= 0 ? nextTodayIndex : Math.max(0, days.length - 1));
  }, [days, todayKey]);
  const selectedDay = days[selectedIndex] || days[6] || {};
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource || hasActivityWeekSource(health) || days.some((day) => Number(day.steps || day.calories || 0) > 0));
  if (!hasData) {
    return (
      <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-black text-appText">РђРєС‚РёРІРЅРѕСЃС‚СЊ Р·Р° РЅРµРґРµР»СЋ</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">РќРµС‚ РґР°РЅРЅС‹С… Р°РєС‚РёРІРЅРѕСЃС‚Рё</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">РџРѕРґРєР»СЋС‡РёС‚Рµ Apple Health, С‡С‚РѕР±С‹ РІРёРґРµС‚СЊ РЅРµРґРµР»СЊРЅСѓСЋ РёСЃС‚РѕСЂРёСЋ.</p>
        <span
          role="button"
          tabIndex={0}
          onClick={(event) => {
            event.stopPropagation();
            onConnect?.();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onConnect?.();
            }
          }}
          className="mt-3 inline-flex h-8 items-center rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
        >
          РџРѕРґРєР»СЋС‡РёС‚СЊ
        </span>
      </motion.button>
    );
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="col-span-2 cursor-pointer rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-black text-appText">РђРєС‚РёРІРЅРѕСЃС‚СЊ Р·Р° РЅРµРґРµР»СЋ</h3>
          <p className="mt-1 text-[11px] text-appMuted">РЁР°РіРё Рё Р°РєС‚РёРІРЅС‹Рµ РєР°Р»РѕСЂРёРё</p>
        </div>
        <ChevronRight size={17} className="text-appMuted" />
      </div>
      <div className="mt-3">
        <DualMetricBarChart days={days} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appBg/70 p-2">
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">{activityDayTitle(selectedDay)}</p>
          <p className="mt-1 text-[13px] font-black text-appText">{Number(selectedDay.steps || 0).toLocaleString("ru-RU")} С€Р°РіРѕРІ</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">РђРєС‚РёРІРЅС‹Рµ</p>
          <p className="mt-1 text-[13px] font-black text-[#FF7A2F]">{Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} РєРєР°Р»</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">Р’СЃРµРіРѕ</p>
          <p className="mt-1 text-[13px] font-black text-appText">{selectedDay.totalCalories ? `${Number(selectedDay.totalCalories).toLocaleString("ru-RU")} РєРєР°Р»` : "вЂ”"}</p>
        </div>
      </div>
    </motion.div>
  );
}

function Sparkline({ values = [], color }) {
  const max = Math.max(...values, 1);
  return (
    <div className="mt-3 flex h-10 items-end gap-1.5">
      {values.map((value, index) => (
        <motion.span
          key={`${value}-${index}`}
          className="flex-1 rounded-full"
          style={{ background: color }}
          animate={{ height: `${Math.max(15, (value / max) * 100)}%` }}
          transition={{ type: "spring", stiffness: 170, damping: 20 }}
        />
      ))}
    </div>
  );
}

function compactSparklineValues(values = [], maxPoints = 7) {
  const cleanValues = values.map((value) => Number(value) || 0).filter((value) => value > 0);
  if (cleanValues.length <= maxPoints) return cleanValues;
  const bucketSize = cleanValues.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    return average(cleanValues.slice(start, end));
  });
}

function smoothSparklineValues(values = []) {
  return values.map((value, index) => {
    const previous = values[index - 1] ?? value;
    const next = values[index + 1] ?? value;
    return Math.round((previous + value + next) / 3);
  });
}

function aggregateNumberSeries(values = [], maxPoints = 24) {
  const cleanValues = values.map((value) => Number(value) || 0).filter((value) => value > 0);
  if (cleanValues.length <= maxPoints) return cleanValues;
  const bucketSize = cleanValues.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => {
    const start = Math.floor(index * bucketSize);
    const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize));
    return average(cleanValues.slice(start, end));
  });
}

function heartWeekValues(heart = {}) {
  return (heart.history7d || []).map((item) => Number(item?.avg || item?.latestBpm || item?.value || item?.bpm || 0));
}

function heartWeekLabels(heart = {}) {
  const rows = heart.history7d || [];
  if (!rows.length) return weekLabels;
  return rows.map((item, index) => item?.label || item?.day || weekLabels[index] || "");
}

function smoothPath(points = []) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const dx = point.x - previous.x;
    return `${path} C ${previous.x + dx * 0.55} ${previous.y}, ${point.x - dx * 0.55} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

function HeartSparkline({ values = [], color = "#EF4444" }) {
  const cleanValues = smoothSparklineValues(compactSparklineValues(values, 7));
  if (!cleanValues.length) return null;
  const width = 240;
  const height = 54;
  const min = Math.min(...cleanValues);
  const max = Math.max(...cleanValues);
  const range = Math.max(1, max - min);
  const points = cleanValues.map((value, index) => ({
    x: cleanValues.length === 1 ? width / 2 : (index / (cleanValues.length - 1)) * width,
    y: height - 8 - ((value - min) / range) * (height - 18),
  }));
  const linePath = smoothPath(points);
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  return (
    <div className="mt-3 h-14 overflow-hidden rounded-2xl bg-red-50/50 px-2 py-1.5">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible" preserveAspectRatio="none" aria-hidden="true">
        {[0.35, 0.68].map((line) => (
          <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="rgba(239,68,68,0.10)" strokeWidth="1" />
        ))}
        {points.length > 1 ? (
          <>
            <motion.path
              d={areaPath}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              fill="rgba(239,68,68,0.10)"
            />
            <motion.path
              d={linePath}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              fill="none"
              stroke={color}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="3.5"
            />
          </>
        ) : (
          <circle cx={points[0].x} cy={points[0].y} r="4" fill={color} />
        )}
      </svg>
    </div>
  );
}

export function LectureDetailScreen({ onBack, access }) {
  const [progress, setProgress] = useLectureProgress();
  const safeProgress = normalizeLectureProgress(progress);
  const [index, setIndex] = useState(safeProgress.currentIndex || 0);
  const [textOpen, setTextOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("");
  const [accessPolicy, setAccessPolicy] = useState(loadLectureAccessPolicy);
  const visibleLectures = visibleLecturesForAccess(lectures, access, accessPolicy);
  const safeIndex = Math.max(0, Math.min(index, Math.max(visibleLectures.length - 1, 0)));
  const activeLecture = visibleLectures[safeIndex] || lectures[0];
  const activeLectureText = lectureTextFor(activeLecture?.id);
  const [meta, setMeta] = useState({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
  const hasHostedVideo = Boolean(activeLecture?.selectelUrl);
  const lectureLocked = !canOpenLecture(activeLecture, safeIndex, access, accessPolicy);
  const completed = safeProgress.completedIds.includes(activeLecture.id);
  const totalPercent = progressForLectureState(safeProgress, visibleLectures);
  const isFreeAccess = accessTier(access) === "free";
  const showLecturePaymentCta = !lectureLocked && isFreeAccess && safeIndex === 5;

  function openFullVideo() {
    if (lectureLocked) return;
    openExternalVideo(lecturePlaybackUrl(activeLecture));
  }

  async function openLecturePayment() {
    if (paymentLoading) return;
    if (!getAuthToken()) {
      setPaymentStatus("Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РѕС‚РєСЂС‹С‚СЊ РїРѕР»РЅС‹Р№ РєСѓСЂСЃ.");
      return;
    }
    setPaymentLoading(true);
    setPaymentStatus("");
    try {
      const session = await createPaymentSession({
        productCode: "individual_program",
        recurringEnabled: false,
      });
      if (!session?.id) throw new Error("РЎРµСЂРІРµСЂ РЅРµ РІРµСЂРЅСѓР» РїР»Р°С‚С‘Р¶РЅСѓСЋ СЃРµСЃСЃРёСЋ.");
      window.location.href = paymentPageUrl(session.id);
    } catch (error) {
      setPaymentStatus(error?.message || "РќРµ СѓРґР°Р»РѕСЃСЊ РѕС‚РєСЂС‹С‚СЊ РѕРїР»Р°С‚Сѓ.");
    } finally {
      setPaymentLoading(false);
    }
  }

  function move(direction) {
    setIndex((value) => {
      const total = Math.max(1, visibleLectures.length || lectures.length);
      const nextIndex = (value + direction + total) % total;
      writeLectureProgress((state) => ({ ...state, currentIndex: nextIndex }));
      return nextIndex;
    });
    setTextOpen(false);
    setCopyStatus("РЎРєРѕРїРёСЂРѕРІР°РЅРѕ");
  }

  function markComplete() {
    if (lectureLocked) return;
    const isLast = safeIndex >= (visibleLectures.length || lectures.length) - 1;
    const next = writeLectureProgress((state) => ({
      currentIndex: isLast ? safeIndex : safeIndex + 1,
      completedIds: [...normalizeLectureProgress(state).completedIds, activeLecture.id],
    }));
    setProgress(next);
    if (!isLast) {
      setIndex(safeIndex + 1);
      setTextOpen(false);
      setCopyStatus("");
    }
  }

  async function copyLectureText() {
    if (!activeLectureText) return;
    try {
      await navigator.clipboard.writeText(activeLectureText);
    } catch (_) {
      const fallback = document.createElement("textarea");
      fallback.value = activeLectureText;
      fallback.className = "allow-select";
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.left = "-9999px";
      document.body.appendChild(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopyStatus("");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  useEffect(() => {
    let alive = true;
    fetchLectureAccessPolicy().then((policy) => {
      if (alive) setAccessPolicy(policy);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (index !== safeIndex) setIndex(safeIndex);
  }, [index, safeIndex]);

  useEffect(() => {
    setMeta({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
    if (hasHostedVideo || !activeLecture?.videoId) return undefined;
    let alive = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(activeLecture.youtubeUrl)}&format=json`;
    fetch(oEmbedUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`YouTube oEmbed ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!alive) return;
        setMeta({
          title: data.title || activeLecture.title,
          thumbnailUrl: data.thumbnail_url || activeLecture.thumbnailUrl,
          error: "",
        });
      })
      .catch((error) => {
        if (!alive) return;
        setMeta({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: error.message });
      });
    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeLecture, hasHostedVideo]);

  return (
    <main className="phone-shell min-h-screen px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+92px)]">
      <header className="fixed-shell fixed left-1/2 top-0 z-50 flex -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="РќР°Р·Р°Рґ">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Р›РµРєС†РёСЏ {safeIndex + 1} РёР· {visibleLectures.length || lectures.length}</p>
          <h1 className="line-clamp-1 text-[23px] font-black leading-tight text-appText">{activeLecture.shortTitle || activeLecture.title}</h1>
        </div>
      </header>

      <section className="overflow-hidden rounded-[28px] border border-appBorder bg-appCard/95 shadow-sm">
        <div className="bg-appDark">
          {lectureLocked ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-appCard text-appGreen">
                <Lock size={24} />
              </div>
              <div>
                <p className="text-[15px] font-black text-appText">Р›РµРєС†РёСЏ РґРѕСЃС‚СѓРїРЅР° РїРѕСЃР»Рµ РѕРїР»Р°С‚С‹</p>
                <p className="mt-1 text-[12px] font-semibold leading-5 text-appMuted">Paid Рё VIP РѕС‚РєСЂС‹РІР°СЋС‚ РІСЃРµ РјРёРЅРё-Р»РµРєС†РёРё.</p>
              </div>
            </div>
          ) : (
            <LectureVideoPlayer item={activeLecture} title={meta.title || activeLecture.title} thumbnailUrl={meta.thumbnailUrl} />
          )}
        </div>
        <div className="p-4">
          <p className="text-[12px] font-black uppercase tracking-wide text-appMuted">РџСЂРѕРіСЂРµСЃСЃ: {totalPercent}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-appBg">
            <span className="block h-full rounded-full bg-appGreen" style={{ width: `${totalPercent}%` }} />
          </div>
          <h2 className="mt-4 text-[22px] font-black leading-tight text-appText">{activeLecture.title}</h2>
          <p className="mt-2 text-[13px] font-semibold leading-5 text-appMuted">{activeLecture.subtitle}</p>
          {lectureLocked ? (
            <p className="mt-3 rounded-2xl bg-appBg px-3 py-3 text-[12px] leading-5 text-appMuted">
              Р­С‚Р° Р»РµРєС†РёСЏ Р·Р°РєСЂС‹С‚Р° РґР»СЏ Р±РµСЃРїР»Р°С‚РЅРѕРіРѕ РґРѕСЃС‚СѓРїР°. Paid Рё VIP РІРёРґСЏС‚ РІСЃРµ Р»РµРєС†РёРё.
            </p>
          ) : showLecturePaymentCta ? (
            <div className="mt-3 rounded-2xl bg-appBg px-3 py-3">
              <p className="text-[14px] font-black leading-5 text-appText">РЈ С‚РµР±СЏ РІСЃС‘ РїРѕР»СѓС‡РёС‚СЃСЏ! рџ’Є</p>
              <button
                type="button"
                onClick={openLecturePayment}
                disabled={paymentLoading}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen px-4 text-[14px] font-black text-[#181F19] disabled:opacity-70"
              >
                <CreditCard size={17} />
                {paymentLoading ? "Р“РѕС‚РѕРІРёРј РѕС„РѕСЂРјР»РµРЅРёРµ..." : "РћС„РѕСЂРјРёС‚СЊ РїРµСЂСЃРѕРЅР°Р»СЊРЅСѓСЋ РїСЂРѕРіСЂР°РјРјСѓ"}
              </button>
              {paymentStatus && <p className="mt-2 text-[12px] font-semibold leading-5 text-appMuted">{paymentStatus}</p>}
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => move(-1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              <ChevronLeft size={17} /> РќР°Р·Р°Рґ
            </button>
            <button type="button" onClick={() => move(1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              Р”Р°Р»РµРµ <ChevronRight size={17} />
            </button>
          </div>
          <button
            type="button"
            onClick={markComplete}
            disabled={lectureLocked}
            className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-black ${lectureLocked ? "bg-appBg text-appMuted" : "bg-appGreen text-[#181F19]"}`}
          >
            <CheckCircle2 size={18} /> {completed ? "РџСЂРѕР№РґРµРЅРѕ" : "РћС‚РјРµС‚РёС‚СЊ РїСЂРѕР№РґРµРЅРЅРѕР№"}
          </button>
          <button
            type="button"
            onClick={openFullVideo}
            disabled={lectureLocked}
            className={`mt-3 flex h-12 w-full items-center justify-center rounded-full text-[14px] font-black ${lectureLocked ? "bg-appBg text-appMuted" : "bg-appDark text-appGreen"}`}
          >
            РћС‚РєСЂС‹С‚СЊ РІРёРґРµРѕ
          </button>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-[24px] border border-appBorder bg-appCard">
        <button type="button" onClick={() => setTextOpen((value) => !value)} className="flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-[14px] font-black text-appText">РўРµРєСЃС‚ Р»РµРєС†РёРё</span>
          <ChevronRight size={17} className={`text-appMuted transition ${textOpen ? "rotate-90" : ""}`} />
        </button>
        {textOpen && (
          <div className="border-t border-appBorder px-4 py-3">
            {activeLectureText ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-appMuted">{activeLectureText.length.toLocaleString("ru-RU")} СЃРёРјРІРѕР»РѕРІ</span>
                  <button
                    type="button"
                    onClick={copyLectureText}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
                  >
                    <Copy size={14} /> {copyStatus || "РЎРєРѕРїРёСЂРѕРІР°С‚СЊ"}
                  </button>
                </div>
                <div className="allow-select max-h-[52vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-appBorder bg-appBg px-3 py-3 text-[12px] leading-5 text-appText">
                  {activeLectureText}
                </div>
              </>
            ) : (
              <p className="text-[12px] leading-5 text-appMuted">РўРµРєСЃС‚ Р»РµРєС†РёРё РїРѕРєР° РЅРµРґРѕСЃС‚СѓРїРµРЅ.</p>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function MetricDetail({ type, health }) {
  const [period, setPeriod] = useState("today");
  const [activeIndex, setActiveIndex] = useState(null);
  const isSteps = type === "steps";
  const metricByType = {
    steps: health.steps || {},
    calories: health.calories || {},
  };
  const metric = metricByType[type] || {};
  const color = isSteps ? "#8BBE3D" : "#FF7A2F";
  const title = isSteps ? "РЁР°РіРё" : "РљР°Р»РѕСЂРёРё";
  const unit = isSteps ? "С€Р°РіРѕРІ" : "РєРєР°Р»";

  const activityWeek = useMemo(() => buildActivityWeekForUi(health), [health]);
  const historyRows = Array.isArray(health.history7d?.[type]) ? health.history7d[type] : [];
  const hasHistoryRows = historyRows.length > 0;
  const historyValuesFromWeek = hasHistoryRows
    ? activityWeek.map((day) => Number(isSteps ? day.steps || 0 : day.activeCalories ?? day.calories ?? 0))
    : historyValues(historyRows, isSteps ? ["value", "steps"] : ["activeCalories", "calories", "value", "kcal"]);
  const sourceAvailable = Boolean(metric?.dataSource || hasHistoryRows || hasHistoryValues(historyValuesFromWeek));
  const rawWeek = Array.isArray(metric.weekRaw) ? metric.weekRaw : [];
  const rawMonth = Array.isArray(metric.monthRaw) ? metric.monthRaw : [];
  const values = period === "today"
    ? (metric.hourly || [])
    : period === "week"
      ? (hasHistoryRows ? historyValuesFromWeek : (rawWeek.length ? rawWeek : (metric.week || [])))
      : (rawMonth.length ? rawMonth : (metric.month || []));
  const todayValue = isSteps
    ? Number(metric.finalDashboardValue ?? metric.dashboardValue ?? metric.today ?? 0)
    : Number(metric.today || 0);
  const weekFallbackValue = Number(metric.detailValue || 0);
  const value = period === "today"
    ? todayValue
    : period === "week" && hasHistoryRows
      ? sum(historyValuesFromWeek)
      : period === "week" && isSteps && !hasChartData(values) && weekFallbackValue > 0
        ? weekFallbackValue
        : sum(values);
  const target = period === "today"
    ? Number(metric.goal || 0)
    : period === "week" && isSteps
      ? WEEKLY_STEPS_GOAL
      : Number(metric.goal || 0) * (period === "week" ? 7 : 30);
  const labels = period === "today"
    ? ["00", "06", "12", "18", "24"]
    : period === "week"
      ? (hasHistoryRows ? activityWeek.map((day) => day.label || dayDateLabel(day)) : weekLabels)
      : ["1", "10", "20", "30"];
  const activeValue = activeIndex === null ? null : values[Math.min(activeIndex, values.length - 1)];
  const activeLabel = activeIndex === null ? "" : (period === "today" ? `${activeIndex}:00` : labels[Math.min(activeIndex, labels.length - 1)] || `#${activeIndex + 1}`);
  const chartHasData = hasChartData(values);
  const showAggregateToday = period === "today" && !chartHasData && Number(metric.today || 0) > 0;
  const detailPercent = period === "week" && isSteps && target
    ? Math.round((Number(value || 0) / target) * 100)
    : formatPercent(value, target);

  if (!sourceAvailable) {
    return <p className="rounded-[22px] bg-appBg p-4 text-[13px] text-appMuted">{isSteps ? "РЁР°РіРё" : "РљР°Р»РѕСЂРёРё"} РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅС‹. РџСЂРѕРІРµСЂСЊС‚Рµ РїРѕРґРєР»СЋС‡РµРЅРёРµ Apple Health.</p>;
  }

  return (
    <>
      <div className="flex rounded-full bg-appBg p-1">
        {periodTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPeriod(tab.id)}
            className={`h-9 flex-1 rounded-full text-[12px] font-bold transition ${period === tab.id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-5">
        <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">{title}</p>
        <p className="mt-1 text-[44px] font-black leading-none text-appText">{value.toLocaleString("ru-RU")}</p>
        <p className="mt-2 text-[13px] text-appMuted">Р¦РµР»СЊ: {target.toLocaleString("ru-RU")} {unit} В· {detailPercent}%</p>
        <p className="mt-1 text-[12px] font-semibold text-appMuted">{friendlySourceHint(metric, type)}</p>
      </div>
      {!isSteps && (
        <div className="mt-4 grid grid-cols-1 gap-2">
          <StatPill label="РђРєС‚РёРІРЅС‹Рµ" value={`${Number(metric.activeToday ?? metric.today ?? 0).toLocaleString("ru-RU")} РєРєР°Р»`} accent />
          {Number(metric.restingToday || 0) > 0 && <StatPill label="Р‘Р°Р·РѕРІС‹Рµ / BMR" value={`${Number(metric.restingToday || 0).toLocaleString("ru-RU")} РєРєР°Р»`} />}
          {Number(metric.totalToday || 0) > 0
            ? <StatPill label="Р’СЃРµРіРѕ" value={`${Number(metric.totalToday || 0).toLocaleString("ru-RU")} РєРєР°Р»`} />
            : <ChartEmptyState>РћР±С‰РёРµ РєР°Р»РѕСЂРёРё РїРѕРєР° РЅРµ РїСЂРёС€Р»Рё РёР· Apple Health.</ChartEmptyState>}
        </div>
      )}
      <div className="mt-4">
        {showAggregateToday ? (
          <AggregateProgress
            value={metric.today}
            target={metric.goal}
            color={color}
            unit={unit}
            note={isSteps
              ? "Р—Р° СЃРµРіРѕРґРЅСЏ РµСЃС‚СЊ Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ. Р”РµС‚Р°Р»СЊРЅР°СЏ СЂР°Р·Р±РёРІРєР° РїРѕСЏРІРёС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё РёСЃС‚РѕСЂРёРё."
              : "Р—Р° СЃРµРіРѕРґРЅСЏ РµСЃС‚СЊ Р°РіСЂРµРіРёСЂРѕРІР°РЅРЅРѕРµ Р·РЅР°С‡РµРЅРёРµ РєР°Р»РѕСЂРёР№, РёСЃС‚РѕСЂРёСЏ РѕР±РЅРѕРІРёС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё."}
          />
        ) : chartHasData ? (
          <div
            className="touch-none"
            onPointerDown={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              setActiveIndex(Math.round(ratio * (values.length - 1)));
            }}
            onPointerMove={(event) => {
              if (event.buttons !== 1) return;
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
              setActiveIndex(Math.round(ratio * (values.length - 1)));
            }}
          >
            <BarChart values={values} color={color} labels={labels} />
          </div>
        ) : (
          <ChartEmptyState>{period === "today" ? "Р—Р° СЃРµРіРѕРґРЅСЏ РїРѕС‡Р°СЃРѕРІРѕР№ РёСЃС‚РѕСЂРёРё РЅРµС‚." : "Р—Р° РІС‹Р±СЂР°РЅРЅС‹Р№ РїРµСЂРёРѕРґ РёСЃС‚РѕСЂРёРё РїРѕРєР° РЅРµС‚."}</ChartEmptyState>
        )}
        {activeValue !== null && (
          <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[12px] font-bold text-appText">
            {activeLabel}: {Number(activeValue || 0).toLocaleString("ru-RU")} {unit}
          </p>
        )}
      </div>
      <MiniGuide
        title={isSteps ? "РќР° С‡С‚Рѕ РІР»РёСЏСЋС‚ С€Р°РіРё?" : "РќР° С‡С‚Рѕ РІР»РёСЏСЋС‚ РєР°Р»РѕСЂРёРё?"}
        items={isSteps
          ? ["РЁР°РіРё РїРѕРјРѕРіР°СЋС‚ РїРѕРЅСЏС‚СЊ РѕР±С‰РёР№ СѓСЂРѕРІРµРЅСЊ Р°РєС‚РёРІРЅРѕСЃС‚Рё Р·Р° РґРµРЅСЊ.", "Р•СЃР»Рё С€Р°РіРѕРІ РјР°Р»Рѕ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ СЃСЂРµРґРЅРµРµ, Р»СѓС‡С€Рµ РІС‹Р±СЂР°С‚СЊ РјСЏРіРєСѓСЋ РЅР°РіСЂСѓР·РєСѓ РёР»Рё РїСЂРѕРіСѓР»РєСѓ.", "РСЃС‚РѕСЂРёСЏ РјРѕР¶РµС‚ РѕР±РЅРѕРІРёС‚СЊСЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‡Р°СЃРѕРІ СЃ Apple Health."]
          : ["РљР°Р»РѕСЂРёРё РїРѕРјРѕРіР°СЋС‚ СЃРѕРїРѕСЃС‚Р°РІРёС‚СЊ РїРёС‚Р°РЅРёРµ, Р°РєС‚РёРІРЅРѕСЃС‚СЊ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.", "РЎРјРѕС‚СЂРёС‚Рµ РѕС‚РґРµР»СЊРЅРѕ Р°РєС‚РёРІРЅС‹Рµ Рё РѕР±С‰РёРµ РєР°Р»РѕСЂРёРё: РѕРЅРё СЃС‡РёС‚Р°СЋС‚СЃСЏ РїРѕ-СЂР°Р·РЅРѕРјСѓ.", "Р•СЃР»Рё РґР°РЅРЅС‹Рµ РІС‹РіР»СЏРґСЏС‚ СЃС‚СЂР°РЅРЅРѕ, РѕР±РЅРѕРІРёС‚Рµ Apple Health Рё РїСЂРёР»РѕР¶РµРЅРёРµ С‡Р°СЃРѕРІ."]}
      />
    </>
  );
}

function HeartDetailV2({ health, setHeartCondition }) {
  const heart = health.heart_rate || {};
  const [period, setPeriod] = useState("day");
  const rangeInfo = heartRangeInfo(heart);
  const sourceName = healthSourceDisplayName(heart.latestSourcePackage || heart.sourcePackage, heart.latestSourceName || heart.sourceName);
  const dayValues = aggregateNumberSeries(heart.hourly || [], 24);
  const weekValues = heartWeekValues(heart);
  const chartValues = period === "week" ? weekValues : dayValues;
  const chartLabels = period === "week" ? heartWeekLabels(heart) : ["00", "06", "12", "18", "24"];
  const heartOptions = ["РЅРѕСЂРјР°", "СѓСЃС‚Р°Р»РѕСЃС‚СЊ", "СЃС‚СЂРµСЃСЃ", "РїРѕСЃР»Рµ С‚СЂРµРЅРёСЂРѕРІРєРё", "РїР»РѕС…Рѕ"];
  const lastHeartTime = heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "РЅРµС‚ РґР°РЅРЅС‹С…";
  const heartAgeHours = Number(heart.latestAgeMinutes || 0) > 0 ? Math.round(Number(heart.latestAgeMinutes) / 60) : null;
  const heartStatusText = heart.freshness === "stale"
    ? "РќРѕРІС‹С… РёР·РјРµСЂРµРЅРёР№ РґР°РІРЅРѕ РЅРµ Р±С‹Р»Рѕ"
    : heart.freshness === "no_data"
      ? "РџСѓР»СЊСЃ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ"
      : "Р”Р°РЅРЅС‹Рµ РїСѓР»СЊСЃР° РґРѕСЃС‚СѓРїРЅС‹";
  const heartAdvice = heart.latestTimestamp
    ? (heartAgeHours && heartAgeHours > 4
      ? "РћС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ С‡Р°СЃРѕРІ РёР»Рё Mi Fitness/Samsung Health Рё РґРѕР¶РґРёС‚РµСЃСЊ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё СЃ Apple Health."
      : friendlyHeartHint(heart))
    : "Р Р°Р·СЂРµС€РёС‚Рµ РїСѓР»СЊСЃ РІ Apple Health Рё СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓР№С‚Рµ С‡Р°СЃС‹.";

  return (
    <>
      <div className="flex rounded-full bg-appBg p-1">
        {[
          ["day", "24 С‡Р°СЃР°"],
          ["week", "7 РґРЅРµР№"],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            className={`h-9 flex-1 rounded-full text-[12px] font-bold transition ${period === id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {hasChartData(chartValues)
          ? <LineChart values={chartValues} color="#EF4444" labels={chartLabels} />
          : <ChartEmptyState>Р“СЂР°С„РёРє РїСѓР»СЊСЃР° РїРѕРєР° РїСѓСЃС‚. Р”Р°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё.</ChartEmptyState>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label={rangeInfo.rangeTitle} value={rangeInfo.rangeLabel} accent />
        <StatPill label={rangeInfo.avgTitle} value={rangeInfo.avg > 0 ? `${rangeInfo.avg} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РџРѕСЃР»РµРґРЅРёР№" value={heart.latestBpm ? `${heart.latestBpm} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РџРѕРєРѕР№" value={heart.resting ? `${heart.resting} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РСЃС‚РѕС‡РЅРёРє" value={sourceName} />
        <StatPill label="РћР±РЅРѕРІР»РµРЅРѕ" value={heart.updatedAgoText || "РЅРµС‚ РґР°РЅРЅС‹С…"} />
      </div>

      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">РЎС‚Р°С‚СѓСЃ:</span> {heartStatusText}</p>
        <p><span className="font-black text-appText">РџРѕСЃР»РµРґРЅРµРµ РёР·РјРµСЂРµРЅРёРµ:</span> {lastHeartTime}</p>
        <p>{heartAdvice}</p>
      </div>

      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">РЎР°РјРѕС‡СѓРІСЃС‚РІРёРµ</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {heartOptions.map((item) => {
            const active = heart.condition === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setHeartCondition(item)}
                className={`min-h-10 rounded-2xl border px-3 text-[12px] font-bold transition active:scale-[0.98] ${active ? "border-appGreen bg-appGreen/30 text-appText" : "border-appBorder bg-appCard text-appMuted"}`}
              >
                {item}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">
          РћС‚РјРµС‚РєР° СЃР°РјРѕС‡СѓРІСЃС‚РІРёСЏ РїРѕРјРѕРіР°РµС‚ СЃРѕРїРѕСЃС‚Р°РІРёС‚СЊ РїСѓР»СЊСЃ, РЅР°РіСЂСѓР·РєСѓ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.
        </p>
      </div>

      <MiniGuide
        title="РќР° С‡С‚Рѕ СЃРјРѕС‚СЂРµС‚СЊ?"
        items={[
          "РЎРјРѕС‚СЂРёС‚Рµ РЅРµ С‚РѕР»СЊРєРѕ РїРѕСЃР»РµРґРЅРµРµ РёР·РјРµСЂРµРЅРёРµ, Р° РґРёР°РїР°Р·РѕРЅ Рё СЃСЂРµРґРЅРёР№ РїСѓР»СЊСЃ Р·Р° СЃСѓС‚РєРё.",
          "Р•СЃР»Рё СЃСЂРµРґРЅРёР№ РїСѓР»СЊСЃ РІС‹С€Рµ РѕР±С‹С‡РЅРѕРіРѕ, СЃРЅРёР·СЊС‚Рµ РёРЅС‚РµРЅСЃРёРІРЅРѕСЃС‚СЊ С‚СЂРµРЅРёСЂРѕРІРєРё.",
          "FruitFit СѓС‡РёС‚С‹РІР°РµС‚ РїСѓР»СЊСЃ РІ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРё РІРјРµСЃС‚Рµ СЃРѕ СЃРЅРѕРј Рё Р°РєС‚РёРІРЅРѕСЃС‚СЊСЋ.",
        ]}
      />
    </>
  );
}

function HeartDetail({ health, setHeartCondition }) {
  const heart = health.heart_rate;
  const rangeInfo = heartRangeInfo(heart);
  const sourceName = healthSourceDisplayName(heart.latestSourcePackage || heart.sourcePackage, heart.latestSourceName || heart.sourceName);
  const heartOptions = ["РЅРѕСЂРјР°", "СѓСЃС‚Р°Р»РѕСЃС‚СЊ", "СЃС‚СЂРµСЃСЃ", "РїРѕСЃР»Рµ С‚СЂРµРЅРёСЂРѕРІРєРё", "РїР»РѕС…Рѕ"];
  const lastHeartTime = heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "РЅРµС‚ РґР°РЅРЅС‹С…";
  const heartAgeHours = Number(heart.latestAgeMinutes || 0) > 0 ? Math.round(Number(heart.latestAgeMinutes) / 60) : null;
  const heartStatusText = heart.freshness === "stale"
    ? "РќРѕРІС‹С… РёР·РјРµСЂРµРЅРёР№ РґР°РІРЅРѕ РЅРµ Р±С‹Р»Рѕ"
    : heart.freshness === "no_data"
      ? "РџСѓР»СЊСЃ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ"
      : "Р”Р°РЅРЅС‹Рµ РїСѓР»СЊСЃР° РґРѕСЃС‚СѓРїРЅС‹";
  const heartAdvice = heart.latestTimestamp
    ? (heartAgeHours && heartAgeHours > 4
      ? "РћС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ С‡Р°СЃРѕРІ РёР»Рё Mi Fitness/Samsung Health Рё РґРѕР¶РґРёС‚РµСЃСЊ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё СЃ Apple Health."
      : friendlyHeartHint(heart))
    : "Р Р°Р·СЂРµС€РёС‚Рµ РїСѓР»СЊСЃ РІ Apple Health Рё СЃРёРЅС…СЂРѕРЅРёР·РёСЂСѓР№С‚Рµ С‡Р°СЃС‹.";
  return (
    <>
      {hasChartData(heart.hourly)
        ? <LineChart values={heart.hourly} color="#EF4444" />
        : <ChartEmptyState>Р“СЂР°С„РёРє РїСѓР»СЊСЃР° РїРѕРєР° РїСѓСЃС‚. Р”Р°РЅРЅС‹Рµ РїРѕСЏРІСЏС‚СЃСЏ РїРѕСЃР»Рµ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё.</ChartEmptyState>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label={rangeInfo.rangeTitle} value={rangeInfo.rangeLabel} accent />
        <StatPill label={rangeInfo.avgTitle} value={rangeInfo.avg > 0 ? `${rangeInfo.avg} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РџРѕСЃР»РµРґРЅРёР№" value={heart.latestBpm ? `${heart.latestBpm} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РџРѕРєРѕР№" value={heart.resting ? `${heart.resting} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РСЃС‚РѕС‡РЅРёРє" value={sourceName} />
        <StatPill label="РћР±РЅРѕРІР»РµРЅРѕ" value={heart.updatedAgoText || "РЅРµС‚ РґР°РЅРЅС‹С…"} />
      </div>
      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">РЎС‚Р°С‚СѓСЃ:</span> {heartStatusText}</p>
        <p><span className="font-black text-appText">РџРѕСЃР»РµРґРЅРµРµ РёР·РјРµСЂРµРЅРёРµ:</span> {lastHeartTime}</p>
        <p>{heartAdvice}</p>
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">РЎР°РјРѕС‡СѓРІСЃС‚РІРёРµ</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {heartOptions.map((item) => {
            const active = heart.condition === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setHeartCondition(item)}
                className={`min-h-10 rounded-2xl border px-3 text-[12px] font-bold transition active:scale-[0.98] ${active ? "border-appGreen bg-appGreen/30 text-appText" : "border-appBorder bg-appCard text-appMuted"}`}
              >
                {item}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">
          РћС‚РјРµС‚РєР° СЃР°РјРѕС‡СѓРІСЃС‚РІРёСЏ РїРѕРјРѕРіР°РµС‚ СЃРѕРїРѕСЃС‚Р°РІРёС‚СЊ РїСѓР»СЊСЃ, РЅР°РіСЂСѓР·РєСѓ Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.
        </p>
      </div>
      <MiniGuide
        title="РќР° С‡С‚Рѕ СЃРјРѕС‚СЂРµС‚СЊ?"
        items={[
          "РЎРјРѕС‚СЂРёС‚Рµ РЅРµ С‚РѕР»СЊРєРѕ РїРѕСЃР»РµРґРЅРµРµ РёР·РјРµСЂРµРЅРёРµ, Р° РґРёР°РїР°Р·РѕРЅ Рё СЃСЂРµРґРЅРёР№ РїСѓР»СЊСЃ Р·Р° СЃСѓС‚РєРё.",
          "Р•СЃР»Рё СЃСЂРµРґРЅРёР№ РїСѓР»СЊСЃ РІС‹С€Рµ РѕР±С‹С‡РЅРѕРіРѕ, СЃРЅРёР·СЊС‚Рµ РёРЅС‚РµРЅСЃРёРІРЅРѕСЃС‚СЊ С‚СЂРµРЅРёСЂРѕРІРєРё.",
          "FruitFit СѓС‡РёС‚С‹РІР°РµС‚ РїСѓР»СЊСЃ РІ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРё РІРјРµСЃС‚Рµ СЃРѕ СЃРЅРѕРј Рё Р°РєС‚РёРІРЅРѕСЃС‚СЊСЋ.",
        ]}
      />
    </>
  );
}

function normalizeTimeInput(value) {
  const cleaned = String(value || "").replace(/[^0-9:]/g, "").slice(0, 5);
  if (!cleaned.includes(":")) {
    if (cleaned.length <= 2) return cleaned;
    return cleaned.slice(0, 2) + ":" + cleaned.slice(2, 4);
  }
  const [rawHour = "", rawMinute = ""] = cleaned.split(":");
  return rawHour.slice(0, 2) + ":" + rawMinute.slice(0, 2);
}

function normalizeTimeOnBlur(value, fallback = "23:30") {
  const [rawHour, rawMinute] = String(value || "").split(":");
  const hour = Math.max(0, Math.min(23, Number(rawHour)));
  const minute = Math.max(0, Math.min(59, Number(rawMinute)));
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return fallback;
  return String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0");
}

function SleepTimeInput({ label, value, onChange }) {
  const [draft, setDraft] = useState(value || "");

  useEffect(() => setDraft(value || ""), [value]);

  return (
    <label className="block rounded-[18px] border border-appBorder bg-appCard p-3">
      <span className="text-[11px] font-bold uppercase text-appMuted">{label}</span>
      <input
        value={draft}
        inputMode="numeric"
        placeholder="23:30"
        maxLength={5}
        onChange={(event) => setDraft(normalizeTimeInput(event.target.value))}
        onBlur={() => {
          const next = normalizeTimeOnBlur(draft, value || "23:30");
          setDraft(next);
          onChange(next);
        }}
        className="mt-2 h-12 w-full rounded-2xl border border-appBorder bg-appBg px-3 text-center text-[26px] font-black leading-none text-appText outline-none placeholder:text-appMuted/45"
      />
      <span className="mt-2 block text-[10px] font-semibold text-appMuted">Р¤РѕСЂРјР°С‚: 23:30</span>
    </label>
  );
}

function SleepDetail({ health, updateSleepManual }) {
  const [sleep, setSleep] = useState(health.sleep);
  const [saved, setSaved] = useState(false);
  const [period, setPeriod] = useState("week");
  const source = health.sleep.dataSource === "manual" ? "Р СѓС‡РЅРѕР№ РІРІРѕРґ" : "Р”Р°РЅРЅС‹Рµ С‚СЂРµРєРµСЂР°";
  const sleepWeekValues = health.sleep.week.map((item) => item.minutes);
  const sleepValues = period === "week"
    ? sleepWeekValues
    : (health.sleep.month || []);
  const sleepLabels = period === "week" ? health.sleep.week.map((item) => item.day) : ["1", "10", "20", "30"];

  useEffect(() => setSleep(health.sleep), [health.sleep]);

  function update(key, value) {
    setSaved(false);
    setSleep((current) => ({ ...current, [key]: value }));
  }

  function saveManualSleep() {
    updateSleepManual({
      date: sleep.date || new Date().toISOString().slice(0, 10),
      bed: sleep.bed,
      wake: sleep.wake,
      quality: sleep.quality,
      notes: sleep.notes || "",
    });
    setSaved(true);
  }

  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">{source}</p>
        <p className="mt-2 text-[46px] font-black leading-none text-appText">{formatSleepDuration(health.sleep.minutes)}</p>
        <p className="mt-2 text-[13px] text-appMuted">РљР°С‡РµСЃС‚РІРѕ: {health.sleep.quality}/5</p>
      </div>
      <div className="mt-4 flex rounded-full bg-appBg p-1">
        {[["week", "РќРµРґРµР»СЏ"], ["month", "РњРµСЃСЏС†"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPeriod(id)} className={`h-9 flex-1 rounded-full text-[12px] font-bold transition ${period === id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {hasChartData(sleepValues)
          ? <BarChart values={sleepValues} color="#60A5FA" labels={sleepLabels} />
          : <ChartEmptyState>{period === "week" ? "Р—Р° РЅРµРґРµР»СЋ РёСЃС‚РѕСЂРёРё СЃРЅР° РїРѕРєР° РЅРµС‚." : "Р—Р° РјРµСЃСЏС† РёСЃС‚РѕСЂРёРё СЃРЅР° РїРѕРєР° РЅРµС‚."}</ChartEmptyState>}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <h3 className="text-[13px] font-black text-appText">Р СѓС‡РЅРѕР№ РІРІРѕРґ СЃРЅР°</h3>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р”Р°С‚Р°
          <input type="date" value={sleep.date || new Date().toISOString().slice(0, 10)} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SleepTimeInput label="РќР°С‡Р°Р»Рѕ" value={sleep.bed} onChange={(value) => update("bed", value)} />
          <SleepTimeInput label="РљРѕРЅРµС†" value={sleep.wake} onChange={(value) => update("wake", value)} />
        </div>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">РљР°С‡РµСЃС‚РІРѕ: {sleep.quality}/5
          <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
        </label>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">
          <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="РќР°РїСЂРёРјРµСЂ: РїСЂРѕСЃС‹РїР°Р»СЃСЏ, Р¶Р°СЂРєРѕ, С…РѕСЂРѕС€РёР№ СЃРѕРЅ" className="mt-1 min-h-20 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appCard p-2">
          {["Р›С‘РіРєРёР№", "Р“Р»СѓР±РѕРєРёР№", "REM"].map((phase, index) => (
            <div key={phase} className="rounded-[14px] bg-appBg px-2 py-2 text-center">
              <p className="text-[10px] font-bold text-appMuted">{phase}</p>
              <p className="mt-1 text-[13px] font-black text-appText">{[22, 56, 22][index]}%</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Р СѓС‡РЅРѕР№ СЃРѕРЅ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІ РєР°СЂС‚РѕС‡РєРµ СЃРЅР° Рё РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРё.</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Р¤Р°Р·С‹ РїРѕРєР°Р·Р°РЅС‹ С‚РѕР»СЊРєРѕ РєР°Рє РѕСЂРёРµРЅС‚РёСЂ, РµСЃР»Рё С‚СЂРµРєРµСЂ РёС… РЅРµ РїРµСЂРµРґР°Р».</p>
        <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">РЎРѕС…СЂР°РЅРёС‚СЊ СЃРѕРЅ</button>
        {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">РЎРѕРЅ СЃРѕС…СЂР°РЅС‘РЅ</p>}
      </div>
      <MiniGuide
        title="РљР°Рє РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ СЃРѕРЅ?"
        items={[
          "Р•СЃР»Рё С‚СЂРµРєРµСЂ РЅРµ Р·Р°РїРёСЃР°Р» РЅРѕС‡СЊ, РІРЅРµСЃРёС‚Рµ СЃРѕРЅ РІСЂСѓС‡РЅСѓСЋ: РѕРЅ РїРѕРїР°РґС‘С‚ РІ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.",
          "Р”СЂРµРјС‹ РїРѕРјРѕРіР°СЋС‚ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёСЋ, РЅРѕ РЅРµ Р·Р°РјРµРЅСЏСЋС‚ РїРѕР»РЅРѕС†РµРЅРЅС‹Р№ РЅРѕС‡РЅРѕР№ СЃРѕРЅ.",
        ]}
      />
    </>
  );
}

function RecoveryDetail({ health }) {
  const readiness = health.readiness;
  const recoveryStats = [
    ["РЎРѕРЅ РїСЂРѕС€Р»РѕР№ РЅРѕС‡СЊСЋ", readiness.sleepLastNightMinutes ? formatSleepDuration(readiness.sleepLastNightMinutes) : "РЅРµС‚ РґР°РЅРЅС‹С…"],
    ["РЎСЂРµРґРЅРёР№ СЃРѕРЅ 7Рґ", readiness.sleep7dAverageMinutes ? formatSleepDuration(readiness.sleep7dAverageMinutes) : "РЅРµС‚ РґР°РЅРЅС‹С…"],
    ["Р”СЂРµРјС‹", readiness.napsTodayMinutes ? formatSleepDuration(readiness.napsTodayMinutes) : "РЅРµС‚"],
    ["РџСѓР»СЊСЃ 24С‡", readiness.heartAvg24h ? `${readiness.heartRange24h?.[0] || "?"}-${readiness.heartRange24h?.[1] || "?"}` : "РЅРµС‚ РґР°РЅРЅС‹С…"],
    ["РџСѓР»СЊСЃ 7Рґ", readiness.heartAvg7d ? `${readiness.heartRange7d?.[0] || "?"}-${readiness.heartRange7d?.[1] || "?"}` : "РЅРµС‚ РґР°РЅРЅС‹С…"],
    ["РЁР°РіРё", readiness.stepsToday ? `${Number(readiness.stepsToday).toLocaleString("ru-RU")} С€Р°РіРѕРІ` : "РЅРµС‚ РґР°РЅРЅС‹С…"],
  ];
  if (readiness.score == null) {
    return (
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">РќРµРґРѕСЃС‚Р°С‚РѕС‡РЅРѕ РґР°РЅРЅС‹С…</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">
          РџСѓР»СЊСЃ: {recoveryHeartSummary(health.heart_rate)}. РЎРѕРЅ: {health.sleep?.minutes ? formatSleepDuration(health.sleep.minutes) : "РЅРµС‚ РґР°РЅРЅС‹С…"}. РЁР°РіРё: {(health.steps?.today || 0).toLocaleString("ru-RU")}.
        </p>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Р”РѕР±Р°РІСЊС‚Рµ СЃРѕРЅ РёР»Рё РґРѕР¶РґРёС‚РµСЃСЊ СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёРё С‚СЂРµРєРµСЂР°, С‡С‚РѕР±С‹ FruitFit СЂР°СЃСЃС‡РёС‚Р°Р» РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.</p>
      </div>
    );
  }
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <div className="flex items-center gap-4">
          <Ring value={readiness.score} size={112}>
            <div className="text-center">
              <p className="text-[28px] font-black leading-none text-appText">{readiness.score}%</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">РіРѕС‚РѕРІРЅРѕСЃС‚СЊ</p>
            </div>
          </Ring>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Р РµРєРѕРјРµРЅРґР°С†РёСЏ</p>
            <p className="mt-2 text-[15px] font-bold leading-5 text-appText">{readiness.recommendation}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {readiness.factors.map((factor) => (
          <div key={factor.id} className="rounded-[18px] border border-appBorder bg-appBg/70 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-black text-appText">{factor.label}</p>
              <span className="text-[11px] font-black text-appMuted">{Math.round(factor.score)}%</span>
            </div>
            <p className="mt-1 text-[12px] text-appMuted">{factor.value}</p>
            <div className="mt-2 h-1.5 rounded-full bg-appCard">
              <div className="h-full rounded-full bg-appGreen" style={{ width: `${Math.round(factor.score)}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
        <p className="text-[13px] font-black text-appText">Р”РµС‚Р°Р»Рё СЂР°СЃС‡С‘С‚Р°</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {recoveryStats.map(([label, value]) => (
            <StatPill key={label} label={label} value={value} />
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">{readiness.recommendation}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">РџРѕР»РЅРѕС‚Р° РґР°РЅРЅС‹С…: {readiness.dataCompleteness ?? 0}% В· Р°РєС‚РёРІРЅРѕСЃС‚СЊ: {readiness.activityStatus || "unknown"}</p>
      </div>
    </>
  );
}

const cycleFieldLabelClass = "block min-w-0 text-[10px] font-black uppercase leading-4 text-appMuted";
const cycleInputClass = "mt-2 h-12 min-w-0 w-full max-w-full rounded-[18px] border border-appBorder bg-appCard px-3 text-[16px] font-black leading-none text-appText outline-none";

function CycleField({ label, children }) {
  return (
    <label className={cycleFieldLabelClass}>
      <span className="block truncate">{label}</span>
      {children}
    </label>
  );
}

function CycleDetail({ health, updateCycle }) {
  const cycle = health.cycle || {};
  const [draft, setDraft] = useState({
    lastPeriodStartDate: cycle.lastPeriodStartDate || "",
    cycleLengthDays: cycle.cycleLengthDays || cycle.length || 28,
    periodLengthDays: cycle.periodLengthDays || 5,
  });
  const phaseColor = {
    menstrual: "#F87171",
    follicular: "#F9A8D4",
    ovulatory: "#5EEAD4",
    luteal: "#A78BFA",
  }[cycle.phase] || "#A78BFA";

  useEffect(() => {
    setDraft({
      lastPeriodStartDate: cycle.lastPeriodStartDate || "",
      cycleLengthDays: cycle.cycleLengthDays || cycle.length || 28,
      periodLengthDays: cycle.periodLengthDays || 5,
    });
  }, [cycle.lastPeriodStartDate, cycle.cycleLengthDays, cycle.length, cycle.periodLengthDays]);

  function updateDraft(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function saveCycle() {
    updateCycle?.({
      lastPeriodStartDate: draft.lastPeriodStartDate,
      cycleLengthDays: Number(draft.cycleLengthDays) || 28,
      periodLengthDays: Number(draft.periodLengthDays) || 5,
      lutealPhaseLengthDays: cycle.lutealPhaseLengthDays || 14,
    });
  }

  if (!cycle.configured) {
    return (
      <>
        <div className="rounded-[24px] bg-appBg p-4">
          <p className="text-[18px] font-black text-appText">Р¦РёРєР» РЅРµ РЅР°СЃС‚СЂРѕРµРЅ</p>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">Р”РѕР±Р°РІСЊС‚Рµ РґР°С‚Сѓ РЅР°С‡Р°Р»Р° РїРѕСЃР»РµРґРЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё, С‡С‚РѕР±С‹ FruitFit СЂР°СЃСЃС‡РёС‚Р°Р» РґРµРЅСЊ С†РёРєР»Р°, С„Р°Р·Сѓ Рё РѕСЂРёРµРЅС‚РёСЂРѕРІРѕС‡РЅС‹Р№ РїСЂРѕРіРЅРѕР·.</p>
        </div>
	        <div className="mt-4 grid gap-3 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
	          <CycleField label="Р”Р°С‚Р° РЅР°С‡Р°Р»Р° РїРѕСЃР»РµРґРЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё">
	            <input type="date" value={draft.lastPeriodStartDate} onChange={(event) => updateDraft("lastPeriodStartDate", event.target.value)} className={`${cycleInputClass} cycle-date-input text-center`} />
	          </CycleField>
	          <div className="grid grid-cols-2 gap-2">
	            <CycleField label="Р”Р»РёРЅР° С†РёРєР»Р°">
	              <input value={draft.cycleLengthDays} inputMode="numeric" onChange={(event) => updateDraft("cycleLengthDays", event.target.value)} className={cycleInputClass} />
	            </CycleField>
	            <CycleField label="Р”РЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё">
	              <input value={draft.periodLengthDays} inputMode="numeric" onChange={(event) => updateDraft("periodLengthDays", event.target.value)} className={cycleInputClass} />
	            </CycleField>
	          </div>
	          <button type="button" onClick={saveCycle} className="h-11 rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">РЎРѕС…СЂР°РЅРёС‚СЊ</button>
	        </div>
      </>
    );
  }

  const ovulationText = cycle.daysUntilOvulation == null
    ? `РїСЂРёРјРµСЂРЅРѕ ${cycle.ovulationDate || "РІ СЌС‚РѕРј С†РёРєР»Рµ"}`
    : cycle.daysUntilOvulation === 0
      ? "РїСЂРёРјРµСЂРЅРѕ СЃРµРіРѕРґРЅСЏ"
      : `РїСЂРёРјРµСЂРЅРѕ С‡РµСЂРµР· ${cycle.daysUntilOvulation} РґРЅ.`;
  const nextPeriodText = cycle.daysUntilNextPeriod === 0 ? "СЃРµРіРѕРґРЅСЏ" : `С‡РµСЂРµР· ${cycle.daysUntilNextPeriod} РґРЅ.`;
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <div className="flex items-center gap-4">
          <Ring value={cycle.progress || Math.round((cycle.cycleDay / cycle.cycleLengthDays) * 100)} color={phaseColor} size={98}>
            <div className="text-center">
              <p className="text-[24px] font-black leading-none text-appText">{cycle.cycleDay}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">РґРµРЅСЊ</p>
            </div>
          </Ring>
          <div>
            <p className="text-[13px] font-bold uppercase text-appMuted">Р¤Р°Р·Р°</p>
            <p className="mt-1 text-[20px] font-black text-appText">{cycle.phaseLabel}</p>
            <p className="mt-2 text-[12px] text-appMuted">РћРІСѓР»СЏС†РёСЏ {ovulationText}</p>
          </div>
        </div>
        <div className="mt-4 h-3 rounded-full bg-appCard">
          <div className="relative h-full rounded-full" style={{ width: `${cycle.progress || 0}%`, background: phaseColor }}>
            <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-appCard" style={{ background: phaseColor }} />
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-[20px] bg-appBg p-3">
        <h3 className="text-[13px] font-black text-appText">РџРѕРґСЃРєР°Р·РєР° РїРѕ РЅР°РіСЂСѓР·РєРµ</h3>
        <p className="mt-2 text-[12px] leading-5 text-appMuted">{cycle.recommendation}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">РџСЂРѕРіРЅРѕР· РѕСЂРёРµРЅС‚РёСЂРѕРІРѕС‡РЅС‹Р№ Рё Р·Р°РІРёСЃРёС‚ РѕС‚ РІРІРµРґС‘РЅРЅС‹С… РґР°РЅРЅС‹С….</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="РЎР»РµРґСѓСЋС‰Р°СЏ РјРµРЅСЃС‚СЂСѓР°С†РёСЏ" value={`${nextPeriodText}${cycle.nextPeriodDate ? ` В· ${compactDateLabel(cycle.nextPeriodDate)}` : ""}`} accent />
        <StatPill label="РћРІСѓР»СЏС†РёСЏ" value={`${ovulationText}${cycle.ovulationDate ? ` В· ${compactDateLabel(cycle.ovulationDate)}` : ""}`} />
      </div>
	      <div className="mt-4 grid gap-3 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
	        <CycleField label="Р”Р°С‚Р° РЅР°С‡Р°Р»Р° РїРѕСЃР»РµРґРЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё">
	          <input type="date" value={draft.lastPeriodStartDate} onChange={(event) => updateDraft("lastPeriodStartDate", event.target.value)} className={`${cycleInputClass} cycle-date-input text-center`} />
	        </CycleField>
	        <div className="grid grid-cols-2 gap-2">
	          <CycleField label="Р”Р»РёРЅР° С†РёРєР»Р°">
	            <input value={draft.cycleLengthDays} inputMode="numeric" onChange={(event) => updateDraft("cycleLengthDays", event.target.value)} className={cycleInputClass} />
	          </CycleField>
	          <CycleField label="Р”РЅРµР№ РјРµРЅСЃС‚СЂСѓР°С†РёРё">
	            <input value={draft.periodLengthDays} inputMode="numeric" onChange={(event) => updateDraft("periodLengthDays", event.target.value)} className={cycleInputClass} />
	          </CycleField>
	        </div>
	        <button type="button" onClick={saveCycle} className="h-11 rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">РЎРѕС…СЂР°РЅРёС‚СЊ РЅР°СЃС‚СЂРѕР№РєРё С†РёРєР»Р°</button>
	      </div>
    </>
  );
}

function WeeklyDetail({ health }) {
  const week = useMemo(() => buildActivityWeekForUi(health), [health]);
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource || hasActivityWeekSource(health) || week.some((item) => Number(item.steps || item.calories || 0) > 0));

  if (!hasData) {
    return (
      <div className="rounded-[22px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">РќРµС‚ РґР°РЅРЅС‹С… Р°РєС‚РёРІРЅРѕСЃС‚Рё</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">РџРѕРґРєР»СЋС‡РёС‚Рµ Apple Health, С‡С‚РѕР±С‹ FruitFit РїРѕРєР°Р·Р°Р» РёСЃС‚РѕСЂРёСЋ Р·Р° РЅРµРґРµР»СЋ.</p>
      </div>
    );
  }

  const totalSteps = sum(week.map((item) => item.steps));
  const totalCalories = sum(week.map((item) => item.calories));
  const avgSteps = average(week.map((item) => item.steps));
  const activeDays = week.filter((item) => item.steps >= 7000).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <StatPill label="РЁР°РіРё Р·Р° РЅРµРґРµР»СЋ" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="РљР°Р»РѕСЂРёРё" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="РЎСЂРµРґРЅРёРµ С€Р°РіРё" value={avgSteps.toLocaleString("ru-RU")} />
        <StatPill label="РђРєС‚РёРІРЅС‹Рµ РґРЅРё" value={`${activeDays}/7`} />
      </div>
      <div className="mt-4">
        <BarChart values={week.map((item) => item.steps)} color="#8BBE3D" labels={week.map((item) => item.label)} />
      </div>
      <div className="mt-4">
        <BarChart values={week.map((item) => item.calories)} color="#FF7A2F" labels={week.map((item) => item.label)} />
      </div>
    </>
  );
}

function ManualSleepSection({ health, updateSleepManual, selectedDate }) {
  const currentSleep = health.sleep || {};
  const [sleep, setSleep] = useState({
    date: selectedDate || currentSleep.date || localDateKeyFromValue(new Date()),
    bed: currentSleep.bed || "23:00",
    wake: currentSleep.wake || "07:00",
    sleepKind: currentSleep.sleepKind || "night",
    quality: currentSleep.quality || 4,
    notes: currentSleep.notes || "",
  });
  const [saved, setSaved] = useState(false);
  const existingManualEntry = useMemo(() => {
    const date = sleep.date || localDateKeyFromValue(new Date());
    return (currentSleep.manualSleepEntries || []).find((entry) => sleepEntryDateKey(entry) === date) || null;
  }, [currentSleep.manualSleepEntries, sleep.date]);

  useEffect(() => {
    const date = selectedDate || currentSleep.date || localDateKeyFromValue(new Date());
    const entry = (currentSleep.manualSleepEntries || []).find((item) => sleepEntryDateKey(item) === date) || null;
    setSleep({
      date,
      bed: entry ? localTimeInputValue(entry.start, currentSleep.bed || "23:00") : (currentSleep.bed || "23:00"),
      wake: entry ? localTimeInputValue(entry.end, currentSleep.wake || "07:00") : (currentSleep.wake || "07:00"),
      sleepKind: entry?.sleepKind || currentSleep.sleepKind || "night",
      quality: entry?.quality || currentSleep.quality || 4,
      notes: entry?.notes || entry?.comment || currentSleep.notes || "",
    });
  }, [currentSleep.bed, currentSleep.date, currentSleep.manualSleepEntries, currentSleep.notes, currentSleep.quality, currentSleep.sleepKind, currentSleep.wake, selectedDate]);

  function update(key, value) {
    setSaved(false);
    setSleep((current) => ({ ...current, [key]: value }));
  }

  function saveManualSleep() {
    if (existingManualEntry && typeof window !== "undefined") {
      const confirmed = window.confirm("Р—Р° СЌС‚РѕС‚ РґРµРЅСЊ СѓР¶Рµ РµСЃС‚СЊ Р·Р°РїРёСЃСЊ СЃРЅР°. Р—Р°РјРµРЅРёС‚СЊ РµС‘?");
      if (!confirmed) return;
    }
    updateSleepManual?.({
      date: sleep.date || new Date().toISOString().slice(0, 10),
      bed: sleep.bed,
      wake: sleep.wake,
      sleepKind: sleep.sleepKind,
      type: sleep.sleepKind,
      quality: Number(sleep.quality || 4),
      notes: sleep.notes || "",
      comment: sleep.notes || "",
    });
    setSaved(true);
  }

  return (
    <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
      <h3 className="text-[13px] font-black text-appText">{existingManualEntry ? "РР·РјРµРЅРёС‚СЊ Р·Р°РїРёСЃСЊ СЃРЅР°" : "Р”РѕР±Р°РІРёС‚СЊ СЃРѕРЅ"}</h3>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р”Р°С‚Р°
        <input type="date" value={sleep.date} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SleepTimeInput label="РќР°С‡Р°Р»Рѕ" value={sleep.bed} onChange={(value) => update("bed", value)} />
        <SleepTimeInput label="РљРѕРЅРµС†" value={sleep.wake} onChange={(value) => update("wake", value)} />
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">РљР°С‡РµСЃС‚РІРѕ: {sleep.quality}/5
        <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
      </label>
      <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="РљРѕРјРјРµРЅС‚Р°СЂРёР№" className="mt-3 min-h-16 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
      <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">{existingManualEntry ? "РР·РјРµРЅРёС‚СЊ Р·Р°РїРёСЃСЊ" : "РЎРѕС…СЂР°РЅРёС‚СЊ СЃРѕРЅ"}</button>
      {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">РЎРѕРЅ СЃРѕС…СЂР°РЅС‘РЅ</p>}
    </div>
  );
}

function SleepDetailV2({ health, updateSleepManual }) {
  const sleep = health.sleep || {};
  const sleepDays = buildSleepDays(sleep);
  const lastDataIndex = sleepDays.map((day) => day.totalMinutes > 0).lastIndexOf(true);
  const [selectedIndex, setSelectedIndex] = useState(lastDataIndex >= 0 ? lastDataIndex : 6);
  useEffect(() => {
    if (lastDataIndex >= 0) setSelectedIndex(lastDataIndex);
  }, [lastDataIndex]);
  const selectedDay = sleepDays[selectedIndex] || sleepDays[6];
  const selectedSourceLabel = sleepDaySourceLabel(selectedDay, sleep);
  const selectedWarning = sleepDuplicateWarning(selectedDay?.totalMinutes || sleep.minutes || 0);
  const weekTotal = sleepDays.reduce((total, day) => total + Number(day.totalMinutes || 0), 0);
  const nightTotal = sleepDays.reduce((total, day) => total + Number(day.nightMinutes || 0), 0);
  const napTotal = sleepDays.reduce((total, day) => total + Number(day.napMinutes || 0), 0);
  const nightsWithData = sleepDays.filter((day) => Number(day.nightMinutes || 0) > 0);
  const avgNight7d = nightsWithData.length
    ? Math.round(nightsWithData.reduce((total, day) => total + Number(day.nightMinutes || 0), 0) / nightsWithData.length)
    : 0;
  const manualQuality = Number(sleep.quality || 0) || null;
  if (!weekTotal && !sleep.minutes) {
    return (
      <>
        <div className="rounded-[22px] bg-appBg p-4">
          <p className="text-[18px] font-black text-appText">РЎРѕРЅ РїРѕРєР° РЅРµ РЅР°Р№РґРµРЅ</p>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">Apple Health РЅРµ РїРµСЂРµРґР°Р» Р·Р°РїРёСЃРё СЃРЅР°. РњРѕР¶РЅРѕ РІРЅРµСЃС‚Рё СЃРѕРЅ РІСЂСѓС‡РЅСѓСЋ.</p>
        </div>
        <ManualSleepSection health={health} updateSleepManual={updateSleepManual} selectedDate={sleepDays[6]?.date || sleepDays[6]?.key} />
      </>
    );
  }
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">РСЃС‚РѕС‡РЅРёРє: {selectedSourceLabel}</p>
        <p className="mt-2 text-[42px] font-black leading-none text-appText">{formatSleepDuration(selectedDay?.totalMinutes || sleep.minutes || 0)}</p>
        {selectedWarning && <p className="mt-2 rounded-2xl bg-amber-100 px-3 py-2 text-[11px] font-black text-amber-700">{selectedWarning}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="РќРѕС‡РЅРѕР№ СЃРѕРЅ" value={formatSleepDuration(nightTotal)} accent />
          <StatPill label="Р”СЂРµРјС‹" value={formatSleepDuration(napTotal)} />
        </div>
      </div>
      {nightTotal <= 0 && napTotal > 0 && <p className="mt-3 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">РќРѕС‡РЅРѕР№ СЃРѕРЅ РЅРµ РЅР°Р№РґРµРЅ. Р•СЃС‚СЊ С‚РѕР»СЊРєРѕ РґСЂРµРјС‹ РёР»Рё РєРѕСЂРѕС‚РєРёРµ С„СЂР°РіРјРµРЅС‚С‹.</p>}
      <SleepDayBars days={sleepDays} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      <SleepStageBreakdown day={selectedDay} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="РЎРѕРЅ РїСЂРѕС€Р»РѕР№ РЅРѕС‡Рё" value={formatSleepDuration(selectedDay?.nightMinutes || sleep.nightMinutes || 0)} accent />
        <StatPill label="РЎСЂРµРґРЅРёР№ СЃРѕРЅ 7Рґ" value={avgNight7d ? formatSleepDuration(avgNight7d) : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="Р”СЂРµРјС‹ Р·Р° РЅРµРґРµР»СЋ" value={formatSleepDuration(napTotal)} />
        <StatPill label="РљР°С‡РµСЃС‚РІРѕ" value={manualQuality ? `${manualQuality}/5` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
      </div>
      <ManualSleepSection health={health} updateSleepManual={updateSleepManual} selectedDate={selectedDay?.date || selectedDay?.key} />
    </>
  );
}

function WeeklyDetailV2({ health }) {
  const week = useMemo(() => buildActivityWeekForUi(health), [health]);
  const todayKey = localDateKeyFromValue(new Date());
  const todayIndex = week.findIndex((day) => day.date === todayKey);
  const [selectedIndex, setSelectedIndex] = useState(() => todayIndex >= 0 ? todayIndex : Math.max(0, week.length - 1));
  useEffect(() => {
    const nextTodayIndex = week.findIndex((day) => day.date === todayKey);
    setSelectedIndex(nextTodayIndex >= 0 ? nextTodayIndex : Math.max(0, week.length - 1));
  }, [todayKey, week]);
  const selectedDay = week[selectedIndex] || week[6] || {};
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource || hasActivityWeekSource(health) || week.some((item) => Number(item.steps || item.calories || 0) > 0));

  if (!hasData) {
    return (
      <div className="rounded-[22px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">РќРµС‚ РґР°РЅРЅС‹С… Р°РєС‚РёРІРЅРѕСЃС‚Рё</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">РџРѕРґРєР»СЋС‡РёС‚Рµ Apple Health, С‡С‚РѕР±С‹ FruitFit РїРѕРєР°Р·Р°Р» РЅРµРґРµР»СЊРЅСѓСЋ РёСЃС‚РѕСЂРёСЋ.</p>
      </div>
    );
  }

  const totalSteps = sum(week.map((item) => item.steps));
  const totalCalories = sum(week.map((item) => item.activeCalories ?? item.calories));
  const totalAllCalories = sum(week.map((item) => item.totalCalories));
  const avgSteps = average(week.map((item) => item.steps));

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <StatPill label="РЁР°РіРё Р·Р° РЅРµРґРµР»СЋ" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="РђРєС‚РёРІРЅС‹Рµ РєРєР°Р»" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Р’СЃРµРіРѕ РєРєР°Р»" value={totalAllCalories ? totalAllCalories.toLocaleString("ru-RU") : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="РЎСЂРµРґРЅРёРµ С€Р°РіРё" value={avgSteps.toLocaleString("ru-RU")} />
      </div>
      <div className="mt-4">
        <DualMetricBarChart days={week} selectedIndex={selectedIndex} onSelect={setSelectedIndex} height={154} />
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
        <p className="text-[12px] font-black uppercase text-appMuted">{activityDayTitle(selectedDay)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="РЁР°РіРё" value={Number(selectedDay.steps || 0).toLocaleString("ru-RU")} accent />
          <StatPill label="РђРєС‚РёРІРЅС‹Рµ РєРєР°Р»" value={Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} />
          <StatPill label="Р’СЃРµРіРѕ РєРєР°Р»" value={selectedDay.totalCalories ? Number(selectedDay.totalCalories).toLocaleString("ru-RU") : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
          <StatPill label="Р”РёСЃС‚Р°РЅС†РёСЏ" value={selectedDay.distance ? `${selectedDay.distance} Рј` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
          <StatPill label="РџСѓР»СЊСЃ" value={selectedDay.heart ? `${selectedDay.heart} СѓРґ/РјРёРЅ` : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        </div>
        {selectedDay.suspicious && <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-500">Р­С‚РѕС‚ РґРµРЅСЊ РїРѕРјРµС‡РµРЅ РєР°Рє РїРѕРґРѕР·СЂРёС‚РµР»СЊРЅС‹Р№ Рё РЅРµ РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РґР»СЏ РјР°СЃС€С‚Р°Р±Р° РіСЂР°С„РёРєР°.</p>}
      </div>
    </>
  );
}

function openWidgetFromKeyboard(event, onOpen) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  onOpen?.();
}

function DashboardRefreshButton({ onRefresh }) {
  if (!onRefresh) return null;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRefresh();
      }}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-appBg text-appMuted shadow-sm transition active:scale-95"
      aria-label="РћР±РЅРѕРІРёС‚СЊ РґР°РЅРЅС‹Рµ Apple Health"
    >
      <RefreshCcw size={14} />
    </button>
  );
}

export function HealthDetailScreen({ type, onBack }) {
  const { health, setHeartCondition, updateSleepManual, updateCycle, syncNativeHealth, syncing, syncError } = useHealth();
  const [refreshNote, setRefreshNote] = useState("");
  const titles = {
    heart: "РџСѓР»СЊСЃ",
    steps: "РЁР°РіРё",
    calories: "РљР°Р»РѕСЂРёРё",
    sleep: "РЎРѕРЅ",
    recovery: "Р’РѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ",
    cycle: "Р¦РёРєР»",
    weekly: "РђРєС‚РёРІРЅРѕСЃС‚СЊ",
  };
  const refreshMs = type === "heart" ? 2 * 60 * 1000 : type === "sleep" ? 20 * 60 * 1000 : 4 * 60 * 1000;
  const detailQueryMode = type === "cycle" ? "dashboard" : "history";

  useEffect(() => {
    syncNativeHealth?.({ reason: `detail-${type}-auto`, queryMode: detailQueryMode });
    const id = window.setInterval(() => syncNativeHealth?.({ reason: `detail-${type}-auto`, queryMode: detailQueryMode }), refreshMs);
    return () => window.clearInterval(id);
  }, [detailQueryMode, refreshMs, syncNativeHealth, type]);

  async function handleRefresh() {
    setRefreshNote("");
    const result = await syncNativeHealth?.({ force: true, reason: `detail-${type}`, queryMode: detailQueryMode });
    setRefreshNote(result?.message ? "Р”Р°РЅРЅС‹Рµ СЃРєРѕСЂРѕ РѕР±РЅРѕРІСЏС‚СЃСЏ" : "РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ РїСЂРѕРІРµСЂРµРЅР°");
  }

  return (
    <main className="phone-shell min-h-screen px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+92px)]">
      <header className="fixed-shell fixed left-1/2 top-0 z-50 flex -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="РќР°Р·Р°Рґ">
          <ChevronLeft size={22} />
        </button>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Apple Health</p>
          <h1 className="text-[24px] font-black leading-tight text-appText">{titles[type] || "Р”РµС‚Р°Р»Рё"}</h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={syncing}
          className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-appCard text-appMuted shadow-sm disabled:opacity-50"
          aria-label="РћР±РЅРѕРІРёС‚СЊ РґР°РЅРЅС‹Рµ"
        >
          <RefreshCcw size={17} className={syncing ? "animate-spin" : ""} />
        </button>
      </header>

      <section className="rounded-[28px] border border-appBorder bg-appCard/95 p-4 shadow-sm">
        <p className="mb-3 rounded-2xl bg-appBg/70 px-3 py-2 text-[11px] font-semibold text-appMuted">
          РЎРёРЅС…СЂРѕРЅРёР·Р°С†РёСЏ: {health.lastFruitFitRefreshAt ? new Date(health.lastFruitFitRefreshAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "РґР°РЅРЅС‹Рµ СЃРєРѕСЂРѕ РїРѕСЏРІСЏС‚СЃСЏ"}
          {refreshNote ? ` В· ${refreshNote}` : ""}
        </p>
        {syncError && <p className="mb-3 rounded-2xl border border-appBorder bg-appBg/80 px-3 py-2 text-[11px] font-bold text-appMuted">Р”Р°РЅРЅС‹Рµ СЃРєРѕСЂРѕ РѕР±РЅРѕРІСЏС‚СЃСЏ. РџСЂРѕРІРµСЂСЊС‚Рµ, С‡С‚Рѕ С‚СЂРµРєРµСЂ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°Р»СЃСЏ СЃ Apple Health.</p>}
        {type === "heart" && <HeartDetailV2 health={health} setHeartCondition={setHeartCondition} />}
        {type === "steps" && <MetricDetail type="steps" health={health} />}
        {type === "calories" && <MetricDetail type="calories" health={health} />}
        {type === "sleep" && <SleepDetailV2 health={health} updateSleepManual={updateSleepManual} />}
        {type === "recovery" && <RecoveryDetail health={health} />}
        {type === "cycle" && <CycleDetail health={health} updateCycle={updateCycle} />}
        {type === "weekly" && <WeeklyDetailV2 health={health} />}
      </section>
    </main>
  );
}

export default function WidgetGrid({ profile, access, onNavigate }) {
  const { health, requestConnection, syncNativeHealth } = useHealth();
  const { widgets, visible, commit, cycleAvailable } = useWidgetConfig(profile);
  const [editMode, setEditMode] = useState(false);

  function toggle(id) {
    if (id === "cycle" && !cycleAvailable) return;
    commit(widgets.map((widget) => widget.id === id ? { ...widget, enabled: !widget.enabled } : widget));
  }

  function move(id, direction) {
    const ordered = [...widgets].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((widget) => widget.id === id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    commit(ordered);
  }

  useEffect(() => {
    syncNativeHealth?.({ reason: "dashboard-auto-history7d", queryMode: WEEKLY_ACTIVITY_QUERY_MODE });
  }, [syncNativeHealth]);

  function render(widget) {
    switch (widget.type) {
      case "lecture":
        return <MiniLectureWidget key={widget.id} access={access} onOpen={() => onNavigate?.("lecture")} />;
      case "nutrition":
        return <NutritionWidget key={widget.id} profile={profile} onOpen={() => onNavigate?.("food")} />;
      case "heart":
        return <HeartWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:heart")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-heart", queryMode: "dashboard" })} />;
      case "steps":
        return <MetricWidget key={widget.id} kind="steps" status={health.steps.status} title="РЁР°РіРё" icon={Footprints} value={health.steps.today} target={health.steps.goal} color="#8BBE3D" suffix="С€Р°РіРѕРІ" sourceNote={friendlySourceHint(health.steps, "steps")} onOpen={() => onNavigate?.("health:steps")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-steps-history7d", queryMode: WEEKLY_ACTIVITY_QUERY_MODE })} />;
      case "calories":
        return <MetricWidget key={widget.id} kind="calories" status={health.calories.status} title="РљР°Р»РѕСЂРёРё" icon={Flame} value={health.calories.today} target={health.calories.goal} color="#FF7A2F" suffix="РєРєР°Р»" sourceNote={friendlySourceHint(health.calories, "calories")} onOpen={() => onNavigate?.("health:calories")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-calories-history7d", queryMode: WEEKLY_ACTIVITY_QUERY_MODE })} />;
      case "sleep":
        return <SleepWidgetV2 key={widget.id} health={health} onOpen={() => onNavigate?.("health:sleep")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-sleep", queryMode: "dashboard" })} />;
      case "recovery":
        return <RecoveryWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:recovery")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-recovery", queryMode: "dashboard" })} />;
      case "cycle":
        return <CycleWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:cycle")} />;
      case "weekly":
        return <WeeklyWidgetV2 key={widget.id} health={health} onOpen={() => onNavigate?.("health:weekly")} onConnect={requestConnection} />;
      default:
        return null;
    }
  }

  return (
    <>
      <div className="mt-4 flex justify-end">
        <button type="button" onClick={() => setEditMode((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-appCard/90 px-3 text-[12px] font-bold text-appMuted shadow-sm">
        <SlidersHorizontal size={14} /> {editMode ? "Р“РѕС‚РѕРІРѕ" : "РќР°СЃС‚СЂРѕР№РєР° РІРёРґР¶РµС‚РѕРІ"}
        </button>
      </div>

      {editMode && (
        <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 space-y-2 rounded-[22px] border border-appBorder bg-appCard/92 p-3 shadow-sm">
          {[...widgets].filter((widget) => cycleAvailable || widget.type !== "cycle").sort((a, b) => a.order - b.order).map((widget) => {
            const disabled = widget.type === "cycle" && !cycleAvailable;
            return (
              <div key={widget.id} className={`grid grid-cols-[1fr_32px_32px_72px] items-center gap-1 rounded-2xl p-1 ${disabled ? "opacity-55" : ""}`}>
                <div className="min-w-0">
                  <span className="block truncate text-[12px] font-bold text-appText">{widget.title}</span>
                  {disabled && <span className="block truncate text-[10px] text-appMuted">Р”РѕСЃС‚СѓРїРЅРѕ РґР»СЏ Р¶РµРЅСЃРєРѕРіРѕ РїСЂРѕС„РёР»СЏ</span>}
                </div>
                <button type="button" onClick={() => move(widget.id, -1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowUp size={13} /></button>
                <button type="button" onClick={() => move(widget.id, 1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowDown size={13} /></button>
                <button type="button" disabled={disabled} onClick={() => toggle(widget.id)} className={`h-8 rounded-full px-2 text-[11px] font-bold ${widget.enabled && !disabled ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appMuted"}`}>
                  {widget.enabled && !disabled ? "Р’РєР»" : "Р’С‹РєР»"}
                </button>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => commit(defaultWidgets)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appBg text-[12px] font-bold text-appMuted">
              <RefreshCcw size={13} /> РЎР±СЂРѕСЃРёС‚СЊ
            </button>
            <button type="button" onClick={() => setEditMode(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
              <CheckCircle2 size={14} /> Р“РѕС‚РѕРІРѕ
            </button>
          </div>
        </motion.div>
      )}

      <section className="mt-3 grid grid-cols-2 gap-3">
        {visible.map(render)}
      </section>
    </>
  );
}
