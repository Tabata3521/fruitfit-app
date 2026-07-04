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
import { accessTier } from "../data/accessRules";
import { getAuthToken } from "../data/authStore";
import { openLectureProgramAction } from "#fruitfit/programAction";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const widgetStorageKey = "fruitfit.widgets";

const lecture = lectures[0];

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
          <a href="${safeEmbed}" aria-label="Воспроизвести видео: ${safeTitle}">
            <img src="${safeThumb}" alt="" />
            <span class="shade"></span>
            <span class="play"></span>
            <span class="caption">Нажмите Play, чтобы открыть плеер внутри приложения</span>
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
    // Fall through to window open.
  }
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = target;
  return true;
}

const defaultWidgets = [
  { id: "lecture", title: "Мини-лекция", type: "lecture", enabled: true, order: 1, dataSource: "content", fallbackState: "Нет данных" },
  { id: "nutrition", title: "Питание", type: "nutrition", enabled: true, order: 2, dataSource: "csv", fallbackState: "Нет данных" },
  { id: "heart", title: "Пульс", type: "heart", enabled: true, order: 3, dataSource: "tracker", fallbackState: "Трекер не подключён" },
  { id: "steps", title: "Шаги", type: "steps", enabled: true, order: 4, dataSource: "tracker", fallbackState: "Трекер не подключён" },
  { id: "calories", title: "Калории", type: "calories", enabled: true, order: 5, dataSource: "tracker", fallbackState: "Трекер не подключён" },
  { id: "sleep", title: "Сон", type: "sleep", enabled: true, order: 6, dataSource: "tracker/manual", fallbackState: "Трекер не подключён" },
  { id: "recovery", title: "Восстановление", type: "recovery", enabled: true, order: 7, dataSource: "tracker/manual", fallbackState: "Трекер не подключён" },
  { id: "cycle", title: "Цикл", type: "cycle", enabled: true, order: 8, dataSource: "manual", fallbackState: "Нет данных" },
  { id: "weekly", title: "Активность за неделю", type: "weekly", enabled: true, order: 9, dataSource: "tracker", fallbackState: "Трекер не подключён" },
];

const periodTabs = [
  { id: "today", label: "Сегодня" },
  { id: "week", label: "Неделя" },
  { id: "month", label: "Месяц" },
];

const WEEKLY_STEPS_GOAL = 70000;
const WEEKLY_ACTIVITY_QUERY_MODE = "history_7d";
const weekLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

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
        <span>{max} уд/мин</span>
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
    day: days[0] || "Понедельник",
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
            <Utensils size={15} className="text-appOrange" /> Питание
          </span>
          {loading ? (
            <div className="mt-3 h-14 w-36 animate-pulse rounded-2xl bg-white/60" />
          ) : (
            <>
              <p className="mt-3 text-[25px] font-black text-[#181F19]">{totals.calories || caloriesTarget} <span className="text-[12px] font-semibold">ккал</span></p>
              <p className="mt-1 text-[12px] text-[#5f675f]">Б {totals.protein || 0} / Ж {totals.fat || 0} / У {totals.carbs || 0}</p>
              <p className="mt-1 line-clamp-1 text-[11px] font-semibold text-appOrange">{filters.ration || "Рацион подобран"}</p>
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
  const cta = completed ? "Пересмотреть" : safeProgress.completedIds.length ? "Продолжить" : "Начать";
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="col-span-2 grid grid-cols-[1fr_112px] gap-3 rounded-[22px] border border-appBorder bg-appCard/90 p-3 text-left shadow-sm"
    >
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold text-appMuted">
          <BookOpen size={14} /> Лекция {currentIndex + 1} из {visibleLectures.length || lectures.length}
        </span>
        <h3 className="mt-2 line-clamp-2 text-[15px] font-black leading-tight text-appText">{currentLecture.shortTitle || currentLecture.title}</h3>
        <p className="mt-2 text-[11px] text-appMuted">{completed ? "Все доступные лекции пройдены" : currentLecture.subtitle}</p>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-appBg">
          <span className="block h-full rounded-full bg-appGreen" style={{ width: `${percent}%` }} />
        </div>
        <p className="mt-2 text-[11px] font-black text-appGreen">{cta} · {percent}%</p>
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

function EmptyHealthWidget({ title, icon: Icon, color = "#8BBE3D", onOpen, onConnect, onRefresh, headline = "Трекер не подключён", description = "После подключения Apple Health здесь появятся реальные данные.", actionLabel = "Подключить трекер" }) {
  const runAction = () => {
    if (actionLabel === "Посмотреть") {
      onOpen?.();
      return;
    }
    if (actionLabel === "Обновить" || actionLabel === "Проверить") {
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
        <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] font-bold text-appMuted">нет данных</span>
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
  const latestBpm = Number(heart.latestBpm || heart.current || 0);
  const singleValueRange = rangeInfo.hasRange && rangeInfo.min === rangeInfo.max;
  const dashboardValue = latestBpm > 0 && (!rangeInfo.hasRange || singleValueRange)
    ? `${Math.round(latestBpm)} уд/мин`
    : (rangeInfo.hasRange ? rangeInfo.rangeLabel : (rangeInfo.avg > 0 ? `${rangeInfo.avg} уд/мин` : rangeInfo.rangeLabel));
  const dashboardMeta = rangeInfo.hasRange && !singleValueRange
    ? `средний ${rangeInfo.avg > 0 ? rangeInfo.avg : "—"} · диапазон ${rangeInfo.min}-${rangeInfo.max}`
    : latestLabel;
  if (!hasHeartData) {
    const copy = friendlyEmptyCopy("heart", heart.status);
    return (
      <EmptyHealthWidget
        title="Пульс"
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
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Heart size={15} className="text-red-500" fill="currentColor" /> Пульс</span>
        <span className="ml-auto rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-500">24</span>
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black leading-tight text-appText">{dashboardValue}</p>
      <p className="mt-2 text-[11px] font-bold text-appMuted">{dashboardMeta}</p>
      <div className="hidden">
        {rangeInfo.hasRange && <span>{rangeInfo.minLabel}: {rangeInfo.min} уд/мин</span>}
        {rangeInfo.hasRange && rangeInfo.avg > 0 && <span>{rangeInfo.avgLabel}: {rangeInfo.avg} уд/мин</span>}
        {rangeInfo.hasRange && <span>{rangeInfo.maxLabel}: {rangeInfo.max} уд/мин</span>}
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
  if (!entries.length && !(day.entries || []).length) return sleep.dataSource === "manual" && sleep.minutes > 0 ? "Ручная запись" : "Нет данных";
  if (day.hasManualNight || entries.some(isManualSleepEntry) || (day.entries || []).some(isManualSleepEntry)) return "Ручная запись";
  if (entries.length || sleep.dataSource === "tracker") return "Apple Health";
  return "Нет данных";
}

function sleepDuplicateWarning(totalMinutes) {
  return Number(totalMinutes || 0) > 14 * 60 ? "Проверьте запись сна: возможный дубль данных" : "";
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
                  aria-label={`${activityDayTitle(day)}: ${steps} шагов, ${calories} ккал`}
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
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-appGreen" /> Шаги</span>
        <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#FF7A2F]" /> Активные ккал</span>
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
            <span className="mb-1 block text-[9px] font-black text-appText">{day.totalMinutes > 0 ? formatSleepDuration(day.totalMinutes) : "—"}</span>
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
  1: { key: "awake", label: "Бодрствование", color: "#FBBF24" },
  2: { key: "light", label: "Лёгкий сон", color: "#93C5FD" },
  3: { key: "awake", label: "Пробуждение", color: "#F59E0B" },
  4: { key: "light", label: "Лёгкий сон", color: "#60A5FA" },
  5: { key: "deep", label: "Глубокий сон", color: "#1D4ED8" },
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
      const meta = sleepStageMeta[Number(stage.type)] || { key: "other", label: "Сон", color: "#BFDBFE" };
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
          <p className="mt-1 text-[11px] text-appMuted">Ночной сон {formatSleepDuration(day?.nightMinutes || 0)} · дремы {formatSleepDuration(day?.napMinutes || 0)}</p>
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
              ["Лёгкий", totals.light, "#60A5FA"],
              ["Глубокий", totals.deep, "#1D4ED8"],
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
        <p className="mt-3 rounded-2xl bg-appCard px-3 py-2 text-[12px] leading-5 text-appMuted">Фазы сна не переданы трекером. Показываем только длительность.</p>
      )}
    </div>
  );
}

function sleepKindLabel(kind) {
  if (kind === "night") return "Ночной сон";
  if (kind === "fragment") return "Фрагмент сна";
  return "Дрема";
}

function sleepEntryRange(entry = {}) {
  if (entry.startLocal && entry.endLocal) return `${entry.startLocal}-${entry.endLocal}`;
  const start = entry.start || entry.startTime;
  const end = entry.end || entry.endTime;
  if (!start || !end) return "Время не указано";
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
        <p className="mt-2 text-[12px] leading-5 text-appMuted">Записей нет.</p>
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
  return "Apple Health";
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
      rangeLabel: `${min}-${max} уд/мин`,
      minLabel: "Мин. 24ч",
      avgLabel: "Средний 24ч",
      maxLabel: "Макс. 24ч",
      rangeTitle: "Диапазон 24ч",
      avgTitle: "Средний 24ч",
      hintPrefix: "Диапазон за 24 часа",
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
      rangeLabel: `${weekMin}-${weekMax} уд/мин`,
      minLabel: "Мин. за 7 дней",
      avgLabel: "Средний за 7 дней",
      maxLabel: "Макс. за 7 дней",
      rangeTitle: "Диапазон 7 дней",
      avgTitle: "Средний 7 дней",
      hintPrefix: "Диапазон за 7 дней",
    };
  }
  return {
    hasRange: false,
    scope: "latest",
    min: null,
    avg: null,
    max: null,
    rangeLabel: heart.latestBpm ? `${heart.latestBpm} уд/мин` : "Нет данных",
    minLabel: "Мин.",
    avgLabel: "Средний",
    maxLabel: "Макс.",
    rangeTitle: "Пульс",
    avgTitle: "Средний",
    hintPrefix: "Пульс",
  };
}

function heartRangeLabel(heart = {}) {
  return heartRangeInfo(heart).rangeLabel;
}

function heartLatestLabel(heart = {}) {
  if (!heart.latestBpm) return "последнего измерения нет";
  const age = heart.updatedAgoText || "";
  return `последний: ${heart.latestBpm}, ${age}`;
}

function recoveryHeartSummary(heart = {}) {
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return rangeInfo.avg > 0 ? `${rangeInfo.rangeLabel}, ${rangeInfo.avgTitle.toLowerCase()} ${rangeInfo.avg} уд/мин` : rangeInfo.rangeLabel;
  }
  if (heart.latestBpm) return `${heart.latestBpm} уд/мин, ${heart.updatedAgoText || "без времени"}`;
  return "нет данных";
}

function friendlyHealthBadge(status) {
  if (status === "rate_limited") return "кэш";
  if (status === "fresh") return "свежие";
  if (status === "aging") return "сегодня";
  if (status === "today") return "сегодня";
  if (status === "old_today") return "за 24ч";
  if (status === "stale") return "устарели";
  return "данные";
}

function isRateLimitedUiStatus(status) {
  return status === "rate_limited" || status === "using_cache" || status === "temporarily_unavailable";
}

function friendlyHeartHint(heart = {}) {
  if (isRateLimitedUiStatus(heart.status) || isRateLimitedUiStatus(heart.widgetState) || heart.freshness === "rate_limited") {
    return heart.dataSource || heart.latestBpm
      ? "Apple Health временно ограничил запросы, показываем сохранённые данные."
      : "Apple Health пока не ответил. Повторите обновление позже.";
  }
  const rangeInfo = heartRangeInfo(heart);
  if (rangeInfo.hasRange) {
    return `${rangeInfo.hintPrefix}: ${rangeInfo.rangeLabel}. ${heartLatestLabel(heart)}.`;
  }
  if (heart.displayMode === "latest_only" && heart.latestTimestamp) {
    return `Есть только последнее измерение: ${new Date(heart.latestTimestamp).toLocaleDateString("ru-RU")} (${heart.updatedAgoText || ""}).`;
  }
  if (heart.latestBpm) return `Последний пульс: ${heart.latestBpm} уд/мин, ${heart.updatedAgoText || "время неизвестно"}.`;
  return "Пульс появится после синхронизации трекера.";
}

function friendlySourceHint(metric = {}, type = "metric") {
  if (isRateLimitedUiStatus(metric.status) || isRateLimitedUiStatus(metric.widgetState)) {
    return metric.dataSource
      ? "Apple Health ограничил частоту запросов, показываем сохранённые данные."
      : "Apple Health временно недоступен. Повторите обновление позже.";
  }
  if (metric.isEstimated || metric.status === "estimated") {
    return "Значение рассчитано приблизительно.";
  }
  if (!metric.dataSource) {
    return type === "sleep"
      ? "Данных сна пока нет. Можно внести сон вручную."
      : "Данные появятся после синхронизации трекера.";
  }
  return "Данные получены из Apple Health.";
}

function friendlyEmptyCopy(kind, status, hasPartialData = false) {
  if (isRateLimitedUiStatus(status)) {
    return {
      headline: "Показываем сохранённые данные",
      description: "Apple Health временно ограничил запросы. FruitFit обновит виджет после паузы.",
      actionLabel: "Проверить",
    };
  }
  if (status === "permission_required") {
    return {
      headline: "Нужно разрешение",
      description: "FruitFit нужен доступ Apple Health, чтобы читать эти данные.",
      actionLabel: "Подключить",
    };
  }
  if (kind === "heart") {
    return {
      headline: "Пульс пока не найден",
      description: "Синхронизируйте трекер с Apple Health, и FruitFit покажет диапазон за сутки.",
      actionLabel: "Обновить",
    };
  }
  if (kind === "sleep") {
    return {
      headline: "Сон пока не найден",
      description: "Если трекер не записал сон, можно внести его вручную.",
      actionLabel: "Посмотреть",
    };
  }
  if (kind === "recovery" && hasPartialData) {
    return {
      headline: "Восстановление почти готово",
      description: "Есть часть данных. Добавьте сон или дождитесь синхронизации, чтобы расчёт стал точнее.",
      actionLabel: "Посмотреть",
    };
  }
  return {
    headline: "Данных пока нет",
    description: "Apple Health подключён, данные появятся после синхронизации трекера.",
    actionLabel: "Обновить",
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
          <p className="text-[11px] font-bold uppercase tracking-wide text-appMuted">Всего</p>
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
        <p className="mt-1 text-[10px] font-bold text-appMuted">Сегодня шагов пока нет. Данные появятся после синхронизации трекера.</p>
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
    copy.headline = "Сон пока не найден";
    copy.description = "Если трекер не записал сон, можно внести его вручную.";
    copy.actionLabel = "Внести сон";
    return <EmptyHealthWidget title="Сон" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> Сон</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(health.sleep.minutes)}</p>
      <p className="text-[11px] text-appMuted">Качество: {health.sleep.quality}/5</p>
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
    return <EmptyHealthWidget title="Сон" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> Сон</span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(sleep.minutes || selectedDay?.totalMinutes || 0)}</p>
      <p className="mt-1 text-[10px] font-bold text-appMuted">Источник: {sourceLabel}</p>
      {warning && <p className="mt-1 text-[10px] font-black text-amber-500">{warning}</p>}
      <p className="text-[11px] text-appMuted">Ночной сон: {formatSleepDuration(nightMinutes)} · Дремы: {formatSleepDuration(napMinutes)}</p>
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
    return <EmptyHealthWidget title="Восстановление" icon={Activity} color="#8BBE3D" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={copy.headline} description={copy.description} actionLabel={copy.actionLabel} />;
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="cursor-pointer overflow-hidden rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex min-w-0 max-w-full items-start gap-2 text-[13px] font-bold leading-4 text-appText"><Activity size={15} className="shrink-0 text-[#8BBE3D]" /> <span className="min-w-0 break-words">Восстановление</span></span>
      <div className="mt-2 flex justify-end">
        <DashboardRefreshButton onRefresh={onRefresh} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Ring value={score} size={64}>
          <span className="text-[18px] font-black text-appText">{score}%</span>
        </Ring>
        <div className="min-w-0 overflow-hidden">
          <p className="line-clamp-1 text-[13px] font-black text-appText">{readiness.status || "Готовность"}</p>
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
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Цикл</span>
        <p className="mt-3 text-[12px] font-black leading-4 text-appText">Настройте цикл</p>
        <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-appMuted">Добавьте дату начала последней менструации, чтобы FruitFit рассчитал прогноз.</p>
      </motion.button>
    );
  }
  const progress = cycle.progress || Math.round((cycle.cycleDay / cycle.cycleLengthDays) * 100);
  const nextPeriodText = cycle.daysUntilNextPeriod === 0 ? "сегодня" : `через ${cycle.daysUntilNextPeriod} дн.`;
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Цикл</span>
      <div className="mt-3 grid grid-cols-[1fr_40px] items-center gap-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black leading-4 text-appText">{cycle.cycleDay} день цикла</p>
          <p className="truncate text-[10px] font-bold leading-4 text-violet-500">{cycle.phaseLabel}</p>
          <p className="mt-1 text-[10px] leading-4 text-appMuted">Менструация примерно {nextPeriodText}</p>
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
        <h3 className="text-[15px] font-black text-appText">Активность за неделю</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">Нет данных активности</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">FruitFit покажет шаги и калории после подключения трекера.</p>
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
          Подключить
        </span>
      </motion.button>
    );
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="col-span-2 rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-black text-appText">Активность за неделю</h3>
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
          <h3 className="text-[15px] font-black text-appText">Активность за неделю</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">Нет данных активности</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">Подключите Apple Health, чтобы видеть недельную историю.</p>
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
          Подключить
        </span>
      </motion.button>
    );
  }
  return (
    <motion.div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(event) => openWidgetFromKeyboard(event, onOpen)} whileTap={{ scale: 0.985 }} className="col-span-2 cursor-pointer rounded-[24px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[15px] font-black text-appText">Активность за неделю</h3>
          <p className="mt-1 text-[11px] text-appMuted">Шаги и активные калории</p>
        </div>
        <ChevronRight size={17} className="text-appMuted" />
      </div>
      <div className="mt-3">
        <DualMetricBarChart days={days} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appBg/70 p-2">
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">{activityDayTitle(selectedDay)}</p>
          <p className="mt-1 text-[13px] font-black text-appText">{Number(selectedDay.steps || 0).toLocaleString("ru-RU")} шагов</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">Активные</p>
          <p className="mt-1 text-[13px] font-black text-[#FF7A2F]">{Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} ккал</p>
        </div>
        <div>
          <p className="text-[9px] font-bold uppercase text-appMuted">Всего</p>
          <p className="mt-1 text-[13px] font-black text-appText">{selectedDay.totalCalories ? `${Number(selectedDay.totalCalories).toLocaleString("ru-RU")} ккал` : "—"}</p>
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
  const [courseActionLoading, setCourseActionLoading] = useState(false);
  const [courseActionStatus, setCourseActionStatus] = useState("");
  const [accessPolicy, setAccessPolicy] = useState(loadLectureAccessPolicy);
  const visibleLectures = visibleLecturesForAccess(lectures, access, accessPolicy);
  const safeIndex = Math.max(0, Math.min(index, Math.max(visibleLectures.length - 1, 0)));
  const activeLecture = visibleLectures[safeIndex] || lectures[0];
  const activeLectureText = lectureTextFor(activeLecture?.id);
  const [meta, setMeta] = useState({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
  const hasHostedVideo = Boolean(activeLecture?.selectelUrl);
  const lectureLocked = APP_STORE_REVIEW ? false : !canOpenLecture(activeLecture, safeIndex, access, accessPolicy);
  const completed = safeProgress.completedIds.includes(activeLecture.id);
  const totalPercent = progressForLectureState(safeProgress, visibleLectures);
  const isFreeAccess = !APP_STORE_REVIEW && accessTier(access) === "free";
  const showLectureCourseCta = !lectureLocked && safeIndex === 5 && (APP_STORE_REVIEW || isFreeAccess);

  function openFullVideo() {
    if (lectureLocked) return;
    openExternalVideo(lecturePlaybackUrl(activeLecture));
  }

  async function openLectureCourseAction() {
    if (courseActionLoading) return;
    if (!getAuthToken()) {
      setCourseActionStatus("Войдите в аккаунт, чтобы отправить заявку тренеру.");
      return;
    }
    setCourseActionLoading(true);
    setCourseActionStatus("");
    try {
      const result = await openLectureProgramAction({
        source: APP_STORE_REVIEW ? "ios-lecture-6" : "lecture-6",
        openExternalUrl,
      });
      if (result?.message) setCourseActionStatus(result.message);
    } catch (error) {
      setCourseActionStatus(error?.message || "Не удалось открыть страницу.");
    } finally {
      setCourseActionLoading(false);
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
    setCopyStatus("Скопировано");
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
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="Назад">
          <ChevronLeft size={22} />
        </button>
        <div className="min-w-0">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Лекция {safeIndex + 1} из {visibleLectures.length || lectures.length}</p>
          <h1 className="line-clamp-1 text-[23px] font-black leading-tight text-appText">{activeLecture.shortTitle || activeLecture.title}</h1>
        </div>
      </header>

      <section className="overflow-hidden rounded-[28px] border border-appBorder bg-appCard/95 shadow-sm">
        <div className="bg-appDark">
          {lectureLocked && !APP_STORE_REVIEW ? (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-black px-6 text-center">
              <div className="grid h-14 w-14 place-items-center rounded-full bg-appCard text-appGreen">
                <Lock size={24} />
              </div>
              <div>
                <p className="text-[15px] font-black text-appText">Материал пока недоступен</p>
                <p className="mt-1 text-[12px] font-semibold leading-5 text-appMuted">Тренер подскажет дальнейший маршрут после заявки.</p>
              </div>
            </div>
          ) : (
            <LectureVideoPlayer item={activeLecture} title={meta.title || activeLecture.title} thumbnailUrl={meta.thumbnailUrl} />
          )}
        </div>
        <div className="p-4">
          <p className="text-[12px] font-black uppercase tracking-wide text-appMuted">Прогресс: {totalPercent}%</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-appBg">
            <span className="block h-full rounded-full bg-appGreen" style={{ width: `${totalPercent}%` }} />
          </div>
          <h2 className="mt-4 text-[22px] font-black leading-tight text-appText">{activeLecture.title}</h2>
          <p className="mt-2 text-[13px] font-semibold leading-5 text-appMuted">{activeLecture.subtitle}</p>
          {lectureLocked && !APP_STORE_REVIEW ? (
            <p className="mt-3 rounded-2xl bg-appBg px-3 py-3 text-[12px] leading-5 text-appMuted">
              Материал пока недоступен. Тренер подскажет дальнейший маршрут после заявки.
            </p>
          ) : showLectureCourseCta ? (
            <div className="mt-3 rounded-2xl bg-appBg px-3 py-3">
              <p className="text-[14px] font-black leading-5 text-appText">У тебя всё получится! 💪</p>
              <button
                type="button"
                onClick={openLectureCourseAction}
                disabled={courseActionLoading}
                className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen px-4 text-[14px] font-black text-[#181F19] disabled:opacity-70"
              >
                {courseActionLoading ? "Отправляем заявку..." : "Оставить заявку тренеру"}
              </button>
              {courseActionStatus && <p className="mt-2 text-[12px] font-semibold leading-5 text-appMuted">{courseActionStatus}</p>}
            </div>
          ) : null}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => move(-1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              <ChevronLeft size={17} /> Назад
            </button>
            <button type="button" onClick={() => move(1)} className="flex h-11 items-center justify-center gap-2 rounded-full bg-appBg text-[13px] font-black text-appText">
              Далее <ChevronRight size={17} />
            </button>
          </div>
          <button
            type="button"
            onClick={markComplete}
            disabled={lectureLocked}
            className={`mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-full text-[14px] font-black ${lectureLocked ? "bg-appBg text-appMuted" : "bg-appGreen text-[#181F19]"}`}
          >
            <CheckCircle2 size={18} /> {completed ? "Пройдено" : "Отметить пройденной"}
          </button>
          <button
            type="button"
            onClick={openFullVideo}
            disabled={lectureLocked}
            className={`mt-3 flex h-12 w-full items-center justify-center rounded-full text-[14px] font-black ${lectureLocked ? "bg-appBg text-appMuted" : "bg-appDark text-appGreen"}`}
          >
            Открыть видео
          </button>
        </div>
      </section>

      <section className="mt-4 overflow-hidden rounded-[24px] border border-appBorder bg-appCard">
        <button type="button" onClick={() => setTextOpen((value) => !value)} className="flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left">
          <span className="text-[14px] font-black text-appText">Текст лекции</span>
          <ChevronRight size={17} className={`text-appMuted transition ${textOpen ? "rotate-90" : ""}`} />
        </button>
        {textOpen && (
          <div className="border-t border-appBorder px-4 py-3">
            {activeLectureText ? (
              <>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-appMuted">{activeLectureText.length.toLocaleString("ru-RU")} символов</span>
                  <button
                    type="button"
                    onClick={copyLectureText}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]"
                  >
                    <Copy size={14} /> {copyStatus || "Скопировать"}
                  </button>
                </div>
                <div className="allow-select max-h-[52vh] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-appBorder bg-appBg px-3 py-3 text-[12px] leading-5 text-appText">
                  {activeLectureText}
                </div>
              </>
            ) : (
              <p className="text-[12px] leading-5 text-appMuted">Текст лекции пока недоступен.</p>
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
  const title = isSteps ? "Шаги" : "Калории";
  const unit = isSteps ? "шагов" : "ккал";

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
    return <p className="rounded-[22px] bg-appBg p-4 text-[13px] text-appMuted">{isSteps ? "Шаги" : "Калории"} пока не найдены. Проверьте подключение Apple Health.</p>;
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
        <p className="mt-2 text-[13px] text-appMuted">Цель: {target.toLocaleString("ru-RU")} {unit} · {detailPercent}%</p>
        <p className="mt-1 text-[12px] font-semibold text-appMuted">{friendlySourceHint(metric, type)}</p>
      </div>
      {!isSteps && (
        <div className="mt-4 grid grid-cols-1 gap-2">
          <StatPill label="Активные" value={`${Number(metric.activeToday ?? metric.today ?? 0).toLocaleString("ru-RU")} ккал`} accent />
          {Number(metric.restingToday || 0) > 0 && <StatPill label="Базовые / BMR" value={`${Number(metric.restingToday || 0).toLocaleString("ru-RU")} ккал`} />}
          {Number(metric.totalToday || 0) > 0
            ? <StatPill label="Всего" value={`${Number(metric.totalToday || 0).toLocaleString("ru-RU")} ккал`} />
            : <ChartEmptyState>Общие калории пока не пришли из Apple Health.</ChartEmptyState>}
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
              ? "За сегодня есть агрегированное значение. Детальная разбивка появится после синхронизации истории."
              : "За сегодня есть агрегированное значение калорий, история обновится после синхронизации."}
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
          <ChartEmptyState>{period === "today" ? "За сегодня почасовой истории нет." : "За выбранный период истории пока нет."}</ChartEmptyState>
        )}
        {activeValue !== null && (
          <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[12px] font-bold text-appText">
            {activeLabel}: {Number(activeValue || 0).toLocaleString("ru-RU")} {unit}
          </p>
        )}
      </div>
      <MiniGuide
        title={isSteps ? "На что влияют шаги?" : "На что влияют калории?"}
        items={isSteps
          ? ["Шаги помогают понять общий уровень активности за день.", "Если шагов мало и восстановление среднее, лучше выбрать мягкую нагрузку или прогулку.", "История может обновиться после синхронизации часов с Apple Health."]
          : ["Калории помогают сопоставить питание, активность и восстановление.", "Смотрите отдельно активные и общие калории: они считаются по-разному.", "Если данные выглядят странно, обновите Apple Health и приложение часов."]}
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
  const heartOptions = ["норма", "усталость", "стресс", "после тренировки", "плохо"];
  const lastHeartTime = heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "нет данных";
  const heartAgeHours = Number(heart.latestAgeMinutes || 0) > 0 ? Math.round(Number(heart.latestAgeMinutes) / 60) : null;
  const heartStatusText = heart.freshness === "stale"
    ? "Новых измерений давно не было"
    : heart.freshness === "no_data"
      ? "Пульс пока не найден"
      : "Данные пульса доступны";
  const heartAdvice = heart.latestTimestamp
    ? (heartAgeHours && heartAgeHours > 4
      ? "Откройте приложение часов или Mi Fitness/Samsung Health и дождитесь синхронизации с Apple Health."
      : friendlyHeartHint(heart))
    : "Разрешите пульс в Apple Health и синхронизируйте часы.";

  return (
    <>
      <div className="flex rounded-full bg-appBg p-1">
        {[
          ["day", "24 часа"],
          ["week", "7 дней"],
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
          : <ChartEmptyState>График пульса пока пуст. Данные появятся после синхронизации.</ChartEmptyState>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label={rangeInfo.rangeTitle} value={rangeInfo.rangeLabel} accent />
        <StatPill label={rangeInfo.avgTitle} value={rangeInfo.avg > 0 ? `${rangeInfo.avg} уд/мин` : "нет данных"} />
        <StatPill label="Последний" value={heart.latestBpm ? `${heart.latestBpm} уд/мин` : "нет данных"} />
        <StatPill label="Покой" value={heart.resting ? `${heart.resting} уд/мин` : "нет данных"} />
        <StatPill label="Источник" value={sourceName} />
        <StatPill label="Обновлено" value={heart.updatedAgoText || "нет данных"} />
      </div>

      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">Статус:</span> {heartStatusText}</p>
        <p><span className="font-black text-appText">Последнее измерение:</span> {lastHeartTime}</p>
        <p>{heartAdvice}</p>
      </div>

      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">Самочувствие</p>
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
          Отметка самочувствия помогает сопоставить пульс, нагрузку и восстановление.
        </p>
      </div>

      <MiniGuide
        title="На что смотреть?"
        items={[
          "Смотрите не только последнее измерение, а диапазон и средний пульс за сутки.",
          "Если средний пульс выше обычного, снизьте интенсивность тренировки.",
          "FruitFit учитывает пульс в восстановлении вместе со сном и активностью.",
        ]}
      />
    </>
  );
}

function HeartDetail({ health, setHeartCondition }) {
  const heart = health.heart_rate;
  const rangeInfo = heartRangeInfo(heart);
  const sourceName = healthSourceDisplayName(heart.latestSourcePackage || heart.sourcePackage, heart.latestSourceName || heart.sourceName);
  const heartOptions = ["норма", "усталость", "стресс", "после тренировки", "плохо"];
  const lastHeartTime = heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "нет данных";
  const heartAgeHours = Number(heart.latestAgeMinutes || 0) > 0 ? Math.round(Number(heart.latestAgeMinutes) / 60) : null;
  const heartStatusText = heart.freshness === "stale"
    ? "Новых измерений давно не было"
    : heart.freshness === "no_data"
      ? "Пульс пока не найден"
      : "Данные пульса доступны";
  const heartAdvice = heart.latestTimestamp
    ? (heartAgeHours && heartAgeHours > 4
      ? "Откройте приложение часов или Mi Fitness/Samsung Health и дождитесь синхронизации с Apple Health."
      : friendlyHeartHint(heart))
    : "Разрешите пульс в Apple Health и синхронизируйте часы.";
  return (
    <>
      {hasChartData(heart.hourly)
        ? <LineChart values={heart.hourly} color="#EF4444" />
        : <ChartEmptyState>График пульса пока пуст. Данные появятся после синхронизации.</ChartEmptyState>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label={rangeInfo.rangeTitle} value={rangeInfo.rangeLabel} accent />
        <StatPill label={rangeInfo.avgTitle} value={rangeInfo.avg > 0 ? `${rangeInfo.avg} уд/мин` : "нет данных"} />
        <StatPill label="Последний" value={heart.latestBpm ? `${heart.latestBpm} уд/мин` : "нет данных"} />
        <StatPill label="Покой" value={heart.resting ? `${heart.resting} уд/мин` : "нет данных"} />
        <StatPill label="Источник" value={sourceName} />
        <StatPill label="Обновлено" value={heart.updatedAgoText || "нет данных"} />
      </div>
      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">Статус:</span> {heartStatusText}</p>
        <p><span className="font-black text-appText">Последнее измерение:</span> {lastHeartTime}</p>
        <p>{heartAdvice}</p>
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">Самочувствие</p>
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
          Отметка самочувствия помогает сопоставить пульс, нагрузку и восстановление.
        </p>
      </div>
      <MiniGuide
        title="На что смотреть?"
        items={[
          "Смотрите не только последнее измерение, а диапазон и средний пульс за сутки.",
          "Если средний пульс выше обычного, снизьте интенсивность тренировки.",
          "FruitFit учитывает пульс в восстановлении вместе со сном и активностью.",
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
      <span className="mt-2 block text-[10px] font-semibold text-appMuted">Формат: 23:30</span>
    </label>
  );
}

function SleepDetail({ health, updateSleepManual }) {
  const [sleep, setSleep] = useState(health.sleep);
  const [saved, setSaved] = useState(false);
  const [period, setPeriod] = useState("week");
  const source = health.sleep.dataSource === "manual" ? "Ручной ввод" : "Данные трекера";
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
        <p className="mt-2 text-[13px] text-appMuted">Качество: {health.sleep.quality}/5</p>
      </div>
      <div className="mt-4 flex rounded-full bg-appBg p-1">
        {[["week", "Неделя"], ["month", "Месяц"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setPeriod(id)} className={`h-9 flex-1 rounded-full text-[12px] font-bold transition ${period === id ? "bg-appCard text-appText shadow-sm" : "text-appMuted"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {hasChartData(sleepValues)
          ? <BarChart values={sleepValues} color="#60A5FA" labels={sleepLabels} />
          : <ChartEmptyState>{period === "week" ? "За неделю истории сна пока нет." : "За месяц истории сна пока нет."}</ChartEmptyState>}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <h3 className="text-[13px] font-black text-appText">Ручной ввод сна</h3>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Дата
          <input type="date" value={sleep.date || new Date().toISOString().slice(0, 10)} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SleepTimeInput label="Начало" value={sleep.bed} onChange={(value) => update("bed", value)} />
          <SleepTimeInput label="Конец" value={sleep.wake} onChange={(value) => update("wake", value)} />
        </div>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Качество: {sleep.quality}/5
          <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
        </label>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">
          <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Например: просыпался, жарко, хороший сон" className="mt-1 min-h-20 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appCard p-2">
          {["Лёгкий", "Глубокий", "REM"].map((phase, index) => (
            <div key={phase} className="rounded-[14px] bg-appBg px-2 py-2 text-center">
              <p className="text-[10px] font-bold text-appMuted">{phase}</p>
              <p className="mt-1 text-[13px] font-black text-appText">{[22, 56, 22][index]}%</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Ручной сон используется в карточке сна и восстановлении.</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Фазы показаны только как ориентир, если трекер их не передал.</p>
        <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Сохранить сон</button>
        {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">Сон сохранён</p>}
      </div>
      <MiniGuide
        title="Как использовать сон?"
        items={[
          "Если трекер не записал ночь, внесите сон вручную: он попадёт в восстановление.",
          "Дремы помогают восстановлению, но не заменяют полноценный ночной сон.",
        ]}
      />
    </>
  );
}

function RecoveryDetail({ health }) {
  const readiness = health.readiness;
  const recoveryStats = [
    ["Сон прошлой ночью", readiness.sleepLastNightMinutes ? formatSleepDuration(readiness.sleepLastNightMinutes) : "нет данных"],
    ["Средний сон 7д", readiness.sleep7dAverageMinutes ? formatSleepDuration(readiness.sleep7dAverageMinutes) : "нет данных"],
    ["Дремы", readiness.napsTodayMinutes ? formatSleepDuration(readiness.napsTodayMinutes) : "нет"],
    ["Пульс 24ч", readiness.heartAvg24h ? `${readiness.heartRange24h?.[0] || "?"}-${readiness.heartRange24h?.[1] || "?"}` : "нет данных"],
    ["Пульс 7д", readiness.heartAvg7d ? `${readiness.heartRange7d?.[0] || "?"}-${readiness.heartRange7d?.[1] || "?"}` : "нет данных"],
    ["Шаги", readiness.stepsToday ? `${Number(readiness.stepsToday).toLocaleString("ru-RU")} шагов` : "нет данных"],
  ];
  if (readiness.score == null) {
    return (
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">Недостаточно данных</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">
          Пульс: {recoveryHeartSummary(health.heart_rate)}. Сон: {health.sleep?.minutes ? formatSleepDuration(health.sleep.minutes) : "нет данных"}. Шаги: {(health.steps?.today || 0).toLocaleString("ru-RU")}.
        </p>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Добавьте сон или дождитесь синхронизации трекера, чтобы FruitFit рассчитал восстановление.</p>
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
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">готовность</p>
            </div>
          </Ring>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Рекомендация</p>
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
        <p className="text-[13px] font-black text-appText">Детали расчёта</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {recoveryStats.map(([label, value]) => (
            <StatPill key={label} label={label} value={value} />
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">{readiness.recommendation}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Полнота данных: {readiness.dataCompleteness ?? 0}% · активность: {readiness.activityStatus || "unknown"}</p>
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
          <p className="text-[18px] font-black text-appText">Цикл не настроен</p>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">Добавьте дату начала последней менструации, чтобы FruitFit рассчитал день цикла, фазу и ориентировочный прогноз.</p>
        </div>
	        <div className="mt-4 grid gap-3 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
	          <CycleField label="Дата начала последней менструации">
	            <input type="date" value={draft.lastPeriodStartDate} onChange={(event) => updateDraft("lastPeriodStartDate", event.target.value)} className={`${cycleInputClass} cycle-date-input text-center`} />
	          </CycleField>
	          <div className="grid grid-cols-2 gap-2">
	            <CycleField label="Длина цикла">
	              <input value={draft.cycleLengthDays} inputMode="numeric" onChange={(event) => updateDraft("cycleLengthDays", event.target.value)} className={cycleInputClass} />
	            </CycleField>
	            <CycleField label="Дней менструации">
	              <input value={draft.periodLengthDays} inputMode="numeric" onChange={(event) => updateDraft("periodLengthDays", event.target.value)} className={cycleInputClass} />
	            </CycleField>
	          </div>
	          <button type="button" onClick={saveCycle} className="h-11 rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Сохранить</button>
	        </div>
      </>
    );
  }

  const ovulationText = cycle.daysUntilOvulation == null
    ? `примерно ${cycle.ovulationDate || "в этом цикле"}`
    : cycle.daysUntilOvulation === 0
      ? "примерно сегодня"
      : `примерно через ${cycle.daysUntilOvulation} дн.`;
  const nextPeriodText = cycle.daysUntilNextPeriod === 0 ? "сегодня" : `через ${cycle.daysUntilNextPeriod} дн.`;
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <div className="flex items-center gap-4">
          <Ring value={cycle.progress || Math.round((cycle.cycleDay / cycle.cycleLengthDays) * 100)} color={phaseColor} size={98}>
            <div className="text-center">
              <p className="text-[24px] font-black leading-none text-appText">{cycle.cycleDay}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">день</p>
            </div>
          </Ring>
          <div>
            <p className="text-[13px] font-bold uppercase text-appMuted">Фаза</p>
            <p className="mt-1 text-[20px] font-black text-appText">{cycle.phaseLabel}</p>
            <p className="mt-2 text-[12px] text-appMuted">Овуляция {ovulationText}</p>
          </div>
        </div>
        <div className="mt-4 h-3 rounded-full bg-appCard">
          <div className="relative h-full rounded-full" style={{ width: `${cycle.progress || 0}%`, background: phaseColor }}>
            <span className="absolute right-0 top-1/2 h-4 w-4 -translate-y-1/2 translate-x-1/2 rounded-full border-2 border-appCard" style={{ background: phaseColor }} />
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-[20px] bg-appBg p-3">
        <h3 className="text-[13px] font-black text-appText">Подсказка по нагрузке</h3>
        <p className="mt-2 text-[12px] leading-5 text-appMuted">{cycle.recommendation}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Прогноз ориентировочный и зависит от введённых данных.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="Следующая менструация" value={`${nextPeriodText}${cycle.nextPeriodDate ? ` · ${compactDateLabel(cycle.nextPeriodDate)}` : ""}`} accent />
        <StatPill label="Овуляция" value={`${ovulationText}${cycle.ovulationDate ? ` · ${compactDateLabel(cycle.ovulationDate)}` : ""}`} />
      </div>
	      <div className="mt-4 grid gap-3 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
	        <CycleField label="Дата начала последней менструации">
	          <input type="date" value={draft.lastPeriodStartDate} onChange={(event) => updateDraft("lastPeriodStartDate", event.target.value)} className={`${cycleInputClass} cycle-date-input text-center`} />
	        </CycleField>
	        <div className="grid grid-cols-2 gap-2">
	          <CycleField label="Длина цикла">
	            <input value={draft.cycleLengthDays} inputMode="numeric" onChange={(event) => updateDraft("cycleLengthDays", event.target.value)} className={cycleInputClass} />
	          </CycleField>
	          <CycleField label="Дней менструации">
	            <input value={draft.periodLengthDays} inputMode="numeric" onChange={(event) => updateDraft("periodLengthDays", event.target.value)} className={cycleInputClass} />
	          </CycleField>
	        </div>
	        <button type="button" onClick={saveCycle} className="h-11 rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Сохранить настройки цикла</button>
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
        <p className="text-[18px] font-black text-appText">Нет данных активности</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">Подключите Apple Health, чтобы FruitFit показал историю за неделю.</p>
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
        <StatPill label="Шаги за неделю" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="Калории" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Средние шаги" value={avgSteps.toLocaleString("ru-RU")} />
        <StatPill label="Активные дни" value={`${activeDays}/7`} />
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
      const confirmed = window.confirm("За этот день уже есть запись сна. Заменить её?");
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
      <h3 className="text-[13px] font-black text-appText">{existingManualEntry ? "Изменить запись сна" : "Добавить сон"}</h3>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Дата
        <input type="date" value={sleep.date} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SleepTimeInput label="Начало" value={sleep.bed} onChange={(value) => update("bed", value)} />
        <SleepTimeInput label="Конец" value={sleep.wake} onChange={(value) => update("wake", value)} />
      </div>
      <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Качество: {sleep.quality}/5
        <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
      </label>
      <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Комментарий" className="mt-3 min-h-16 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
      <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">{existingManualEntry ? "Изменить запись" : "Сохранить сон"}</button>
      {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">Сон сохранён</p>}
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
          <p className="text-[18px] font-black text-appText">Сон пока не найден</p>
          <p className="mt-2 text-[13px] leading-5 text-appMuted">Apple Health не передал записи сна. Можно внести сон вручную.</p>
        </div>
        <ManualSleepSection health={health} updateSleepManual={updateSleepManual} selectedDate={sleepDays[6]?.date || sleepDays[6]?.key} />
      </>
    );
  }
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Источник: {selectedSourceLabel}</p>
        <p className="mt-2 text-[42px] font-black leading-none text-appText">{formatSleepDuration(selectedDay?.totalMinutes || sleep.minutes || 0)}</p>
        {selectedWarning && <p className="mt-2 rounded-2xl bg-amber-100 px-3 py-2 text-[11px] font-black text-amber-700">{selectedWarning}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="Ночной сон" value={formatSleepDuration(nightTotal)} accent />
          <StatPill label="Дремы" value={formatSleepDuration(napTotal)} />
        </div>
      </div>
      {nightTotal <= 0 && napTotal > 0 && <p className="mt-3 rounded-2xl bg-appBg px-3 py-2 text-[11px] font-bold text-appMuted">Ночной сон не найден. Есть только дремы или короткие фрагменты.</p>}
      <SleepDayBars days={sleepDays} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
      <SleepStageBreakdown day={selectedDay} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="Сон прошлой ночи" value={formatSleepDuration(selectedDay?.nightMinutes || sleep.nightMinutes || 0)} accent />
        <StatPill label="Средний сон 7д" value={avgNight7d ? formatSleepDuration(avgNight7d) : "нет данных"} />
        <StatPill label="Дремы за неделю" value={formatSleepDuration(napTotal)} />
        <StatPill label="Качество" value={manualQuality ? `${manualQuality}/5` : "нет данных"} />
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
        <p className="text-[18px] font-black text-appText">Нет данных активности</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">Подключите Apple Health, чтобы FruitFit показал недельную историю.</p>
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
        <StatPill label="Шаги за неделю" value={totalSteps.toLocaleString("ru-RU")} accent />
        <StatPill label="Активные ккал" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Всего ккал" value={totalAllCalories ? totalAllCalories.toLocaleString("ru-RU") : "нет данных"} />
        <StatPill label="Средние шаги" value={avgSteps.toLocaleString("ru-RU")} />
      </div>
      <div className="mt-4">
        <DualMetricBarChart days={week} selectedIndex={selectedIndex} onSelect={setSelectedIndex} height={154} />
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-4">
        <p className="text-[12px] font-black uppercase text-appMuted">{activityDayTitle(selectedDay)}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatPill label="Шаги" value={Number(selectedDay.steps || 0).toLocaleString("ru-RU")} accent />
          <StatPill label="Активные ккал" value={Number(selectedDay.activeCalories ?? selectedDay.calories ?? 0).toLocaleString("ru-RU")} />
          <StatPill label="Всего ккал" value={selectedDay.totalCalories ? Number(selectedDay.totalCalories).toLocaleString("ru-RU") : "нет данных"} />
          <StatPill label="Дистанция" value={selectedDay.distance ? `${selectedDay.distance} м` : "нет данных"} />
          <StatPill label="Пульс" value={selectedDay.heart ? `${selectedDay.heart} уд/мин` : "нет данных"} />
        </div>
        {selectedDay.suspicious && <p className="mt-3 rounded-2xl bg-red-50 px-3 py-2 text-[11px] font-bold text-red-500">Этот день помечен как подозрительный и не используется для масштаба графика.</p>}
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
      aria-label="Обновить данные Apple Health"
    >
      <RefreshCcw size={14} />
    </button>
  );
}

export function HealthDetailScreen({ type, onBack }) {
  const { health, setHeartCondition, updateSleepManual, updateCycle, syncNativeHealth, syncing, syncError } = useHealth();
  const [refreshNote, setRefreshNote] = useState("");
  const titles = {
    heart: "Пульс",
    steps: "Шаги",
    calories: "Калории",
    sleep: "Сон",
    recovery: "Восстановление",
    cycle: "Цикл",
    weekly: "Активность",
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
    setRefreshNote(result?.message ? "Данные скоро обновятся" : "Синхронизация проверена");
  }

  return (
    <main className="phone-shell min-h-screen px-5 pb-[calc(24px+env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+92px)]">
      <header className="fixed-shell fixed left-1/2 top-0 z-50 flex -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-2.5 pt-[calc(env(safe-area-inset-top)+10px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="Назад">
          <ChevronLeft size={22} />
        </button>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Apple Health</p>
          <h1 className="text-[24px] font-black leading-tight text-appText">{titles[type] || "Детали"}</h1>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={syncing}
          className="ml-auto grid h-10 w-10 place-items-center rounded-full bg-appCard text-appMuted shadow-sm disabled:opacity-50"
          aria-label="Обновить данные"
        >
          <RefreshCcw size={17} className={syncing ? "animate-spin" : ""} />
        </button>
      </header>

      <section className="rounded-[28px] border border-appBorder bg-appCard/95 p-4 shadow-sm">
        <p className="mb-3 rounded-2xl bg-appBg/70 px-3 py-2 text-[11px] font-semibold text-appMuted">
          Синхронизация: {health.lastFruitFitRefreshAt ? new Date(health.lastFruitFitRefreshAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "данные скоро появятся"}
          {refreshNote ? ` · ${refreshNote}` : ""}
        </p>
        {syncError && <p className="mb-3 rounded-2xl border border-appBorder bg-appBg/80 px-3 py-2 text-[11px] font-bold text-appMuted">Данные скоро обновятся. Проверьте, что трекер синхронизировался с Apple Health.</p>}
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
        return <MetricWidget key={widget.id} kind="steps" status={health.steps.status} title="Шаги" icon={Footprints} value={health.steps.today} target={health.steps.goal} color="#8BBE3D" suffix="шагов" sourceNote={friendlySourceHint(health.steps, "steps")} onOpen={() => onNavigate?.("health:steps")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-steps-history7d", queryMode: WEEKLY_ACTIVITY_QUERY_MODE })} />;
      case "calories":
        return <MetricWidget key={widget.id} kind="calories" status={health.calories.status} title="Калории" icon={Flame} value={health.calories.today} target={health.calories.goal} color="#FF7A2F" suffix="ккал" sourceNote={friendlySourceHint(health.calories, "calories")} onOpen={() => onNavigate?.("health:calories")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true, reason: "dashboard-calories-history7d", queryMode: WEEKLY_ACTIVITY_QUERY_MODE })} />;
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
        <SlidersHorizontal size={14} /> {editMode ? "Готово" : "Настройка виджетов"}
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
                  {disabled && <span className="block truncate text-[10px] text-appMuted">Доступно для женского профиля</span>}
                </div>
                <button type="button" onClick={() => move(widget.id, -1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowUp size={13} /></button>
                <button type="button" onClick={() => move(widget.id, 1)} className="grid h-8 w-8 place-items-center rounded-full bg-appBg text-appMuted"><ArrowDown size={13} /></button>
                <button type="button" disabled={disabled} onClick={() => toggle(widget.id)} className={`h-8 rounded-full px-2 text-[11px] font-bold ${widget.enabled && !disabled ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appMuted"}`}>
                  {widget.enabled && !disabled ? "Вкл" : "Выкл"}
                </button>
              </div>
            );
          })}
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => commit(defaultWidgets)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appBg text-[12px] font-bold text-appMuted">
              <RefreshCcw size={13} /> Сбросить
            </button>
            <button type="button" onClick={() => setEditMode(false)} className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
              <CheckCircle2 size={14} /> Готово
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
