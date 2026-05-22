import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Footprints,
  Heart,
  Moon,
  Play,
  RefreshCcw,
  SlidersHorizontal,
  Utensils,
  X,
} from "lucide-react";
import NeutralPreview from "./NeutralPreview";
import { useHealth, formatSleepDuration } from "../data/healthStore";
import { lecturePlaybackUrl, lectures } from "../data/lectures";
import { dietTypeToRation } from "../data/profileStore";
import { getMealPlan, useNutritionData } from "../data/useNutritionData";

const widgetStorageKey = "fruitfit.widgets";

const lecture = lectures[0];

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
        <span>{max} уд/мин</span>
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

function MiniLectureWidget({ onOpen }) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      whileTap={{ scale: 0.985 }}
      className="col-span-2 grid grid-cols-[1fr_104px] gap-3 rounded-[22px] border border-appBorder bg-appCard/90 p-3 text-left shadow-sm"
    >
      <div className="min-w-0">
        <span className="inline-flex items-center gap-2 text-[12px] font-bold text-appMuted">
          <BookOpen size={14} /> Мини-лекция
        </span>
        <h3 className="mt-2 line-clamp-2 text-[15px] font-black leading-tight text-appText">{lecture.shortTitle || lecture.title}</h3>
        <p className="mt-2 text-[11px] text-appMuted">{lecture.subtitle}</p>
      </div>
      <div className="relative overflow-hidden rounded-[18px] bg-appDark">
        <NeutralPreview className="h-[78px] w-full rounded-[18px] opacity-80" compact />
        <span className="absolute inset-0 grid place-items-center text-white">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-black/42 backdrop-blur">
            <Play size={17} fill="currentColor" />
          </span>
        </span>
      </div>
    </motion.button>
  );
}

function EmptyHealthWidget({ title, icon: Icon, color = "#8BBE3D", onOpen, onConnect, onRefresh, headline = "Трекер не подключён", description = "После подключения Health Connect или Apple Health здесь появятся реальные данные.", actionLabel = "Подключить трекер" }) {
  const runAction = () => {
    if (actionLabel === "Обновить" || actionLabel === "Посмотреть") {
      onRefresh?.();
      if (actionLabel === "Посмотреть") onOpen?.();
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
        <span className="rounded-full bg-appBg px-2 py-1 text-[10px] font-bold text-appMuted">нет данных</span>
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
    || heart.recordsToday
    || heart.records24h
    || heart.records7d
    || (heart.hourly || []).length
  );
  const displayedBpm = heart.latestBpm || heart.current;
  if (!hasHeartData) {
    const permissionMissing = heart.status === "permission_required";
    const stale = heart.status === "stale";
    const hasLast = Boolean(heart.latestBpm);
    return (
      <EmptyHealthWidget
        title="Пульс"
        icon={Heart}
        color="#EF4444"
        onOpen={onOpen}
        onConnect={onConnect}
        onRefresh={onRefresh}
        headline={permissionMissing ? "Разрешение не выдано" : hasLast ? `Последний пульс: ${heart.latestBpm}` : stale ? "Нет актуальных данных" : "Нет данных пульса"}
        description={permissionMissing ? "Разрешите FruitFit читать пульс в Health Connect." : hasLast ? `Обновлено ${heart.updatedAgoText || "давно"}. Не показываю это как live HR.` : stale ? "Есть старые записи, но за последние 15 минут источник не передал пульс." : "Источник не передал данные пульса. Проверьте синхронизацию часов с Health Connect."}
        actionLabel={permissionMissing ? "Выдать доступ" : "Обновить"}
      />
    );
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Heart size={15} className="text-red-500" fill="currentColor" /> Пульс</span>
        <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-500">{heart.freshness === "fresh" ? "live" : heart.freshness || "data"}</span>
      </div>
      <p className="mt-3 text-[26px] font-black text-appText">{displayedBpm || "—"} <span className="text-[12px] font-medium text-appMuted">уд/мин</span></p>
      <Sparkline values={(heart.hourly || []).slice(-9)} color="#EF4444" />
      <p className="mt-2 text-[11px] text-appMuted">обновлено {heart.updatedAgoText || "только что"} · {heart.sourceName || "Health Connect"}</p>
    </motion.button>
  );
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
          <p className="text-[11px] font-bold uppercase tracking-wide text-appMuted">Итог за день</p>
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

function MetricWidget({ title, icon: Icon, value, target, color, suffix, sourceNote, onOpen, onConnect, onRefresh }) {
  if (value == null || value === 0) {
    return <EmptyHealthWidget title={title} icon={Icon} color={color} onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} actionLabel="Обновить" />;
  }
  const percent = formatPercent(value, target);
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Icon size={15} style={{ color }} /> {title}</span>
        <span className="text-[10px] font-bold text-appMuted">{percent}%</span>
      </div>
      <p className="mt-3 text-[26px] font-black text-appText">{formatCompact(value)}</p>
      <p className="text-[11px] text-appMuted">/ {target.toLocaleString("ru-RU")} {suffix}</p>
      {sourceNote && <p className="mt-1 text-[10px] font-bold text-appMuted">{sourceNote}</p>}
      <div className="mt-3 h-2 rounded-full bg-appBg">
        <motion.div className="h-full rounded-full" style={{ background: color }} animate={{ width: `${percent}%` }} />
      </div>
    </motion.button>
  );
}

function SleepWidget({ health, onOpen, onConnect, onRefresh }) {
  const sleep = health.sleep || {};
  const hasSleepData = Boolean(sleep.dataSource || sleep.minutes > 0 || (sleep.week || []).some((item) => Number(item.minutes || 0) > 0));
  if (!hasSleepData) {
    return <EmptyHealthWidget title="Сон" icon={Moon} color="#60A5FA" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} actionLabel="Обновить" />;
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Moon size={15} className="text-blue-500" /> Сон</span>
      <p className="mt-3 text-[24px] font-black text-appText">{formatSleepDuration(health.sleep.minutes)}</p>
      <p className="text-[11px] text-appMuted">качество: {health.sleep.quality}/5</p>
      <Sparkline values={health.sleep.week.map((item) => item.minutes)} color="#60A5FA" />
    </motion.button>
  );
}

function RecoveryWidget({ health, onOpen, onConnect, onRefresh }) {
  const score = health.readiness.score;
  if (score == null) {
    const hasPartialData = Boolean(health.heart_rate?.latestBpm || health.sleep?.minutes || health.steps?.today);
    return <EmptyHealthWidget title="Восстановление" icon={Activity} color="#8BBE3D" onOpen={onOpen} onConnect={onConnect} onRefresh={onRefresh} headline={hasPartialData ? "Недостаточно данных" : undefined} description={hasPartialData ? "Часть данных уже есть. Откройте детали, чтобы посмотреть, чего не хватает для точной оценки." : undefined} actionLabel={hasPartialData ? "Посмотреть" : "Обновить"} />;
  }
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Activity size={15} className="text-[#8BBE3D]" /> Восстановление</span>
      <div className="mt-3 flex items-center gap-3">
        <Ring value={score} size={64}>
          <span className="text-[18px] font-black text-appText">{score}%</span>
        </Ring>
        <p className="line-clamp-3 text-[11px] leading-4 text-appMuted">{health.readiness.recommendation}</p>
      </div>
    </motion.button>
  );
}

function CycleWidget({ health, onOpen }) {
  const progress = Math.round((health.cycle.day / health.cycle.length) * 100);
  return (
    <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.985 }} className="rounded-[22px] border border-appBorder bg-appCard/90 p-4 text-left shadow-sm">
      <span className="inline-flex items-center gap-2 text-[13px] font-bold text-appText"><Calendar size={15} className="text-violet-500" /> Цикл</span>
      <div className="mt-3 grid grid-cols-[1fr_40px] items-center gap-1">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-black leading-4 text-appText">{health.cycle.phase}</p>
          <p className="mt-1 text-[10px] leading-4 text-appMuted">овуляция через {health.cycle.ovulationInDays} дней</p>
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
        <h3 className="text-[15px] font-black text-appText">Активность за неделю</h3>
          <ChevronRight size={17} className="text-appMuted" />
        </div>
        <p className="mt-3 text-[18px] font-black text-appText">Трекер не подключён</p>
        <p className="mt-1 text-[12px] leading-5 text-appMuted">Шаги и активные калории появятся после подключения Health Connect или Apple Health.</p>
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
          Подключить трекер
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
            <span className="text-[10px] font-semibold text-appMuted">{health.activity_history.week[index].label}</span>
          </div>
        ))}
      </div>
    </motion.button>
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

function AppModal({ title, onClose, children }) {
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/36 px-2">
        <motion.section
          initial={{ y: 34 }}
          animate={{ y: 0 }}
          exit={{ y: 34 }}
          className="max-h-[88vh] w-full max-w-[393px] overflow-y-auto rounded-t-[30px] border border-appBorder bg-appCard p-4 pb-[max(20px,env(safe-area-inset-bottom))] shadow-soft"
        >
          <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-appBorder" />
          <div className="sticky top-0 z-10 -mx-1 flex items-center justify-between bg-appCard/94 px-1 pb-3 backdrop-blur">
            <h2 className="text-[25px] font-black tracking-[-0.02em] text-appText">{title}</h2>
            <button type="button" onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-appBg text-appText">
              <X size={18} />
            </button>
          </div>
          {children}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  );
}

function LectureModal({ onClose }) {
  const [index, setIndex] = useState(0);
  const [textOpen, setTextOpen] = useState(false);
  const activeLecture = lectures[index] || lectures[0];
  const [meta, setMeta] = useState({ title: activeLecture.title, thumbnailUrl: activeLecture.thumbnailUrl, error: "" });
  const hasSelectel = Boolean(activeLecture?.selectelUrl);

  function openFullVideo() {
    openExternalVideo(lecturePlaybackUrl(activeLecture));
  }

  function move(direction) {
    setIndex((value) => (value + direction + lectures.length) % lectures.length);
    setTextOpen(false);
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
    <AppModal title={activeLecture.shortTitle || activeLecture.title} onClose={onClose}>
      <p className="text-[13px] font-semibold text-appMuted">{activeLecture.subtitle}</p>
      <div className="mt-4 overflow-hidden rounded-[24px] bg-appDark shadow-card">
        <LectureVideoPlayer item={activeLecture} title={meta.title || activeLecture.title} thumbnailUrl={meta.thumbnailUrl} />
        <div className="border-t border-white/10 px-4 py-3">
          <button type="button" onClick={openFullVideo} className="text-[12px] font-bold text-appGreen">
            {hasSelectel ? "Открыть видео в отдельном окне" : "Если плеер не открылся внутри, открыть видео в YouTube"}
          </button>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-[44px_1fr_44px] items-center gap-2">
        <button type="button" onClick={() => move(-1)} className="grid h-11 w-11 place-items-center rounded-full bg-appBg text-appText">
          <ChevronLeft size={19} />
        </button>
        <div className="text-center">
          <p className="text-[11px] font-black uppercase tracking-wide text-appMuted">лекция {index + 1} из {lectures.length}</p>
          <p className="mt-1 line-clamp-1 text-[12px] font-bold text-appText">{activeLecture.title}</p>
        </div>
        <button type="button" onClick={() => move(1)} className="grid h-11 w-11 place-items-center rounded-full bg-appBg text-appText">
          <ChevronRight size={19} />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-[78px_1fr] gap-3 rounded-[20px] bg-appBg p-3">
        <img src={meta.thumbnailUrl} alt="" className="h-14 w-[78px] rounded-2xl object-cover" loading="lazy" />
        <div className="min-w-0">
          <p className="line-clamp-2 text-[12px] font-black leading-4 text-appText">{meta.title}</p>
          <p className="mt-1 text-[11px] text-appMuted">{hasSelectel ? "Видео загружается из Selectel через HTML5-плеер." : meta.error ? "Нажмите Play в плеере выше. Метаданные YouTube могут не успеть загрузиться." : "Нажмите Play в плеере выше, видео откроется внутри поп-апа."}</p>
        </div>
      </div>
      <section className="mt-3 overflow-hidden rounded-[20px] border border-appBorder bg-appBg">
        <button type="button" onClick={() => setTextOpen((value) => !value)} className="flex min-h-12 w-full items-center justify-between px-4 text-left">
          <span className="text-[13px] font-black text-appText">Текстовая версия лекции</span>
          <ChevronRight size={17} className={`text-appMuted transition ${textOpen ? "rotate-90" : ""}`} />
        </button>
        {textOpen && (
          <p className="border-t border-appBorder px-4 py-3 text-[12px] leading-5 text-appMuted">
            Текстовая версия лекции находится в подготовке и скоро появится здесь.
          </p>
        )}
      </section>
      <button
        type="button"
        onClick={openFullVideo}
        className="mt-3 flex h-12 w-full items-center justify-center rounded-full bg-appDark text-[14px] font-black text-appGreen"
      >
        Открыть полностью
      </button>
    </AppModal>
  );
}

function MetricDetail({ type, health }) {
  const [period, setPeriod] = useState("today");
  const [activeIndex, setActiveIndex] = useState(null);
  const isSteps = type === "steps";
  const metric = isSteps ? health.steps : health.calories;
  const color = isSteps ? "#8BBE3D" : "#FF7A2F";
  const title = isSteps ? "Шаги" : "Активные калории";
  const unit = isSteps ? "шагов" : "ккал";
  const sourceAvailable = Boolean(metric?.dataSource);

  const values = period === "today" ? (metric.hourly || []) : period === "week" ? (metric.week || []) : (metric.month || []);
  const value = period === "today" ? metric.today : sum(values);
  const target = period === "today" ? metric.goal : metric.goal * (period === "week" ? 7 : 30);
  const labels = period === "today" ? ["00", "06", "12", "18", "24"] : period === "week" ? ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] : ["1", "10", "20", "30"];
  const activeValue = activeIndex === null ? null : values[Math.min(activeIndex, values.length - 1)];
  const activeLabel = activeIndex === null ? "" : (period === "today" ? `${activeIndex}:00` : labels[Math.min(activeIndex, labels.length - 1)] || `#${activeIndex + 1}`);
  const chartHasData = hasChartData(values);
  const showAggregateToday = period === "today" && !chartHasData && Number(metric.today || 0) > 0;

  if (!sourceAvailable) {
    return <p className="rounded-[22px] bg-appBg p-4 text-[13px] text-appMuted">Данные {isSteps ? "шагов" : "калорий"} пока недоступны.</p>;
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
        <p className="mt-2 text-[13px] text-appMuted">Цель: {target.toLocaleString("ru-RU")} {unit} • {formatPercent(value, target)}%</p>
        <p className="mt-1 text-[12px] font-semibold text-appMuted">
          Источник: {metric.sourceName || "Health Connect"}{metric.selectedSourceReason ? ` · Причина: ${metric.selectedSourceReason}` : ""}
        </p>
      </div>
      {!isSteps && (
        <div className="mt-4 grid grid-cols-1 gap-2">
          <StatPill label="Активные калории" value={`${Number(metric.activeToday ?? metric.today ?? 0).toLocaleString("ru-RU")} ккал`} accent />
          {Number(metric.restingToday || 0) > 0 && <StatPill label="Калории покоя / BMR" value={`${Number(metric.restingToday || 0).toLocaleString("ru-RU")} ккал`} />}
          {Number(metric.totalToday || 0) > 0
            ? <StatPill label="Всего за день" value={`${Number(metric.totalToday || 0).toLocaleString("ru-RU")} ккал`} />
            : <ChartEmptyState>Всего за день пока не рассчитано. Активные калории не показываются как общий расход.</ChartEmptyState>}
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
              ? "Health Connect отдал итог за день без почасовой детализации. История будет накапливаться после ежедневных обновлений."
              : "Оценка активности по шагам, дистанции и тренировкам. История активных калорий будет накапливаться после обновлений."}
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
          <ChartEmptyState>{period === "today" ? "Почасовой детализации пока нет." : "История за выбранный период пока не накоплена."}</ChartEmptyState>
        )}
        {activeValue !== null && (
          <p className="mt-2 rounded-2xl bg-appBg px-3 py-2 text-[12px] font-bold text-appText">
            {activeLabel}: {Number(activeValue || 0).toLocaleString("ru-RU")} {unit}
          </p>
        )}
      </div>
      <MiniGuide
        title={isSteps ? "Что это и как использовать?" : "Как считаются калории?"}
        items={isSteps
          ? ["Шаги показывают бытовую активность и помогают видеть, сколько движения есть вне тренировок.", "Смотри тренд за неделю: один слабый день не страшен, важнее общий ритм."]
          : ["Активные калории — расход на движение, шаги и тренировки.", "Калории покоя считаются отдельно по профилю. Общий расход за день = BMR + активные калории, если Health Connect не отдаёт total напрямую."]}
      />
    </>
  );
}

function HeartDetail({ health, setHeartCondition }) {
  const heart = health.heart_rate;
  const heartOptions = ["нет", "брадикардия", "тахикардия", "аритмия", "другое"];
  return (
    <>
      {hasChartData(heart.hourly)
        ? <LineChart values={heart.hourly} color="#EF4444" />
        : <ChartEmptyState>Пока нет серии измерений для графика. Последний пульс и статистика ниже уже доступны.</ChartEmptyState>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <StatPill label="Сейчас" value={heart.current ? `${heart.current} уд/мин` : "нет актуальных данных"} accent />
        <StatPill label="Последний пульс" value={heart.latestBpm ? `${heart.latestBpm} уд/мин` : "нет данных"} />
        <StatPill label="Покой" value={heart.resting ? `${heart.resting} уд/мин` : "нет данных"} />
        <StatPill label="Тренировка" value={heart.avgWorkout ? `${heart.avgWorkout} уд/мин` : "нет данных"} />
        <StatPill label="Обновлено" value={heart.updatedAgoText || "нет данных"} />
      </div>
      <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg/70 p-3 text-[11px] leading-5 text-appMuted">
        <p><span className="font-black text-appText">Источник:</span> {heart.sourceName || "Health Connect"}</p>
        <p><span className="font-black text-appText">Последняя запись:</span> {heart.latestTimestamp ? new Date(heart.latestTimestamp).toLocaleString("ru-RU") : "нет данных"}</p>
        <p><span className="font-black text-appText">Свежесть:</span> {heart.freshness || "no_data"} · {heart.updatedAgoText || "нет данных"}</p>
        <p><span className="font-black text-appText">Записи:</span> сегодня {heart.recordsToday || 0}, 24ч {heart.records24h || 0}, 7д {heart.records7d || 0}</p>
        {heart.message && <p>{heart.message}</p>}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <p className="text-[12px] font-black text-appText">Известные особенности сердца</p>
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
          Эти данные помогают аккуратнее интерпретировать нагрузку. При сердечных заболеваниях ориентируйтесь на рекомендации врача.
        </p>
      </div>
      <MiniGuide
        title="Как использовать пульс?"
        items={[
          "Пульс покоя помогает понять общий фон восстановления и усталости.",
          "Если есть тахикардия, аритмия или давление, интенсивные нагрузки лучше согласовывать с врачом.",
          "FruitFit будет учитывать эти отметки как консервативное ограничение в подборе нагрузки.",
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
      <span className="mt-2 block text-[10px] font-semibold text-appMuted">Введите время в формате ЧЧ:ММ</span>
    </label>
  );
}

function SleepDetail({ health, updateSleepManual }) {
  const [sleep, setSleep] = useState(health.sleep);
  const [saved, setSaved] = useState(false);
  const [period, setPeriod] = useState("week");
  const source = health.sleep.dataSource === "manual" ? "Введено вручную" : "Получено с фитнес-трекера";
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
        <p className="mt-2 text-[13px] text-appMuted">Качество сна: {health.sleep.quality}/5</p>
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
          : <ChartEmptyState>{period === "week" ? "История сна за неделю пока не накоплена." : "История сна за месяц пока не накоплена."}</ChartEmptyState>}
      </div>
      <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg/70 p-3">
        <h3 className="text-[13px] font-black text-appText">Ручной ввод</h3>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Дата сна
          <input type="date" value={sleep.date || new Date().toISOString().slice(0, 10)} onChange={(event) => update("date", event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appCard px-3 text-appText outline-none" />
        </label>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <SleepTimeInput label="Лег" value={sleep.bed} onChange={(value) => update("bed", value)} />
          <SleepTimeInput label="Проснулся" value={sleep.wake} onChange={(value) => update("wake", value)} />
        </div>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Качество сна 1–5
          <input type="range" min="1" max="5" value={sleep.quality} onChange={(event) => update("quality", event.target.value)} className="mt-2 w-full accent-[#60A5FA]" />
        </label>
        <label className="mt-3 block text-[11px] font-bold uppercase text-appMuted">Заметки
          <textarea value={sleep.notes || ""} onChange={(event) => update("notes", event.target.value)} placeholder="Например: просыпался ночью, жарко, поздний кофе" className="mt-1 min-h-20 w-full resize-none rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-[13px] text-appText outline-none placeholder:text-appMuted/50" />
        </label>
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-[18px] bg-appCard p-2">
          {["Глубокий", "Легкий", "REM"].map((phase, index) => (
            <div key={phase} className="rounded-[14px] bg-appBg px-2 py-2 text-center">
              <p className="text-[10px] font-bold text-appMuted">{phase}</p>
              <p className="mt-1 text-[13px] font-black text-appText">{[22, 56, 22][index]}%</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Более точные данные сна помогут лучше рассчитывать восстановление и нагрузку.</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Примерная оценка. Для точного анализа подключите фитнес-трекер.</p>
        <button type="button" onClick={saveManualSleep} className="mt-3 h-11 w-full rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">Сохранить</button>
        {saved && <p className="mt-2 text-center text-[11px] font-bold text-[#86B936]">Сон сохранен как ручной источник</p>}
      </div>
      <MiniGuide
        title="Как читать сон?"
        items={[
          "Смотри не только длительность, но и качество сна: оно сильнее влияет на готовность к нагрузке.",
          "Если сон короткий или рваный, лучше снизить интенсивность и не добивать себя объёмом.",
        ]}
      />
    </>
  );
}

function RecoveryDetail({ health }) {
  const readiness = health.readiness;
  if (readiness.score == null) {
    return (
      <div className="rounded-[24px] bg-appBg p-4">
        <p className="text-[18px] font-black text-appText">Недостаточно данных для точной оценки</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">
          Пульс: {health.heart_rate?.latestBpm ? `${health.heart_rate.latestBpm} уд/мин` : "нет данных"}. Сон: {health.sleep?.minutes ? formatSleepDuration(health.sleep.minutes) : "нет данных"}. Шаги: {(health.steps?.today || 0).toLocaleString("ru-RU")}.
        </p>
        <p className="mt-3 text-[12px] leading-5 text-appMuted">Для точной оценки нужны стабильные данные сна и пульса за период. Пока показываем частичное состояние, а не пустой экран.</p>
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
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">battery</p>
            </div>
          </Ring>
          <div className="min-w-0">
            <p className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Готовность к нагрузке</p>
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
    </>
  );
}

function CycleDetail({ health, updateCycle }) {
  const cycle = health.cycle;
  const phaseText = {
    "Менструальная": "Организм снижает общий тонус, поэтому часто лучше подходят спокойные тренировки, прогулки, мобилити и мягкая техника.",
    "Фолликулярная": "Энергия обычно постепенно растет, восстановление часто ощущается легче. Это хороший период для аккуратного прогресса в силовых упражнениях.",
    "Овуляторная": "Часто есть ощущение бодрости и высокой готовности, но важно не форсировать нагрузку и следить за техникой.",
    "Лютеиновая": "Может повышаться утомляемость и чувствительность к нагрузке. Полезно чуть внимательнее относиться ко сну, питанию и восстановлению.",
  }[cycle.phase] || "Сейчас лучше ориентироваться на самочувствие, сон и качество восстановления, а нагрузку подбирать без резких скачков.";
  return (
    <>
      <div className="rounded-[24px] bg-appBg p-4">
        <div className="flex items-center gap-4">
          <Ring value={Math.round((cycle.day / cycle.length) * 100)} color="#A78BFA" size={98}>
            <div className="text-center">
              <p className="text-[24px] font-black leading-none text-appText">{cycle.day}</p>
              <p className="mt-1 text-[10px] font-bold uppercase text-appMuted">день</p>
            </div>
          </Ring>
          <div>
            <p className="text-[13px] font-bold uppercase text-appMuted">Текущая фаза</p>
            <p className="mt-1 text-[20px] font-black text-appText">{cycle.phase}</p>
            <p className="mt-2 text-[12px] text-appMuted">Овуляция примерно через {cycle.ovulationInDays} дней.</p>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-[20px] bg-appBg p-3">
        <h3 className="text-[13px] font-black text-appText">Что происходит сейчас</h3>
        <p className="mt-2 text-[12px] leading-5 text-appMuted">{phaseText}</p>
        <p className="mt-2 text-[11px] leading-5 text-appMuted">Это не медицинская диагностика, а мягкая подсказка для планирования нагрузки.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <label className="text-[11px] font-bold uppercase text-appMuted">День цикла
          <input value={cycle.day} inputMode="numeric" onChange={(event) => updateCycle({ day: Number(event.target.value) || 1 })} className="mt-1 h-11 w-full rounded-2xl border border-appBorder bg-appBg px-3 text-appText outline-none" />
        </label>
        <label className="text-[11px] font-bold uppercase text-appMuted">Длина цикла
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
        <p className="text-[18px] font-black text-appText">Трекер не подключён</p>
        <p className="mt-2 text-[13px] leading-5 text-appMuted">Данные активности появятся после подключения Health Connect или Apple Health.</p>
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
        <StatPill label="Активные ккал" value={totalCalories.toLocaleString("ru-RU")} />
        <StatPill label="Среднее в день" value={avgSteps.toLocaleString("ru-RU")} />
        <StatPill label="Активных дней" value={`${activeDays}/7`} />
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

function DetailRouter({ type, onClose }) {
  if (type === "lecture") return <LectureModal onClose={onClose} />;
  return null;
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

  useEffect(() => {
    syncNativeHealth?.();
    const id = window.setInterval(() => syncNativeHealth?.(), refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, syncNativeHealth]);

  async function handleRefresh() {
    setRefreshNote("");
    const result = await syncNativeHealth?.({ force: true });
    setRefreshNote(result?.message || "Health Connect проверен.");
  }

  return (
    <main className="phone-shell min-h-screen px-5 pb-8 pt-[calc(env(safe-area-inset-top)+104px)]">
      <header className="fixed left-1/2 top-0 z-50 flex w-[min(100vw,393px)] -translate-x-1/2 items-center gap-3 border-b border-appBorder bg-appBg/95 px-5 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] shadow-sm backdrop-blur">
        <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full bg-appCard text-appText shadow-sm" aria-label="Назад">
          <ChevronLeft size={22} />
        </button>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Health Connect</p>
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
          FruitFit обновил данные: {health.lastFruitFitRefreshAt ? new Date(health.lastFruitFitRefreshAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : "ещё нет"}
          {refreshNote ? ` · ${refreshNote}` : ""}
        </p>
        {syncError && <p className="mb-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] font-bold text-red-500">{syncError}</p>}
        {type === "heart" && <HeartDetail health={health} setHeartCondition={setHeartCondition} />}
        {type === "steps" && <MetricDetail type="steps" health={health} />}
        {type === "calories" && <MetricDetail type="calories" health={health} />}
        {type === "sleep" && <SleepDetail health={health} updateSleepManual={updateSleepManual} />}
        {type === "recovery" && <RecoveryDetail health={health} />}
        {type === "cycle" && <CycleDetail health={health} updateCycle={updateCycle} />}
        {type === "weekly" && <WeeklyDetail health={health} />}
      </section>
    </main>
  );
}

export default function WidgetGrid({ profile, onNavigate }) {
  const { health, requestConnection, syncNativeHealth } = useHealth();
  const { widgets, visible, commit, cycleAvailable } = useWidgetConfig(profile);
  const [editMode, setEditMode] = useState(false);
  const [detail, setDetail] = useState("");

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
    syncNativeHealth?.();
  }, [syncNativeHealth]);

  function render(widget) {
    switch (widget.type) {
      case "lecture":
        return <MiniLectureWidget key={widget.id} onOpen={() => setDetail("lecture")} />;
      case "nutrition":
        return <NutritionWidget key={widget.id} profile={profile} onOpen={() => onNavigate?.("food")} />;
      case "heart":
        return <HeartWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:heart")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true })} />;
      case "steps":
        return <MetricWidget key={widget.id} title="Шаги" icon={Footprints} value={health.steps.today} target={health.steps.goal} color="#8BBE3D" suffix="шагов" sourceNote={health.steps?.sourceName ? `${health.steps.sourceName}` : ""} onOpen={() => onNavigate?.("health:steps")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true })} />;
      case "calories":
        return <MetricWidget key={widget.id} title="Калории" icon={Flame} value={health.calories.today} target={health.calories.goal} color="#FF7A2F" suffix="ккал" sourceNote={health.calories?.isEstimated ? "Оценка активности" : health.calories?.sourceName || ""} onOpen={() => onNavigate?.("health:calories")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true })} />;
      case "sleep":
        return <SleepWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:sleep")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true })} />;
      case "recovery":
        return <RecoveryWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:recovery")} onConnect={requestConnection} onRefresh={() => syncNativeHealth?.({ force: true })} />;
      case "cycle":
        return <CycleWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:cycle")} />;
      case "weekly":
        return <WeeklyWidget key={widget.id} health={health} onOpen={() => onNavigate?.("health:weekly")} onConnect={requestConnection} />;
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

      {detail && <DetailRouter type={detail} onClose={() => setDetail("")} />}
    </>
  );
}
