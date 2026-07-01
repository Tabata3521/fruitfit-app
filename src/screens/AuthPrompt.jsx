import { useEffect, useMemo, useState } from "react";
import { Browser } from "@capacitor/browser";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  apiUrl,
  fetchAccess,
  saveAuthUser,
  setAuthToken,
  transferPreAuthProfileDraft,
} from "../data/authStore";
import { getDeviceRegistrationPayloadAsync, registerDevice } from "../data/deviceStore";
import { registerFirebaseMessagingPush } from "../services/notifications/firebaseMessagingPush";
import { postJson } from "../services/nativeHttp";

const SKIP_AUTH_KEY = "fruitfit.authSkipped";
const PRIVACY_POLICY_URL = "https://tagirfruit.ru/privacy-policy";

function authActionFromUrl(rawUrl = window.location.href) {
  try {
    const url = new URL(rawUrl);
    const token = url.searchParams.get("token") || new URLSearchParams(url.hash.replace(/^#/, "")).get("token") || "";
    const text = `${url.pathname} ${url.hash}`.toLowerCase();
    if (text.includes("/email/verify")) return { mode: "verify", token };
    if (text.includes("/email/reset-password")) return { mode: "reset", token };
  } catch (_) {}
  return { mode: "login", token: "" };
}

function friendlyAuthError(data = {}, fallback = "Не удалось выполнить действие") {
  const code = String(data?.code || data?.error || "").toUpperCase();
  const message = String(data?.message || data?.error?.message || "").trim();
  if (code === "MISSING_PASSWORD_CONFIRMATION") return "Повторите пароль.";
  if (code === "PASSWORD_CONFIRMATION_MISMATCH") return "Пароли не совпадают.";
  if (code.includes("EMAIL") && code.includes("EXISTS")) return "Этот email уже занят.";
  if (code.includes("INVALID") && code.includes("PASSWORD")) return "Неверный пароль.";
  if (code.includes("EMAIL") && code.includes("NOT") && code.includes("VERIFIED")) return "Email ещё не подтверждён. Проверьте письмо.";
  if (code.includes("TOKEN") && (code.includes("EXPIRED") || code.includes("INVALID"))) return "Ссылка устарела или уже использована.";
  return message || fallback;
}

function Field({ label, children }) {
  return (
    <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-appMuted">
      {label}
      {children}
    </label>
  );
}

async function openPrivacyPolicy(event) {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  try {
    await Browser.open({ url: PRIVACY_POLICY_URL, presentationStyle: "fullscreen" });
  } catch (_) {
    window.open(PRIVACY_POLICY_URL, "_self");
  }
}

export default function AuthPrompt({ onComplete, initialUrl = window.location.href }) {
  const initialAction = useMemo(() => authActionFromUrl(initialUrl), [initialUrl]);
  const [mode, setMode] = useState(initialAction.mode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState(initialAction.mode === "reset" ? initialAction.token : "");
  const [verifyToken, setVerifyToken] = useState(initialAction.mode === "verify" ? initialAction.token : "");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function complete(result) {
    localStorage.removeItem(SKIP_AUTH_KEY);
    if (result?.token) setAuthToken(result.token);
    if (result?.user) saveAuthUser(result.user);
    await registerDevice();
    registerFirebaseMessagingPush().catch(() => {});
    await transferPreAuthProfileDraft({ reason: "auth-prompt" });
    await fetchAccess();
    onComplete?.(result?.user || null);
  }

  async function request(path, body, fallback) {
    const response = await postJson(apiUrl(path), body, { credentials: "include" });
    const result = response.data || {};
    if (!response.ok) throw new Error(friendlyAuthError(result, fallback));
    return result;
  }

  async function submitLogin() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password) {
      setMessage("Введите email и пароль.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const result = await request("/api/auth/email/login", {
        email: cleanEmail,
        password,
        device: await getDeviceRegistrationPayloadAsync(),
      }, "Не удалось войти.");
      if (!result.token) throw new Error("Сервер не вернул сессию.");
      await complete(result);
    } catch (error) {
      setMessage(error?.message || "Не удалось войти.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegister() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !password || !confirmPassword) {
      setMessage("Введите email, пароль и повтор пароля.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Пароли не совпадают.");
      return;
    }
    if (!privacyAccepted) {
      setMessage("Для регистрации нужно согласиться с политикой конфиденциальности и обработкой персональных данных.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      const result = await request("/api/auth/email/register", {
        email: cleanEmail,
        password,
        confirmPassword,
        confirm_password: confirmPassword,
        device: await getDeviceRegistrationPayloadAsync(),
      }, "Не удалось создать аккаунт.");
      if (result.token && result.user) {
        await complete(result);
        return;
      }
      setMode("verifySent");
      setMessage("Письмо подтверждения отправлено. Откройте ссылку из письма, чтобы активировать аккаунт.");
    } catch (error) {
      setMessage(error?.message || "Не удалось создать аккаунт.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitForgot() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setMessage("Введите email.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      await request("/api/auth/email/request-password-reset", { email: cleanEmail }, "Не удалось отправить письмо.");
      setMessage("Письмо для восстановления отправлено.");
    } catch (error) {
      setMessage(error?.message || "Не удалось отправить письмо.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReset() {
    if (!resetToken) {
      setMessage("Не найден код восстановления.");
      return;
    }
    if (!password || !confirmPassword) {
      setMessage("Введите новый пароль и повтор.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Пароли не совпадают.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      await request("/api/auth/email/reset-password", {
        token: resetToken,
        password,
        confirmPassword,
        confirm_password: confirmPassword,
      }, "Не удалось обновить пароль.");
      setMode("login");
      setPassword("");
      setConfirmPassword("");
      setMessage("Пароль обновлён. Теперь можно войти.");
    } catch (error) {
      setMessage(error?.message || "Не удалось обновить пароль.");
    } finally {
      setSubmitting(false);
    }
  }

  async function verifyEmail(token = verifyToken) {
    if (!token || submitting) return;
    setSubmitting(true);
    setMessage("Проверяем ссылку...");
    try {
      const result = await request("/api/auth/email/verify", {
        token,
        device: await getDeviceRegistrationPayloadAsync(),
      }, "Не удалось подтвердить email.");
      setAuthToken(null);
      setMode("verifySuccess");
      setMessage(result?.message || "Email подтверждён. Теперь можно войти в аккаунт.");
      window.history.replaceState(null, "", window.location.pathname.includes("/email/") ? "/" : window.location.pathname);
    } catch (error) {
      setMessage(error?.message || "Не удалось подтвердить email.");
    } finally {
      setSubmitting(false);
    }
  }

  async function resendVerification() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setMessage("Введите email для повторной отправки.");
      return;
    }
    setSubmitting(true);
    setMessage("");
    try {
      await request("/api/auth/email/resend-verification", { email: cleanEmail }, "Не удалось отправить письмо повторно.");
      setMessage("Письмо отправлено повторно.");
    } catch (error) {
      setMessage(error?.message || "Не удалось отправить письмо повторно.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submit(event) {
    event?.preventDefault?.();
    if (mode === "login") return submitLogin();
    if (mode === "register") return submitRegister();
    if (mode === "forgot") return submitForgot();
    if (mode === "reset") return submitReset();
    if (mode === "verify") return verifyEmail();
    return null;
  }

  useEffect(() => {
    if (mode === "verify" && verifyToken) verifyEmail(verifyToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const title = {
    login: "Войти в аккаунт",
    register: "Создать аккаунт",
    forgot: "Восстановить пароль",
    reset: "Новый пароль",
    verify: "Подтверждение email",
    verifySuccess: "Email подтверждён",
    verifySent: "Проверьте почту",
  }[mode] || "Войти";

  return (
    <main className="phone-shell flex min-h-screen flex-col justify-between bg-appBg px-4 pb-[var(--app-safe-bottom)] pt-[var(--app-safe-top)]">
      <section>
        <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#6FA62F]">fruitfit</p>
        <h1 className="mt-4 text-[30px] font-black leading-tight text-appText">{title}</h1>
        <p className="mt-3 text-[14px] leading-6 text-appMuted">
          Основной вход FruitFit — email и пароль. Telegram остаётся для связи с тренером, уведомлений и бота.
        </p>

        <form className="mt-6 grid gap-3" onSubmit={submit}>
          {mode !== "reset" && mode !== "verify" && (
            <Field label="Email">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {["login", "register", "reset"].includes(mode) && (
            <Field label={mode === "reset" ? "Новый пароль" : "Пароль"}>
              <span className="relative">
                <input
                  type={passwordVisible ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Минимум 8 символов"
                  className="h-12 w-full rounded-2xl border border-appBorder bg-appCard px-4 pr-12 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
                />
                <button
                  type="button"
                  onClick={() => setPasswordVisible((value) => !value)}
                  className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-appMuted"
                  aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}
                >
                  {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </Field>
          )}

          {["register", "reset"].includes(mode) && (
            <Field label="Повтор пароля">
              <input
                type={passwordVisible ? "text" : "password"}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Повторите пароль"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {mode === "register" && (
            <label className="flex items-start gap-3 rounded-[18px] border border-appBorder bg-appCard p-3 text-[12px] leading-5 text-appMuted">
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(event) => setPrivacyAccepted(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-appGreen"
                required
              />
              <span>
                Я согласен с{" "}
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-left font-black text-appText underline decoration-appGreen decoration-2 underline-offset-4"
                  onClick={openPrivacyPolicy}
                >
                  политикой конфиденциальности и политикой обработки персональных данных
                </button>
                .
              </span>
            </label>
          )}

          {mode === "reset" && !resetToken && (
            <Field label="Код из письма">
              <input
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value.trim())}
                placeholder="Код восстановления"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {mode === "verify" && !verifyToken && (
            <Field label="Код из письма">
              <input
                value={verifyToken}
                onChange={(event) => setVerifyToken(event.target.value.trim())}
                placeholder="Код подтверждения"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {!["verifySent", "verifySuccess"].includes(mode) && (
            <button
              type="submit"
              disabled={submitting || (mode === "register" && !privacyAccepted)}
              className="mt-1 flex h-[54px] items-center justify-center gap-2 rounded-full bg-appGreen px-5 text-[15px] font-black text-[#181F19] shadow-card disabled:opacity-70"
            >
              {submitting ? <Loader2 size={18} className="animate-spin" /> : null}
              {mode === "login" && "Войти"}
              {mode === "register" && "Создать аккаунт"}
              {mode === "forgot" && "Отправить письмо"}
              {mode === "reset" && "Сохранить пароль"}
              {mode === "verify" && "Подтвердить email"}
            </button>
          )}

          {mode === "verifySuccess" && (
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setMessage("");
              }}
              className="mt-1 flex h-[54px] items-center justify-center gap-2 rounded-full bg-appGreen px-5 text-[15px] font-black text-[#181F19] shadow-card"
            >
              Перейти ко входу
              <ArrowRight size={17} />
            </button>
          )}

          {mode === "login" && (
            <button type="button" onClick={() => { setMode("forgot"); setMessage(""); }} className="h-10 rounded-full text-[13px] font-black text-appMuted">
              Забыли пароль?
            </button>
          )}

          {mode === "verifySent" && (
            <button type="button" onClick={resendVerification} disabled={submitting} className="h-11 rounded-full border border-appBorder bg-appCard text-[13px] font-black text-appText disabled:opacity-70">
              Отправить письмо повторно
            </button>
          )}

          {!["verify", "reset", "verifySent", "verifySuccess"].includes(mode) && (
            <button
              type="button"
              onClick={() => {
                setMode((value) => (value === "register" ? "login" : value === "login" ? "register" : "login"));
                setMessage("");
              }}
              className="flex h-[50px] items-center justify-center gap-2 rounded-full border border-appBorder bg-appCard px-5 text-[14px] font-black text-appText shadow-sm"
            >
              {mode === "login" ? "Создать аккаунт" : "Уже есть аккаунт"}
              <ArrowRight size={17} />
            </button>
          )}

        </form>

        {message && (
          <p className="mt-4 rounded-[18px] border border-appBorder bg-appCard p-3 text-[12px] leading-5 text-appMuted">
            {message}
          </p>
        )}
      </section>

      <p className="pb-1 text-center text-[11px] leading-5 text-appMuted">
        Telegram можно подключить позже в профиле как сервис связи и уведомлений.
      </p>
    </main>
  );
}
