import { Check, ChevronRight, Dumbbell } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import femaleProgramImage from "../assets/program-female.png";
import maleProgramImage from "../assets/program-male.png";

function programImage(course) {
  const text = `${course?.gender || ""} ${course?.display_name || ""} ${course?.technical_name || ""}`.toLowerCase();
  return text.includes("муж") || text.includes("male") || text.includes("рјсѓр¶") ? maleProgramImage : femaleProgramImage;
}

export default function WorkoutsScreen({ program, selectedWorkoutIndex, onOpenWorkout, onNavigate }) {
  const completedUntil = Math.max(0, selectedWorkoutIndex - 1);

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-appDark text-appGreen">
            <Dumbbell size={20} />
          </div>
          <h1 className="mt-4 text-[26px] font-black leading-tight text-appText">Тренировки</h1>
          <p className="mt-2 line-clamp-2 text-[13px] text-appMuted">{program.course.display_name}</p>
          <div className="mt-4 h-1.5 rounded-full bg-[#E6E6DF]">
            <div className="h-full rounded-full bg-[#8BBE3D]" style={{ width: `${((selectedWorkoutIndex + 1) / program.workouts.length) * 100}%` }} />
          </div>
          <div className="relative mt-3 h-[154px] overflow-hidden rounded-[24px] bg-[#070B07] shadow-card">
            <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_82%_18%,rgba(221,247,180,0.12),transparent_28%),linear-gradient(100deg,#050805_0%,#0A100B_58%,#182315_100%)]" />
            <div className="absolute inset-y-0 right-0 z-10 w-[58%] bg-gradient-to-l from-transparent via-transparent to-[#070B07]" />
            <img
              src={programImage(program.course)}
              alt=""
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute bottom-0 right-[-18px] z-20 h-[96%] w-[48%] object-contain object-bottom opacity-95 mix-blend-screen drop-shadow-[0_16px_26px_rgba(0,0,0,0.5)]"
              draggable="false"
            />
            <div className="relative z-30 flex h-full max-w-[62%] flex-col justify-end p-4 text-white">
              <span className="text-[11px] font-bold uppercase text-appGreen">Программа</span>
              <h2 className="mt-1 line-clamp-2 text-[20px] font-black leading-tight">{program.course.display_name}</h2>
            </div>
          </div>
        </header>

        <section className="mt-5 space-y-2">
          {program.workouts.map((workout, index) => {
            const active = index === selectedWorkoutIndex;
            const completed = index <= completedUntil;
            const status = completed ? "завершена" : active ? "в процессе" : "не начата";
            return (
              <button
                key={workout.workout_id}
                type="button"
                onClick={() => onOpenWorkout(index)}
                className={`grid min-h-[92px] w-full grid-cols-[44px_1fr_32px] items-center gap-3 rounded-[20px] border p-3 text-left shadow-sm transition ${active ? "border-[#A9D95A] bg-appCard" : "border-appBorder bg-appCard/82"}`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-full text-[13px] font-black ${completed ? "bg-appGreen text-[#181F19]" : active ? "bg-appDark text-appGreen" : "bg-appBg text-appMuted"}`}>
                  {completed ? <Check size={18} /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-[15px] font-bold text-appText">{workout.lesson.lesson_title}</h2>
                    <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] text-appMuted">{status}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-appMuted">{workout.exercises.length} упражнений</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-appMuted">{workout.lesson.lesson_description || "Описание тренировки не указано"}</p>
                </div>
                <ChevronRight size={18} className="text-appMuted" />
              </button>
            );
          })}
        </section>
      </div>
      <BottomNavigation active="workouts" onNavigate={onNavigate} />
    </main>
  );
}
