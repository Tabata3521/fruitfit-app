import { useState } from "react";
import { motion } from "framer-motion";

const days = [
  ["Пн", 6800],
  ["Вт", 7200],
  ["Ср", 8100],
  ["Чт", 9000],
  ["Пт", 8400],
  ["Сб", 6200],
  ["Вс", 4300],
];

export default function WeeklyGraph() {
  const [active, setActive] = useState(3);
  const max = Math.max(...days.map(([, value]) => value));

  return (
    <section className="mt-4 rounded-[24px] border border-appBorder bg-white/86 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-appText">Активность за неделю</h3>
        <span className="text-[12px] text-appMuted">{days[active][1].toLocaleString("ru-RU")} шагов</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {days.map(([day, value], index) => {
          const height = 42 + (value / max) * 68;
          const selected = active === index;
          return (
            <button key={day} type="button" onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} className="flex flex-col items-center gap-2">
              <div className="flex h-[116px] items-end">
                <motion.span
                  layout
                  className="w-7 rounded-full"
                  animate={{
                    height,
                    backgroundColor: selected ? "#8BBE3D" : "#E9EDD9",
                  }}
                  transition={{ type: "spring", stiffness: 150, damping: 20 }}
                />
              </div>
              <span className={`text-[11px] ${selected ? "font-bold text-appText" : "text-appMuted"}`}>{day}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
