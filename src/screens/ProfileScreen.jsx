import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CheckCircle2, ChevronDown, Gift, Settings, TicketPercent, Watch, X } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import CustomSelect from "../components/CustomSelect";
import { useHealth } from "../data/healthStore";
import { normalizeProfile, profileOptions, profileSummary, saveProfile, validateProfile } from "../data/profileStore";
import { healthProviderLabels, healthProviderStates, healthSourceShortcuts, openHealthSource } from "../services/health/healthProvider";

const MEASUREMENTS_KEY = "fruitfit.measurements";

const permissionItems = [
  { id: "watch", label: "Смарт-часы", permissionKey: null },
  { id: "heart", label: "Пульс", permissionKey: "heartRate" },
  { id: "sleep", label: "Сон", permissionKey: "sleep" },
  { id: "steps", label: "Шаги", permissionKey: "steps" },
  { id: "calories", label: "Калории", permissionKey: "calories" },
  { id: "cycle", label: "Цикл" },
  { id: "notifications", label: "Уведомления" },
];

function healthPermissionSummary(availability) {
  const state = availability?.state || healthProviderStates.NOT_SUPPORTED;
  if (state === healthProviderStates.CONNECTED) return "Health Connect подключён";
  if (state === healthProviderStates.PARTIALLY_GRANTED) return "Часть разрешений выдана";
  if (state === healthProviderStates.PERMISSIONS_REQUIRED) return "Разрешение не выдано";
  if (state === healthProviderStates.NOT_INSTALLED) return "Health Connect не установлен";
  if (state === healthProviderStates.NO_DATA) return "Нет данных";
  return healthProviderLabels[state] || "Трекер не подключён";
}

function permissionLine(item, availability, active) {
  if (item.id === "notifications") return active ? "Уведомления включены" : "Уведомления выключены";
  if (item.id === "cycle") return "Данные цикла вводятся вручную";
  if (!item.permissionKey) return healthPermissionSummary(availability);
  const granted = Boolean(availability?.permissionStatus?.[item.permissionKey]);
  if (granted) return "Разрешение выдано";
  if (availability?.state === healthProviderStates.NOT_INSTALLED) return "Health Connect не установлен";
  if (availability?.state === healthProviderStates.NOT_SUPPORTED) return "Доступно в Android APK";
  return "Разрешение не выдано";
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
        <p className="mt-1 text-[12px] leading-5 text-appMuted">Можно добавить замеры вручную или нажать «Симуляция прогресса».</p>
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

function MeasurementsSection({ goal }) {
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState(loadMeasurements);
  const [draft, setDraft] = useState({ date: today, weight: "", chest: "", waist: "", hips: "" });
  const [period, setPeriod] = useState("month");
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => saveMeasurements(items), [items]);

  function update(key, value) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function addMeasurement() {
    if (!draft.date) return;
    const next = { ...draft, id: crypto.randomUUID?.() || String(Date.now()) };
    setItems((current) => [next, ...current]);
    setDraft({ date: today, weight: "", chest: "", waist: "", hips: "" });
  }

  function updateDate(id, date) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, date } : item));
  }

  function simulate() {
    const muscleGain = String(goal).toLowerCase().includes("масс");
    const weightLoss = String(goal).toLowerCase().includes("похуд");
    const base = { weight: 72, chest: 96, waist: 78, hips: 98 };
    const generated = Array.from({ length: 8 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (7 - index) * 7);
      const dir = muscleGain ? 1 : weightLoss ? -1 : 0.18;
      return {
        id: `sim-${Date.now()}-${index}`,
        date: date.toISOString().slice(0, 10),
        weight: (base.weight + dir * index * 0.45).toFixed(1),
        chest: (base.chest + (muscleGain ? index * 0.35 : weightLoss ? -index * 0.08 : index * 0.05)).toFixed(1),
        waist: (base.waist + (weightLoss ? -index * 0.55 : muscleGain ? index * 0.08 : -index * 0.05)).toFixed(1),
        hips: (base.hips + (muscleGain ? index * 0.3 : weightLoss ? -index * 0.18 : index * 0.03)).toFixed(1),
      };
    });
    setItems(generated.reverse());
  }

  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-black text-appText">Замеры</h2>
        <button type="button" onClick={simulate} className="rounded-full bg-appGreen px-3 py-2 text-[11px] font-black text-[#181F19]">Симуляция прогресса</button>
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

function PromoPlaceholderSection() {
  return (
    <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[18px] bg-appGreen/20 text-appGreen">
          <Gift size={21} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[16px] font-black text-appText">Реферальная программа</h2>
            <span className="rounded-full bg-appGreen/20 px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-appGreen">скоро</span>
          </div>
          <p className="mt-1 text-[13px] leading-5 text-appMuted">Пригласи друга — получи месяц бесплатно. Механика готовится, backend пока не подключён.</p>
        </div>
      </div>
      <div className="mt-4 rounded-[20px] border border-appBorder bg-appBg p-3">
        <label className="text-[11px] font-black uppercase tracking-[0.12em] text-appMuted">Промокод</label>
        <div className="mt-2 flex gap-2">
          <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-appBorder bg-appCard px-3">
            <TicketPercent size={17} className="shrink-0 text-appOrange" />
            <input disabled placeholder="Скоро будет доступно" className="min-w-0 flex-1 bg-transparent text-[13px] font-bold text-appText outline-none placeholder:text-appMuted" />
          </div>
          <button type="button" disabled className="h-12 rounded-2xl bg-appGreen/40 px-4 text-[12px] font-black text-[#181F19] opacity-70">
            Применить
          </button>
        </div>
      </div>
    </section>
  );
}

export default function ProfileScreen({ profile, onProfileChange, theme, onThemeChange, onNavigate, onRestartQuiz }) {
  const { health, availability, syncing, requestConnection, syncNativeHealth, buildHealthDebugReport } = useHealth();
  const [avatar, setAvatar] = useState(localStorage.getItem("fruitfit.avatar") || "");
  const [draft, setDraft] = useState(() => normalizeProfile(profile));
  const [errors, setErrors] = useState({});
  const [saved, setSaved] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [healthDebug, setHealthDebug] = useState(null);
  const [healthDebugStatus, setHealthDebugStatus] = useState("");
  const [pendingSourceScan, setPendingSourceScan] = useState(false);
  const [preferredSourcePackage, setPreferredSourcePackage] = useState(() => localStorage.getItem("fruitfit.health.preferredSourcePackage") || "");
  const [permissions, setPermissions] = useState(() => {
    try {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: false, ...JSON.parse(localStorage.getItem("fruitfit.permissions") || "{}") };
    } catch (_) {
      return { watch: false, heart: true, sleep: true, steps: true, calories: true, cycle: true, notifications: false };
    }
  });

  useEffect(() => setDraft(normalizeProfile(profile)), [profile]);

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

  function onAvatar(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setAvatar(reader.result);
      localStorage.setItem("fruitfit.avatar", reader.result);
    };
    reader.readAsDataURL(file);
  }

  function updateDraft(key, value) {
    setSaved(false);
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const nextErrors = validateProfile(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const savedProfile = saveProfile(draft);
    onProfileChange?.(savedProfile);
    setSaved(true);
  }

  function canRefreshNativeHealth() {
    return availability?.state === healthProviderStates.CONNECTED
      || availability?.state === healthProviderStates.PARTIALLY_GRANTED
      || availability?.state === healthProviderStates.NO_DATA;
  }

  async function refreshHealthData() {
    if (canRefreshNativeHealth()) {
      await syncNativeHealth?.({ force: true });
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
    const report = healthDebug || await buildHealthDebugReport?.();
    if (!report) return;
    await navigator.clipboard?.writeText(JSON.stringify(report, null, 2));
    setHealthDebug(report);
    setHealthDebugStatus("JSON скопирован");
  }

  async function shareHealthDebug() {
    const report = healthDebug || await buildHealthDebugReport?.();
    if (!report) return;
    const json = JSON.stringify(report, null, 2);
    const fileName = report.fileName || "fruitfit_health_debug.json";
    setHealthDebug(report);
    try {
      if (navigator.share && window.File) {
        const file = new File([json], fileName, { type: "application/json" });
        await navigator.share({ title: "FruitFit health debug", files: [file] });
        setHealthDebugStatus("Отчёт передан в системное меню");
        return;
      }
    } catch (_) {
      // Fall back to clipboard below.
    }
    await navigator.clipboard?.writeText(json);
    setHealthDebugStatus("Share недоступен, JSON скопирован");
  }

  const stepSources = health?.steps?.sources || [];

  return (
    <main className="phone-shell pb-[82px]">
      <div className="px-4 pt-5">
        <header className="flex items-center justify-between">
          <h1 className="text-[26px] font-black text-appText">Профиль</h1>
          <button type="button" onClick={() => onNavigate?.("settings")} className="grid h-10 w-10 place-items-center rounded-full bg-appCard shadow-sm">
            <Settings size={18} />
          </button>
        </header>

        <section className="mt-5 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-card">
          <div className="flex items-center gap-4">
            <label className="relative grid h-20 w-20 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-full bg-appDark text-appGreen">
              {avatar ? <img src={avatar} alt="avatar" className="h-full w-full object-cover" /> : <Camera size={24} />}
              <input type="file" accept="image/*" onChange={onAvatar} className="hidden" />
            </label>
            <div className="min-w-0">
              <h2 className="text-[20px] font-black text-appText">fruitfit athlete</h2>
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-appMuted">{profileSummary(draft)}</p>
            </div>
          </div>
          <div className="mt-4 rounded-[20px] border border-appBorder bg-appBg px-4 py-3 text-[12px] leading-5 text-appMuted">
            {"Health Connect / Apple Health \u0431\u0443\u0434\u0443\u0442 \u0437\u0430\u043f\u0440\u0430\u0448\u0438\u0432\u0430\u0442\u044c\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0432 native build. \u0412 web/PWA \u0434\u0430\u043d\u043d\u044b\u0435 \u0442\u0440\u0435\u043a\u0435\u0440\u0430 \u043d\u0435 \u0441\u0438\u043c\u0443\u043b\u0438\u0440\u0443\u044e\u0442\u0441\u044f."}
          </div>
          <button type="button" onClick={onRestartQuiz} className="mt-2 h-11 w-full rounded-full border border-appBorder bg-appBg text-[13px] font-black text-appText">
            Повторить квиз
          </button>
        </section>

        <section className="mt-4 rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
          <h2 className="text-[16px] font-black text-appText">Данные профиля</h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
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

        <PromoPlaceholderSection />

        <MeasurementsSection goal={draft.goal} />

        <section className="mt-4 overflow-hidden rounded-[26px] border border-appBorder bg-appCard shadow-sm">
          <button
            type="button"
            onClick={() => setPermissionsOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 p-4 text-left"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Watch size={18} className="shrink-0 text-appOrange" />
              <span className="min-w-0">
                <span className="block text-[16px] font-black text-appText">Подключения и разрешения</span>
                <span className="mt-0.5 block text-[12px] font-semibold text-appMuted">
                  {healthPermissionSummary(availability)} · источник: {availability?.source || "Health Connect"}
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
                    <p className="text-[12px] font-black text-appText">{availability?.source || "Health Connect"}</p>
                    <p className="mt-1 text-[11px] leading-4 text-appMuted">{syncing ? "Запрашиваю данные трекера..." : availability?.message || "Нажмите кнопку ниже, чтобы выдать доступ к данным."}</p>
                    <p className="mt-2 text-[11px] leading-4 text-appMuted">
                      Если ваш трекер не передаёт данные напрямую в Health Connect, подключите его приложение к Google Fit, а Google Fit — к Health Connect.
                    </p>
                    <button type="button" onClick={refreshHealthData} className="mt-3 h-10 w-full rounded-full bg-appGreen text-[12px] font-black text-[#181F19]">
                      {syncing ? "Обновляю..." : "Обновить данные"}
                    </button>
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
                    {stepSources.length > 1 && (
                      <div className="mt-3 rounded-[16px] border border-appBorder bg-appCard/70 p-2">
                        <p className="px-1 text-[11px] font-black uppercase tracking-[0.08em] text-appMuted">Источник шагов</p>
                        <div className="mt-2 space-y-1">
                          <button
                            type="button"
                            onClick={() => setPreferredSourcePackage("")}
                            className={`flex min-h-9 w-full items-center justify-between rounded-xl px-3 text-left text-[11px] font-bold transition ${!preferredSourcePackage ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appText"}`}
                          >
                            <span>Автоматически</span>
                            <span>{health?.steps?.selectedSourceReason || "auto"}</span>
                          </button>
                          {stepSources.map((source) => (
                            <button
                              key={source.sourcePackage || source.sourceName}
                              type="button"
                              onClick={() => setPreferredSourcePackage(source.sourcePackage || "")}
                              className={`flex min-h-9 w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-[11px] font-bold transition ${preferredSourcePackage === source.sourcePackage ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appText"}`}
                            >
                              <span className="min-w-0 truncate">{source.sourceName || source.sourcePackage || "Health Connect aggregate"}</span>
                              <span className="shrink-0">{Number(source.total || 0).toLocaleString("ru-RU")}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {health?.steps?.selectedSourceReason && (
                      <p className="mt-2 rounded-2xl bg-appCard px-3 py-2 text-[11px] font-semibold text-appMuted">
                        Источник: {health.steps.sourceName || "Health Connect"} · Причина: {health.steps.selectedSourceReason}
                      </p>
                    )}
                  </div>
                  <div className="rounded-[18px] border border-appBorder bg-appBg p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-black text-appText">Диагностика трекера</p>
                        <p className="mt-1 text-[11px] leading-4 text-appMuted">
                          Технический JSON без ФИО, токенов и медицинских диагнозов: permissions, источники, пульс, шаги, сон и ошибки Health Connect.
                        </p>
                      </div>
                      {healthDebug?.fileName && <span className="shrink-0 rounded-full bg-appCard px-2 py-1 text-[10px] font-bold text-appMuted">JSON</span>}
                    </div>
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
                            aggregateToday: healthDebug.steps?.aggregateToday,
                            selectedSource: healthDebug.steps?.selectedSource,
                            sourcesToday: healthDebug.steps?.sourcesToday,
                          },
                        }, null, 2)}
                      </pre>
                    )}
                  </div>
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
