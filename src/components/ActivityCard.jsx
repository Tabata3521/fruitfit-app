import { useMemo, useState } from "react";
import { motion, useSpring, useTransform } from "framer-motion";
import { Flame, Footprints } from "lucide-react";

const variants = {
  steps: { Icon: Footprints, color: "#8BBE3D", pale: "#EFFBD8", label: "Шаги", suffix: "" },
  calories: { Icon: Flame, color: "#FF7A2F", pale: "#FFE8D5", label: "Калории", suffix: "" },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export default function ActivityCard({ type = "steps", initial = 8420, target = 10000 }) {
  const config = variants[type] || variants.steps;
  const [value, setValue] = useState(initial);
  const progress = clamp(value / target, 0, 1);
  const spring = useSpring(progress, { stiffness: 120, damping: 22, mass: 0.4 });
  const pathLength = useTransform(spring, (latest) => latest);
  const displayValue = type === "steps" ? `${(value / 1000).toFixed(1)}k` : value;
  const bars = useMemo(() => [34, 42, 38, 56, 62, 48, 70, 78, 60, 74, 88, 66], []);
  const Icon = config.Icon;

  function bump(delta) {
    const step = type === "steps" ? 180 : 12;
    setValue((current) => clamp(current + (delta < 0 ? step : -step), 0, target));
  }

  return (
    <motion.article
      whileHover={{ y: -2, scale: 1.01 }}
      transition={{ type: "spring", stiffness: 180, damping: 20 }}
      onWheel={(event) => {
        event.preventDefault();
        bump(event.deltaY);
      }}
      className="rounded-[22px] border border-appBorder bg-white/86 p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-appMuted">
          <span className="grid h-7 w-7 place-items-center rounded-full" style={{ backgroundColor: config.pale, color: config.color }}>
            <Icon size={15} />
          </span>
          {config.label}
        </span>
        <span className="text-[11px] text-appMuted">/{target.toLocaleString("ru-RU")}</span>
      </div>

      <div className="mt-3 grid place-items-center">
        <div className="relative h-[112px] w-[112px]">
          <svg viewBox="0 0 120 120" className="-rotate-90">
            <circle cx="60" cy="60" r="48" fill="none" stroke="#EEF0EC" strokeWidth="10" />
            <motion.circle
              cx="60"
              cy="60"
              r="48"
              fill="none"
              stroke={config.color}
              strokeLinecap="round"
              strokeWidth="10"
              style={{ pathLength }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-[25px] font-black leading-none text-appText">{displayValue}</p>
              <p className="mt-1 text-[10px] text-appMuted">{config.label.toLowerCase()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-2 flex h-10 items-end gap-1">
        {bars.map((height, index) => (
          <motion.span
            key={index}
            className="w-1.5 rounded-full"
            style={{ backgroundColor: config.color }}
            animate={{ height: `${height * (0.72 + progress * 0.35)}%`, opacity: index / bars.length < progress ? 0.9 : 0.25 }}
            transition={{ type: "spring", stiffness: 120, damping: 18 }}
          />
        ))}
      </div>
    </motion.article>
  );
}
