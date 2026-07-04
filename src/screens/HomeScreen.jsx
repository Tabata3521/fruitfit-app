import { Leaf } from "lucide-react";
import { useEffect, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import HeroWorkoutCard from "../components/HeroWorkoutCard";
import WidgetGrid from "../components/WidgetGrid";
import { loadNotificationCenter } from "../data/notificationCenterStore";
import { profileGreetingName } from "../data/profileStore";
import { ensureMotivationLockScreenNotifications } from "../services/notifications/localMotivationNotifications";
import { APP_STORE_REVIEW } from "../config/appStoreReview";

const fallbackCoachTip = {
  id: "home-coach-fallback",
  kind: "daily_motivation",
  title: "FruitFit",
  body: "Сегодня ты становишься версией себя, которую раньше только представлял.",
};

export default function HomeScreen({ program, workout, profile, access, onStartWorkout, onNavigate }) {
  const [notificationItems, setNotificationItems] = useState(() => loadNotificationCenter());
  const greetingName = profileGreetingName(profile);
  const accessBadge = APP_STORE_REVIEW ? "" : accessLabel(access);
  const coachTip = notificationItems[0] || fallbackCoachTip;

  useEffect(() => {
    let active = true;
    ensureMotivationLockScreenNotifications()
      .then(() => {
        if (active) setNotificationItems(loadNotificationCenter());
      })
      .catch(() => {
        if (active) setNotificationItems(loadNotificationCenter());
      });

    const syncCoachTip = () => {
      if (active) setNotificationItems(loadNotificationCenter());
    };
    window.addEventListener("fruitfit:auth-updated", syncCoachTip);
    window.addEventListener("storage", syncCoachTip);

    return () => {
      active = false;
      window.removeEventListener("fruitfit:auth-updated", syncCoachTip);
      window.removeEventListener("storage", syncCoachTip);
    };
  }, []);

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-1 text-[25px] font-black tracking-[-0.02em] text-appText">
              fruitfit <Leaf size={17} className="text-[#8BBE3D]" fill="currentColor" />
            </div>
            <div className="max-w-[150px] pt-1 text-right">
              <p className="truncate text-[12px] font-bold leading-4 text-appMuted">Привет, {greetingName}!</p>
              {accessBadge && (
                <p className="accent-readable-shadow mt-1 inline-flex rounded-full bg-appGreen/20 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-appGreen">
                  {accessBadge}
                </p>
              )}
            </div>
          </div>

          <CoachTip item={coachTip} />

          <h1 className="mt-4 text-[25px] font-bold text-appText">Сегодня</h1>
          <p className="mt-1 text-[14px] text-appMuted">Тренировка, питание и активность</p>
        </header>

        <div className="mt-3.5">
          <HeroWorkoutCard program={program} workout={workout} access={access} onStart={onStartWorkout} />
        </div>

        <WidgetGrid profile={profile} access={access} onNavigate={onNavigate} />
      </div>
      <BottomNavigation active="home" onNavigate={onNavigate} />
    </main>
  );
}

function CoachTip({ item }) {
  const body = String(item?.body || fallbackCoachTip.body).trim();
  return (
    <p className="mt-2 line-clamp-2 text-[12px] font-bold leading-4 text-appMuted">«{body}»</p>
  );
}

function accessLabel(access) {
  if (!access) return "";
  if (access.isAdmin) return "admin";
  if (access.isTrainer) return "trainer";
  if (access.status === "vip" || access.isVip) return "vip";
  if (access.status === "paid" || access.isPaid) return "paid";
  return "free";
}
