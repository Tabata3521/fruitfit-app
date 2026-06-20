import { Bot, Dumbbell, Home, Salad, User } from "lucide-react";

const items = [
  { id: "home", label: "Главная", icon: Home },
  { id: "workouts", label: "Тренировки", icon: Dumbbell },
  { id: "food", label: "Питание", icon: Salad },
  { id: "coach", label: "Coach", icon: Bot },
  { id: "profile", label: "Профиль", icon: User },
];

export default function BottomNavigation({ active = "home", onNavigate }) {
  return (
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
  );
}
