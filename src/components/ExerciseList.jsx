import ExerciseCard from "./ExerciseCard";
import SupersetCard from "./SupersetCard";

export default function ExerciseList({ exercises = [], currentIndex = 0, exerciseStates = {}, superset = [], onExerciseClick, onSupersetStart, getExerciseId }) {
  const supersetIds = new Set(superset.map((exercise) => exercise.exercise_order));

  return (
    <section className="mt-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-appMuted">Упражнения</h3>
        <span className="text-[12px] text-appMuted">{exercises.length}</span>
      </div>
      <div className="space-y-2">
        {exercises.map((exercise, index) => {
          if (supersetIds.has(exercise.exercise_order)) {
            if (exercise.exercise_order !== superset[0]?.exercise_order) return null;
            return <SupersetCard key="superset" exercises={superset} onStart={onSupersetStart} />;
          }

          const exerciseId = getExerciseId?.(exercise, index) || `${exercise.lesson_id || "exercise"}:${exercise.exercise_order || index + 1}`;
          const progressState = exerciseStates[exerciseId] || {};
          const completedSets = Array.isArray(progressState.sets)
            ? progressState.sets.filter((set) => set.completed).length
            : 0;
          const totalSets = Array.isArray(progressState.sets) ? progressState.sets.length : Number(exercise.sets) || 1;
          const state = progressState.status || (index === currentIndex ? "current" : "not_started");
          return (
            <ExerciseCard
              key={exerciseId}
              exercise={exercise}
              state={state}
              selected={index === currentIndex}
              completedSets={completedSets}
              totalSets={totalSets}
              index={index + 1}
              onClick={() => onExerciseClick?.(exercise)}
            />
          );
        })}
      </div>
    </section>
  );
}
