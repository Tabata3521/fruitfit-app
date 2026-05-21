import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { saveAuthUser, telegramWebAppUser } from "../data/authStore";

const DEFAULT_TELEGRAM_BOT = "fruitfit_login_bot";

export default function AuthPrompt({ onComplete }) {
  const [message, setMessage] = useState("");
  const telegramBot = (import.meta.env.VITE_TELEGRAM_BOT_USERNAME || DEFAULT_TELEGRAM_BOT).replace(/^@/, "");
  const tgContainerRef = useRef(null);

  function complete(user) {
    console.log("[FruitFit Auth] Current Hostname:", window.location.hostname);
    saveAuthUser(user);
    onComplete?.(user);
  }

  // Встраиваем Telegram Login Widget через useEffect
  useEffect(() => {
    const container = tgContainerRef.current;
    if (!container) return;

    // Очистка
    container.innerHTML = "";

    // Определяем глобальную функцию для виджета
    window.onTelegramAuth = async (user) => {
      console.log("[FruitFit Auth] Telegram user received:", user);
      if (!user) {
        setMessage("Ошибка: Telegram не передал данные пользователя");
        return;
      }

      try {
        setMessage("Проверка авторизации...");
        const response = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });

        const result = await response.json();
        if (response.ok && result.token) {
          // Сохраняем JWT и профиль
          complete(result.user);
        } else {
          setMessage(`Ошибка сервера: ${result.error || "Неизвестная ошибка"}`);
        }
      } catch (err) {
        console.error("[FruitFit Auth] Fetch error:", err);
        setMessage("Ошибка сети при проверке авторизации");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", telegramBot);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.async = true;
    container.appendChild(script);

    return () => {
      container.innerHTML = "";
      delete window.onTelegramAuth;
    };
  }, [telegramBot]);

  function skipLogin() {
    saveAuthUser(null);
    onComplete?.(null);
  }

  function yandexLogin() {
    window.location.href = "/api/auth/yandex";
  }

  // Если пользователь открыл через Telegram WebApp — сразу авторизуем
  useEffect(() => {
    const tgUser = telegramWebAppUser();
    if (tgUser) complete(tgUser);
  }, []);

  return (
    <main className="phone-shell flex min-h-screen flex-col justify-between bg-appBg px-4 pb-[max(22px,env(safe-area-inset-bottom))] pt-5">
      <section>
        <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#6FA62F]">fruitfit</p>
        <h1 className="mt-4 text-[30px] font-black leading-tight text-appText">Сохранить прогресс</h1>
        <p className="mt-3 text-[14px] leading-6 text-appMuted">
          Войдите, чтобы синхронизировать прогресс на всех устройствах. Вход можно временно пропустить.
        </p>

        <div className="mt-6 grid gap-3">
          {/* Telegram Widget — загружается через useEffect, не через JSX */}
          <div
            className="flex h-[54px] items-center justify-center overflow-hidden rounded-full bg-[#229ED9] shadow-card"
            ref={tgContainerRef}
          />

          {/* Запасной вариант: Прямая ссылка на бота */}
          <a
            href={`https://t.me/${telegramBot}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-11 items-center justify-center rounded-full border border-[#229ED9]/30 bg-[#229ED9]/10 text-[13px] font-bold text-[#229ED9]"
          >
            Не работает кнопка? Войти через бота напрямую
          </a>

          {/* Яндекс ID */}
          <button
            type="button"
            id="btn-yandex-login"
            onClick={yandexLogin}
            className="flex h-[54px] items-center justify-between rounded-full bg-[#FC3F1D] px-5 text-[15px] font-black text-white shadow-card"
          >
            <span className="inline-flex items-center gap-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M13.878 22H16.8V2H12.534C7.668 2 5.1 4.612 5.1 8.26c0 3.1 1.524 4.924 4.386 6.874L4.8 22h3.108L12.756 15l-1.152-.784c-2.268-1.55-3.384-2.94-3.384-5.124 0-2.478 1.68-4.14 4.782-4.14h.876V22z" fill="white"/>
              </svg>
              Яндекс ID
            </span>
            <ArrowRight size={18} />
          </button>

          {/* Пропустить */}
          <button
            type="button"
            id="btn-skip-login"
            onClick={skipLogin}
            className="flex h-[54px] items-center justify-center rounded-full border border-appBorder bg-appCard px-5 text-[15px] font-black text-appText shadow-sm"
          >
            Пропустить
          </button>
        </div>

        {message && (
          <p className="mt-4 rounded-[18px] border border-appBorder bg-appCard p-3 text-[12px] leading-5 text-appMuted">
            {message}
          </p>
        )}
      </section>

      <p className="pb-1 text-center text-[11px] leading-5 text-appMuted">
        Токены и секреты не хранятся во frontend.
      </p>
    </main>
  );
}
