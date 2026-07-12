import { ArrowRight } from "lucide-react";
import femaleProgramImage from "../assets/program-female.png";
import maleProgramImage from "../assets/program-male.png";
import { visibleWorkoutsForAccess } from "../data/accessRules";
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

function compactTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export default function HeroWorkoutCard({ program, workout, access, profile, programAssignment, onStart }) {
  const exerciseCount = workout?.exercises?.length || 0;
  const lessonNumber = workout?.lesson?.lesson_number || 1;
  const visibleWorkouts = visibleWorkoutsForAccess(program?.workouts || workout?.lessons || [], access, profile, programAssignment);
  const totalLessons = visibleWorkouts.length || program?.workouts?.length || workout?.lessons?.length || 1;
  const progress = workout?.progress || 0;
  const supersetCount = workout?.superset?.length > 1 ? 1 : 0;
  const title = compactTitle(workout?.lesson?.lesson_title);
  const subtitle = compactTitle(workout?.course?.display_name);

  return (
    <section className="relative min-h-[244px] overflow-hidden rounded-[26px] bg-[#050805] p-4 text-white shadow-card">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_88%_18%,rgba(221,247,180,0.18),transparent_34%),linear-gradient(135deg,#050805_0%,#091009_48%,#142014_100%)]" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-[82%] bg-[linear-gradient(90deg,#050805_0%,rgba(5,8,5,0.92)_16%,rgba(5,8,5,0.44)_44%,rgba(5,8,5,0.08)_72%,transparent_100%)]" />
      <img
        src={programImage(workout?.course)}
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
        className="pointer-events-none absolute bottom-0 right-0 z-20 h-[92%] w-[42%] object-contain object-bottom opacity-92 mix-blend-lighten drop-shadow-[0_18px_30px_rgba(0,0,0,0.62)]"
        style={{
          WebkitMaskImage:
            "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.18) 12%, rgba(0,0,0,0.72) 28%, #000 48%, #000 100%)",
          maskImage:
            "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.18) 12%, rgba(0,0,0,0.72) 28%, #000 48%, #000 100%)",
        }}
      />
      <div className="pointer-events-none absolute inset-y-0 right-[22%] z-[25] w-[42%] bg-[linear-gradient(90deg,#050805_0%,rgba(5,8,5,0.78)_42%,rgba(5,8,5,0.24)_80%,transparent_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] h-20 bg-gradient-to-t from-[#050805] via-[#050805]/48 to-transparent" />

      <div className="relative z-30 flex min-h-[212px] max-w-[78%] flex-col pb-[62px]">
        <span className="w-fit rounded-full bg-appGreen/15 px-2.5 py-1 text-[11px] font-bold text-appGreen">
          Тренировка {lessonNumber}/{totalLessons}
        </span>
        <h2 className="mt-3 line-clamp-2 text-[25px] font-black leading-[1.06]">{title}</h2>
        <div className="mt-2 flex flex-col items-start gap-2">
          <span className="program-card-kicker">{programTypeLabel(workout?.course)}</span>
          <p className="line-clamp-4 text-[12px] leading-[1.35] text-white/82">{subtitle}</p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-white/76">
          <span>{exerciseCount} упражнений</span>
          {supersetCount > 0 && (
            <>
              <span className="text-white/35">•</span>
              <span>{supersetCount} суперсет</span>
            </>
          )}
        </div>

        <div className="mt-auto pt-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="w-9 text-[13px] font-black text-white">{progress}%</span>
            <div className="h-1.5 flex-1 rounded-full bg-white/16">
              <div className="h-full rounded-full bg-appGreen transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onStart}
        className="absolute bottom-4 left-4 z-50 flex h-12 w-[72%] max-w-[260px] items-center justify-between rounded-full bg-appGreen px-4 text-[13px] font-black text-[#181F19] shadow-glow"
      >
        <span className="truncate">Начать тренировку</span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#181F19] text-appGreen">
          <ArrowRight size={17} />
        </span>
      </button>
    </section>
  );
}
