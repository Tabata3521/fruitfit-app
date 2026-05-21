import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { buildMuscleProfile } from "../data/exerciseMuscles";
import { assignMuscleTemplate } from "../data/muscleTemplates";

function Dot({ color }) {
  return <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />;
}

function MuscleList({ title, items, color, note }) {
  if (!items?.length) return null;
  return (
    <div className="rounded-[16px] bg-white/[0.045] p-3">
      <div className="flex gap-2">
        <Dot color={color} />
        <div className="min-w-0">
          <p className="text-[12px] font-black text-white">{title}</p>
          <p className="mt-1 text-[12px] leading-5 text-white/68">{items.join(", ")}</p>
          {note && <p className="mt-1 text-[11px] leading-4 text-white/45">{note}</p>}
        </div>
      </div>
    </div>
  );
}

function AnatomyCard({ assigned, compact = false }) {
  const height = compact ? "h-[86px]" : "h-[292px]";

  return (
    <div className={`grid w-full place-items-center rounded-[18px] bg-black ${compact ? "p-1.5" : "p-2.5"} ${height}`}>
      {assigned.imageSrc ? (
        <img
          src={assigned.imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-contain object-center"
        />
      ) : (
        <div className="grid h-full w-full place-items-center rounded-[16px] border border-dashed border-white/14 px-3 text-center text-[11px] font-bold leading-4 text-white/48">
          Для этой мышечной группы пока нет anatomy image
        </div>
      )}
    </div>
  );
}

export default function MuscleWorkBlock({ exercise, className = "" }) {
  const [open, setOpen] = useState(false);
  const profile = useMemo(() => buildMuscleProfile(exercise), [exercise]);
  const assigned = useMemo(() => assignMuscleTemplate(exercise), [exercise]);
  const highlights = profile.primary.length ? profile.primary.slice(0, 4) : [assigned.normalizedLabel].filter(Boolean);

  if (import.meta.env.DEV && assigned.status !== "ok" && assigned.status !== "alias_used") {
    console.warn("[FruitFit] Missing anatomy mapping", {
      exercise: exercise?.exercise_name || exercise?.name,
      muscleLabel: assigned.muscleLabel,
      normalizedLabel: assigned.normalizedLabel,
      status: assigned.status,
    });
  }

  if (!highlights.length) return null;

  return (
    <section className={`rounded-[22px] border border-white/10 bg-[#111811] p-3 text-white shadow-card ${className}`}>
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 text-left">
        <div className="w-[112px] shrink-0 rounded-[16px] bg-black">
          <AnatomyCard assigned={assigned} compact />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold uppercase text-appGreen">Основные мышцы</p>
          <p className="mt-1 line-clamp-2 text-[14px] font-black text-white">{highlights.join(", ")}</p>
          <p className="mt-1 text-[11px] text-white/52">Нажмите, чтобы раскрыть карту мышц</p>
        </div>
        <ChevronDown size={18} className={`shrink-0 text-white/56 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="rounded-[20px] bg-black/18 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-[17px] font-black">Какие мышцы работают</h3>
              <span className="rounded-full bg-appGreen/15 px-2 py-1 text-[10px] font-bold text-appGreen">{assigned.normalizedLabel}</span>
            </div>
            <AnatomyCard assigned={assigned} />
          </div>

          {assigned.status !== "ok" && (
            <div className="rounded-[16px] border border-appOrange/20 bg-appOrange/10 p-3 text-[12px] font-semibold leading-5 text-white/70">
              Статус anatomy map: {assigned.status}. {assigned.reviewStatus}
            </div>
          )}

          <MuscleList title="Основные мышцы" items={profile.primary} color="#9BE85F" note="Главные мышцы, на которые направлено упражнение." />
          <MuscleList title="Второстепенные мышцы" items={profile.secondary} color="#78A84F" note="Синергисты помогают выполнить движение и стабилизировать траекторию." />
          <MuscleList title="Стабилизаторы" items={profile.stabilizers} color="#8E988F" note="Помогают удерживать корпус и суставы в безопасном положении." />
        </div>
      )}
    </section>
  );
}
