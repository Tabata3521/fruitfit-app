import { Flame } from "lucide-react";
import ExerciseMedia from "./ExerciseMedia";

function metaLine(exercise) {
  return [
    exercise.sets ? `${exercise.sets} подхода` : "",
    exercise.reps ? `${exercise.reps} повторений` : "",
    exercise.weight || "",
  ].filter(Boolean).join(" • ");
}

export default function SupersetCard({ exercises = [], onStart }) {
  if (exercises.length < 2) return null;

  return (
    <article className="rounded-[20px] border border-orange-200 bg-[#FFF4E8] p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[16px] font-bold text-appText">Суперсет</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-appOrange">
          <Flame size={13} /> отдых
        </span>
      </div>
      <div className="space-y-2">
        {exercises.map((exercise, index) => (
          <div key={`${exercise.lesson_id}-${exercise.exercise_order}`} className="grid grid-cols-[52px_1fr] gap-3 rounded-2xl bg-white/75 p-2">
            <ExerciseMedia exercise={exercise} compact className="h-[52px] w-[52px] rounded-xl" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="grid h-6 w-6 place-items-center rounded-full bg-appBg text-[11px] font-bold text-appDark">
                  {String.fromCharCode(65 + index)}
                </span>
                <h4 className="line-clamp-1 text-[14px] font-semibold text-appText">{exercise.exercise_name}</h4>
              </div>
              <p className="mt-1 truncate text-[12px] text-appMuted">{metaLine(exercise) || exercise.raw_line}</p>
            </div>
          </div>
        ))}
      </div>
      <button type="button" onClick={onStart} className="mt-3 h-11 w-full rounded-full bg-appOrange text-sm font-bold text-white">
        Начать блок
      </button>
    </article>
  );
}
