import { AlertTriangle } from "lucide-react";
import { programRestrictionState } from "../data/programRestrictions";

export default function ProgramRestrictions({ profile, course, programAssignment, dark = false, compact = false }) {
  const state = programRestrictionState({ profile, course, programAssignment });
  const title = state.requiresAdaptation ? "Заявленные ограничения" : "Учтённые ограничения";

  return (
    <div className={`${compact ? "mt-2" : "mt-3"}`}>
      <p className={`${compact ? "text-[10px]" : "text-[11px]"} font-black uppercase tracking-[0.1em] ${dark ? "text-white/58" : "text-appMuted"}`}>
        {title}
      </p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {state.labels.map((label) => (
          <span
            key={label}
            className={`${compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"} rounded-full font-bold ${dark ? "bg-white/10 text-white/86" : "bg-appBg text-appText"}`}
          >
            {label}
          </span>
        ))}
      </div>
      {state.requiresAdaptation && (
        <div className={`mt-2 flex items-start gap-2 rounded-[14px] px-3 py-2 ${dark ? "bg-amber-300/12 text-amber-100" : "bg-amber-500/10 text-amber-700"}`}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <p className="text-[11px] font-bold leading-4">
            Для части ограничений нужна дополнительная адаптация программы. Не начинай тренировку до уточнения.
          </p>
        </div>
      )}
    </div>
  );
}
