import { Check, ChevronRight, Dumbbell, Lock } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import femaleProgramImage from "../assets/program-female.png";
import maleProgramImage from "../assets/program-male.png";
import { isWorkoutUnlocked, originalWorkoutIndex, visibleWorkoutsForAccess, workoutAccessLabel } from "../data/accessRules";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import { programGender } from "../data/programPresentation";

function programImage(course) {
  return programGender(course) === "male" ? maleProgramImage : femaleProgramImage;
}

function programTypeLabel(course) {
  const gender = programGender(course);
  if (gender === "male") return "Мужская программа";
  if (gender === "female") return "Женская программа";
  return "Программа";
}

export default function WorkoutsScreen({ program, selectedWorkoutIndex, onOpenWorkout, onNavigate, access, profile, programAssignment }) {
  const completedUntil = Math.max(0, selectedWorkoutIndex - 1);
  const totalWorkouts = program.workouts.length;
  const visibleWorkouts = visibleWorkoutsForAccess(program.workouts, access, profile, programAssignment);
  const visibleTotal = Math.max(1, visibleWorkouts.length);
  const visibleSelectedIndex = Math.min(selectedWorkoutIndex, visibleTotal - 1);

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-appDark text-appGreen">
            <Dumbbell size={20} />
          </div>
          <h1 className="mt-4 text-[26px] font-black leading-tight text-appText">Тренировки</h1>
          <p className="mt-2 line-clamp-2 text-[13px] text-appMuted">{program.course.display_name}</p>
          <p className="mt-2 inline-flex rounded-full bg-appCard px-3 py-1 text-[11px] font-bold text-appMuted">{workoutAccessLabel(access, program.workouts, profile, programAssignment)}</p>
          <div className="mt-4 h-1.5 rounded-full bg-[#E6E6DF]">
            <div className="h-full rounded-full bg-[#8BBE3D]" style={{ width: `${((visibleSelectedIndex + 1) / visibleTotal) * 100}%` }} />
          </div>
          <div className="relative mt-3 h-[154px] overflow-hidden rounded-[24px] bg-[#070B07] shadow-card">
            <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_82%_18%,rgba(221,247,180,0.12),transparent_28%),linear-gradient(100deg,#050805_0%,#0A100B_58%,#182315_100%)]" />
            <div className="absolute inset-y-0 right-0 z-10 w-[58%] bg-gradient-to-l from-transparent via-transparent to-[#070B07]" />
            <img
              src={programImage(program.course)}
              alt=""
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute bottom-0 right-0 z-20 h-[96%] w-[36%] object-contain object-bottom opacity-92 mix-blend-screen drop-shadow-[0_16px_26px_rgba(0,0,0,0.5)]"
              draggable="false"
            />
            <div className="relative z-30 flex h-full max-w-[84%] flex-col justify-end p-4 pr-16 text-white">
              <span className="program-card-kicker">{programTypeLabel(program.course)}</span>
              <h2 className="mt-1 line-clamp-4 text-[16px] font-black leading-[1.08]">{program.course.display_name}</h2>
            </div>
          </div>
        </header>

        <section className="mt-5 space-y-2">
          {!visibleWorkouts.length && (
            <div className="rounded-[22px] border border-appBorder bg-appCard p-4 text-center">
              <p className="text-[15px] font-black text-appText">Программа пока формируется.</p>
              <p className="mt-1 text-[12px] leading-5 text-appMuted">После заявки тренер свяжется с вами по электронной почте.</p>
            </div>
          )}
          {visibleWorkouts.map((workout, index) => {
            const sourceIndex = originalWorkoutIndex(program.workouts, workout);
            const safeSourceIndex = sourceIndex >= 0 ? sourceIndex : index;
            const active = safeSourceIndex === selectedWorkoutIndex;
            const locked = !APP_STORE_REVIEW && !isWorkoutUnlocked(safeSourceIndex, program.workouts, access, profile, programAssignment);
            const completed = safeSourceIndex <= completedUntil;
            const status = locked ? "закрыта" : completed ? "завершена" : active ? "в процессе" : "не начата";
            return (
              <button
                key={workout.workout_id}
                type="button"
                onClick={() => onOpenWorkout(safeSourceIndex)}
                className={`grid min-h-[92px] w-full grid-cols-[44px_1fr_32px] items-center gap-3 rounded-[20px] border p-3 text-left shadow-sm transition ${locked ? "border-appBorder bg-appCard/62 opacity-75" : active ? "border-[#7FBA31] bg-appCard" : "border-appBorder bg-appCard/82"}`}
              >
                <span className={`grid h-11 w-11 place-items-center rounded-full text-[13px] font-black ${locked ? "bg-appBg text-appMuted" : completed ? "bg-[#8BCB35] text-[#181F19]" : active ? "bg-appDark text-[#8BCB35]" : "bg-appBg text-appMuted"}`}>
                  {locked ? <Lock size={16} /> : completed ? <Check size={18} /> : index + 1}
                </span>
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="min-w-0 flex-1 text-[15px] font-bold leading-5 text-appText">{workout.lesson.lesson_title}</h2>
                    <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] text-appMuted">{status}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-appMuted">{workout.exercises.length} упражнений</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-appMuted">{workout.lesson.lesson_description || "Описание тренировки не указано"}</p>
                </div>
                {locked ? <Lock size={17} className="text-appMuted" /> : <ChevronRight size={18} className="text-appMuted" />}
              </button>
            );
          })}
        </section>
      </div>
      <BottomNavigation active="workouts" onNavigate={onNavigate} />
    </main>
  );
}
