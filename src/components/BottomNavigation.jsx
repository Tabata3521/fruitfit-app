import { useEffect, useRef, useState } from "react";
import { Bot, Dumbbell, GripHorizontal, Home, Salad, Save, User } from "lucide-react";
import { activeWorkoutSession } from "../data/workoutSessions";
import { readUserCoreField } from "../data/dataContainers";
import { workoutCycleIdentity } from "../data/workoutCycle";
import { flushWorkoutSessionSync } from "../services/workoutSessionSync";

const HIDDEN_BANNER_KEY = "fruitfit.workout.activeBanner.hiddenSession.v1";
const BANNER_POSITION_PREFIX = "fruitfit.workout.activeBanner.lift.v1:";
const DEFAULT_BANNER_BOTTOM = 76;
const BANNER_SAFE_TOP = 72;
const BANNER_ESTIMATED_HEIGHT = 76;

function bannerPositionKey(sessionId) {
  return `${BANNER_POSITION_PREFIX}${String(sessionId || "unknown")}`;
}

function readSessionValue(key, fallback = "") {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function writeSessionValue(key, value) {
  try {
    sessionStorage.setItem(key, String(value));
  } catch (_) {
    // The banner remains usable when session storage is unavailable.
  }
}

function maxBannerLift() {
  if (typeof window === "undefined") return 0;
  return Math.max(0, window.innerHeight - DEFAULT_BANNER_BOTTOM - BANNER_ESTIMATED_HEIGHT - BANNER_SAFE_TOP);
}

function clampBannerLift(value) {
  return Math.max(0, Math.min(maxBannerLift(), Number(value) || 0));
}

const items = [
  { id: "home", label: "Главная", icon: Home },
  { id: "workouts", label: "Тренировки", icon: Dumbbell },
  { id: "food", label: "Питание", icon: Salad },
  { id: "coach", label: "Coach", icon: Bot },
  { id: "profile", label: "Профиль", icon: User },
];

export default function BottomNavigation({ active = "home", onNavigate }) {
  function readCycleScopedActiveSession() {
    const assignment = readUserCoreField("programAssignment", undefined, null);
    const access = readUserCoreField("accessState", undefined, null);
    return activeWorkoutSession(undefined, workoutCycleIdentity(assignment, access));
  }

  const [activeSession, setActiveSession] = useState(readCycleScopedActiveSession);
  const [hiddenSessionId, setHiddenSessionId] = useState(() => readSessionValue(HIDDEN_BANNER_KEY));
  const [bannerLift, setBannerLift] = useState(0);
  const bannerLiftRef = useRef(0);
  const dragRef = useRef(null);
  const movedRef = useRef(false);

  useEffect(() => {
    const refresh = () => setActiveSession(readCycleScopedActiveSession());
    window.addEventListener("fruitfit:workout-sessions-updated", refresh);
    window.addEventListener("fruitfit:program-assignment-updated", refresh);
    window.addEventListener("fruitfit:access-updated", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("fruitfit:workout-sessions-updated", refresh);
      window.removeEventListener("fruitfit:program-assignment-updated", refresh);
      window.removeEventListener("fruitfit:access-updated", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const sessionId = activeSession?.session_id;
    if (!sessionId) {
      bannerLiftRef.current = 0;
      setBannerLift(0);
      return;
    }
    const nextLift = clampBannerLift(readSessionValue(bannerPositionKey(sessionId), "0"));
    bannerLiftRef.current = nextLift;
    setBannerLift(nextLift);
  }, [activeSession?.session_id]);

  useEffect(() => {
    const clampPosition = () => {
      const nextLift = clampBannerLift(bannerLiftRef.current);
      bannerLiftRef.current = nextLift;
      setBannerLift(nextLift);
      if (activeSession?.session_id) writeSessionValue(bannerPositionKey(activeSession.session_id), nextLift);
    };
    window.addEventListener("resize", clampPosition);
    return () => window.removeEventListener("resize", clampPosition);
  }, [activeSession?.session_id]);

  function beginBannerDrag(event) {
    if (event.button !== 0 || event.target.closest("[data-workout-banner-action]")) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    movedRef.current = false;
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startLift: bannerLiftRef.current,
    };
  }

  function moveBanner(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = drag.startY - event.clientY;
    if (Math.abs(delta) > 6) movedRef.current = true;
    const nextLift = clampBannerLift(drag.startLift + delta);
    bannerLiftRef.current = nextLift;
    setBannerLift(nextLift);
  }

  function finishBannerDrag(event) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (activeSession?.session_id) {
      writeSessionValue(bannerPositionKey(activeSession.session_id), bannerLiftRef.current);
    }
  }

  function resumeWorkout() {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    window.dispatchEvent(new CustomEvent("fruitfit:resume-workout", { detail: activeSession }));
  }

  function saveAndHideBanner(event) {
    event.stopPropagation();
    const sessionId = activeSession?.session_id;
    if (!sessionId) return;
    flushWorkoutSessionSync(sessionId, {
      userId: activeSession.user_id,
      keepalive: true,
    }).catch(() => {});
    writeSessionValue(HIDDEN_BANNER_KEY, sessionId);
    setHiddenSessionId(sessionId);
  }

  const showWorkoutBanner = Boolean(
    activeSession &&
    active !== "workouts" &&
    hiddenSessionId !== activeSession.session_id
  );

  return (
    <>
      {showWorkoutBanner && (
        <aside
          className="fixed left-1/2 z-40 w-[calc(min(100vw,430px)-24px)] -translate-x-1/2 select-none rounded-[16px] border border-appGreen/35 bg-appDark px-2.5 pb-2.5 pt-1 text-white shadow-soft"
          style={{
            bottom: `calc(${DEFAULT_BANNER_BOTTOM}px + env(safe-area-inset-bottom) + ${bannerLift}px)`,
            touchAction: "none",
          }}
          onPointerDown={beginBannerDrag}
          onPointerMove={moveBanner}
          onPointerUp={finishBannerDrag}
          onPointerCancel={finishBannerDrag}
        >
          <span className="flex h-3 items-center justify-center text-white/45" aria-hidden="true">
            <GripHorizontal size={20} />
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resumeWorkout}
              className="flex min-w-0 flex-1 items-center gap-3 rounded-[12px] text-left"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-appGreen text-[#181F19]"><Dumbbell size={18} /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-black">Тренировка продолжается — вернуться</span>
                <span className="mt-0.5 block truncate text-[11px] text-white/70">
                  {activeSession.workout_title || "Тренировка"} · {activeSession.progress?.completed_exercises || 0} из {activeSession.progress?.total_exercises || 0}
                </span>
              </span>
            </button>
            <button
              type="button"
              data-workout-banner-action
              onClick={saveAndHideBanner}
              aria-label="Сохранить прогресс и скрыть плашку"
              title="Сохранить и скрыть"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-white transition active:scale-95"
            >
              <Save size={16} />
            </button>
          </div>
        </aside>
      )}
      <nav className="fixed-shell fixed bottom-0 left-1/2 z-40 -translate-x-1/2 border-t border-appBorder bg-appCard/92 px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-md">
        <div className="grid h-[58px] grid-cols-5 items-center">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate?.(item.id, { source: "tab" })}
              className={`flex h-full flex-col items-center justify-center gap-1 text-[10px] font-medium ${selected ? "text-[#86B936]" : "text-appMuted"}`}
            >
              <Icon size={21} strokeWidth={selected ? 2.6 : 1.8} />
              <span className="leading-none">{item.label}</span>
            </button>
          );
        })}
        </div>
      </nav>
    </>
  );
}
