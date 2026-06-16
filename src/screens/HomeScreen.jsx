import { BellRing, Leaf } from "lucide-react";
import { useEffect, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import HeroWorkoutCard from "../components/HeroWorkoutCard";
import WidgetGrid from "../components/WidgetGrid";
import { authDisplayName } from "../data/authStore";
import { formatNotificationTime, loadNotificationCenter, markAllNotificationsRead, markNotificationRead } from "../data/notificationCenterStore";
import { ensureMotivationLockScreenNotifications } from "../services/notifications/localMotivationNotifications";

export default function HomeScreen({ program, workout, profile, authUser, access, onStartWorkout, onNavigate }) {
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState(() => loadNotificationCenter());
  const [deliveryStatus, setDeliveryStatus] = useState(null);
  const userName = authDisplayName(authUser);
  const unreadNotifications = notificationItems.filter((item) => !item.readAt).length;
  const accessBadge = accessLabel(access);

  useEffect(() => {
    let active = true;
    ensureMotivationLockScreenNotifications()
      .then((result) => {
        if (active) setDeliveryStatus(result);
      })
      .catch((error) => {
        if (active) setDeliveryStatus({ ok: false, status: "error", message: String(error?.message || error) });
      });
    return () => {
      active = false;
    };
  }, []);

  function toggleNotifications() {
    const refreshed = loadNotificationCenter();
    setNotificationItems(refreshed);
    setNotificationsOpen((value) => !value);
  }

  function readNotification(id) {
    setNotificationItems(markNotificationRead(id));
  }

  function readAllNotifications() {
    setNotificationItems(markAllNotificationsRead());
  }

  async function refreshLockScreenSchedule() {
    const result = await ensureMotivationLockScreenNotifications({ force: true }).catch((error) => ({
      ok: false,
      status: "error",
      message: String(error?.message || error)
    }));
    setDeliveryStatus(result);
  }

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1 text-[25px] font-black tracking-[-0.02em] text-appText">
              fruitfit <Leaf size={17} className="text-[#8BBE3D]" fill="currentColor" />
            </div>
            {userName && <p className="mt-2 text-[13px] font-bold text-appMuted">Привет, {userName}</p>}
            {accessBadge && (
              <p className="accent-readable-shadow mt-1 inline-flex rounded-full bg-appGreen/20 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-appGreen">
                {accessBadge}
              </p>
            )}
            <h1 className="mt-4 text-[25px] font-bold text-appText">Сегодня</h1>
            <p className="mt-1 text-[14px] text-appMuted">Тренировка, питание и активность</p>
          </div>
          <div>
            <button
              type="button"
              onClick={toggleNotifications}
              className="relative grid h-10 w-10 place-items-center rounded-full border border-appBorder bg-appCard/92 text-appText shadow-sm transition active:scale-95"
              aria-label="Уведомления"
            >
              <BellRing size={19} strokeWidth={2.45} />
              {unreadNotifications > 0 && (
                <span className="absolute right-1.5 top-1.5 grid min-h-4 min-w-4 place-items-center rounded-full border-2 border-appCard bg-appOrange px-1 text-[8px] font-black leading-none text-white">
                  {Math.min(unreadNotifications, 9)}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <div className="notification-popover-layer">
                <section className="notification-popover-card border border-appBorder bg-appCard text-left shadow-card">
                  <div className="shrink-0 border-b border-appBorder/70 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[15px] font-black leading-5 text-appText">Уведомления</p>
                        <p className="mt-0.5 text-[11px] font-bold text-appMuted">Спокойные напоминания 2-3 раза в день</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-appBg px-2 py-1 text-[10px] font-black text-appMuted">
                        {unreadNotifications ? `${unreadNotifications} новых` : "всё прочитано"}
                      </span>
                    </div>
                    {unreadNotifications > 0 && (
                      <button type="button" onClick={readAllNotifications} className="mt-2 h-8 rounded-full bg-appGreen px-3 text-[11px] font-black text-[#181F19]">
                        Отметить прочитанными
                      </button>
                    )}
                  </div>

                  <div className="notification-popover-scroll">
                    {notificationItems.length ? notificationItems.map((item) => {
                      const unread = !item.readAt;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => readNotification(item.id)}
                          className={`grid w-full grid-cols-[34px_1fr] gap-3 rounded-[18px] p-3 text-left transition active:scale-[0.99] ${unread ? "bg-appGreen/18" : "bg-appBg/78"}`}
                        >
                          <span className={`grid h-8 w-8 place-items-center rounded-full ${unread ? "bg-appGreen text-[#181F19]" : "bg-appBg text-appMuted"}`}>
                            <BellRing size={15} strokeWidth={2.4} />
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-black uppercase tracking-wide text-appMuted">{formatNotificationTime(item.sentAt)}</span>
                              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${unread ? "bg-appOrange/18 text-appOrange" : "bg-appBg text-appMuted"}`}>
                                {unread ? "непрочитано" : "прочитано"}
                              </span>
                            </span>
                            <span className="mt-1 block text-[13px] font-black text-appText">{item.title}</span>
                            <span className="mt-0.5 block text-[12px] leading-4 text-appMuted">{item.body}</span>
                          </span>
                        </button>
                      );
                    }) : (
                      <div className="rounded-[18px] bg-appBg p-4 text-[12px] font-bold leading-5 text-appMuted">
                        Пока нет отправленных уведомлений. Новые спокойные напоминания появятся по расписанию.
                      </div>
                    )}
                  </div>

                  <div className="shrink-0 border-t border-appBorder/70 px-4 py-3">
                    <p className="text-[11px] font-bold leading-4 text-appMuted">
                      {deliveryStatusText(deliveryStatus)}
                    </p>
                    <button type="button" onClick={refreshLockScreenSchedule} className="mt-2 h-8 rounded-full bg-appBg px-3 text-[11px] font-black text-appText">
                      Проверить lock screen
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
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

function accessLabel(access) {
  if (!access) return "";
  if (access.isAdmin) return "admin";
  if (access.isTrainer) return "trainer";
  if (access.status === "vip" || access.isVip) return "vip";
  if (access.status === "paid" || access.isPaid) return "paid";
  return "free";
}

function deliveryStatusText(status) {
  if (!status) return "Готовим lock-screen уведомления Android.";
  if (status.status === "permission_missing") return "Чтобы уведомления появлялись на заблокированном экране, разреши уведомления Android для FruitFit.";
  if (status.ok && status.scheduled) return `Lock screen включен: запланировано ${status.scheduled}, ближайшее ${formatNotificationTime(status.nextAt)}.`;
  if (status.ok) return "Lock screen уведомления уже запланированы.";
  if (status.status === "web_only") return "В браузере показываем in-app уведомления. На телефоне они будут системными.";
  return "Не удалось включить lock-screen уведомления. Проверь системные разрешения FruitFit.";
}
