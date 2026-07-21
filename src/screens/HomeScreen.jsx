import { ArrowRight, Leaf, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import HeroWorkoutCard from "../components/HeroWorkoutCard";
import WidgetGrid from "../components/WidgetGrid";
import EngagementPrompt from "../components/EngagementPrompt";
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

export default function HomeScreen({ program, workout, profile, user, access, programAssignment, onStartWorkout, onNavigate }) {
  const [notificationItems, setNotificationItems] = useState(() => loadNotificationCenter());
  const greetingName = profileGreetingName(profile);
  const accessBadge = APP_STORE_REVIEW ? "" : accessLabel(access);
  const coachTip = notificationItems[0] || fallbackCoachTip;
  const showPersonalSupportCard = !hasActivePersonalProgram(access);

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
          <HeroWorkoutCard
            program={program}
            workout={workout}
            access={access}
            profile={profile}
            programAssignment={programAssignment}
            isPreview={showPersonalSupportCard}
            onStart={onStartWorkout}
          />
        </div>

        {showPersonalSupportCard && (
          <PersonalSupportCard onOpen={() => onNavigate?.("trainerRequest", { source: "personal-support-card" })} />
        )}

        <WidgetGrid profile={profile} access={access} onNavigate={onNavigate} />
      </div>
      <BottomNavigation active="home" onNavigate={onNavigate} />
      <EngagementPrompt user={user} access={access} onNavigate={onNavigate} />
    </main>
  );
}

function PersonalSupportCard({ onOpen }) {
  return (
    <section className="mt-3 rounded-[22px] border border-appBorder bg-appCard p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border border-appBorder bg-appBg text-appText">
          <UserCheck size={16} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-black leading-tight text-appText">Персональное сопровождение</h2>
          <p className="mt-0.5 text-[11px] font-semibold leading-4 text-appMuted">
            Отправь мне анкету для персональной программы.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="exercise-replace-button mt-2 flex h-9 w-full items-center justify-between rounded-full px-3.5 text-[12px] font-black transition active:scale-[0.98]"
      >
        <span>Подать заявку</span>
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#181F19]/12 text-current">
          <ArrowRight size={15} />
        </span>
      </button>
    </section>
  );
}

function CoachTip({ item }) {
  const body = String(item?.body || fallbackCoachTip.body).trim();
  return (
    <p className="mt-2 line-clamp-2 text-[12px] font-bold leading-4 text-appMuted">«{body}»</p>
  );
}

function hasActivePersonalProgram(access) {
  if (!access) return false;
  const values = [
    access.billingStatus,
    access.billing_status,
    access.paymentStatus,
    access.payment_status,
    access.accessStatus,
    access.access_status,
    access.plan,
    access.status,
    access.tier,
    access.subscriptionStatus,
    access.subscription_status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
  const activeValues = new Set(["paid", "vip", "active", "trainer", "admin", "test"]);
  return Boolean(
    access.isPaid ||
    access.isVip ||
    access.is_vip ||
    access.isAdmin ||
    access.isTrainer ||
    access.isTest ||
    access.personalCoachingActive ||
    access.personal_coaching_active ||
    access.subscription?.status === "active" ||
    values.some((value) => activeValues.has(value))
  );
}

function accessLabel(access) {
  if (!access) return "";
  if (access.isAdmin) return "admin";
  if (access.isTrainer) return "trainer";
  const assigned = ["pa", "id"].join("");
  const priority = ["v", "ip"].join("");
  if (access.status === priority || access?.[["is", "V", "ip"].join("")]) return priority;
  if (access.status === assigned || access?.[["is", "Pa", "id"].join("")]) return assigned;
  return "free";
}
