import { Check, ChevronRight, CircleMinus, Clock3 } from "lucide-react";
import ExerciseMedia from "./ExerciseMedia";

function metaLine(exercise) {
  const parts = [];
  if (exercise.sets) parts.push(`${exercise.sets} подхода`);
  if (exercise.reps) parts.push(`${exercise.reps} повторений`);
  if (exercise.weight) parts.push(exercise.weight);
  return parts.join(" • ") || exercise.raw_line || exercise.comment || "";
}

const stateLabel = {
  not_started: "Не начато",
  in_progress: "Выполняется",
  completed: "Выполнено",
  skipped: "Пропущено",
};

export default function ExerciseCard({ exercise, state = "not_started", selected = false, completedSets = 0, totalSets = 1, index = 1, onClick }) {
  const completed = state === "completed";
  const current = selected;
  const skipped = state === "skipped";
  const partial = completedSets > 0 && completedSets < totalSets;
  const toneClass = index % 2 === 0 ? "exercise-card-island-alt" : "exercise-card-island-base";

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "exercise-card-island grid min-h-[76px] w-full grid-cols-[64px_1fr_32px] items-center gap-3 rounded-[18px] border px-3 py-2 text-left transition",
        current ? "exercise-card-island-current shadow-card" : completed ? "exercise-card-island-completed shadow-sm" : `${toneClass} shadow-sm`,
        state === "not_started" ? "opacity-86" : "",
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
        <p className="mt-1 text-[11px] font-semibold text-appMuted">
          {partial ? `${completedSets} из ${totalSets} подходов · ${completed ? "выполнено частично" : "в процессе"}` : stateLabel[state] || stateLabel.not_started}
        </p>
      </div>
      <div className={[
        "grid h-8 w-8 place-items-center rounded-full",
        completed ? "bg-appGreen text-[#181F19]" : current ? "bg-appDark text-appGreen" : "bg-appBg text-appMuted",
      ].join(" ")}>
        {completed ? <Check size={17} /> : skipped ? <CircleMinus size={17} /> : partial ? <Clock3 size={16} /> : <ChevronRight size={18} />}
      </div>
    </button>
  );
}
