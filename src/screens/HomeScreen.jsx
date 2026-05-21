import { Bell, CalendarDays, ChevronDown, History, Leaf, ListChecks } from "lucide-react";
import { useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import HeroWorkoutCard from "../components/HeroWorkoutCard";
import WidgetGrid from "../components/WidgetGrid";
import { authDisplayName } from "../data/authStore";

export default function HomeScreen({ program, workout, profile, authUser, onStartWorkout, onNavigate }) {
  const [todayOpen, setTodayOpen] = useState(false);
  const userName = authDisplayName(authUser);
  const todayItems = [
    ["Текущий день", "План на сегодня", CalendarDays],
    ["История тренировок", "Последние завершённые дни", History],
    ["Прогресс недели", "Тренировки и активность", ListChecks],
    ["Пропущенные", "Что можно наверстать мягко", ChevronDown],
  ];

  return (
    <main className="phone-shell pb-[82px]">
      <div className="px-4 pt-5">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1 text-[25px] font-black tracking-[-0.02em] text-appText">
              fruitfit <Leaf size={17} className="text-[#8BBE3D]" fill="currentColor" />
            </div>
            {userName && <p className="mt-2 text-[13px] font-bold text-appMuted">Привет, {userName}</p>}
            <div className="relative mt-5">
              <button type="button" onClick={() => setTodayOpen((value) => !value)} className="inline-flex items-center gap-1 text-[25px] font-bold text-appText">
                Сегодня <ChevronDown size={18} className={`transition ${todayOpen ? "rotate-180" : ""}`} />
              </button>
              {todayOpen && (
                <div className="absolute left-0 top-10 z-30 w-[270px] rounded-[22px] border border-appBorder bg-appCard p-2 shadow-card">
                  {todayItems.map(([title, subtitle, Icon]) => (
                    <button key={title} type="button" onClick={() => setTodayOpen(false)} className="flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-appBg">
                      <span className="grid h-9 w-9 place-items-center rounded-full bg-appGreen/50 text-[#181F19]"><Icon size={16} /></span>
                      <span>
                        <span className="block text-[13px] font-black text-appText">{title}</span>
                        <span className="block text-[11px] text-appMuted">{subtitle}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-1 text-[14px] text-appMuted">Тренировка, питание и активность</p>
          </div>
          <button type="button" className="relative grid h-10 w-10 place-items-center rounded-full border border-appBorder bg-appCard/82 shadow-sm">
            <Bell size={18} />
            <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-appOrange" />
          </button>
        </header>

        <div className="mt-4">
          <HeroWorkoutCard program={program} workout={workout} onStart={onStartWorkout} />
        </div>

        <WidgetGrid profile={profile} onNavigate={onNavigate} />
      </div>
      <BottomNavigation active="home" onNavigate={onNavigate} />
    </main>
  );
}
