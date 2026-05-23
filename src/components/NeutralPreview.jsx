import { Dumbbell } from "lucide-react";

export default function NeutralPreview({ className = "", compact = false }) {
  return (
    <div className={`grid place-items-center overflow-hidden rounded-2xl border border-white/10 bg-[#172018] ${className}`}>
      <div className="grid place-items-center gap-2 px-3 text-center">
        <div className={`grid place-items-center rounded-full bg-white/8 text-appGreen ${compact ? "h-9 w-9" : "h-14 w-14"}`}>
          <Dumbbell size={compact ? 17 : 24} />
        </div>
        {!compact && <p className="text-[12px] font-bold leading-4 text-white/55">Демонстрация скоро появится</p>}
      </div>
    </div>
  );
}
