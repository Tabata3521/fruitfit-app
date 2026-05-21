import { Bot, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import { getExerciseAlternatives } from "../data/exerciseAlternatives";
import { dietTypeToRation } from "../data/profileStore";
import { getMealPlan, useNutritionData } from "../data/useNutritionData";
import { askFruitFitCoach } from "../services/openai";

const starters = [
  "Какой вес поставить в следующем подходе?",
  "Что делать если плохо восстановился?",
  "Чем заменить упражнение без тренажера?",
  "Как собрать прием пищи на сегодня?",
];

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") || fallback;
  } catch (_) {
    return fallback;
  }
}

function ThinkingDots() {
  return (
    <div className="flex w-20 items-center gap-1 rounded-[20px] bg-appCard px-4 py-3 shadow-sm">
      {[0, 1, 2].map((item) => (
        <span key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-appMuted" style={{ animationDelay: `${item * 120}ms` }} />
      ))}
    </div>
  );
}

export default function CoachScreen({ program, workout, profile, onNavigate }) {
  const { data: nutritionData } = useNutritionData();
  const [messages, setMessages] = useState(() => readJsonStorage("fruitfit.coachMessages", [
    { role: "assistant", content: "Я — tagirfruit, ИИ-ассистент внутри FruitFit. Помогаю с тренировками, восстановлением и питанием на основе твоей программы и прогресса." },
  ]));
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  const context = useMemo(() => {
    const currentExercise = workout?.exercises?.[0];
    const profileFromStorage = readJsonStorage("fruitfit.profile", {});
    const activeProfile = { ...profileFromStorage, ...(profile || {}) };
    const ration = dietTypeToRation[activeProfile.dietType] || "Без ограничений";
    const caloriesTarget = Number(activeProfile.recommendedCaloriesTarget || activeProfile.calculatedCalories || 1800);
    const nutrition = getMealPlan(nutritionData, { ration, caloriesTarget, day: "Понедельник", mealType: "" });
    return {
      currentWorkout: workout ? {
        programId: workout.program_id,
        programTitle: workout.course.display_name,
        workoutId: workout.workout_id,
        workoutTitle: workout.lesson.lesson_title,
        day: workout.lesson.lesson_number,
        totalWorkouts: program?.workouts?.length,
        exercises: workout.exercises.slice(0, 10).map((exercise) => ({
          name: exercise.exercise_name,
          sets: exercise.sets,
          reps: exercise.reps,
          comment: exercise.raw_line || exercise.comment,
        })),
      } : null,
      currentExercise: currentExercise ? {
        name: currentExercise.exercise_name,
        sets: currentExercise.sets,
        reps: currentExercise.reps,
        comment: currentExercise.raw_line || currentExercise.comment,
      } : null,
      exerciseAlternatives: currentExercise ? getExerciseAlternatives(currentExercise, "equipment") : null,
      exerciseWeights: readJsonStorage("exerciseWeights", {}),
      nutrition: {
        ration,
        caloriesTarget,
        day: "Понедельник",
        totals: nutrition.totals,
        mealsCount: nutrition.mealsCount,
        meals: nutrition.meals.slice(0, 4).map((meal) => ({
          title: meal.title,
          mealType: meal.mealType,
          calories: meal.calories,
          protein: meal.protein,
          fat: meal.fat,
          carbs: meal.carbs,
        })),
      },
      health: {
        pulse: 72,
        restingPulse: 58,
        sleep: "7ч 32м",
        recovery: 82,
        fatigue: "умеренная",
      },
      profile: Object.keys(activeProfile).length ? activeProfile : {
        gender: "female",
        level: "средний",
        goal: "массонабор",
      },
    };
  }, [nutritionData, profile, program, workout]);

  useEffect(() => {
    localStorage.setItem("fruitfit.coachMessages", JSON.stringify(messages.slice(-30)));
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text = input) {
    const content = text.trim();
    if (!content || loading) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const answer = await askFruitFitCoach(next, context);
      setMessages([...next, { role: "assistant", content: answer }]);
    } catch (error) {
      setMessages([...next, { role: "assistant", content: error.message || "tagirfruit временно недоступен." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="phone-shell flex min-h-screen flex-col pb-[142px]">
      <div className="px-4 pt-5">
        <header className="flex items-start justify-between">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-appDark text-appGreen">
              <Bot size={22} />
            </div>
            <h1 className="mt-4 text-[26px] font-black text-appText">tagirfruit</h1>
            <p className="mt-2 text-[13px] text-appMuted">Онлайн • знает текущую тренировку, питание и веса.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-appGreen/60 px-3 py-1.5 text-[11px] font-bold text-[#181F19]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6EAA24]" /> live
          </span>
        </header>

        <section className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {starters.map((item) => (
            <button key={item} type="button" onClick={() => send(item)} className="shrink-0 rounded-full bg-appCard px-3 py-2 text-left text-[12px] font-semibold text-appText shadow-sm">
              {item}
            </button>
          ))}
        </section>
      </div>

      <section ref={listRef} className="mt-2 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {messages.map((message, index) => (
          <div key={index} className={`max-w-[86%] rounded-[20px] px-4 py-3 text-[13px] leading-5 shadow-sm ${message.role === "user" ? "ml-auto bg-appGreen text-[#181F19]" : "bg-appCard text-appText"}`}>
            {message.content}
          </div>
        ))}
        {loading && <ThinkingDots />}
      </section>

      <div className="fixed bottom-[76px] left-1/2 z-30 w-full max-w-[393px] -translate-x-1/2 px-4">
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2 rounded-full border border-appBorder bg-appCard p-2 shadow-card">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Спроси tagirfruit..." className="min-w-0 flex-1 bg-transparent px-3 text-[14px] text-appText outline-none" />
          <button type="submit" disabled={loading} className="grid h-10 w-10 place-items-center rounded-full bg-appDark text-appGreen disabled:opacity-55">
            <Send size={17} />
          </button>
        </form>
      </div>
      <BottomNavigation active="coach" onNavigate={onNavigate} />
    </main>
  );
}
