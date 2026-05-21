import { Check, ChevronRight } from "lucide-react";
import ExerciseMedia from "./ExerciseMedia";

function metaLine(exercise) {
  const parts = [];
  if (exercise.sets) parts.push(`${exercise.sets} подхода`);
  if (exercise.reps) parts.push(`${exercise.reps} повторений`);
  if (exercise.weight) parts.push(exercise.weight);
  return parts.join(" • ") || exercise.raw_line || exercise.comment || "";
}

export default function ExerciseCard({ exercise, state = "upcoming", index = 1, onClick }) {
  const completed = state === "completed";
  const current = state === "current";
  const upcoming = state === "upcoming";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "grid min-h-[76px] w-full grid-cols-[64px_1fr_32px] items-center gap-3 rounded-[18px] border px-3 py-2 text-left transition",
        current ? "border-[#A9D95A] bg-appCard shadow-card" : "border-appBorder bg-appCard/82 shadow-sm",
        upcoming ? "opacity-78" : "",
      ].join(" ")}
    >
      <ExerciseMedia exercise={exercise} compact className="h-[56px] w-[64px] rounded-xl" />
      <div className="min-w-0">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 text-xs font-medium text-appMuted">{index}</span>
          <h4 className="line-clamp-2 text-[14px] font-semibold leading-[18px] text-appText">
            {exercise.exercise_name}
          </h4>
        </div>
        <p className="mt-1 truncate text-[12px] leading-4 text-appMuted">{metaLine(exercise)}</p>
      </div>
      <div className={[
        "grid h-8 w-8 place-items-center rounded-full",
        completed ? "bg-appGreen text-[#181F19]" : current ? "bg-appDark text-appGreen" : "bg-appBg text-appMuted",
      ].join(" ")}>
        {completed ? <Check size={17} /> : <ChevronRight size={18} />}
      </div>
    </button>
  );
}
