import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Browser } from "@capacitor/browser";
import { ArrowLeft, ArrowRight, ExternalLink, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";
import {
  apiUrl,
  clearLocalAuthSession,
  fetchAccess,
  saveAuthUser,
  setAuthToken,
  transferPreAuthProfileDraft,
} from "../data/authStore";
import { getDeviceRegistrationPayloadAsync, registerDevice } from "../data/deviceStore";
import { flushAttributionQueue, trackAnalyticsEvent } from "../services/attribution";
import {
  clearPendingAppMetricaRegistration,
  rememberPendingAppMetricaRegistration,
  reportAppMetricaRegistration,
  reportProvenPendingAppMetricaRegistration,
} from "../services/appMetrica";
import { registerFirebaseMessagingPush } from "../services/notifications/firebaseMessagingPush";
import { postJson } from "../services/nativeHttp";
import { PRIVACY_POLICY_TEXT, PRIVACY_POLICY_URL } from "../data/privacyPolicyText";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import { loadPrivacyPolicyText } from "../services/privacyPolicy";
import {
  AUTH_FLOW_STATES,
  AuthApiError,
  authApiErrorFromResponse,
  authApiErrorFromThrown,
  authFlowReducer,
  authMessageForCode,
  createAuthFlowState,
  formatRetryDuration,
} from "../services/authFlow";
import {
  parseAuthDeepLink,
} from "../services/authDeepLinks";

const SKIP_AUTH_KEY = "fruitfit.authSkipped";
const SUPPORT_URL = "https://forms.gle/MygV9mU445St16ez5";

function Field({ label, error, children }) {
  return (
    <label className="grid gap-1 text-[11px] font-black uppercase tracking-[0.12em] text-appMuted">
      {label}
      {children}
      {error ? <span className="normal-case tracking-normal text-red-500">{error}</span> : null}
    </label>
  );
}

function normalizePolicyText(value = "") {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function PolicyLine({ line }) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const isTitle = trimmed.toUpperCase().includes("ПОЛИТИКА КОНФИДЕНЦИАЛЬНОСТИ");
  const isSection = /^\d+\.\s/.test(trimmed) || trimmed === "Реквизиты Исполнителя / Оператора";
  if (isTitle) return <h2 className="text-[22px] font-black leading-tight text-appText">{trimmed}</h2>;
  if (isSection) return <h3 className="mt-5 text-[16px] font-black leading-snug text-appText">{trimmed}</h3>;
  return <p className="text-[13px] font-semibold leading-6 text-appMuted">{trimmed}</p>;
}

function PrivacyPolicyScreen({ onBack }) {
  const [policyText, setPolicyText] = useState(PRIVACY_POLICY_TEXT);
  const [loadedFromSite, setLoadedFromSite] = useState(false);

  useEffect(() => {
    if (APP_STORE_REVIEW) return undefined;
    let alive = true;
    loadPrivacyPolicyText()
      .then((text) => {
        if (!alive) return;
        setPolicyText(text);
        setLoadedFromSite(true);
      })
      .catch(() => {
        if (alive) setLoadedFromSite(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function openOfficialPolicy() {
    try {
      await Browser.open({ url: PRIVACY_POLICY_URL, presentationStyle: "popover" });
    } catch (_) {
      window.open(PRIVACY_POLICY_URL, "_blank", "noopener,noreferrer");
    }
  }

  const lines = normalizePolicyText(policyText).split("\n").filter((line) => line.trim());
  return (
    <main className="phone-shell flex h-screen max-h-screen flex-col bg-appBg text-appText">
      <header className="shrink-0 border-b border-appBorder bg-appBg/95 px-4 pb-3 pt-[var(--app-safe-top)] backdrop-blur">
        <div className="flex items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-11 w-11 place-items-center rounded-full border border-appBorder bg-appCard" aria-label="Вернуться к регистрации">
            <ArrowLeft size={22} />
          </button>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-[#6FA62F]">FruitFit</p>
            <h1 className="text-[18px] font-black">Политика конфиденциальности</h1>
          </div>
        </div>
      </header>
      <article className="allow-select min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-[22px] border border-appBorder bg-appCard p-4 shadow-sm">
          <div className="mb-4 flex gap-3 rounded-[18px] border border-appBorder bg-appBg p-3">
            <ShieldCheck size={20} className="mt-1 shrink-0 text-appGreen" />
            <p className="text-[12px] font-semibold leading-5 text-appMuted">
              {loadedFromSite ? "Текст загружен с официального сайта FruitFit." : "Официальный текст сохранён внутри приложения."}
            </p>
          </div>
          <div className="space-y-2">
            {lines.map((line, index) => <PolicyLine key={`${index}-${line.slice(0, 24)}`} line={line} />)}
          </div>
        </div>
      </article>
      {!APP_STORE_REVIEW && (
        <footer className="shrink-0 border-t border-appBorder bg-appBg/95 px-4 pb-[var(--app-safe-bottom)] pt-3">
          <button type="button" onClick={openOfficialPolicy} className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-appBorder bg-appCard text-[13px] font-black">
            Открыть на сайте <ExternalLink size={16} />
          </button>
        </footer>
      )}
    </main>
  );
}

function screenFromInitial({ initialRoute, initialUrl, initialMode }) {
  const route = initialRoute?.recognized ? initialRoute : parseAuthDeepLink(initialUrl);
  if (route?.recognized) return { route, screen: route.screen };
  return {
    route: null,
    screen: initialMode === "register" ? AUTH_FLOW_STATES.REGISTER : AUTH_FLOW_STATES.LOGIN,
  };
}

export default function AuthPrompt({
  onComplete,
  onRouteConsumed,
  initialUrl = window.location.href,
  initialMode = "login",
  initialRoute = null,
}) {
  const initial = useMemo(
    () => screenFromInitial({ initialRoute, initialUrl, initialMode }),
    [initialRoute, initialUrl, initialMode]
  );
  const initialMissingToken = [
    AUTH_FLOW_STATES.VERIFICATION_LINK,
    AUTH_FLOW_STATES.RESET_PASSWORD_LINK,
  ].includes(initial.screen) && !initial.route?.token;
  const [flow, dispatch] = useReducer(authFlowReducer, createAuthFlowState({
    screen: initial.screen,
    email: initial.route?.email || "",
    token: initial.route?.token || "",
    code: initialMissingToken ? "MISSING_TOKEN" : initial.route?.code || "",
    message: initialMissingToken
      ? authMessageForCode("MISSING_TOKEN", initial.screen === AUTH_FLOW_STATES.VERIFICATION_LINK ? "verification" : "reset")
      : initial.route?.message || (initial.screen === AUTH_FLOW_STATES.SESSION_REVOKED
      ? authMessageForCode("SESSION_REVOKED")
      : initial.screen === AUTH_FLOW_STATES.ACCOUNT_DELETED
        ? authMessageForCode("ACCOUNT_DELETED")
        : ""),
  }));
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [privacyPolicyOpen, setPrivacyPolicyOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const autoActionRef = useRef(new Set());
  const actionInFlightRef = useRef(false);

  const retrySeconds = flow.retryUntil ? Math.max(0, Math.ceil((flow.retryUntil - now) / 1000)) : 0;
  const actionBlocked = flow.submitting || retrySeconds > 0;

  useEffect(() => {
    if (!flow.retryUntil) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [flow.retryUntil]);

  useEffect(() => {
    if (!initial.route?.recognized) return;
    dispatch({
      type: "NAVIGATE",
      screen: initial.route.screen,
      email: initial.route.email || flow.email,
      token: initial.route.token || "",
    });
    // Route delivery is intentionally keyed by a secret-free digest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.route?.deliveryKey]);

  async function complete(result) {
    await reportProvenPendingAppMetricaRegistration(result?.user);
    localStorage.removeItem(SKIP_AUTH_KEY);
    if (result?.token) setAuthToken(result.token);
    if (result?.user) saveAuthUser(result.user);
    await registerDevice();
    registerFirebaseMessagingPush().catch(() => {});
    await transferPreAuthProfileDraft({ reason: "auth-prompt" });
    await fetchAccess();
    flushAttributionQueue().catch(() => {});
    onComplete?.(result?.user || null);
  }

  async function request(path, body, fallbackCode = "AUTH_UNAVAILABLE") {
    let response;
    try {
      response = await postJson(apiUrl(path), body, { credentials: "include", cache: "no-store" });
    } catch (error) {
      throw authApiErrorFromThrown(error);
    }
    if (!response.ok) throw authApiErrorFromResponse(response, fallbackCode);
    return { result: response.data || {}, response };
  }

  function navigate(screen, options = {}) {
    dispatch({ type: "NAVIGATE", screen, ...options });
  }

  function setField(field, value) {
    dispatch({ type: "SET_FIELD", field, value });
  }

  function applyError(error, context = "generic") {
    const normalized = error instanceof AuthApiError ? error : authApiErrorFromThrown(error);
    dispatch({
      type: "SUBMIT_ERROR",
      error: normalized,
      message: authMessageForCode(normalized.code, context),
    });
    return normalized;
  }

  function beginAuthAction() {
    if (actionInFlightRef.current) return false;
    actionInFlightRef.current = true;
    return true;
  }

  function finishAuthAction() {
    actionInFlightRef.current = false;
  }

  async function submitLogin() {
    const email = flow.email.trim().toLowerCase();
    if (!email || !flow.password) {
      applyError(new AuthApiError({ code: !email ? "INVALID_EMAIL" : "INVALID_CREDENTIALS" }));
      return;
    }
    if (!beginAuthAction()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const { result } = await request("/api/auth/email/login", {
        email,
        password: flow.password,
        device: await getDeviceRegistrationPayloadAsync(),
      }, "INVALID_CREDENTIALS");
      if (!result.token) throw new AuthApiError({ code: "AUTH_UNAVAILABLE" });
      await complete(result);
    } catch (error) {
      const normalized = error instanceof AuthApiError ? error : authApiErrorFromThrown(error);
      if (normalized.code === "EMAIL_NOT_VERIFIED") {
        navigate(AUTH_FLOW_STATES.VERIFICATION_PENDING, {
          email,
          code: normalized.code,
          message: "Email нужно подтвердить. Проверь почту или запроси новую ссылку.",
        });
        return;
      }
      applyError(normalized);
    } finally {
      finishAuthAction();
    }
  }

  async function submitRegister() {
    const email = flow.email.trim().toLowerCase();
    if (!email) return applyError(new AuthApiError({ code: "INVALID_EMAIL" }));
    if (!flow.password) return applyError(new AuthApiError({ code: "PASSWORD_TOO_SHORT" }));
    if (!flow.confirmPassword) return applyError(new AuthApiError({ code: "MISSING_PASSWORD_CONFIRMATION" }));
    if (flow.password !== flow.confirmPassword) return applyError(new AuthApiError({ code: "PASSWORD_CONFIRMATION_MISMATCH" }));
    if (!privacyAccepted) {
      dispatch({
        type: "SUBMIT_ERROR",
        error: new AuthApiError({ code: "AUTH_UNAVAILABLE", message: "Для регистрации нужно принять политику конфиденциальности и обработки персональных данных." }),
        message: "Для регистрации нужно принять политику конфиденциальности и обработки персональных данных.",
      });
      return;
    }
    if (!beginAuthAction()) return;
    trackAnalyticsEvent("registration_started", { screen: "register", source: "email" }).catch(() => {});
    dispatch({ type: "SUBMIT_START" });
    try {
      const { result, response } = await request("/api/auth/email/register", {
        email,
        password: flow.password,
        confirmPassword: flow.confirmPassword,
        confirm_password: flow.confirmPassword,
        device: await getDeviceRegistrationPayloadAsync(),
      });
      rememberPendingAppMetricaRegistration({ email, responseHeaders: response.headers });
      if (result.token && result.user) {
        await reportAppMetricaRegistration(result.user.id);
        clearPendingAppMetricaRegistration(result.user.email || email);
        await complete(result);
        return;
      }
      navigate(AUTH_FLOW_STATES.VERIFICATION_PENDING, {
        email,
        message: "Проверь почту. Если аккаунту требуется подтверждение, письмо будет отправлено.",
      });
    } catch (error) {
      applyError(error);
    } finally {
      finishAuthAction();
    }
  }

  async function resendVerification() {
    const email = flow.email.trim().toLowerCase();
    if (!email) return applyError(new AuthApiError({ code: "INVALID_EMAIL" }));
    if (!beginAuthAction()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      await request("/api/auth/email/resend-verification", { email }, "EMAIL_DELIVERY_UNAVAILABLE");
      dispatch({
        type: "SUBMIT_SUCCESS",
        message: "Если аккаунту требуется подтверждение, письмо будет отправлено.",
      });
    } catch (error) {
      applyError(error);
    } finally {
      finishAuthAction();
    }
  }

  async function submitForgot() {
    const email = flow.email.trim().toLowerCase();
    if (!email) return applyError(new AuthApiError({ code: "INVALID_EMAIL" }));
    if (!beginAuthAction()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      await request("/api/auth/email/request-password-reset", { email }, "EMAIL_DELIVERY_UNAVAILABLE");
      dispatch({
        type: "SUBMIT_SUCCESS",
        message: "Проверь почту. Если аккаунт существует, мы отправили ссылку для смены пароля. Если аккаунт ещё не создан, на почту придёт инструкция по регистрации.",
      });
    } catch (error) {
      applyError(error);
    } finally {
      finishAuthAction();
    }
  }

  async function submitReset() {
    if (!flow.token) {
      applyError(new AuthApiError({ code: "MISSING_TOKEN" }), "reset");
      return;
    }
    if (!flow.password) return applyError(new AuthApiError({ code: "PASSWORD_TOO_SHORT" }));
    if (!flow.confirmPassword) return applyError(new AuthApiError({ code: "MISSING_PASSWORD_CONFIRMATION" }));
    if (flow.password !== flow.confirmPassword) return applyError(new AuthApiError({ code: "PASSWORD_CONFIRMATION_MISMATCH" }));
    if (!beginAuthAction()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      await request("/api/auth/email/reset-password", {
        token: flow.token,
        password: flow.password,
        confirmPassword: flow.confirmPassword,
        confirm_password: flow.confirmPassword,
      });
      clearLocalAuthSession();
      onRouteConsumed?.();
      navigate(AUTH_FLOW_STATES.RESET_PASSWORD_SUCCESS, {
        email: flow.email,
        message: "Пароль изменён. Войди с новым паролем.",
      });
    } catch (error) {
      applyError(error, "reset");
    } finally {
      finishAuthAction();
    }
  }

  async function verifyEmail() {
    if (!flow.token) {
      applyError(new AuthApiError({ code: "MISSING_TOKEN" }), "verification");
      return;
    }
    if (!beginAuthAction()) return;
    dispatch({ type: "SUBMIT_START" });
    try {
      const { result } = await request("/api/auth/email/verify", {
        token: flow.token,
        device: await getDeviceRegistrationPayloadAsync(),
      });
      if (result?.emailVerified && result?.user?.id) {
        await reportAppMetricaRegistration(result.user.id);
        clearPendingAppMetricaRegistration(result.user.email || flow.email);
      }
      if (result?.token && result?.user) {
        dispatch({ type: "CLEAR_SECRET" });
        onRouteConsumed?.();
        await complete(result);
        return;
      }
      const alreadyUsed = result?.alreadyVerified || String(result?.code || "").toUpperCase() === "TOKEN_ALREADY_USED";
      onRouteConsumed?.();
      navigate(AUTH_FLOW_STATES.VERIFICATION_SUCCESS, {
        email: flow.email,
        message: alreadyUsed
          ? "Email уже подтверждён. Теперь можно войти."
          : "Email подтверждён. Теперь можно войти.",
      });
    } catch (error) {
      const normalized = error instanceof AuthApiError ? error : authApiErrorFromThrown(error);
      if (normalized.code === "TOKEN_ALREADY_USED") {
        onRouteConsumed?.();
        navigate(AUTH_FLOW_STATES.VERIFICATION_SUCCESS, {
          email: flow.email,
          message: "Email уже подтверждён. Теперь можно войти.",
        });
        return;
      }
      applyError(normalized, "verification");
    } finally {
      finishAuthAction();
    }
  }

  useEffect(() => {
    if (flow.screen !== AUTH_FLOW_STATES.VERIFICATION_LINK || !flow.token) return;
    const key = initial.route?.deliveryKey || `verify:${flow.token.length}`;
    if (autoActionRef.current.has(key)) return;
    autoActionRef.current.add(key);
    verifyEmail();
    // Deliberately do not repeat a secret-bearing action after network errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.screen, initial.route?.deliveryKey]);

  function submit(event) {
    event?.preventDefault?.();
    if (actionBlocked) return;
    if (flow.screen === AUTH_FLOW_STATES.LOGIN) return submitLogin();
    if (flow.screen === AUTH_FLOW_STATES.REGISTER) return submitRegister();
    if (flow.screen === AUTH_FLOW_STATES.FORGOT_PASSWORD) return submitForgot();
    if (flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_LINK) return submitReset();
    if (flow.screen === AUTH_FLOW_STATES.VERIFICATION_LINK) return verifyEmail();
    return null;
  }

  const title = {
    [AUTH_FLOW_STATES.LOGIN]: "Войти в аккаунт",
    [AUTH_FLOW_STATES.REGISTER]: "Создать аккаунт",
    [AUTH_FLOW_STATES.VERIFICATION_PENDING]: "Проверь почту",
    [AUTH_FLOW_STATES.VERIFICATION_LINK]: "Подтверждение email",
    [AUTH_FLOW_STATES.VERIFICATION_SUCCESS]: "Email подтверждён",
    [AUTH_FLOW_STATES.FORGOT_PASSWORD]: "Восстановить пароль",
    [AUTH_FLOW_STATES.RESET_PASSWORD_LINK]: "Новый пароль",
    [AUTH_FLOW_STATES.RESET_PASSWORD_SUCCESS]: "Пароль изменён",
    [AUTH_FLOW_STATES.SESSION_REVOKED]: "Нужно войти снова",
    [AUTH_FLOW_STATES.ACCOUNT_DELETED]: "Аккаунт удалён",
    [AUTH_FLOW_STATES.AUTH_UNAVAILABLE]: "Вход не завершён",
  }[flow.screen] || "Войти в FruitFit";

  const showEmail = [
    AUTH_FLOW_STATES.LOGIN,
    AUTH_FLOW_STATES.REGISTER,
    AUTH_FLOW_STATES.VERIFICATION_PENDING,
    AUTH_FLOW_STATES.FORGOT_PASSWORD,
  ].includes(flow.screen);
  const showPassword = [AUTH_FLOW_STATES.LOGIN, AUTH_FLOW_STATES.REGISTER, AUTH_FLOW_STATES.RESET_PASSWORD_LINK].includes(flow.screen);
  const showConfirmation = [AUTH_FLOW_STATES.REGISTER, AUTH_FLOW_STATES.RESET_PASSWORD_LINK].includes(flow.screen);
  const showSubmit = [
    AUTH_FLOW_STATES.LOGIN,
    AUTH_FLOW_STATES.REGISTER,
    AUTH_FLOW_STATES.FORGOT_PASSWORD,
    AUTH_FLOW_STATES.RESET_PASSWORD_LINK,
  ].includes(flow.screen)
    || (flow.screen === AUTH_FLOW_STATES.VERIFICATION_LINK && Boolean(flow.token) && flow.code);
  const resetNeedsNewLink = flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_LINK
    && (!flow.token || ["TOKEN_EXPIRED", "TOKEN_INVALID", "TOKEN_ALREADY_USED", "INVALID_OR_EXPIRED_TOKEN", "MISSING_TOKEN"].includes(flow.code));

  if (privacyPolicyOpen) return <PrivacyPolicyScreen onBack={() => setPrivacyPolicyOpen(false)} />;

  return (
    <main className="phone-shell flex min-h-screen flex-col bg-appBg px-4 pb-[var(--app-safe-bottom)] pt-[var(--app-safe-top)]">
      <section className="mx-auto w-full max-w-md">
        <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#6FA62F]">fruitfit</p>
        <h1 className="mt-4 text-[30px] font-black leading-tight text-appText">{title}</h1>
        <p className="mt-3 text-[14px] leading-6 text-appMuted">
          Аккаунт сохраняет анкету, программу и прогресс и позволяет безопасно восстановить доступ.
        </p>

        <form className="mt-6 grid gap-3" onSubmit={submit}>
          {showEmail && (
            <Field label="Email" error={flow.fieldErrors.email}>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={flow.email}
                onChange={(event) => setField("email", event.target.value)}
                placeholder="you@example.com"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {showPassword && (
            <Field label={flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_LINK ? "Новый пароль" : "Пароль"} error={flow.fieldErrors.password}>
              <span className="relative">
                <input
                  type={passwordVisible ? "text" : "password"}
                  autoComplete={flow.screen === AUTH_FLOW_STATES.LOGIN ? "current-password" : "new-password"}
                  value={flow.password}
                  onChange={(event) => setField("password", event.target.value)}
                  placeholder="Минимум 8 символов"
                  className="h-12 w-full rounded-2xl border border-appBorder bg-appCard px-4 pr-12 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
                />
                <button type="button" onClick={() => setPasswordVisible((value) => !value)} className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full text-appMuted" aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}>
                  {passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </span>
            </Field>
          )}

          {showConfirmation && (
            <Field label="Повтор пароля" error={flow.fieldErrors.confirmPassword}>
              <input
                type={passwordVisible ? "text" : "password"}
                autoComplete="new-password"
                value={flow.confirmPassword}
                onChange={(event) => setField("confirmPassword", event.target.value)}
                placeholder="Повтори пароль"
                className="h-12 rounded-2xl border border-appBorder bg-appCard px-4 text-[14px] font-bold normal-case tracking-normal text-appText outline-none placeholder:text-appMuted focus:border-appGreen"
              />
            </Field>
          )}

          {flow.screen === AUTH_FLOW_STATES.REGISTER && (
            <label className="flex items-start gap-3 rounded-[18px] border border-appBorder bg-appCard p-3 text-[12px] leading-5 text-appMuted">
              <input type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-appGreen" />
              <span>
                Я согласен с{" "}
                <button type="button" className="font-black text-appText underline decoration-appGreen decoration-2 underline-offset-4" onClick={() => setPrivacyPolicyOpen(true)}>
                  политикой конфиденциальности и обработки персональных данных
                </button>.
              </span>
            </label>
          )}

          {showSubmit && (
            <button type="submit" disabled={actionBlocked || (flow.screen === AUTH_FLOW_STATES.REGISTER && !privacyAccepted)} className="mt-1 flex h-[54px] items-center justify-center gap-2 rounded-full bg-appGreen px-5 text-[15px] font-black text-[#181F19] shadow-card disabled:opacity-60">
              {flow.submitting ? <Loader2 size={18} className="animate-spin" /> : null}
              {flow.screen === AUTH_FLOW_STATES.LOGIN && "Войти"}
              {flow.screen === AUTH_FLOW_STATES.REGISTER && "Создать аккаунт"}
              {flow.screen === AUTH_FLOW_STATES.FORGOT_PASSWORD && "Отправить письмо"}
              {flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_LINK && "Сохранить пароль"}
              {flow.screen === AUTH_FLOW_STATES.VERIFICATION_LINK && "Повторить проверку"}
            </button>
          )}

          {retrySeconds > 0 && (
            <p className="rounded-2xl border border-appBorder bg-appCard px-3 py-2 text-center text-[12px] font-bold text-appMuted">
              Слишком много попыток. Повтори через {formatRetryDuration(retrySeconds)}.
            </p>
          )}

          {flow.screen === AUTH_FLOW_STATES.LOGIN && (
            <>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.FORGOT_PASSWORD, { email: flow.email })} className="h-10 rounded-full text-[13px] font-black text-appMuted">
                Забыли пароль?
              </button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: flow.email })} className="flex h-[50px] items-center justify-center gap-2 rounded-full border border-appBorder bg-appCard text-[14px] font-black text-appText">
                Создать аккаунт <ArrowRight size={17} />
              </button>
            </>
          )}

          {flow.screen === AUTH_FLOW_STATES.REGISTER && (
            <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="flex h-[50px] items-center justify-center gap-2 rounded-full border border-appBorder bg-appCard text-[14px] font-black text-appText">
              Уже есть аккаунт — войти <ArrowRight size={17} />
            </button>
          )}

          {flow.screen === AUTH_FLOW_STATES.VERIFICATION_PENDING && (
            <>
              <button type="button" onClick={resendVerification} disabled={actionBlocked} className="h-12 rounded-full bg-appGreen text-[14px] font-black text-[#181F19] disabled:opacity-60">Отправить письмо повторно</button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="h-12 rounded-full border border-appBorder bg-appCard text-[14px] font-black">Уже есть аккаунт — войти</button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.FORGOT_PASSWORD, { email: flow.email })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Забыли пароль?</button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: "" })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Изменить email</button>
            </>
          )}

          {[AUTH_FLOW_STATES.VERIFICATION_LINK, AUTH_FLOW_STATES.VERIFICATION_SUCCESS].includes(flow.screen) && (
            <>
              {flow.screen === AUTH_FLOW_STATES.VERIFICATION_LINK && (
                <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.VERIFICATION_PENDING, { email: flow.email, message: "Введите email, чтобы запросить новую ссылку." })} className="h-12 rounded-full border border-appBorder bg-appCard text-[14px] font-black">
                  Отправить новую ссылку
                </button>
              )}
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="h-12 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">Перейти ко входу</button>
              {flow.screen === AUTH_FLOW_STATES.VERIFICATION_LINK && (
                <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: flow.email })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Создать аккаунт</button>
              )}
            </>
          )}

          {flow.screen === AUTH_FLOW_STATES.FORGOT_PASSWORD && (
            <>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: flow.email })} className="h-12 rounded-full border border-appBorder bg-appCard text-[14px] font-black">Нет аккаунта — создать</button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Вернуться ко входу</button>
            </>
          )}

          {flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_LINK && (
            <>
              {resetNeedsNewLink && (
                <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.FORGOT_PASSWORD, { email: flow.email, message: "Запросите новую ссылку восстановления." })} className="h-12 rounded-full border border-appBorder bg-appCard text-[14px] font-black">Запросить новую ссылку</button>
              )}
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Вернуться ко входу</button>
              {resetNeedsNewLink && <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: flow.email })} className="h-11 rounded-full text-[13px] font-black text-appMuted">Создать аккаунт</button>}
            </>
          )}

          {flow.screen === AUTH_FLOW_STATES.RESET_PASSWORD_SUCCESS && (
            <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email, message: "Введите новый пароль." })} className="h-12 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">Войти с новым паролем</button>
          )}

          {[AUTH_FLOW_STATES.SESSION_REVOKED, AUTH_FLOW_STATES.ACCOUNT_DELETED, AUTH_FLOW_STATES.AUTH_UNAVAILABLE].includes(flow.screen) && (
            <>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.LOGIN, { email: flow.email })} className="h-12 rounded-full bg-appGreen text-[14px] font-black text-[#181F19]">Перейти ко входу</button>
              <button type="button" onClick={() => navigate(AUTH_FLOW_STATES.REGISTER, { email: flow.email })} className="h-12 rounded-full border border-appBorder bg-appCard text-[14px] font-black">Создать аккаунт</button>
              {flow.screen === AUTH_FLOW_STATES.ACCOUNT_DELETED && (
                <button type="button" onClick={() => Browser.open({ url: SUPPORT_URL, presentationStyle: "popover" }).catch(() => window.open(SUPPORT_URL, "_blank", "noopener,noreferrer"))} className="h-11 rounded-full text-[13px] font-black text-appMuted">Обратиться в поддержку</button>
              )}
            </>
          )}
        </form>

        {flow.message && (
          <p className="mt-4 rounded-[18px] border border-appBorder bg-appCard p-3 text-[12px] leading-5 text-appMuted">{flow.message}</p>
        )}

      </section>
    </main>
  );
}
