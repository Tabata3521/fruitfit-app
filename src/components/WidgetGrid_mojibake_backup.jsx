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
  Flame,
  Footprints,
  Heart,
  Moon,
  Play,
  RefreshCcw,
  SlidersHorizontal,
  Utensils,
} from "lucide-react";
import NeutralPreview from "./NeutralPreview";
import { useHealth, formatSleepDuration } from "../data/healthStore";
import { lecturePlaybackUrl, lectures } from "../data/lectures";
import { lectureTextFor } from "../data/lectureTexts";
import { dietTypeToRation } from "../data/profileStore";
import { getMealPlan, useNutritionData } from "../data/useNutritionData";

const widgetStorageKey = "fruitfit.widgets";
const lectureProgressKey = "fruitfit.lectureProgress.v1";

const lecture = lectures[0];

function readLectureProgress() {
  try {
    const saved = JSON.parse(localStorage.getItem(lectureProgressKey) || "null");
    const completedIds = Array.isArray(saved?.completedIds) ? saved.completedIds.filter(Boolean) : [];
    const currentIndex = Math.max(0, Math.min(lectures.length - 1, Number(saved?.currentIndex || 0)));
    return { currentIndex, completedIds };
  } catch (_) {
    return { currentIndex: 0, completedIds: [] };
  }
}

function saveLectureProgress(next) {
  localStorage.setItem(lectureProgressKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("fruitfit:lecture-progress", { detail: next }));
}

function useLectureProgress() {
  const [progress, setProgress] = useState(readLectureProgress);
  useEffect(() => {
    function sync(event) {
      setProgress(event?.detail || readLectureProgress());
    }
    window.addEventListener("fruitfit:lecture-progress", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("fruitfit:lecture-progress", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return [progress, setProgress];
}

function writeLectureProgress(update) {
  const previous = readLectureProgress();
  const next = typeof update === "function" ? update(previous) : update;
  const normalized = {
    currentIndex: Math.max(0, Math.min(lectures.length - 1, Number(next.currentIndex || 0))),
    completedIds: Array.from(new Set(next.completedIds || [])).filter(Boolean),
  };
  saveLectureProgress(normalized);
  return normalized;
}

function progressForLectureState(progress) {
  const completedCount = progress.completedIds.length;
  return Math.min(100, Math.round((completedCount / Math.max(1, lectures.length)) * 100));
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
          <a href="${safeEmbed}" aria-label="Р вЂ™Р С•РЎРѓР С—РЎР‚Р С•Р С‘Р В·Р Р†Р ВµРЎРѓРЎвЂљР С‘ Р Р†Р С‘Р Т‘Р ВµР С•: ${safeTitle}">
            <img src="${safeThumb}" alt="" />
            <span class="shade"></span>
            <span class="play"></span>
            <span class="caption">Р СњР В°Р В¶Р СР С‘РЎвЂљР Вµ Play, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р С•РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р С—Р В»Р ВµР ВµРЎР‚ Р Р†Р Р…РЎС“РЎвЂљРЎР‚Р С‘ Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘РЎРЏ</span>
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
  { id: "lecture", title: "Р СљР С‘Р Р…Р С‘-Р В»Р ВµР С”РЎвЂ Р С‘РЎРЏ", type: "lecture", enabled: true, order: 1, dataSource: "content", fallbackState: "Р СњР ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦" },
  { id: "nutrition", title: "Р СџР С‘РЎвЂљР В°Р Р…Р С‘Р Вµ", type: "nutrition", enabled: true, order: 2, dataSource: "csv", fallbackState: "Р СњР ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦" },
  { id: "heart", title: "Р СџРЎС“Р В»РЎРЉРЎРѓ", type: "heart", enabled: true, order: 3, dataSource: "tracker", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
  { id: "steps", title: "Р РЃР В°Р С–Р С‘", type: "steps", enabled: true, order: 4, dataSource: "tracker", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
  { id: "calories", title: "Р С™Р В°Р В»Р С•РЎР‚Р С‘Р С‘", type: "calories", enabled: true, order: 5, dataSource: "tracker", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
  { id: "sleep", title: "Р РЋР С•Р Р…", type: "sleep", enabled: true, order: 6, dataSource: "tracker/manual", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
  { id: "recovery", title: "Р вЂ™Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ", type: "recovery", enabled: true, order: 7, dataSource: "tracker/manual", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
  { id: "cycle", title: "Р В¦Р С‘Р С”Р В»", type: "cycle", enabled: true, order: 8, dataSource: "manual", fallbackState: "Р СњР ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦" },
  { id: "weekly", title: "Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹", type: "weekly", enabled: true, order: 9, dataSource: "tracker", fallbackState: "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…" },
];

const periodTabs = [
  { id: "today", label: "Р РЋР ВµР С–Р С•Р Т‘Р Р…РЎРЏ" },
  { id: "week", label: "Р СњР ВµР Т‘Р ВµР В»РЎРЏ" },
  { id: "month", label: "Р СљР ВµРЎРѓРЎРЏРЎвЂ " },
];

const weekLabels = ["Р СџР Р…", "Р вЂ™РЎвЂљ", "Р РЋРЎР‚", "Р В§РЎвЂљ", "Р СџРЎвЂљ", "Р РЋР В±", "Р вЂ™РЎРѓ"];

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
        setWidgets(defaultWidgets.map((widget) => ({
          ...widget,
          ...(saved.find((item) => item.id === widget.id) || {}),
        })));
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

function LineChart({ values = [], color = "#EF4444", height = 132 }) {
  const cleanValues = values.map((value) => Number(value) || 0).filter((value) => value > 0);
  const min = Math.min(...cleanValues, 0);
  const max = Math.max(...cleanValues, 1);
  const width = 320;
  const range = Math.max(1, max - min);
  const points = cleanValues.map((value, index) => {
    const x = cleanValues.length === 1 ? width / 2 : (index / (cleanValues.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 18) - 9;
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="rounded-[22px] border border-appBorder bg-appBg/70 p-3">
      <div className="mb-2 flex justify-between text-[10px] font-semibold text-appMuted">
        <span>{max} РЎС“Р Т‘/Р СР С‘Р Р…</span>
        <span>{Math.round((min + max) / 2)}</span>
        <span>{min}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[132px] w-full overflow-visible">
        {[0.25, 0.5, 0.75].map((line) => (
          <line key={line} x1="0" x2={width} y1={height * line} y2={height * line} stroke="rgba(115,124,116,0.16)" strokeWidth="1" />
        ))}
        {cleanValues.length > 1 ? (
          <motion.polyline
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
            points={points}
          />
        ) : (
          <circle cx={width / 2} cy={height / 2} r="6" fill={color} />
        )}
      </svg>
      <div className="mt-2 flex justify-between text-[10px] font-semibold text-appMuted">
        <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
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
    day: days[0] || "Р СџР С•Р Р…Р ВµР Т‘Р ВµР В»РЎРЉР Р…Р С‘Р С”",
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
            <Utensils size={15} className="text-appOrange" /> Р СџР С‘РЎвЂљР В°Р Р…Р С‘Р Вµ
          </span>
          {loading ? (
            <div className="mt-3 h-14 w-36 animate-pulse rounded-2xl bg-white/60" />
          ) : (
            <>
              <p className="mt-3 text-[25px] font-black text-[#181F19]">{totals.calories || caloriesTarget} <span className="text-[12px] font-semibold">Р С”Р С”Р В°Р В»</span></p>
              <p className="mt-1 text-[12px] text-[#5f675f]">Р вЂ {totals.protein || 0} / Р вЂ“ {totals.fat || 0} / Р Р€ {totals.carbs || 0}</p>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-appOrange">{filters.ration || "Р В Р В°РЎвЂ Р С‘Р С•Р Р… Р С—Р С•Р Т‘Р С•Р В±РЎР‚Р В°Р Р…"}</p>
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

function MiniLectureWidget({ onOpen }) {
  const [progress] = useLectureProgress();
  const currentLecture = lectures[progress.currentIndex] || lecture;
  const completed = progress.completedIds.length >= lectures.length;
  const percent = progressForLectureState(progress);
  const cta = completed ? "Р СџР ВµРЎР‚Р ВµРЎРѓР СР С•РЎвЂљРЎР‚Р ВµРЎвЂљРЎРЉ" : progress.completedIds.length ? "Р СџРЎР‚Р С•Р Т‘Р С•Р В»Р В¶Р С‘РЎвЂљРЎРЉ" : "Р СњР В°РЎвЂЎР В°РЎвЂљРЎРЉ";
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="col-span-2 grid grid-cols-[1fr_112px] gap-3 rounded-[22px] border border-appBorder bg-appCard/90 p-3 text-left shadow-sm"
    >
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold text-appMuted">
          <BookOpen size={14} /> Р вЂєР ВµР С”РЎвЂ Р С‘РЎРЏ {progress.currentIndex + 1} Р С‘Р В· {lectures.length}
        </span>
        <h3 className="mt-2 line-clamp-2 text-[15px] font-black leading-tight text-appText">{currentLecture.shortTitle || currentLecture.title}</h3>
        <p className="mt-2 text-[11px] text-appMuted">{completed ? "Р вЂ™РЎРѓР Вµ Р В»Р ВµР С”РЎвЂ Р С‘Р С‘ Р С—РЎР‚Р С•Р в„–Р Т‘Р ВµР Р…РЎвЂ№" : currentLecture.subtitle}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-appBg">
          <span className="block h-full rounded-full bg-appGreen" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] font-black text-appGreen">{cta} Р’В· {percent}%</p>
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

function EmptyHealthWidget({ title, icon: Icon, color = "#8BBE3D", onOpen, onConnect, onRefresh, headline = "Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎРЎвЂР Р…", description = "Р СџР С•РЎРѓР В»Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘РЎРЏ Health Connect Р С‘Р В»Р С‘ Apple Health Р В·Р Т‘Р ВµРЎРѓРЎРЉ Р С—Р С•РЎРЏР Р†РЎРЏРЎвЂљРЎРѓРЎРЏ РЎР‚Р ВµР В°Р В»РЎРЉР Р…РЎвЂ№Р Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ.", actionLabel = "Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚" }) {
  const runAction = () => {
    if (actionLabel === "Р вЂ™Р Р…Р ВµРЎРѓРЎвЂљР С‘ РЎРѓР С•Р Р… Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹") {
      onOpen?.();
      return;
    }
    if (actionLabel === "Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ" || actionLabel === "Р СџР С•РЎРѓР СР С•РЎвЂљРЎР‚Р ВµРЎвЂљРЎРЉ") {
      onRefresh?.();
      if (actionLabel === "Р СџР С•РЎРѓР СР С•РЎвЂљРЎР‚Р ВµРЎвЂљРЎРЉ") onOpen?.();
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
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-2 text-[13px] font-bold text-appText">
          <Icon size={15} style={{ color }} /> {title}
        </span>
        <span className="rounded-full bg-appBg px-2 py-1 text-[10px] font-bold text-appMuted">Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦</span>
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
  const dashboardValue = rangeInfo.hasRange ? rangeInfo.rangeLabel : (rangeInfo.avg > 0 ? `${rangeInfo.avg} РЎС“Р Т‘/Р СР С‘Р Р…` : rangeInfo.rangeLabel);
  const averageLabel = rangeInfo.avg > 0 ? `РЎРѓРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– ${rangeInfo.avg}` : "РЎРѓРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– РІР‚вЂќ";
  if (!hasHeartData) {
    const copy = friendlyEmptyCopy("heart", heart.status);
    return (
      <EmptyHealthWidget
        title="Р СџРЎС“Р В»РЎРЉРЎРѓ"
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
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Heart size={15} className="text-red-500" fill="currentColor" /> Р СџРЎС“Р В»РЎРЉРЎРѓ</span>
        <span className="ml-auto rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-500">24С‡</span>
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black leading-tight text-appText">{dashboardValue}</p>
      <p className="mt-2 text-[11px] font-bold text-appMuted">Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„–: {rangeInfo.avg > 0 ? rangeInfo.avg : "РІР‚вЂќ"} Р’В· Р вЂќР С‘Р В°Р С—Р В°Р В·Р С•Р Р…: {rangeInfo.hasRange ? `${rangeInfo.min}-${rangeInfo.max}` : "РІР‚вЂќ"}</p>
      <div className="hidden">
        {rangeInfo.hasRange && <span>{rangeInfo.minLabel}: {rangeInfo.min} РЎС“Р Т‘/Р СР С‘Р Р…</span>}
        {rangeInfo.hasRange && rangeInfo.avg > 0 && <span>{rangeInfo.avgLabel}: {rangeInfo.avg} РЎС“Р Т‘/Р СР С‘Р Р…</span>}
        {rangeInfo.hasRange && <span>{rangeInfo.maxLabel}: {rangeInfo.max} РЎС“Р Т‘/Р СР С‘Р Р…</span>}
        <span>{latestLabel}</span>
      </div>
      <p className="mt-1 truncate text-[10px] font-bold text-appMuted">{sourceLabel}</p>
      <Sparkline values={(heart.hourly || []).slice(-9)} color="#EF4444" />
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
    return { key, label: weekLabels[day === 0 ? 6 : day - 1] };
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
      <div className="mb-2 grid grid-cols-[34px_1fr_34px] text-[9px] font-black text-appMuted">
        <div className="space-y-[34px]">
          {axisSteps.map((value) => <p key={`s-${value}`}>{formatAxisValue(value)}</p>)}
        </div>
        <div className="relative" style={{ height }}>
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
                  key={`${day.label}-${index}`}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect?.(index);
                  }}
                  className={`flex min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-2xl px-0.5 py-1 transition ${selected ? "bg-appCard shadow-sm" : "hover:bg-appCard/60"} ${day.suspicious ? "opacity-60 ring-1 ring-red-200" : ""}`}
                  aria-label={`${day.label}: ${steps} РЎв‚¬Р В°Р С–Р С•Р Р†, ${calories} Р С”Р С”Р В°Р В»`}
                >
                  <div className="h-6 text-center text-[8px] font-black leading-3 text-appText">
                    <p>{formatAxisValue(steps)}</p>
                    <p className="text-[#FF7A2F]">{formatAxisValue(calories)}</p>
                  </div>
                  <div className="flex h-[82px] w-full items-end justify-center gap-0.5">
                    <motion.span
                      className="w-[45%] rounded-t-full bg-appGreen"
                      animate={{ height: `${Math.max(steps > 0 ? 10 : 2, stepsHeight)}%` }}
                      transition={{ type: "spring", stiffness: 170, damping: 22 }}
                    />
                    <motion.span
                      className="w-[45%] rounded-t-full bg-[#FF7A2F]"
                      animate={{ height: `${Math.max(calories > 0 ? 10 : 2, caloriesHeight)}%` }}
                      transition={{ type: "spring", stiffness: 170, damping: 22 }}
                    />
                  </div>
                  <span className="text-[10px] font-bold text-appMuted">{day.label}</span>
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
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-appGreen" /> РЎв‚¬Р В°Р С–Р С‘</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#FF7A2F]" /> Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р С”Р В°Р В»</span>
      </div>
    </div>
  );
}

function SleepDayBars({ days = [], selectedIndex = 6, onSelect }) {
  const max = Math.max(...days.map((item) => Number(item.totalMinutes || 0)), 1);
  return (
    <div className="mt-3 grid grid-cols-7 items-end gap-1.5">
      {days.map((day, index) => {
        const selected = index === selectedIndex;
        const minutes = Number(day.totalMinutes || 0);
        const height = minutes > 0 ? `${Math.max(12, (minutes / max) * 100)}%` : "0%";
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
            <span className="mb-1 block text-[9px] font-black text-appText">{day.totalMinutes > 0 ? formatSleepDuration(day.totalMinutes) : "0"}</span>
            <span className="mx-auto flex h-[58px] w-full max-w-[24px] items-end overflow-hidden rounded-full bg-appBg">
              <motion.span
                className="block w-full rounded-full bg-blue-400"
                animate={{ height }}
              />
            </span>
            <span className="mt-1 block text-[10px] font-bold text-appMuted">{day.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const sleepStageMeta = {
  1: { key: "awake", label: "Р вЂР С•Р Т‘РЎР‚РЎРѓРЎвЂљР Р†Р С•Р Р†Р В°Р Р…Р С‘Р Вµ", color: "#FBBF24" },
  2: { key: "light", label: "Р вЂєР ВµР С–Р С”Р С‘Р в„– РЎРѓР С•Р Р…", color: "#93C5FD" },
  3: { key: "awake", label: "Р вЂ™Р Р…Р Вµ Р С”РЎР‚Р С•Р Р†Р В°РЎвЂљР С‘", color: "#F59E0B" },
  4: { key: "light", label: "Р вЂєР ВµР С–Р С”Р С‘Р в„– РЎРѓР С•Р Р…", color: "#60A5FA" },
  5: { key: "deep", label: "Р вЂњР В»РЎС“Р В±Р С•Р С”Р С‘Р в„– РЎРѓР С•Р Р…", color: "#1D4ED8" },
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
      const meta = sleepStageMeta[Number(stage.type)] || { key: "other", label: "Р РЋР С•Р Р…", color: "#BFDBFE" };
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
  const days = lastSevenDays().map((day) => ({
    ...day,
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
          <p className="text-[12px] font-black text-appText">{day?.label || "Р вЂќР ВµР Р…РЎРЉ"}</p>
          <p className="mt-1 text-[11px] text-appMuted">Р СњР С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р… {formatSleepDuration(day?.nightMinutes || 0)} Р’В· Р Т‘РЎР‚Р ВµР СРЎвЂ№ {formatSleepDuration(day?.napMinutes || 0)}</p>
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
              ["Р вЂєР ВµР С–Р С”Р С‘Р в„–", totals.light, "#60A5FA"],
              ["Р вЂњР В»РЎС“Р В±Р С•Р С”Р С‘Р в„–", totals.deep, "#1D4ED8"],
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
        <p className="mt-3 rounded-2xl bg-appCard px-3 py-2 text-[12px] leading-5 text-appMuted">Р СћРЎР‚Р ВµР С”Р ВµРЎР‚ Р С—Р ВµРЎР‚Р ВµР Т‘Р В°Р В» Р Т‘Р В»Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р С•РЎРѓРЎвЂљРЎРЉ РЎРѓР Р…Р В°, Р Р…Р С• Р Р…Р Вµ Р С—Р ВµРЎР‚Р ВµР Т‘Р В°Р В» РЎвЂћР В°Р В·РЎвЂ№ Р Т‘Р В»РЎРЏ РЎРЊРЎвЂљР С•Р С–Р С• Р Т‘Р Р…РЎРЏ.</p>
      )}
    </div>
  );
}

function sleepKindLabel(kind) {
  if (kind === "night") return "Р СњР С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р…";
  if (kind === "fragment") return "Р В¤РЎР‚Р В°Р С–Р СР ВµР Р…РЎвЂљ";
  return "Р вЂќРЎР‚Р ВµР СР В°";
}

function sleepEntryRange(entry = {}) {
  if (entry.startLocal && entry.endLocal) return `${entry.startLocal}-${entry.endLocal}`;
  const start = entry.start || entry.startTime;
  const end = entry.end || entry.endTime;
  if (!start || !end) return "Р Р†РЎР‚Р ВµР СРЎРЏ Р Р…Р Вµ РЎС“Р С”Р В°Р В·Р В°Р Р…Р С•";
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
              <p className="mt-1 text-[11px] font-bold text-appMuted">{entry.date || localDateKeyFromValue(entry.end || entry.start)} Р’В· {sleepEntryRange(entry)}</p>
              <p className="mt-1 text-[11px] text-appMuted">{healthSourceDisplayName(entry.sourcePackage, entry.sourceName)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] leading-5 text-appMuted">Р вЂ”Р В°Р С—Р С‘РЎРѓР ВµР в„– Р Р…Р ВµРЎвЂљ.</p>
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
  return "Health Connect aggregate";
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
      rangeLabel: `${min}-${max} РЎС“Р Т‘/Р СР С‘Р Р…`,
      minLabel: "Р СљР С‘Р Р… 24РЎвЂЎ",
      avgLabel: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– 24РЎвЂЎ",
      maxLabel: "Р СљР В°Р С”РЎРѓ 24РЎвЂЎ",
      rangeTitle: "Р вЂќР С‘Р В°Р С—Р В°Р В·Р С•Р Р… 24РЎвЂЎ",
      avgTitle: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– 24РЎвЂЎ",
      hintPrefix: "Р вЂ”Р В° 24 РЎвЂЎР В°РЎРѓР В°",
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
      rangeLabel: `${weekMin}-${weekMax} РЎС“Р Т‘/Р СР С‘Р Р…`,
      minLabel: "Р СљР С‘Р Р… Р В·Р В° 7 Р Т‘Р Р…Р ВµР в„–",
      avgLabel: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р В·Р В° 7 Р Т‘Р Р…Р ВµР в„–",
      maxLabel: "Р СљР В°Р С”РЎРѓ Р В·Р В° 7 Р Т‘Р Р…Р ВµР в„–",
      rangeTitle: "Р вЂќР С‘Р В°Р С—Р В°Р В·Р С•Р Р… Р В·Р В° 7 Р Т‘Р Р…Р ВµР в„–",
      avgTitle: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р В·Р В° 7 Р Т‘Р Р…Р ВµР в„–",
      hintPrefix: "Р вЂ”Р В° 7 Р Т‘Р Р…Р ВµР в„–",
    };
  }
  return {
    hasRange: false,
    scope: "latest",
    min: null,
    avg: null,
    max: null,
    rangeLabel: heart.latestBpm ? `${heart.latestBpm} РЎС“Р Т‘/Р СР С‘Р Р…` : "Р СњР ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ Р С—РЎС“Р В»РЎРЉРЎРѓР В°",
    minLabel: "Р СљР С‘Р Р…",
    avgLabel: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„–",
    maxLabel: "Р СљР В°Р С”РЎРѓ",
    rangeTitle: "Р вЂќР С‘Р В°Р С—Р В°Р В·Р С•Р Р…",
    avgTitle: "Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– Р С—РЎС“Р В»РЎРЉРЎРѓ",
    hintPrefix: "Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…РЎРЏРЎРЏ Р С‘РЎРѓРЎвЂљР С•РЎР‚Р С‘РЎРЏ",
  };
}

function heartRangeLabel(heart = {}) {
  return heartRangeInfo(heart).rangeLabel;
}

function heartLatestLabel(heart = {}) {
  if (!heart.latestBpm) return "Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р в„–: РІР‚вЂќ";
  const age = heart.updatedAgoText || "Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С•";
  return `Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р в„–: ${heart.latestBpm}, ${age}`;
}

function recoveryHeartSummary(heart = {}) {
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return rangeInfo.avg > 0 ? `${rangeInfo.rangeLabel}, ${rangeInfo.avgTitle.toLowerCase()} ${rangeInfo.avg} РЎС“Р Т‘/Р СР С‘Р Р…` : rangeInfo.rangeLabel;
  }
  if (heart.latestBpm) return `${heart.latestBpm} РЎС“Р Т‘/Р СР С‘Р Р…, ${heart.updatedAgoText || "Р С—Р С•РЎРѓР В»Р ВµР Т‘Р Р…РЎРЏРЎРЏ Р В·Р В°Р С—Р С‘РЎРѓРЎРЉ"}`;
  return "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ Р С—РЎС“Р В»РЎРЉРЎРѓР В°";
}

function friendlyHealthBadge(status) {
  if (status === "rate_limited") return "Р В»Р С‘Р СР С‘РЎвЂљ";
  if (status === "fresh") return "Р В°Р С”РЎвЂљРЎС“Р В°Р В»РЎРЉР Р…Р С•";
  if (status === "aging") return "Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏР ВµРЎвЂљРЎРѓРЎРЏ";
  if (status === "today") return "РЎРѓР ВµР С–Р С•Р Т‘Р Р…РЎРЏ";
  if (status === "old_today") return "Р В·Р В° 24 РЎвЂЎ";
  if (status === "stale") return "Р Т‘Р В°Р Р†Р Р…Р С•";
  return "Р С‘Р В·Р СР ВµРЎР‚Р ВµР Р…Р С‘Р Вµ";
}

function isRateLimitedUiStatus(status) {
  return status === "rate_limited" || status === "using_cache" || status === "temporarily_unavailable";
}

function friendlyHeartHint(heart = {}) {
  if (isRateLimitedUiStatus(heart.status) || isRateLimitedUiStatus(heart.widgetState) || heart.freshness === "rate_limited") {
    return heart.dataSource || heart.latestBpm
      ? "Health Connect Р Р†РЎР‚Р ВµР СР ВµР Р…Р Р…Р С• Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР С‘Р В» Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ, Р С—Р С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°Р ВµР С РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎвЂР Р…Р Р…РЎвЂ№Р Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ."
      : "Health Connect Р Р†РЎР‚Р ВµР СР ВµР Р…Р Р…Р С• Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР С‘Р В» Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ. Р СњР С•Р Р†Р В°РЎРЏ Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚Р С”Р В° РЎРѓРЎвЂљР В°Р Р…Р ВµРЎвЂљ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…Р В° Р С—Р С•РЎРѓР В»Р Вµ cooldown.";
  }
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return `${rangeInfo.hintPrefix}: ${rangeInfo.rangeLabel}. ${heartLatestLabel(heart)}.`;
  }
  if (heart.displayMode === "latest_only" && heart.latestTimestamp) {
    return `Р РЋР ВµР С–Р С•Р Т‘Р Р…РЎРЏ Р Р…Р С•Р Р†РЎвЂ№РЎвЂ¦ Р В·Р В°Р СР ВµРЎР‚Р С•Р Р† Р Р…Р ВµРЎвЂљ. Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…РЎРЏРЎРЏ Р В·Р В°Р С—Р С‘РЎРѓРЎРЉ: ${new Date(heart.latestTimestamp).toLocaleDateString("ru-RU")} (${heart.updatedAgoText || "Р Т‘Р В°Р Р†Р Р…Р С•"}).`;
  }
  if (heart.latestBpm) return `Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…РЎРЏРЎРЏ Р В·Р В°Р С—Р С‘РЎРѓРЎРЉ: ${heart.latestBpm} РЎС“Р Т‘/Р СР С‘Р Р…, ${heart.updatedAgoText || "Р Р…Р ВµР С”Р С•РЎвЂљР С•РЎР‚Р С•Р Вµ Р Р†РЎР‚Р ВµР СРЎРЏ Р Р…Р В°Р В·Р В°Р Т‘"}.`;
  return "Р С›РЎвЂљР С”РЎР‚Р С•Р в„–РЎвЂљР Вµ Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘Р Вµ РЎвЂЎР В°РЎРѓР С•Р Р†, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ Р С—РЎС“Р В»РЎРЉРЎРѓ.";
}

function friendlySourceHint(metric = {}, type = "metric") {
  if (isRateLimitedUiStatus(metric.status) || isRateLimitedUiStatus(metric.widgetState)) {
    return metric.dataSource
      ? "Р С›Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Health Connect Р Р†РЎР‚Р ВµР СР ВµР Р…Р Р…Р С• Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР ВµР Р…Р С•, Р С—Р С•Р С”Р В°Р В·Р В°Р Р…РЎвЂ№ РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎвЂР Р…Р Р…РЎвЂ№Р Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ."
      : "Health Connect Р Р†РЎР‚Р ВµР СР ВµР Р…Р Р…Р С• Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР С‘Р В» Р С•Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ. Р СџР С•Р С—РЎР‚Р С•Р В±РЎС“Р ВµР С РЎРѓР Р…Р С•Р Р†Р В° Р С—Р С•РЎРѓР В»Р Вµ cooldown.";
  }
  if (metric.isEstimated || metric.status === "estimated") {
    return "Р В§Р В°РЎРѓРЎвЂљРЎРЉ Р С—Р С•Р С”Р В°Р В·Р В°РЎвЂљР ВµР В»Р ВµР в„– РЎР‚Р В°РЎРѓРЎРѓРЎвЂЎР С‘РЎвЂљР В°Р Р…Р В° Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘ Р Р…Р В° Р С•РЎРѓР Р…Р С•Р Р†Р Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљР С‘.";
  }
  if (!metric.dataSource) {
    return type === "sleep"
      ? "Р вЂќР С•Р В±Р В°Р Р†РЎРЉРЎвЂљР Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР Р…Р В° Р С‘Р В»Р С‘ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚ Р Т‘Р В»РЎРЏ Р В±Р С•Р В»Р ВµР Вµ РЎвЂљР С•РЎвЂЎР Р…Р С•Р в„– Р В°Р Р…Р В°Р В»Р С‘РЎвЂљР С‘Р С”Р С‘."
      : "Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚ Р Т‘Р В»РЎРЏ Р В±Р С•Р В»Р ВµР Вµ РЎвЂљР С•РЎвЂЎР Р…Р С•Р в„– Р В°Р Р…Р В°Р В»Р С‘РЎвЂљР С‘Р С”Р С‘.";
  }
  return "Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ Р С•Р В±Р Р…Р С•Р Р†Р В»РЎРЏРЎР‹РЎвЂљРЎРѓРЎРЏ Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘ Р С—РЎР‚Р С‘ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚Р В°.";
}

function friendlyEmptyCopy(kind, status, hasPartialData = false) {
  if (isRateLimitedUiStatus(status)) {
    return {
      headline: "Р С›Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Р Р†РЎР‚Р ВµР СР ВµР Р…Р Р…Р С• Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР ВµР Р…Р С•",
      description: "Health Connect Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР С‘Р В» РЎвЂЎР В°РЎРѓРЎвЂљР С•РЎвЂљРЎС“ Р В·Р В°Р С—РЎР‚Р С•РЎРѓР С•Р Р†. FruitFit Р С—Р С•Р С”Р В°Р В¶Р ВµРЎвЂљ РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…РЎвЂР Р…Р Р…РЎвЂ№Р Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ Р С‘ Р С—Р С•Р С—РЎР‚Р С•Р В±РЎС“Р ВµРЎвЂљ Р С•Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉРЎРѓРЎРЏ Р С—Р С•РЎРѓР В»Р Вµ cooldown.",
      actionLabel: "Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ",
    };
  }
  if (status === "permission_required") {
    return {
      headline: "Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С— Р С” Р С—Р С•Р С”Р В°Р В·Р В°РЎвЂљР ВµР В»РЎРЏР С",
      description: "FruitFit РЎРѓР СР С•Р В¶Р ВµРЎвЂљ РЎС“РЎвЂЎР С‘РЎвЂљРЎвЂ№Р Р†Р В°РЎвЂљРЎРЉ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ, РЎРѓР С•Р Р… Р С‘ Р С—РЎС“Р В»РЎРЉРЎРѓ Р Р† РЎР‚Р ВµР С”Р С•Р СР ВµР Р…Р Т‘Р В°РЎвЂ Р С‘РЎРЏРЎвЂ¦. Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·РЎС“РЎР‹РЎвЂљРЎРѓРЎРЏ РЎвЂљР С•Р В»РЎРЉР С”Р С• Р Р†Р Р…РЎС“РЎвЂљРЎР‚Р С‘ Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘РЎРЏ.",
      actionLabel: "Р СњР В°РЎРѓРЎвЂљРЎР‚Р С•Р С‘РЎвЂљРЎРЉ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—",
    };
  }
  if (kind === "heart") {
    return {
      headline: "Р вЂ“Р Т‘РЎвЂР С РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎР‹ Р С—РЎС“Р В»РЎРЉРЎРѓР В°",
      description: "Р С›РЎвЂљР С”РЎР‚Р С•Р в„–РЎвЂљР Вµ Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘Р Вµ РЎвЂЎР В°РЎРѓР С•Р Р† Р С‘Р В»Р С‘ Р С•Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљР Вµ Health Connect, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ FruitFit РЎС“Р Р†Р С‘Р Т‘Р ВµР В» Р С—Р С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р Вµ Р С‘Р В·Р СР ВµРЎР‚Р ВµР Р…Р С‘РЎРЏ.",
      actionLabel: "Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ",
    };
  }
  if (kind === "sleep") {
    return {
      headline: "Р вЂќР С•Р В±Р В°Р Р†РЎРЉРЎвЂљР Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР Р…Р В°",
      description: "Р РЋР С•Р Р… Р С—Р С•Р СР С•Р С–Р В°Р ВµРЎвЂљ РЎвЂљР С•РЎвЂЎР Р…Р ВµР Вµ Р С•РЎвЂ Р ВµР Р…Р С‘Р Р†Р В°РЎвЂљРЎРЉ Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Р С‘ Р С—Р С•Р Т‘Р В±Р С‘РЎР‚Р В°РЎвЂљРЎРЉ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“ Р Р…Р В° Р Т‘Р ВµР Р…РЎРЉ.",
      actionLabel: "Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ",
    };
  }
  if (kind === "recovery" && hasPartialData) {
    return {
      headline: "Р С›РЎвЂ Р ВµР Р…Р С”Р В° РЎРѓРЎвЂљР В°Р Р…Р ВµРЎвЂљ РЎвЂљР С•РЎвЂЎР Р…Р ВµР Вµ Р С—Р С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘",
      description: "Р В§Р В°РЎРѓРЎвЂљРЎРЉ Р С—Р С•Р С”Р В°Р В·Р В°РЎвЂљР ВµР В»Р ВµР в„– РЎС“Р В¶Р Вµ Р ВµРЎРѓРЎвЂљРЎРЉ. Р вЂќР С•Р В±Р В°Р Р†РЎРЉРЎвЂљР Вµ РЎРѓР С•Р Р… Р С‘ РЎРѓР Р†Р ВµР В¶Р С‘Р в„– Р С—РЎС“Р В»РЎРЉРЎРѓ, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ РЎРѓРЎвЂЎР С‘РЎвЂљР В°Р В»Р С•РЎРѓРЎРЉ РЎС“Р Р†Р ВµРЎР‚Р ВµР Р…Р Р…Р ВµР Вµ.",
      actionLabel: "Р СџР С•РЎРѓР СР С•РЎвЂљРЎР‚Р ВµРЎвЂљРЎРЉ",
    };
  }
  return {
    headline: "Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚",
    description: "Health Connect Р С—Р С•Р СР С•Р В¶Р ВµРЎвЂљ FruitFit Р В°Р Р…Р В°Р В»Р С‘Р В·Р С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С‘ Р СРЎРЏР С–Р С”Р С• Р В°Р Т‘Р В°Р С—РЎвЂљР С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ РЎР‚Р ВµР С”Р С•Р СР ВµР Р…Р Т‘Р В°РЎвЂ Р С‘Р С‘.",
    actionLabel: "Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ",
  };
}

function isConnectedEmptyStatus(status) {
  return status === "connected_empty_today" || status === "connected_empty" || status === "connected_zero";
}

function hasChartData(values = []) {
  return values.some((value) => Number(value || 0) > 0);
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
          <p className="text-[11px] font-bold uppercase tracking-wide text-appMuted">Р ВРЎвЂљР С•Р С– Р В·Р В° Р Т‘Р ВµР Р…РЎРЉ</p>
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
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Icon size={15} style={{ color }} /> {title}</span>
          <span className="ml-auto text-[10px] font-bold text-appMuted">{percent}%</span>
          <DashboardRefreshButton onRefresh={onRefresh} />
        </div>
        <p className="mt-3 text-[26px] font-black text-appText">0</p>
        <p className="text-[11px] text-appMuted">/ {target.toLocaleString("ru-RU")} {suffix}</p>
        <p className="mt-1 text-[10px] font-bold text-appMuted">Р РЋР ВµР С–Р С•Р Т‘Р Р…РЎРЏ РЎв‚¬Р В°Р С–Р С•Р Р† Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ. Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ Р С—Р С•РЎРЏР Р†РЎРЏРЎвЂљРЎРѓРЎРЏ Р С—Р С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚Р В°.</p>
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
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Icon size={15} style={{ color }} /> {title}</span>
        <span className="ml-auto text-[10px] font-bold text-appMuted">{percent}%</span>
        <DashboardRefreshButton onRefresh={onRefresh} />
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
    copy.headline = "Р СњР ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ РЎРѓР Р…Р В°";
    copy.description = "Р вЂўРЎРѓР В»Р С‘ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·РЎС“Р ВµРЎвЂљРЎРѓРЎРЏ, РЎРѓР С•Р Р… Р СР С•Р В¶Р Р…Р С• Р Р†Р Р…Р ВµРЎРѓРЎвЂљР С‘ Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹.";
    copy.actionLabel = "Р вЂ™Р Р…Р ВµРЎРѓРЎвЂљР С‘ РЎРѓР С•Р Р… Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹";
    return <EmptyHealthWidget title="Р РЋР С•Р Р…" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> Р РЋР С•Р Р…</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(health.sleep.minutes)}</p>
      <p className="text-[11px] text-appMuted">Р С”Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С•: {health.sleep.quality}/5</p>
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
  const hasSleepData = Boolean(sleep.dataSource || sleep.minutes > 0 || sleepDays.some((item) => Number(item.totalMinutes || 0) > 0));
  if (!hasSleepData) {
    const copy = friendlyEmptyCopy("sleep", sleep.status);
    return <EmptyHealthWidget title="Р РЋР С•Р Р…" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> Р РЋР С•Р Р…</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(sleep.minutes || selectedDay?.totalMinutes || 0)}</p>
      <p className="text-[11px] text-appMuted">Р СњР С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р… {formatSleepDuration(nightMinutes)} Р’В· Р Т‘РЎР‚Р ВµР СРЎвЂ№ {formatSleepDuration(napMinutes)}</p>
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
    return <EmptyHealthWidget title="Р вЂ™Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ" icon={Activity} color="#8BBE3D" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Activity size={15} className="text-[#8BBE3D]" /> Р вЂ™Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Ring value={score} size={64}>
          <span className="text-[18px] font-black text-appText">{score}%</span>
        </Ring>
        <div className="min-w-0">
          <p className="text-[13px] font-black text-appText">{readiness.status || "Р вЂњР С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ"}</p>
          <p className="line-clamp-2 text-[11px] leading-4 text-appMuted">{readiness.recommendation}</p>
        </div>
      </div>
      {factors.length > 0 && (
        <div className="mt-3 space-y-1">
          {factors.map((factor) => (
            <p key={factor.id} className="line-clamp-1 text-[11px] leading-4 text-appMuted"><span className="font-black text-appText">{factor.label}:</span> {factor.value}</p>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CycleWidget({ health, onOpen }) {
  const progress = Math.round((health.cycle.day / health.cycle.length) * 100);
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Р В¦Р С‘Р С”Р В»</span>
      <div className="mt-3 grid grid-cols-[1fr_40px] items-center gap-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black leading-4 text-appText">{health.cycle.phase}</p>
          <p className="mt-1 text-[10px] leading-4 text-appMuted">Р С•Р Р†РЎС“Р В»РЎРЏРЎвЂ Р С‘РЎРЏ РЎвЂЎР ВµРЎР‚Р ВµР В· {health.cycle.ovulationInDays} Р Т‘Р Р…Р ВµР в„–</p>
        </div>
        <Ring value={progress} color="#A78BFA" size={40}>
          <span className="text-[11px] font-black text-appText">{health.cycle.day}</span>
        </Ring>
      </div>
    </motion.button>
  );
}

function WeeklyWidget({ health, onOpen, onConnect }) {
  const values = health.activity_history.week.map((item) => item.steps);
  if (!health.steps?.dataSource && !health.calories?.dataSource) {
    return (
      <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-black text-appText">Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">FruitFit РЎРѓР СР С•Р В¶Р ВµРЎвЂљ Р Р†Р С‘Р Т‘Р ВµРЎвЂљРЎРЉ Р Р…Р ВµР Т‘Р ВµР В»РЎРЉР Р…РЎвЂ№Р в„– РЎР‚Р С‘РЎвЂљР С Р С‘ Р СРЎРЏР С–РЎвЂЎР Вµ Р С—Р С•Р Т‘Р В±Р С‘РЎР‚Р В°РЎвЂљРЎРЉ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“.</p>
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
          Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ
        </span>
      </motion.button>
    );
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-black text-appText">Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹</h3>
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
            <span className="text-[10px] font-semibold text-appMuted">{health.activity_history.week[index].label}</span>
          </div>
        ))}
      </div>
    </motion.button>
  );
}

function WeeklyWidgetV2({ health, onOpen, onConnect }) {
  const days = health.activity_history?.week || [];
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, days.map((day) => Number(day.steps || day.calories || 0) > 0).lastIndexOf(true)));
  const selectedDay = days[selectedIndex] || days[6] || {};
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource || days.some((day) => Number(day.steps || day.calories || 0) > 0));
  if (!hasData) {
    return (
      <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="text-[15px] font-black text-appText">Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">Р СџР С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ Health Connect Р В·Р Т‘Р ВµРЎРѓРЎРЉ Р С—Р С•РЎРЏР Р†РЎРЏРЎвЂљРЎРѓРЎРЏ РЎв‚¬Р В°Р С–Р С‘ Р С‘ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘ Р С—Р С• Р Т‘Р Р…РЎРЏР С.</p>
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
          Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљРЎРЉ
        </span>
      </motion.button>
    );
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="col-span-2 cursor-pointer rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-black text-appText">Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹</h3>
          <p className="mt-1 text-[11px] text-appMuted">Р РЃР В°Р С–Р С‘ Р С‘ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘ Р С—Р С• Р Т‘Р Р…РЎРЏР С</p>
        </div>
        <ChevronRight size={17} className="text-appMuted" />
      </div>
      <div className="mt-3">
        <DualMetricBarChart days={days} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appBg/70 p-2">
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">{selectedDay.label || "Р вЂќР ВµР Р…РЎРЉ"}</p>
          <p className="mt-1 text-[13px] font-black text-appText">{Number(selectedDay.steps || 0).toLocaleString("ru-RU")} РЎв‚¬Р В°Р С–Р С•Р Р†</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ</p>
          <p className="mt-1 text-[13px] font-black text-[#FF7A2F]">{Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} Р С”Р С”Р В°Р В»</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">Р вЂ™РЎРѓР ВµР С–Р С•</p>
          <p className="mt-1 text-[13px] font-black text-appText">{selectedDay.totalCalories ? `${Number(selectedDay.totalCalories).toLocaleString("ru-RU")} Р С”Р С”Р В°Р В»` : "РІР‚вЂќ"}</p>
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

export function LectureDetailScreen({ onBack }) {
  const [progress, setProgress] = useLectureProgress();
  const [index, setIndex] = useState(progress.currentIndex || 0);
  const [textOpen, setTextOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const activeLecture = lectures[index] || lectures[0];
  const activeLectureText = lectureTextFor(activeLecture?.id);
  const [meta, setMeta] = useState({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
  const hasSelectel = Boolean(activeLecture?.selectelUrl);
  const completed = progress.completedIds.includes(activeLecture.id);
  const totalPercent = progressForLectureState(progress);

  function openFullVideo() {
    openExternalVideo(lecturePlaybackUrl(activeLecture));
  }

  function move(direction) {
    setIndex((value) => {
      const nextIndex = (value + direction + lectures.length) % lectures.length;
      writeLectureProgress((state) => ({ ...state, currentIndex: nextIndex }));
      return nextIndex;
    });
    setTextOpen(false);
    setCopyStatus("");
  }

  function markComplete() {
    const isLast = index >= lectures.length - 1;
    const next = writeLectureProgress((state) => ({
      currentIndex: isLast ? index : index + 1,
      completedIds: [...state.completedIds, activeLecture.id],
    }));
    setProgress(next);
    if (!isLast) {
      setIndex(index + 1);
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
    setCopyStatus("Р РЋР С”Р С•Р С—Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С•");
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  useEffect(() => {
    setMeta({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
    if (hasSelectel || !activeLecture?.videoId) return undefined;
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
  }, [activeLecture, hasSelectel]);

  return (
    <main className="phone-shell min-h-screen px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+92px)]">
      <header className="fixed left-1/2 top-0 z-50 flex w-[min(100vw,393px)] -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="Р СњР В°Р В·Р В°Р Т‘">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Р вЂєР ВµР С”РЎвЂ Р С‘РЎРЏ {index + 1} Р С‘Р В· {lectures.length}</p>
          <h1 className="line-clamp-1 text-[23px] font-black leading-tight text-appText">{activeLecture.shortTitle || activeLecture.title}</h1>
        </div>
      </header>

      <section className="overflow-hidden rounded-[28px] border border-appBorder bg-appCard/95 shadow-sm">
        <div className="bg-appDark">
          <LectureVideoPlayer item={activeLecture} title={meta.title || activeLecture.title} thumbnailUrl={meta.thumbnailUrl} />
        </div>
        <div className="p-4">
          <p className="text-[12px] font-black uppercase tracking-wide text-appMuted">Р СџРЎР‚Р С•Р С–РЎР‚Р ВµРЎРѓРЎРѓ Р С”РЎС“РЎР‚РЎРѓР В°: {totalPercent}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-appBg">
            <span className="block h-full rounded-full bg-appGreen" style={{ width: `${totalPercent}%` }} />
          </div>
          <h2 className="mt-4 text-[22px] font-black leading-tight text-appText">{activeLecture.title}</h2>
          <p className="mt-2 text-[13px] font-semibold leading-5 text-appMuted">{activeLecture.subtitle}</p>
          <p className="mt-3 rounded-2xl bg-appBg px-3 py-3 text-[12px] leading-5 text-appMuted">
            {hasSelectel ? "Р вЂ™Р С‘Р Т‘Р ВµР С• Р В·Р В°Р С–РЎР‚РЎС“Р В¶Р В°Р ВµРЎвЂљРЎРѓРЎРЏ Р С‘Р В· Selectel РЎвЂЎР ВµРЎР‚Р ВµР В· HTML5-Р С—Р В»Р ВµР ВµРЎР‚." : meta.error ? "Р вЂўРЎРѓР В»Р С‘ YouTube-Р СР ВµРЎвЂљР В°Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ Р Р…Р Вµ Р В·Р В°Р С–РЎР‚РЎС“Р В·Р С‘Р В»Р С‘РЎРѓРЎРЉ, Р Р†Р С‘Р Т‘Р ВµР С• Р Р†РЎРѓРЎвЂ РЎР‚Р В°Р Р†Р Р…Р С• Р СР С•Р В¶Р Р…Р С• Р С•РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р С—Р С•Р В»Р Р…Р С•РЎРѓРЎвЂљРЎРЉРЎР‹." : "Р СњР В°Р В¶Р СР С‘РЎвЂљР Вµ Play, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ Р С•РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р С—Р В»Р ВµР ВµРЎР‚ Р Р†Р Р…РЎС“РЎвЂљРЎР‚Р С‘ Р С—РЎР‚Р С‘Р В»Р С•Р В¶Р ВµР Р…Р С‘РЎРЏ."}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => move(-1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              <ChevronLeft size={17} /> Р СџРЎР‚Р ВµР Т‘РЎвЂ№Р Т‘РЎС“РЎвЂ°Р В°РЎРЏ
            </button>
            <button type="button" onClick={() => move(1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              Р РЋР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р В°РЎРЏ <ChevronRight size={17} />
            </button>
          </div>
          <button
            type="button"
            onClick={markComplete}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]"
          >
            <CheckCircle2 size={18} /> {completed ? "Р вЂєР ВµР С”РЎвЂ Р С‘РЎРЏ Р С•РЎвЂљР СР ВµРЎвЂЎР ВµР Р…Р В°" : "Р С›РЎвЂљР СР ВµРЎвЂљР С‘РЎвЂљРЎРЉ Р С—РЎР‚Р С•РЎРѓР СР С•РЎвЂљРЎР‚Р ВµР Р…Р Р…Р С•Р в„–"}
          </button>
          <button
            type="button"
            onClick={openFullVideo}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-appDark text-[14px] font-black text-appGreen"
          >
            Р С›РЎвЂљР С”РЎР‚РЎвЂ№РЎвЂљРЎРЉ Р С—Р С•Р В»Р Р…Р С•РЎРѓРЎвЂљРЎРЉРЎР‹
          </button>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-[24px] border border-appBorder bg-appCard">
        <button type="button" onClick={() => setTextOpen((value) => !value)} className="flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-[14px] font-black text-appText">Р СћР ВµР С”РЎРѓРЎвЂљР С•Р Р†Р В°РЎРЏ Р Р†Р ВµРЎР‚РЎРѓР С‘РЎРЏ Р В»Р ВµР С”РЎвЂ Р С‘Р С‘</span>
          <ChevronRight size={17} className={`text-appMuted transition ${textOpen ? "rotate-90" : ""}`} />
        </button>
        {textOpen && (
          <div className="border-t border-appBorder px-4 py-3">
            {activeLectureText ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-appMuted">{activeLectureText.length.toLocaleString("ru-RU")} Р В·Р Р…Р В°Р С”Р С•Р Р†</span>
                  <button
                    type="button"
                    onClick={copyLectureText}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
                  >
                    <Copy size={14} /> {copyStatus || "Р С™Р С•Р С—Р С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ"}
                  </button>
                </div>
                <div className="allow-select max-h-[52vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-appBorder bg-appBg px-3 py-3 text-[12px] leading-5 text-appText">
                  {activeLectureText}
                </div>
              </>
            ) : (
              <p className="text-[12px] leading-5 text-appMuted">Р СћР ВµР С”РЎРѓРЎвЂљР С•Р Р†Р В°РЎРЏ Р Р†Р ВµРЎР‚РЎРѓР С‘РЎРЏ Р В»Р ВµР С”РЎвЂ Р С‘Р С‘ Р С—Р С•Р С”Р В° Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…Р В°.</p>
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
  const title = isSteps ? "Р РЃР В°Р С–Р С‘" : "Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘";
  const unit = isSteps ? "РЎв‚¬Р В°Р С–Р С•Р Р†" : "Р С”Р С”Р В°Р В»";
  const sourceAvailable = Boolean(metric?.dataSource);

  const rawWeek = Array.isArray(metric.weekRaw) ? metric.weekRaw : [];
  const rawMonth = Array.isArray(metric.monthRaw) ? metric.monthRaw : [];
  const values = period === "today"
    ? (metric.hourly || [])
    : period === "week"
      ? (rawWeek.length ? rawWeek : (metric.week || []))
      : (rawMonth.length ? rawMonth : (metric.month || []));
  const value = period === "today" ? Number(metric.today || 0) : sum(values);
  const target = period === "today" ? Number(metric.goal || 0) : Number(metric.goal || 0) * (period === "week" ? 7 : 30);
  const labels = period === "today" ? ["00", "06", "12", "18", "24"] : period === "week" ? ["Р СџР Р…", "Р вЂ™РЎвЂљ", "Р РЋРЎР‚", "Р В§РЎвЂљ", "Р СџРЎвЂљ", "Р РЋР В±", "Р вЂ™РЎРѓ"] : ["1", "10", "20", "30"];
  const activeValue = activeIndex === null ? null : values[Math.min(activeIndex, values.length - 1)];
  const activeLabel = activeIndex === null ? "" : (period === "today" ? `${activeIndex}:00` : labels[Math.min(activeIndex, labels.length - 1)] || `#${activeIndex + 1}`);
  const chartHasData = hasChartData(values);
  const showAggregateToday = period === "today" && !chartHasData && Number(metric.today || 0) > 0;

  if (!sourceAvailable) {
    return <p className="rounded-[22px] bg-appBg p-4 text-[13px] text-appMuted">Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ {isSteps ? "РЎв‚¬Р В°Р С–Р С•Р Р†" : "Р С”Р В°Р В»Р С•РЎР‚Р С‘Р в„–"} Р С—Р С•Р С”Р В° Р Р…Р ВµР Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№.</p>;
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
        <p className="mt-2 text-[13px] text-appMuted">Р В¦Р ВµР В»РЎРЉ: {target.toLocaleString("ru-RU")} {unit} РІР‚Сћ {formatPercent(value, target)}%</p>
        <p className="mt-1 text-[12px] font-semibold text-appMuted">{friendlySourceHint(metric, type)}</p>
      </div>
      {!isSteps && (
        <div className="mt-4 grid grid-cols-1 gap-2">
          <StatPill label="Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘" value={`${Number(metric.activeToday ?? metric.today ?? 0).toLocaleString("ru-RU")} Р С”Р С”Р В°Р В»`} accent />
          {Number(metric.restingToday || 0) > 0 && <StatPill label="Р С™Р В°Р В»Р С•РЎР‚Р С‘Р С‘ Р С—Р С•Р С”Р С•РЎРЏ / BMR" value={`${Number(metric.restingToday || 0).toLocaleString("ru-RU")} Р С”Р С”Р В°Р В»`} />}
          {Number(metric.totalToday || 0) > 0
            ? <StatPill label="Р вЂ™РЎРѓР ВµР С–Р С• Р В·Р В° Р Т‘Р ВµР Р…РЎРЉ" value={`${Number(metric.totalToday || 0).toLocaleString("ru-RU")} Р С”Р С”Р В°Р В»`} />
            : <ChartEmptyState>Р вЂ™РЎРѓР ВµР С–Р С• Р В·Р В° Р Т‘Р ВµР Р…РЎРЉ Р С—Р С•Р С”Р В° Р Р…Р Вµ РЎР‚Р В°РЎРѓРЎРѓРЎвЂЎР С‘РЎвЂљР В°Р Р…Р С•. Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘ Р Р…Р Вµ Р С—Р С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°РЎР‹РЎвЂљРЎРѓРЎРЏ Р С”Р В°Р С” Р С•Р В±РЎвЂ°Р С‘Р в„– РЎР‚Р В°РЎРѓРЎвЂ¦Р С•Р Т‘.</ChartEmptyState>}
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
              ? "Р РЋР ВµР С–Р С•Р Т‘Р Р…РЎРЏ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р ВµР Р… Р С•Р В±РЎвЂ°Р С‘Р в„– Р С‘РЎвЂљР С•Р С–. Р вЂќР ВµРЎвЂљР В°Р В»РЎРЉР Р…Р В°РЎРЏ Р Т‘Р С‘Р Р…Р В°Р СР С‘Р С”Р В° Р С—Р С•РЎРЏР Р†Р С‘РЎвЂљРЎРѓРЎРЏ Р С—Р С•РЎРѓР В»Р Вµ РЎРѓР В»Р ВµР Т‘РЎС“РЎР‹РЎвЂ°Р С‘РЎвЂ¦ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р в„–."
              : "Р В§Р В°РЎРѓРЎвЂљРЎРЉ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р в„– РЎР‚Р В°РЎРѓРЎРѓРЎвЂЎР С‘РЎвЂљР В°Р Р…Р В° Р В°Р Р†РЎвЂљР С•Р СР В°РЎвЂљР С‘РЎвЂЎР ВµРЎРѓР С”Р С‘ Р Р…Р В° Р С•РЎРѓР Р…Р С•Р Р†Р Вµ РЎв‚¬Р В°Р С–Р С•Р Р†, Р Т‘Р С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘Р С‘ Р С‘ РЎвЂљРЎР‚Р ВµР Р…Р С‘РЎР‚Р С•Р Р†Р С•Р С”."}
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
          <ChartEmptyState>{period === "today" ? "Р СџР С•РЎвЂЎР В°РЎРѓР С•Р Р†Р С•Р в„– Р Т‘Р ВµРЎвЂљР В°Р В»Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ." : "Р ВРЎРѓРЎвЂљР С•РЎР‚Р С‘РЎРЏ Р В·Р В° Р Р†РЎвЂ№Р В±РЎР‚Р В°Р Р…Р Р…РЎвЂ№Р в„– Р С—Р ВµРЎР‚Р С‘Р С•Р Т‘ Р С—Р С•Р С”Р В° Р Р…Р Вµ Р Р…Р В°Р С”Р С•Р С—Р В»Р ВµР Р…Р В°."}</ChartEmptyState>
        )}
        {activeValue !== null && (
          <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[12px] font-bold text-appText">
            {activeLabel}: {Number(activeValue || 0).toLocaleString("ru-RU")} {unit}
          </p>
        )}
      </div>
      <MiniGuide
        title={isSteps ? "Р В§РЎвЂљР С• РЎРЊРЎвЂљР С• Р С‘ Р С”Р В°Р С” Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљРЎРЉ?" : "Р С™Р В°Р С” РЎРѓРЎвЂЎР С‘РЎвЂљР В°РЎР‹РЎвЂљРЎРѓРЎРЏ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘?"}
        items={isSteps
          ? ["Р РЃР В°Р С–Р С‘ Р С—Р С•Р С”Р В°Р В·РЎвЂ№Р Р†Р В°РЎР‹РЎвЂљ Р В±РЎвЂ№РЎвЂљР С•Р Р†РЎС“РЎР‹ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С‘ Р С—Р С•Р СР С•Р С–Р В°РЎР‹РЎвЂљ Р Р†Р С‘Р Т‘Р ВµРЎвЂљРЎРЉ, РЎРѓР С”Р С•Р В»РЎРЉР С”Р С• Р Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘РЎРЏ Р ВµРЎРѓРЎвЂљРЎРЉ Р Р†Р Р…Р Вµ РЎвЂљРЎР‚Р ВµР Р…Р С‘РЎР‚Р С•Р Р†Р С•Р С”.", "Р РЋР СР С•РЎвЂљРЎР‚Р С‘ РЎвЂљРЎР‚Р ВµР Р…Р Т‘ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹: Р С•Р Т‘Р С‘Р Р… РЎРѓР В»Р В°Р В±РЎвЂ№Р в„– Р Т‘Р ВµР Р…РЎРЉ Р Р…Р Вµ РЎРѓРЎвЂљРЎР‚Р В°РЎв‚¬Р ВµР Р…, Р Р†Р В°Р В¶Р Р…Р ВµР Вµ Р С•Р В±РЎвЂ°Р С‘Р в„– РЎР‚Р С‘РЎвЂљР С."]
          : ["Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘ РІР‚вЂќ РЎРЊРЎвЂљР С• РЎРЊР Р…Р ВµРЎР‚Р С–Р С‘РЎРЏ Р Р…Р В° Р Т‘Р Р†Р С‘Р В¶Р ВµР Р…Р С‘Р Вµ, РЎв‚¬Р В°Р С–Р С‘ Р С‘ РЎвЂљРЎР‚Р ВµР Р…Р С‘РЎР‚Р С•Р Р†Р С”Р С‘.", "Р вЂўРЎРѓР В»Р С‘ РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚ Р Р…Р Вµ Р С—Р ВµРЎР‚Р ВµР Т‘Р В°РЎвЂРЎвЂљ Р С—Р С•Р В»Р Р…РЎвЂ№Р в„– Р Т‘Р Р…Р ВµР Р†Р Р…Р С•Р в„– РЎР‚Р В°РЎРѓРЎвЂ¦Р С•Р Т‘, FruitFit Р В°Р С”Р С”РЎС“РЎР‚Р В°РЎвЂљР Р…Р С• Р Т‘Р С•Р С—Р С•Р В»Р Р…РЎРЏР ВµРЎвЂљ Р С•РЎвЂ Р ВµР Р…Р С”РЎС“ Р С—Р С• Р С—РЎР‚Р С•РЎвЂћР С‘Р В»РЎР‹ Р С‘ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљР С‘."]}
      />
    </>
  );
}

function HeartDetail({ health, setHeartCondition }) {
  const heart = health.heart_rate;
  const rangeInfo = heartRangeInfo(heart);
  const sourceName = healthSourceDisplayName(heart.latestSourcePackage || heart.sourcePackage, heart.latestSourceName || heart.sourceName);
  const heartOptions = ["Р Р…Р ВµРЎвЂљ", "Р В±РЎР‚Р В°Р Т‘Р С‘Р С”Р В°РЎР‚Р Т‘Р С‘РЎРЏ", "РЎвЂљР В°РЎвЂ¦Р С‘Р С”Р В°РЎР‚Р Т‘Р С‘РЎРЏ", "Р В°РЎР‚Р С‘РЎвЂљР СР С‘РЎРЏ", "Р Т‘РЎР‚РЎС“Р С–Р С•Р Вµ"];
  return (
    <>
      {hasChartData(heart.hourly)
        ? <LineChart values={heart.hourly} color="#EF4444" />
        : <ChartEmptyState>Р СџР С•Р С”Р В° Р Р…Р ВµРЎвЂљ РЎРѓР ВµРЎР‚Р С‘Р С‘ Р С‘Р В·Р СР ВµРЎР‚Р ВµР Р…Р С‘Р в„– Р Т‘Р В»РЎРЏ Р С–РЎР‚Р В°РЎвЂћР С‘Р С”Р В°. Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р в„– Р С—РЎС“Р В»РЎРЉРЎРѓ Р С‘ РЎРѓРЎвЂљР В°РЎвЂљР С‘РЎРѓРЎвЂљР С‘Р С”Р В° Р Р…Р С‘Р В¶Р Вµ РЎС“Р В¶Р Вµ Р Т‘Р С•РЎРѓРЎвЂљРЎС“Р С—Р Р…РЎвЂ№.</ChartEmptyState>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label={rangeInfo.rangeTitle} value={rangeInfo.rangeLabel} accent />
        <StatPill label={rangeInfo.avgTitle} value={rangeInfo.avg > 0 ? `${rangeInfo.avg} РЎС“Р Т‘/Р СР С‘Р Р…` : "Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ Р С‘Р В·Р СР ВµРЎР‚Р ВµР Р…Р С‘Р в„–"} />
        <StatPill label="Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…Р С‘Р в„– Р С—РЎС“Р В»РЎРЉРЎРѓ" value={heart.latestBpm ? `${heart.latestBpm} РЎС“Р Т‘/Р СР С‘Р Р…` : "Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ Р С‘Р В·Р СР ВµРЎР‚Р ВµР Р…Р С‘Р в„–"} />
        <StatPill label="Р СџР С•Р С”Р С•Р в„–" value={heart.resting ? `${heart.resting} РЎС“Р Т‘/Р СР С‘Р Р…` : "Р С—Р С•РЎРЏР Р†Р С‘РЎвЂљРЎРѓРЎРЏ Р С—Р С•Р В·Р В¶Р Вµ"} />
        <StatPill label="Р ВРЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”" value={sourceName} />
        <StatPill label="Р С›Р В±Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С•" value={heart.updatedAgoText || "РЎРѓР С”Р С•РЎР‚Р С•"} />
      </div>
      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ:</span> {friendlyHealthBadge(heart.freshness)}</p>
        <p><span className="font-black text-appText">Р В Р ВµР В¶Р С‘Р С:</span> {heart.displayMode || "no_data"} Р’В· {heart.displayReason || "Р Р…Р ВµРЎвЂљ Р С—РЎР‚Р С‘РЎвЂЎР С‘Р Р…РЎвЂ№"}</p>
        <p><span className="font-black text-appText">Р СџР С•РЎРѓР В»Р ВµР Т‘Р Р…РЎРЏРЎРЏ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ:</span> {heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР С”Р С•РЎР‚Р С• Р С•Р В±Р Р…Р С•Р Р†РЎРЏРЎвЂљРЎРѓРЎРЏ"}</p>
        <p>{friendlyHeartHint(heart)}</p>
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">Р ВР В·Р Р†Р ВµРЎРѓРЎвЂљР Р…РЎвЂ№Р Вµ Р С•РЎРѓР С•Р В±Р ВµР Р…Р Р…Р С•РЎРѓРЎвЂљР С‘ РЎРѓР ВµРЎР‚Р Т‘РЎвЂ Р В°</p>
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
          Р В­РЎвЂљР С‘ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ Р С—Р С•Р СР С•Р С–Р В°РЎР‹РЎвЂљ Р В°Р С”Р С”РЎС“РЎР‚Р В°РЎвЂљР Р…Р ВµР Вµ Р С‘Р Р…РЎвЂљР ВµРЎР‚Р С—РЎР‚Р ВµРЎвЂљР С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“. Р СџРЎР‚Р С‘ РЎРѓР ВµРЎР‚Р Т‘Р ВµРЎвЂЎР Р…РЎвЂ№РЎвЂ¦ Р В·Р В°Р В±Р С•Р В»Р ВµР Р†Р В°Р Р…Р С‘РЎРЏРЎвЂ¦ Р С•РЎР‚Р С‘Р ВµР Р…РЎвЂљР С‘РЎР‚РЎС“Р в„–РЎвЂљР ВµРЎРѓРЎРЉ Р Р…Р В° РЎР‚Р ВµР С”Р С•Р СР ВµР Р…Р Т‘Р В°РЎвЂ Р С‘Р С‘ Р Р†РЎР‚Р В°РЎвЂЎР В°.
        </p>
      </div>
      <MiniGuide
        title="Р С™Р В°Р С” Р С‘РЎРѓР С—Р С•Р В»РЎРЉР В·Р С•Р Р†Р В°РЎвЂљРЎРЉ Р С—РЎС“Р В»РЎРЉРЎРѓ?"
        items={[
          "Р СџРЎС“Р В»РЎРЉРЎРѓ Р С—Р С•Р С”Р С•РЎРЏ Р С—Р С•Р СР С•Р С–Р В°Р ВµРЎвЂљ Р С—Р С•Р Р…РЎРЏРЎвЂљРЎРЉ Р С•Р В±РЎвЂ°Р С‘Р в„– РЎвЂћР С•Р Р… Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ Р С‘ РЎС“РЎРѓРЎвЂљР В°Р В»Р С•РЎРѓРЎвЂљР С‘.",
          "Р вЂўРЎРѓР В»Р С‘ Р ВµРЎРѓРЎвЂљРЎРЉ РЎвЂљР В°РЎвЂ¦Р С‘Р С”Р В°РЎР‚Р Т‘Р С‘РЎРЏ, Р В°РЎР‚Р С‘РЎвЂљР СР С‘РЎРЏ Р С‘Р В»Р С‘ Р Т‘Р В°Р Р†Р В»Р ВµР Р…Р С‘Р Вµ, Р С‘Р Р…РЎвЂљР ВµР Р…РЎРѓР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘ Р В»РЎС“РЎвЂЎРЎв‚¬Р Вµ РЎРѓР С•Р С–Р В»Р В°РЎРѓР С•Р Р†РЎвЂ№Р Р†Р В°РЎвЂљРЎРЉ РЎРѓ Р Р†РЎР‚Р В°РЎвЂЎР С•Р С.",
          "FruitFit Р В±РЎС“Р Т‘Р ВµРЎвЂљ РЎС“РЎвЂЎР С‘РЎвЂљРЎвЂ№Р Р†Р В°РЎвЂљРЎРЉ РЎРЊРЎвЂљР С‘ Р С•РЎвЂљР СР ВµРЎвЂљР С”Р С‘ Р С”Р В°Р С” Р С”Р С•Р Р…РЎРѓР ВµРЎР‚Р Р†Р В°РЎвЂљР С‘Р Р†Р Р…Р С•Р Вµ Р С•Р С–РЎР‚Р В°Р Р…Р С‘РЎвЂЎР ВµР Р…Р С‘Р Вµ Р Р† Р С—Р С•Р Т‘Р В±Р С•РЎР‚Р Вµ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘.",
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
      <span className="mt-2 block text-[10px] font-semibold text-appMuted">Р вЂ™Р Р†Р ВµР Т‘Р С‘РЎвЂљР Вµ Р Р†РЎР‚Р ВµР СРЎРЏ Р Р† РЎвЂћР С•РЎР‚Р СР В°РЎвЂљР Вµ Р В§Р В§:Р СљР Сљ</span>
    </label>
  );
}

function SleepDetail({ health, updateSleepManual }) {
  const [sleep, setSleep] = useState(health.sleep);
  const [saved, setSaved] = useState(false);
  const [period, setPeriod] = useState("week");
  const source = health.sleep.dataSource === "manual" ? "Р вЂ™Р Р†Р ВµР Т‘Р ВµР Р…Р С• Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹" : "Р СџР С•Р В»РЎС“РЎвЂЎР ВµР Р…Р С• РЎРѓ РЎвЂћР С‘РЎвЂљР Р…Р ВµРЎРѓ-РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚Р В°";
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
        <p className="mt-2 text-[13px] text-appMuted">Р С™Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• РЎРѓР Р…Р В°: {health.sleep.quality}/5</p>
      </div>
      <div className="mt-4 flex rounded-full bg-appBg p-1">
        {[["week", "Р СњР ВµР Т‘Р ВµР В»РЎРЏ"], ["month", "Р СљР ВµРЎРѓРЎРЏРЎвЂ "]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPeriod(id)} className={`h-9 flex-1 rounded-full text-[12px] font-bold transition ${period === id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {hasChartData(sleepValues)
          ? <BarChart values={sleepValues} color="#60A5FA" labels={sleepLabels} />
          : <ChartEmptyState>{period === "week" ? "Р ВРЎРѓРЎвЂљР С•РЎР‚Р С‘РЎРЏ РЎРѓР Р…Р В° Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹ Р С—Р С•Р С”Р В° Р Р…Р Вµ Р Р…Р В°Р С”Р С•Р С—Р В»Р ВµР Р…Р В°." : "Р ВРЎРѓРЎвЂљР С•РЎР‚Р С‘РЎРЏ РЎРѓР Р…Р В° Р В·Р В° Р СР ВµРЎРѓРЎРЏРЎвЂ  Р С—Р С•Р С”Р В° Р Р…Р Вµ Р Р…Р В°Р С”Р С•Р С—Р В»Р ВµР Р…Р В°."}</ChartEmptyState>}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <h3 className="text-[13px] font-black text-appText">Р В РЎС“РЎвЂЎР Р…Р С•Р в„– Р Р†Р Р†Р С•Р Т‘</h3>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р вЂќР В°РЎвЂљР В° РЎРѓР Р…Р В°
          <input type="date" value={sleep.date || new Date().toISOString().slice(0, 10)} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SleepTimeInput label="Р вЂєР ВµР С–" value={sleep.bed} onChange={(value) => update("bed", value)} />
          <SleepTimeInput label="Р СџРЎР‚Р С•РЎРѓР Р…РЎС“Р В»РЎРѓРЎРЏ" value={sleep.wake} onChange={(value) => update("wake", value)} />
        </div>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р С™Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• РЎРѓР Р…Р В° 1РІР‚вЂњ5
          <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
        </label>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р вЂ”Р В°Р СР ВµРЎвЂљР С”Р С‘
          <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Р СњР В°Р С—РЎР‚Р С‘Р СР ВµРЎР‚: Р С—РЎР‚Р С•РЎРѓРЎвЂ№Р С—Р В°Р В»РЎРѓРЎРЏ Р Р…Р С•РЎвЂЎРЎРЉРЎР‹, Р В¶Р В°РЎР‚Р С”Р С•, Р С—Р С•Р В·Р Т‘Р Р…Р С‘Р в„– Р С”Р С•РЎвЂћР Вµ" className="mt-1 min-h-20 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appCard p-2">
          {["Р вЂњР В»РЎС“Р В±Р С•Р С”Р С‘Р в„–", "Р вЂєР ВµР С–Р С”Р С‘Р в„–", "REM"].map((phase, index) => (
            <div key={phase} className="rounded-[14px] bg-appBg px-2 py-2 text-center">
              <p className="text-[10px] font-bold text-appMuted">{phase}</p>
              <p className="mt-1 text-[13px] font-black text-appText">{[22, 56, 22][index]}%</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Р вЂР С•Р В»Р ВµР Вµ РЎвЂљР С•РЎвЂЎР Р…РЎвЂ№Р Вµ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР Р…Р В° Р С—Р С•Р СР С•Р С–РЎС“РЎвЂљ Р В»РЎС“РЎвЂЎРЎв‚¬Р Вµ РЎР‚Р В°РЎРѓРЎРѓРЎвЂЎР С‘РЎвЂљРЎвЂ№Р Р†Р В°РЎвЂљРЎРЉ Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ Р С‘ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“.</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Р СџРЎР‚Р С‘Р СР ВµРЎР‚Р Р…Р В°РЎРЏ Р С•РЎвЂ Р ВµР Р…Р С”Р В°. Р вЂќР В»РЎРЏ РЎвЂљР С•РЎвЂЎР Р…Р С•Р С–Р С• Р В°Р Р…Р В°Р В»Р С‘Р В·Р В° Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ РЎвЂћР С‘РЎвЂљР Р…Р ВµРЎРѓ-РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚.</p>
        <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Р РЋР С•РЎвЂ¦РЎР‚Р В°Р Р…Р С‘РЎвЂљРЎРЉ</button>
        {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">Р РЋР С•Р Р… РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…Р ВµР Р… Р С”Р В°Р С” РЎР‚РЎС“РЎвЂЎР Р…Р С•Р в„– Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”</p>}
      </div>
      <MiniGuide
        title="Р С™Р В°Р С” РЎвЂЎР С‘РЎвЂљР В°РЎвЂљРЎРЉ РЎРѓР С•Р Р…?"
        items={[
          "Р РЋР СР С•РЎвЂљРЎР‚Р С‘ Р Р…Р Вµ РЎвЂљР С•Р В»РЎРЉР С”Р С• Р Т‘Р В»Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р С•РЎРѓРЎвЂљРЎРЉ, Р Р…Р С• Р С‘ Р С”Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• РЎРѓР Р…Р В°: Р С•Р Р…Р С• РЎРѓР С‘Р В»РЎРЉР Р…Р ВµР Вµ Р Р†Р В»Р С‘РЎРЏР ВµРЎвЂљ Р Р…Р В° Р С–Р С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С” Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р Вµ.",
          "Р вЂўРЎРѓР В»Р С‘ РЎРѓР С•Р Р… Р С”Р С•РЎР‚Р С•РЎвЂљР С”Р С‘Р в„– Р С‘Р В»Р С‘ РЎР‚Р Р†Р В°Р Р…РЎвЂ№Р в„–, Р В»РЎС“РЎвЂЎРЎв‚¬Р Вµ РЎРѓР Р…Р С‘Р В·Р С‘РЎвЂљРЎРЉ Р С‘Р Р…РЎвЂљР ВµР Р…РЎРѓР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С‘ Р Р…Р Вµ Р Т‘Р С•Р В±Р С‘Р Р†Р В°РЎвЂљРЎРЉ РЎРѓР ВµР В±РЎРЏ Р С•Р В±РЎР‰РЎвЂР СР С•Р С.",
        ]}
      />
    </>
  );
}

function RecoveryDetail({ health }) {
  const readiness = health.readiness;
  const recoveryStats = [
    ["Р РЋР С•Р Р… Р С—РЎР‚Р С•РЎв‚¬Р В»Р С•Р в„– Р Р…Р С•РЎвЂЎР С‘", readiness.sleepLastNightMinutes ? formatSleepDuration(readiness.sleepLastNightMinutes) : "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦"],
    ["Р РЋРЎР‚Р ВµР Т‘Р Р…Р С‘Р в„– РЎРѓР С•Р Р… 7Р Т‘", readiness.sleep7dAverageMinutes ? formatSleepDuration(readiness.sleep7dAverageMinutes) : "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦"],
    ["Р вЂќРЎР‚Р ВµР СРЎвЂ№ РЎРѓР ВµР С–Р С•Р Т‘Р Р…РЎРЏ", readiness.napsTodayMinutes ? formatSleepDuration(readiness.napsTodayMinutes) : "Р Р…Р ВµРЎвЂљ"],
    ["Р СџРЎС“Р В»РЎРЉРЎРѓ 24РЎвЂЎ", readiness.heartAvg24h ? `${readiness.heartRange24h?.[0] || "?"}-${readiness.heartRange24h?.[1] || "?"}` : "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦"],
    ["Р СџРЎС“Р В»РЎРЉРЎРѓ 7Р Т‘", readiness.heartAvg7d ? `${readiness.heartRange7d?.[0] || "?"}-${readiness.heartRange7d?.[1] || "?"}` : "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦"],
    ["Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ", readiness.stepsToday ? `${Number(readiness.stepsToday).toLocaleString("ru-RU")} РЎв‚¬Р В°Р С–Р С•Р Р†` : "Р Р…Р ВµРЎвЂљ Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦"],
  ];
  if (readiness.score == null) {
    return (
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">Р вЂ™Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ РЎРѓРЎвЂљР В°Р Р…Р ВµРЎвЂљ РЎвЂљР С•РЎвЂЎР Р…Р ВµР Вµ Р С—Р С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">
          Р СџРЎС“Р В»РЎРЉРЎРѓ: {recoveryHeartSummary(health.heart_rate)}. Р РЋР С•Р Р…: {health.sleep?.minutes ? formatSleepDuration(health.sleep.minutes) : "Р СР С•Р В¶Р Р…Р С• Р Т‘Р С•Р В±Р В°Р Р†Р С‘РЎвЂљРЎРЉ Р Р†РЎР‚РЎС“РЎвЂЎР Р…РЎС“РЎР‹"}. Р РЃР В°Р С–Р С‘: {(health.steps?.today || 0).toLocaleString("ru-RU")}.
        </p>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Р вЂќР С•Р В±Р В°Р Р†РЎРЉРЎвЂљР Вµ РЎРѓР С•Р Р… Р С‘Р В»Р С‘ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р С‘РЎР‚РЎС“Р в„–РЎвЂљР Вµ РЎвЂЎР В°РЎРѓРЎвЂ№, РЎвЂЎРЎвЂљР С•Р В±РЎвЂ№ FruitFit РЎС“Р Р†Р ВµРЎР‚Р ВµР Р…Р Р…Р ВµР Вµ Р С•РЎвЂ Р ВµР Р…Р С‘Р Р†Р В°Р В» Р С–Р С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С” Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р Вµ.</p>
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
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">Р С–Р С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ</p>
            </div>
          </Ring>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Р вЂњР С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С” Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р Вµ</p>
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
        <p className="text-[13px] font-black text-appText">Р СџР С•РЎвЂЎР ВµР СРЎС“ РЎвЂљР В°Р С”Р В°РЎРЏ РЎР‚Р ВµР С”Р С•Р СР ВµР Р…Р Т‘Р В°РЎвЂ Р С‘РЎРЏ</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {recoveryStats.map(([label, value]) => (
            <StatPill key={label} label={label} value={value} />
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">{readiness.recommendation}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Р СџР С•Р В»Р Р…Р С•РЎвЂљР В° Р Т‘Р В°Р Р…Р Р…РЎвЂ№РЎвЂ¦: {readiness.dataCompleteness ?? 0}% Р’В· Р РЋРЎвЂљР В°РЎвЂљРЎС“РЎРѓ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљР С‘: {readiness.activityStatus || "unknown"}</p>
      </div>
    </>
  );
}

function CycleDetail({ health, updateCycle }) {
  const cycle = health.cycle;
  const phaseText = {
    "Р СљР ВµР Р…РЎРѓРЎвЂљРЎР‚РЎС“Р В°Р В»РЎРЉР Р…Р В°РЎРЏ": "Р С›РЎР‚Р С–Р В°Р Р…Р С‘Р В·Р С РЎРѓР Р…Р С‘Р В¶Р В°Р ВµРЎвЂљ Р С•Р В±РЎвЂ°Р С‘Р в„– РЎвЂљР С•Р Р…РЎС“РЎРѓ, Р С—Р С•РЎРЊРЎвЂљР С•Р СРЎС“ РЎвЂЎР В°РЎРѓРЎвЂљР С• Р В»РЎС“РЎвЂЎРЎв‚¬Р Вµ Р С—Р С•Р Т‘РЎвЂ¦Р С•Р Т‘РЎРЏРЎвЂљ РЎРѓР С—Р С•Р С”Р С•Р в„–Р Р…РЎвЂ№Р Вµ РЎвЂљРЎР‚Р ВµР Р…Р С‘РЎР‚Р С•Р Р†Р С”Р С‘, Р С—РЎР‚Р С•Р С–РЎС“Р В»Р С”Р С‘, Р СР С•Р В±Р С‘Р В»Р С‘РЎвЂљР С‘ Р С‘ Р СРЎРЏР С–Р С”Р В°РЎРЏ РЎвЂљР ВµРЎвЂ¦Р Р…Р С‘Р С”Р В°.",
    "Р В¤Р С•Р В»Р В»Р С‘Р С”РЎС“Р В»РЎРЏРЎР‚Р Р…Р В°РЎРЏ": "Р В­Р Р…Р ВµРЎР‚Р С–Р С‘РЎРЏ Р С•Р В±РЎвЂ№РЎвЂЎР Р…Р С• Р С—Р С•РЎРѓРЎвЂљР ВµР С—Р ВµР Р…Р Р…Р С• РЎР‚Р В°РЎРѓРЎвЂљР ВµРЎвЂљ, Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ РЎвЂЎР В°РЎРѓРЎвЂљР С• Р С•РЎвЂ°РЎС“РЎвЂ°Р В°Р ВµРЎвЂљРЎРѓРЎРЏ Р В»Р ВµР С–РЎвЂЎР Вµ. Р В­РЎвЂљР С• РЎвЂ¦Р С•РЎР‚Р С•РЎв‚¬Р С‘Р в„– Р С—Р ВµРЎР‚Р С‘Р С•Р Т‘ Р Т‘Р В»РЎРЏ Р В°Р С”Р С”РЎС“РЎР‚Р В°РЎвЂљР Р…Р С•Р С–Р С• Р С—РЎР‚Р С•Р С–РЎР‚Р ВµРЎРѓРЎРѓР В° Р Р† РЎРѓР С‘Р В»Р С•Р Р†РЎвЂ№РЎвЂ¦ РЎС“Р С—РЎР‚Р В°Р В¶Р Р…Р ВµР Р…Р С‘РЎРЏРЎвЂ¦.",
    "Р С›Р Р†РЎС“Р В»РЎРЏРЎвЂљР С•РЎР‚Р Р…Р В°РЎРЏ": "Р В§Р В°РЎРѓРЎвЂљР С• Р ВµРЎРѓРЎвЂљРЎРЉ Р С•РЎвЂ°РЎС“РЎвЂ°Р ВµР Р…Р С‘Р Вµ Р В±Р С•Р Т‘РЎР‚Р С•РЎРѓРЎвЂљР С‘ Р С‘ Р Р†РЎвЂ№РЎРѓР С•Р С”Р С•Р в„– Р С–Р С•РЎвЂљР С•Р Р†Р Р…Р С•РЎРѓРЎвЂљР С‘, Р Р…Р С• Р Р†Р В°Р В¶Р Р…Р С• Р Р…Р Вµ РЎвЂћР С•РЎР‚РЎРѓР С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“ Р С‘ РЎРѓР В»Р ВµР Т‘Р С‘РЎвЂљРЎРЉ Р В·Р В° РЎвЂљР ВµРЎвЂ¦Р Р…Р С‘Р С”Р С•Р в„–.",
    "Р вЂєРЎР‹РЎвЂљР ВµР С‘Р Р…Р С•Р Р†Р В°РЎРЏ": "Р СљР С•Р В¶Р ВµРЎвЂљ Р С—Р С•Р Р†РЎвЂ№РЎв‚¬Р В°РЎвЂљРЎРЉРЎРѓРЎРЏ РЎС“РЎвЂљР С•Р СР В»РЎРЏР ВµР СР С•РЎРѓРЎвЂљРЎРЉ Р С‘ РЎвЂЎРЎС“Р Р†РЎРѓРЎвЂљР Р†Р С‘РЎвЂљР ВµР В»РЎРЉР Р…Р С•РЎРѓРЎвЂљРЎРЉ Р С” Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р Вµ. Р СџР С•Р В»Р ВµР В·Р Р…Р С• РЎвЂЎРЎС“РЎвЂљРЎРЉ Р Р†Р Р…Р С‘Р СР В°РЎвЂљР ВµР В»РЎРЉР Р…Р ВµР Вµ Р С•РЎвЂљР Р…Р С•РЎРѓР С‘РЎвЂљРЎРЉРЎРѓРЎРЏ Р С”Р С• РЎРѓР Р…РЎС“, Р С—Р С‘РЎвЂљР В°Р Р…Р С‘РЎР‹ Р С‘ Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎР‹.",
  }[cycle.phase] || "Р РЋР ВµР в„–РЎвЂЎР В°РЎРѓ Р В»РЎС“РЎвЂЎРЎв‚¬Р Вµ Р С•РЎР‚Р С‘Р ВµР Р…РЎвЂљР С‘РЎР‚Р С•Р Р†Р В°РЎвЂљРЎРЉРЎРѓРЎРЏ Р Р…Р В° РЎРѓР В°Р СР С•РЎвЂЎРЎС“Р Р†РЎРѓРЎвЂљР Р†Р С‘Р Вµ, РЎРѓР С•Р Р… Р С‘ Р С”Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• Р Р†Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘РЎРЏ, Р В° Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”РЎС“ Р С—Р С•Р Т‘Р В±Р С‘РЎР‚Р В°РЎвЂљРЎРЉ Р В±Р ВµР В· РЎР‚Р ВµР В·Р С”Р С‘РЎвЂ¦ РЎРѓР С”Р В°РЎвЂЎР С”Р С•Р Р†.";
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <div className="flex items-center gap-4">
          <Ring value={Math.round((cycle.day / cycle.length) * 100)} color="#A78BFA" size={98}>
            <div className="text-center">
              <p className="text-[24px] font-black leading-none text-appText">{cycle.day}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">Р Т‘Р ВµР Р…РЎРЉ</p>
            </div>
          </Ring>
          <div>
            <p className="text-[13px] font-bold uppercase text-appMuted">Р СћР ВµР С”РЎС“РЎвЂ°Р В°РЎРЏ РЎвЂћР В°Р В·Р В°</p>
            <p className="mt-1 text-[20px] font-black text-appText">{cycle.phase}</p>
            <p className="mt-2 text-[12px] text-appMuted">Р С›Р Р†РЎС“Р В»РЎРЏРЎвЂ Р С‘РЎРЏ Р С—РЎР‚Р С‘Р СР ВµРЎР‚Р Р…Р С• РЎвЂЎР ВµРЎР‚Р ВµР В· {cycle.ovulationInDays} Р Т‘Р Р…Р ВµР в„–.</p>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-[20px] bg-appBg p-3">
        <h3 className="text-[13px] font-black text-appText">Р В§РЎвЂљР С• Р С—РЎР‚Р С•Р С‘РЎРѓРЎвЂ¦Р С•Р Т‘Р С‘РЎвЂљ РЎРѓР ВµР в„–РЎвЂЎР В°РЎРѓ</h3>
        <p className="mt-2 text-[12px] leading-5 text-appMuted">{phaseText}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Р В­РЎвЂљР С• Р Р…Р Вµ Р СР ВµР Т‘Р С‘РЎвЂ Р С‘Р Р…РЎРѓР С”Р В°РЎРЏ Р Т‘Р С‘Р В°Р С–Р Р…Р С•РЎРѓРЎвЂљР С‘Р С”Р В°, Р В° Р СРЎРЏР С–Р С”Р В°РЎРЏ Р С—Р С•Р Т‘РЎРѓР С”Р В°Р В·Р С”Р В° Р Т‘Р В»РЎРЏ Р С—Р В»Р В°Р Р…Р С‘РЎР‚Р С•Р Р†Р В°Р Р…Р С‘РЎРЏ Р Р…Р В°Р С–РЎР‚РЎС“Р В·Р С”Р С‘.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold uppercase text-appMuted">Р вЂќР ВµР Р…РЎРЉ РЎвЂ Р С‘Р С”Р В»Р В°
          <input value={cycle.day} inputMode="numeric" onChange={(event) => updateCycle({ day: Number(event.target.value) || 1 })} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appBg px-3 text-appText outline-none" />
        </label>
        <label className="text-[11px] font-bold uppercase text-appMuted">Р вЂќР В»Р С‘Р Р…Р В° РЎвЂ Р С‘Р С”Р В»Р В°
          <input value={cycle.length} inputMode="numeric" onChange={(event) => updateCycle({ length: Number(event.target.value) || 28 })} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appBg px-3 text-appText outline-none" />
        </label>
      </div>
    </>
  );
}

function WeeklyDetail({ health }) {
  const week = health.activity_history.week || [];
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource);

  if (!hasData) {
    return (
      <div className="rounded-[22px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">Р СџР С•РЎРѓР В»Р Вµ Р С—Р С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР ВµР Р…Р С‘РЎРЏ Health Connect FruitFit РЎРѓР СР С•Р В¶Р ВµРЎвЂљ Р Р†Р С‘Р Т‘Р ВµРЎвЂљРЎРЉ Р Р…Р ВµР Т‘Р ВµР В»РЎРЉР Р…РЎвЂ№Р в„– РЎР‚Р С‘РЎвЂљР С Р С‘ Р Т‘Р В°Р Р†Р В°РЎвЂљРЎРЉ Р В±Р С•Р В»Р ВµР Вµ РЎвЂљР С•РЎвЂЎР Р…РЎвЂ№Р Вµ РЎР‚Р ВµР С”Р С•Р СР ВµР Р…Р Т‘Р В°РЎвЂ Р С‘Р С‘.</p>
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
        <StatPill label="Р РЃР В°Р С–Р С‘ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р С”Р В°Р В»" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Р РЋРЎР‚Р ВµР Т‘Р Р…Р ВµР Вµ Р Р† Р Т‘Р ВµР Р…РЎРЉ" value={avgSteps.toLocaleString("ru-RU")} />
        <StatPill label="Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№РЎвЂ¦ Р Т‘Р Р…Р ВµР в„–" value={`${activeDays}/7`} />
      </div>
      <div className="mt-4">
        <BarChart values={health.activity_history.week.map((item) => item.steps)} color="#8BBE3D" labels={health.activity_history.week.map((item) => item.label)} />
      </div>
      <div className="mt-4">
        <BarChart values={health.activity_history.week.map((item) => item.calories)} color="#FF7A2F" labels={health.activity_history.week.map((item) => item.label)} />
      </div>
    </>
  );
}

function ManualSleepSection({ health, updateSleepManual }) {
  const currentSleep = health.sleep || {};
  const [sleep, setSleep] = useState({
    date: currentSleep.date || new Date().toISOString().slice(0, 10),
    bed: currentSleep.bed || "23:00",
    wake: currentSleep.wake || "07:00",
    sleepKind: currentSleep.sleepKind || "night",
    quality: currentSleep.quality || 4,
    notes: currentSleep.notes || "",
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSleep({
      date: currentSleep.date || new Date().toISOString().slice(0, 10),
      bed: currentSleep.bed || "23:00",
      wake: currentSleep.wake || "07:00",
      sleepKind: currentSleep.sleepKind || "night",
      quality: currentSleep.quality || 4,
      notes: currentSleep.notes || "",
    });
  }, [currentSleep.bed, currentSleep.date, currentSleep.notes, currentSleep.quality, currentSleep.wake]);

  function update(key, value) {
    setSaved(false);
    setSleep((current) => ({ ...current, [key]: value }));
  }

  function saveManualSleep() {
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
      <h3 className="text-[13px] font-black text-appText">Р В РЎС“РЎвЂЎР Р…Р С•Р в„– Р Р†Р Р†Р С•Р Т‘ РЎРѓР Р…Р В°</h3>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р вЂќР В°РЎвЂљР В° РЎРѓР Р…Р В°
        <input type="date" value={sleep.date} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SleepTimeInput label="Р вЂєР ВµР С–" value={sleep.bed} onChange={(value) => update("bed", value)} />
        <SleepTimeInput label="Р СџРЎР‚Р С•РЎРѓР Р…РЎС“Р В»РЎРѓРЎРЏ" value={sleep.wake} onChange={(value) => update("wake", value)} />
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Р С™Р В°РЎвЂЎР ВµРЎРѓРЎвЂљР Р†Р С• РЎРѓР Р…Р В°: {sleep.quality}/5
        <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
      </label>
      <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Р вЂ”Р В°Р СР ВµРЎвЂљР С”Р В° Р С• РЎРѓР Р…Р Вµ" className="mt-3 min-h-16 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
      <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Р РЋР С•РЎвЂ¦РЎР‚Р В°Р Р…Р С‘РЎвЂљРЎРЉ РЎРѓР С•Р Р…</button>
      {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">Р РЋР С•Р Р… РЎРѓР С•РЎвЂ¦РЎР‚Р В°Р Р…Р ВµР Р… Р С”Р В°Р С” РЎР‚РЎС“РЎвЂЎР Р…Р С•Р в„– Р С‘РЎРѓРЎвЂљР С•РЎвЂЎР Р…Р С‘Р С”</p>}
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
          <p className="text-[18px] font-black text-appText">Р вЂќР В°Р Р…Р Р…РЎвЂ№РЎвЂ¦ РЎРѓР Р…Р В° Р С—Р С•Р С”Р В° Р Р…Р ВµРЎвЂљ</p>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">Р СџР С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ Health Connect Р В·Р Т‘Р ВµРЎРѓРЎРЉ Р С—Р С•РЎРЏР Р†РЎРЏРЎвЂљРЎРѓРЎРЏ Р Р…Р С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р…, Р Т‘Р Р…Р ВµР Р†Р Р…РЎвЂ№Р Вµ Р Т‘РЎР‚Р ВµР СРЎвЂ№ Р С‘ РЎвЂћР В°Р В·РЎвЂ№ РЎРѓР Р…Р В°.</p>
        </div>
        <ManualSleepSection health={health} updateSleepManual={updateSleepManual} />
      </>
    );
  }
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР Р…Р В° Health Connect</p>
        <p className="mt-2 text-[42px] font-black leading-none text-appText">{formatSleepDuration(sleep.minutes || selectedDay?.totalMinutes || 0)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="Р СњР С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р… Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹" value={formatSleepDuration(nightTotal)} accent />
          <StatPill label="Р вЂќРЎР‚Р ВµР СРЎвЂ№ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹" value={formatSleepDuration(napTotal)} />
        </div>
      </div>
      {nightTotal <= 0 && napTotal > 0 && <p className="mt-3 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">Р СњР С•РЎвЂЎР Р…Р С•Р в„– РЎРѓР С•Р Р… Р Р…Р Вµ Р Р…Р В°Р в„–Р Т‘Р ВµР Р…. Р СњР В°Р в„–Р Т‘Р ВµР Р…РЎвЂ№ РЎвЂљР С•Р В»РЎРЉР С”Р С• Р С”Р С•РЎР‚Р С•РЎвЂљР С”Р С‘Р Вµ/Р Т‘Р Р…Р ВµР Р†Р Р…РЎвЂ№Р Вµ РЎРѓР ВµРЎРѓРЎРѓР С‘Р С‘.</p>}
      <SleepDayBars days={sleepDays} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      <SleepStageBreakdown day={selectedDay} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="РЎРѕРЅ РїСЂРѕС€Р»РѕР№ РЅРѕС‡Рё" value={formatSleepDuration(selectedDay?.nightMinutes || sleep.nightMinutes || 0)} accent />
        <StatPill label="РЎСЂРµРґРЅРёР№ СЃРѕРЅ 7Рґ" value={avgNight7d ? formatSleepDuration(avgNight7d) : "РЅРµС‚ РґР°РЅРЅС‹С…"} />
        <StatPill label="Р”СЂРµРјС‹ Р·Р° РЅРµРґРµР»СЋ" value={formatSleepDuration(napTotal)} />
        <StatPill label="РљР°С‡РµСЃС‚РІРѕ" value={manualQuality ? `${manualQuality}/5` : "РЅРµ СѓРєР°Р·Р°РЅРѕ"} />
      </div>
      <ManualSleepSection health={health} updateSleepManual={updateSleepManual} />
    </>
  );
}

function WeeklyDetailV2({ health }) {
  const week = health.activity_history?.week || [];
  const [selectedIndex, setSelectedIndex] = useState(() => Math.max(0, week.map((day) => Number(day.steps || day.calories || 0) > 0).lastIndexOf(true)));
  const selectedDay = week[selectedIndex] || week[6] || {};
  const hasData = Boolean(health.steps?.dataSource || health.calories?.dataSource || week.some((item) => Number(item.steps || item.calories || 0) > 0));

  if (!hasData) {
    return (
      <div className="rounded-[22px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">Р СџР С•Р Т‘Р С”Р В»РЎР‹РЎвЂЎР С‘РЎвЂљР Вµ Р В°Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">Р СџР С•РЎРѓР В»Р Вµ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘Р С‘ Health Connect FruitFit Р С—Р С•Р С”Р В°Р В¶Р ВµРЎвЂљ РЎв‚¬Р В°Р С–Р С‘, Р В°Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р В°Р В»Р С•РЎР‚Р С‘Р С‘ Р С‘ Р С•Р В±РЎвЂ°Р С‘Р в„– Р С”Р В°Р В»Р С•РЎР‚Р В°Р В¶ Р С—Р С• Р Т‘Р Р…РЎРЏР С.</p>
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
        <StatPill label="Р РЃР В°Р С–Р С‘ Р В·Р В° Р Р…Р ВµР Т‘Р ВµР В»РЎР‹" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р С”Р В°Р В»" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Р С›Р В±РЎвЂ°Р С‘Р в„– Р С”Р В°Р В»Р С•РЎР‚Р В°Р В¶" value={totalAllCalories ? totalAllCalories.toLocaleString("ru-RU") : "РІР‚вЂќ"} />
        <StatPill label="Р РЋРЎР‚Р ВµР Т‘Р Р…Р ВµР Вµ РЎв‚¬Р В°Р С–Р С•Р Р†" value={avgSteps.toLocaleString("ru-RU")} />
      </div>
      <div className="mt-4">
        <DualMetricBarChart days={week} selectedIndex={selectedIndex} onSelect={setSelectedIndex} height={154} />
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
        <p className="text-[12px] font-black uppercase text-appMuted">{selectedDay.label || "Р вЂќР ВµР Р…РЎРЉ"}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="Р РЃР В°Р С–Р С‘" value={Number(selectedDay.steps || 0).toLocaleString("ru-RU")} accent />
          <StatPill label="Р С’Р С”РЎвЂљР С‘Р Р†Р Р…РЎвЂ№Р Вµ Р С”Р С”Р В°Р В»" value={Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} />
          <StatPill label="Р вЂ™РЎРѓР ВµР С–Р С• Р С”Р С”Р В°Р В»" value={selectedDay.totalCalories ? Number(selectedDay.totalCalories).toLocaleString("ru-RU") : "РІР‚вЂќ"} />
          <StatPill label="Р вЂќР С‘РЎРѓРЎвЂљР В°Р Р…РЎвЂ Р С‘РЎРЏ" value={selectedDay.distance ? `${selectedDay.distance} Р С”Р С` : "РІР‚вЂќ"} />
          <StatPill label="Р СџРЎС“Р В»РЎРЉРЎРѓ" value={selectedDay.heart ? `${selectedDay.heart} РЎС“Р Т‘/Р СР С‘Р Р…` : "РІР‚вЂќ"} />
        </div>
        {selectedDay.suspicious && <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-500">Р вЂќР ВµР Р…РЎРЉ Р С—Р С•Р СР ВµРЎвЂЎР ВµР Р… Р С”Р В°Р С” Р С—Р С•Р Т‘Р С•Р В·РЎР‚Р С‘РЎвЂљР ВµР В»РЎРЉР Р…РЎвЂ№Р в„– Р С‘ Р Р…Р Вµ Р Р†Р В»Р С‘РЎРЏР ВµРЎвЂљ Р Р…Р В° Р СР В°РЎРѓРЎв‚¬РЎвЂљР В°Р В± Р С–РЎР‚Р В°РЎвЂћР С‘Р С”Р В°.</p>}
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
      aria-label="Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ Health Connect"
    >
      <RefreshCcw size={14} />
    </button>
  );
}

export function HealthDetailScreen({ type, onBack }) {
  const { health, setHeartCondition, updateSleepManual, updateCycle, syncNativeHealth, syncing, syncError } = useHealth();
  const [refreshNote, setRefreshNote] = useState("");
  const titles = {
    heart: "Р СџРЎС“Р В»РЎРЉРЎРѓ",
    steps: "Р РЃР В°Р С–Р С‘",
    calories: "Р С™Р В°Р В»Р С•РЎР‚Р С‘Р С‘",
    sleep: "Р РЋР С•Р Р…",
    recovery: "Р вЂ™Р С•РЎРѓРЎРѓРЎвЂљР В°Р Р…Р С•Р Р†Р В»Р ВµР Р…Р С‘Р Вµ",
    cycle: "Р В¦Р С‘Р С”Р В»",
    weekly: "Р С’Р С”РЎвЂљР С‘Р Р†Р Р…Р С•РЎРѓРЎвЂљРЎРЉ",
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
    setRefreshNote(result?.message ? "Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР С”Р С•РЎР‚Р С• Р С•Р В±Р Р…Р С•Р Р†РЎРЏРЎвЂљРЎРѓРЎРЏ" : "Р РЋР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ Р С—РЎР‚Р С•Р Р†Р ВµРЎР‚Р ВµР Р…Р В°");
  }

  return (
    <main className="phone-shell min-h-screen px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+92px)]">
      <header className="fixed left-1/2 top-0 z-50 flex w-[min(100vw,393px)] -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="Р СњР В°Р В·Р В°Р Т‘">
          <ChevronLeft size={22} />
        </button>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Health Connect</p>
          <h1 className="text-[24px] font-black leading-tight text-appText">{titles[type] || "Р вЂќР ВµРЎвЂљР В°Р В»Р С‘"}</h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={syncing}
          className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-appCard text-appMuted shadow-sm disabled:opacity-50"
          aria-label="Р С›Р В±Р Р…Р С•Р Р†Р С‘РЎвЂљРЎРЉ Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ"
        >
          <RefreshCcw size={17} className={syncing ? "animate-spin" : ""} />
        </button>
      </header>

      <section className="rounded-[28px] border border-appBorder bg-appCard/95 p-4 shadow-sm">
        <p className="mb-3 rounded-2xl bg-appBg/70 px-3 py-2 text-[11px] font-semibold text-appMuted">
          Р РЋР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р В°РЎвЂ Р С‘РЎРЏ: {health.lastFruitFitRefreshAt ? new Date(health.lastFruitFitRefreshAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "Р Т‘Р В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР С”Р С•РЎР‚Р С• Р С—Р С•РЎРЏР Р†РЎРЏРЎвЂљРЎРѓРЎРЏ"}
          {refreshNote ? ` Р’В· ${refreshNote}` : ""}
        </p>
        {syncError && <p className="mb-3 rounded-2xl border border-appBorder bg-appBg/80 px-3 py-2 text-[11px] font-bold text-appMuted">Р вЂќР В°Р Р…Р Р…РЎвЂ№Р Вµ РЎРѓР С”Р С•РЎР‚Р С• Р С•Р В±Р Р…Р С•Р Р†РЎРЏРЎвЂљРЎРѓРЎРЏ. Р СџРЎР‚Р С•Р Р†Р ВµРЎР‚РЎРЉРЎвЂљР Вµ, РЎвЂЎРЎвЂљР С• РЎвЂљРЎР‚Р ВµР С”Р ВµРЎР‚ РЎРѓР С‘Р Р…РЎвЂ¦РЎР‚Р С•Р Р…Р С‘Р В·Р С‘РЎР‚Р С•Р Р†Р В°Р В»РЎРѓРЎРЏ РЎРѓ Health Connect.</p>}
        {type === "heart" && <HeartDetail health={health} setHeartCondition={setHeartCondition} />}
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

export default function WidgetGrid({ profile, onNavigate }) {
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
    syncNativeHealth?.({ reason: "dashboard-auto", queryMode: "dashboard" });
  }, [syncNativeHealth]);

  function render(widget) {
    switch (widget.type) {
      case "lecture":
        return <MiniLectureWidget key={widget.id} onOpen={() => onNavigate?.("lecture")} />;
      case "nutrition":
        return <NutritionWidget key={widget.id} profile={profile} onOpen={() => onNavigate?.("food")} />;
      case "heart":
        return <HeartWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:heart")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-heart", queryMode: "dashboard" })} />;
      case "steps":
        return <MetricWidget key={widget.id} kind="steps" status={health.steps.status} title="Р РЃР В°Р С–Р С‘" icon={Footprints} value={health.steps.today} target={health.steps.goal} color="#8BBE3D" suffix="РЎв‚¬Р В°Р С–Р С•Р Р†" sourceNote={friendlySourceHint(health.steps, "steps")} onOpen={() => onNavigate?.("health:steps")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-steps", queryMode: "dashboard" })} />;
      case "calories":
        return <MetricWidget key={widget.id} kind="calories" status={health.calories.status} title="Р С™Р В°Р В»Р С•РЎР‚Р С‘Р С‘" icon={Flame} value={health.calories.today} target={health.calories.goal} color="#FF7A2F" suffix="Р С”Р С”Р В°Р В»" sourceNote={friendlySourceHint(health.calories, "calories")} onOpen={() => onNavigate?.("health:calories")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-calories", queryMode: "dashboard" })} />;
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
        <SlidersHorizontal size={14} /> {editMode ? "Р вЂњР С•РЎвЂљР С•Р Р†Р С•" : "Р СњР В°РЎРѓРЎвЂљРЎР‚Р С•Р в„–Р С”Р В° Р Р†Р С‘Р Т‘Р В¶Р ВµРЎвЂљР С•Р Р†"}
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
                  {disabled && <span className="block truncate text-[10px] text-appMuted">Р вЂќР С•РЎРѓРЎвЂљРЎС“Р С—Р Р…Р С• Р Т‘Р В»РЎРЏ Р В¶Р ВµР Р…РЎРѓР С”Р С•Р С–Р С• Р С—РЎР‚Р С•РЎвЂћР С‘Р В»РЎРЏ</span>}
                </div>
                <button type="button" onClick={() => move(widget.id, -1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowUp size={13} /></button>
                <button type="button" onClick={() => move(widget.id, 1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowDown size={13} /></button>
                <button type="button" disabled={disabled} onClick={() => toggle(widget.id)} className={`h-8 rounded-full px-2 text-[11px] font-bold ${widget.enabled && !disabled ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appMuted"}`}>
                  {widget.enabled && !disabled ? "Р вЂ™Р С”Р В»" : "Р вЂ™РЎвЂ№Р С”Р В»"}
                </button>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => commit(defaultWidgets)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appBg text-[12px] font-bold text-appMuted">
              <RefreshCcw size={13} /> Р РЋР В±РЎР‚Р С•РЎРѓР С‘РЎвЂљРЎРЉ
            </button>
            <button type="button" onClick={() => setEditMode(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
              <CheckCircle2 size={14} /> Р вЂњР С•РЎвЂљР С•Р Р†Р С•
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
