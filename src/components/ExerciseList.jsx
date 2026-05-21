import ExerciseCard from "./ExerciseCard";
import SupersetCard from "./SupersetCard";

export default function ExerciseList({ exercises = [], currentIndex = 0, superset = [], onExerciseClick, onSupersetStart }) {
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

          const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "upcoming";
          return (
            <ExerciseCard
              key={`${exercise.lesson_id}-${exercise.exercise_order}`}
              exercise={exercise}
              state={state}
              index={index + 1}
              onClick={() => onExerciseClick?.(exercise)}
            />
          );
        })}
      </div>
    </section>
  );
}
