import { Check } from "lucide-react";
import { normalizeRestrictionKeys, restrictionOptions, toggleRestrictionKey } from "../data/profileStore";

export default function RestrictionMultiSelect({ value, onChange, error = "", compact = false }) {
  const selected = normalizeRestrictionKeys(value);

  return (
    <div className="w-full" role="group" aria-label="Физические ограничения">
      <p className={`${compact ? "text-[11px]" : "text-[13px]"} font-semibold leading-5 text-appMuted`}>
        Можно выбрать несколько вариантов. Мы учтём их при подборе упражнений и нагрузки.
      </p>
      <div className={`mt-3 grid ${compact ? "grid-cols-2 gap-2" : "gap-3"}`}>
        {restrictionOptions.map(([key, label]) => {
          const active = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange?.(toggleRestrictionKey(selected, key))}
              className={`flex min-h-12 w-full items-center justify-between gap-2 rounded-[18px] border px-3 text-left font-black shadow-sm transition active:scale-[0.99] ${compact ? "text-[13px]" : "text-[16px]"} ${
                active
                  ? "border-[#A9D95A] bg-appGreen text-[#181F19]"
                  : "border-appBorder bg-appCard text-appText"
              }`}
            >
              <span>{label}</span>
              {active && <Check size={compact ? 17 : 20} className="shrink-0" strokeWidth={3} />}
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-[11px] font-bold text-red-500">{error}</p>}
      <p className="mt-3 text-[11px] leading-4 text-appMuted">
        Анкета не заменяет медицинскую диагностику. При боли или травме проконсультируйтесь с врачом.
      </p>
    </div>
  );
}
