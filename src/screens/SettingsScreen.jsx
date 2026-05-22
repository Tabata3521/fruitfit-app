import { ArrowLeft, Bell, CreditCard, LogOut, Moon, ShieldCheck, Sun, Trash2, UserRound, Wallet } from "lucide-react";
import BottomNavigation from "../components/BottomNavigation";
import AppIconSettings from "../components/AppIconSettings";
import { saveAuthUser } from "../data/authStore";

function ThemeSection({ theme, onThemeChange }) {
  return (
    <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
      <h2 className="text-[16px] font-black text-appText">Тема</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {[
          ["light", "Светлая", Sun],
          ["dark", "Тёмная", Moon],
          ["system", "Системная", Bell],
        ].map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => onThemeChange(id)} className={`grid h-20 place-items-center rounded-[18px] border text-[12px] font-bold ${theme === id ? "border-appGreen bg-appGreen text-[#181F19]" : "border-appBorder bg-appBg text-appMuted"}`}>
            <Icon size={18} />
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

function PlaceholderCard({ icon: Icon, title, text, badge = "готовится" }) {
  return (
    <div className="rounded-[20px] border border-appBorder bg-appBg p-3">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-appCard text-appGreen">
          <Icon size={18} />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="text-[13px] font-black text-appText">{title}</span>
            <span className="rounded-full bg-appGreen/20 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-appGreen">{badge}</span>
          </span>
          <span className="mt-1 block text-[12px] leading-5 text-appMuted">{text}</span>
        </span>
      </div>
    </div>
  );
}

export default function SettingsScreen({ theme, onThemeChange, onNavigate }) {
  function logout() {
    saveAuthUser(null);
    window.location.reload();
  }

  return (
    <main className="phone-shell pb-[82px]">
      <div className="px-4 pt-[max(20px,env(safe-area-inset-top))]">
        <header className="sticky top-0 z-20 -mx-4 flex items-center gap-3 bg-appBg/92 px-4 py-3 backdrop-blur">
          <button type="button" onClick={() => onNavigate("profile")} className="grid h-10 w-10 place-items-center rounded-full bg-appCard text-appText shadow-sm">
            <ArrowLeft size={18} />
          </button>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-appGreen">Профиль</p>
            <h1 className="text-[25px] font-black text-appText">Настройки</h1>
          </div>
        </header>

        <div className="mt-3 space-y-4">
          <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Вход и аккаунт</h2>
            <p className="mt-1 text-[12px] leading-5 text-appMuted">UI подготовлен под будущую авторизацию. Backend-логика будет подключаться отдельно.</p>
            <div className="mt-3 grid gap-2">
              <button type="button" disabled className="flex min-h-12 items-center justify-between rounded-2xl border border-appBorder bg-appBg px-4 text-left opacity-75">
                <span>
                  <span className="block text-[13px] font-black text-appText">Войти через Telegram</span>
                  <span className="text-[11px] font-bold text-appMuted">Скоро будет доступно</span>
                </span>
                <UserRound size={18} className="text-[#229ED9]" />
              </button>
              <button type="button" disabled className="flex min-h-12 items-center justify-between rounded-2xl border border-appBorder bg-appBg px-4 text-left opacity-75">
                <span>
                  <span className="block text-[13px] font-black text-appText">Войти через Яндекс</span>
                  <span className="text-[11px] font-bold text-appMuted">Скоро будет доступно</span>
                </span>
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FC3F1D] text-[14px] font-black text-white">Я</span>
              </button>
            </div>
          </section>

          <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Оплата</h2>
            <div className="mt-3 grid gap-2">
              <PlaceholderCard icon={CreditCard} title="Способы оплаты" text="Платёжные методы появятся после подключения billing backend." />
              <PlaceholderCard icon={Wallet} title="История оплат" text="Здесь будет аккуратный список покупок, программ и продлений." />
            </div>
          </section>

          <AppIconSettings compact />
          <ThemeSection theme={theme} onThemeChange={onThemeChange} />

          <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Данные и приватность</h2>
            <div className="mt-3 grid gap-2">
              <PlaceholderCard icon={ShieldCheck} title="Экспорт данных" text="Будет доступна выгрузка профиля, замеров и истории тренировок." />
              <PlaceholderCard icon={Trash2} title="Удалить аккаунт" text="Опасное действие будет доступно только после полноценной backend-авторизации." badge="недоступно" />
            </div>
          </section>

          <section className="rounded-[26px] border border-appBorder bg-appCard p-4 shadow-sm">
            <h2 className="text-[16px] font-black text-appText">Версия</h2>
            <div className="mt-3 rounded-[18px] border border-appBorder bg-appBg p-3 text-[12px] leading-5 text-appMuted">
              <p><span className="font-black text-appText">FruitFit</span> Android/PWA 0.1.0</p>
              <p>Build: UI polish debug</p>
              <p>Health, питание и тренировки остаются в текущей рабочей логике.</p>
            </div>
          </section>

          <section className="rounded-[26px] border border-red-500/30 bg-red-500/10 p-4 text-center shadow-sm">
            <button type="button" onClick={logout} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red-500 text-[14px] font-black text-white">
              <LogOut size={17} /> Выйти из аккаунта
            </button>
          </section>
        </div>
      </div>
      <BottomNavigation active="profile" onNavigate={onNavigate} />
    </main>
  );
}
