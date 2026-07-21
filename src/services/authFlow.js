export const AUTH_FLOW_STATES = Object.freeze({
  LOGIN: "login",
  REGISTER: "register",
  VERIFICATION_PENDING: "verificationPending",
  VERIFICATION_LINK: "verificationLink",
  VERIFICATION_SUCCESS: "verificationSuccess",
  FORGOT_PASSWORD: "forgotPassword",
  RESET_PASSWORD_LINK: "resetPasswordLink",
  RESET_PASSWORD_SUCCESS: "resetPasswordSuccess",
  SESSION_REVOKED: "sessionRevoked",
  ACCOUNT_DELETED: "accountDeleted",
  AUTH_UNAVAILABLE: "authUnavailable",
});

const FIELD_ERROR_CODES = Object.freeze({
  INVALID_EMAIL: "email",
  PASSWORD_TOO_SHORT: "password",
  PASSWORD_TOO_LONG: "password",
  PASSWORD_CANNOT_MATCH_EMAIL: "password",
  MISSING_PASSWORD_CONFIRMATION: "confirmPassword",
  PASSWORD_CONFIRMATION_MISMATCH: "confirmPassword",
});

export const AUTH_ERROR_MESSAGES = Object.freeze({
  INVALID_CREDENTIALS: "Неверный email или пароль.",
  INVALID_EMAIL: "Проверьте формат email.",
  EMAIL_NOT_VERIFIED: "Email нужно подтвердить. Проверьте почту или запросите новую ссылку.",
  EMAIL_DELIVERY_UNAVAILABLE: "Почтовый сервис временно недоступен. Попробуйте ещё раз позже.",
  SMTP_NOT_CONFIGURED: "Почтовый сервис временно недоступен. Попробуйте ещё раз позже.",
  PASSWORD_TOO_SHORT: "Пароль должен содержать минимум 8 символов.",
  PASSWORD_TOO_LONG: "Пароль не должен быть длиннее 128 символов.",
  PASSWORD_CANNOT_MATCH_EMAIL: "Пароль не должен совпадать с email.",
  MISSING_PASSWORD_CONFIRMATION: "Повторите пароль.",
  PASSWORD_CONFIRMATION_MISMATCH: "Пароли не совпадают.",
  MISSING_TOKEN: "В ссылке отсутствует необходимый код.",
  TOKEN_EXPIRED: "Срок действия ссылки истёк.",
  TOKEN_INVALID: "Ссылка повреждена или недействительна.",
  INVALID_OR_EXPIRED_TOKEN: "Ссылка повреждена или её срок действия истёк.",
  TOKEN_ALREADY_USED: "Эта ссылка уже использована.",
  RATE_LIMITED: "Слишком много попыток.",
  SESSION_REVOKED: "Сессия завершена на этом или другом устройстве. Войдите снова.",
  ACCOUNT_DELETED: "Этот аккаунт удалён.",
  NETWORK_ERROR: "Нет соединения с сервером. Проверьте интернет и повторите попытку.",
  AUTH_UNAVAILABLE: "Авторизация временно недоступна. Попробуйте ещё раз.",
});

function normalizedCode(value = "") {
  const source = typeof value === "object" && value
    ? value.code || value.error || value.message
    : value;
  return String(source || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

export function authErrorCode(data = {}, fallback = "") {
  const direct = normalizedCode(data?.code || data?.error?.code || data?.error);
  if (direct === "UNAUTHORIZED") return "SESSION_REVOKED";
  if (direct === "INVALID_TOKEN") return "SESSION_REVOKED";
  return direct || normalizedCode(fallback);
}

export function getResponseHeader(headers = {}, name = "") {
  const wanted = String(name || "").toLowerCase();
  if (!wanted || !headers) return "";
  if (typeof headers.get === "function") return headers.get(name) || headers.get(wanted) || "";
  const entry = Object.entries(headers).find(([key]) => String(key).toLowerCase() === wanted);
  return entry?.[1] ?? "";
}

function positiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : 0;
}

export function retryAfterSecondsFromResponse(response = {}) {
  const bodySeconds = positiveSeconds(response?.data?.retryAfterSeconds ?? response?.data?.retry_after_seconds);
  if (bodySeconds) return bodySeconds;
  const header = String(getResponseHeader(response?.headers, "Retry-After") || "").trim();
  const numeric = positiveSeconds(header);
  if (numeric) return numeric;
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : 0;
}

export class AuthApiError extends Error {
  constructor({
    status = 0,
    code = "AUTH_UNAVAILABLE",
    message = "",
    serverMessage = "",
    retryAfter = "",
    retryAfterSeconds = 0,
    cause = null,
  } = {}) {
    const normalized = authErrorCode({ code }, "AUTH_UNAVAILABLE");
    super(message || AUTH_ERROR_MESSAGES[normalized] || AUTH_ERROR_MESSAGES.AUTH_UNAVAILABLE);
    this.name = "AuthApiError";
    this.status = Number(status) || 0;
    this.code = normalized;
    this.serverMessage = String(serverMessage || "");
    this.retryAfter = String(retryAfter || "");
    this.retryAfterSeconds = positiveSeconds(retryAfterSeconds);
    this.retryUntil = this.retryAfterSeconds ? Date.now() + (this.retryAfterSeconds * 1000) : 0;
    this.cause = cause || undefined;
  }
}

export function authApiErrorFromResponse(response = {}, fallbackCode = "AUTH_UNAVAILABLE") {
  const code = authErrorCode(response?.data, fallbackCode);
  const retryAfter = getResponseHeader(response?.headers, "Retry-After");
  const retryAfterSeconds = retryAfterSecondsFromResponse(response);
  const serverMessage = typeof response?.data?.message === "string"
    ? response.data.message
    : typeof response?.data?.error === "string" ? response.data.error : "";
  return new AuthApiError({
    status: response?.status,
    code,
    message: AUTH_ERROR_MESSAGES[code] || AUTH_ERROR_MESSAGES[fallbackCode] || AUTH_ERROR_MESSAGES.AUTH_UNAVAILABLE,
    serverMessage,
    retryAfter,
    retryAfterSeconds,
  });
}

export function authApiErrorFromThrown(error, fallbackCode = "NETWORK_ERROR") {
  if (error instanceof AuthApiError) return error;
  return new AuthApiError({
    code: fallbackCode,
    message: AUTH_ERROR_MESSAGES[fallbackCode],
    cause: error,
  });
}

export function authFieldErrors(error) {
  const code = authErrorCode(error, error?.code);
  const field = FIELD_ERROR_CODES[code];
  return field ? { [field]: AUTH_ERROR_MESSAGES[code] } : {};
}

export function authMessageForCode(code, context = "generic") {
  const normalized = authErrorCode({ code }, code);
  if (normalized === "TOKEN_ALREADY_USED" && context === "verification") {
    return "Email уже подтверждён. Теперь можно войти.";
  }
  if (normalized === "TOKEN_ALREADY_USED" && context === "reset") {
    return "Эта ссылка уже использована. Попробуйте войти с новым паролем.";
  }
  if (normalized === "MISSING_TOKEN" && context === "verification") {
    return "В ссылке отсутствует код подтверждения.";
  }
  if (normalized === "MISSING_TOKEN" && context === "reset") {
    return "В ссылке отсутствует код восстановления.";
  }
  return AUTH_ERROR_MESSAGES[normalized] || AUTH_ERROR_MESSAGES.AUTH_UNAVAILABLE;
}

export function formatRetryDuration(totalSeconds = 0) {
  const seconds = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest} сек`;
  return `${minutes} мин ${String(rest).padStart(2, "0")} сек`;
}

function safeInitialScreen(screen) {
  return Object.values(AUTH_FLOW_STATES).includes(screen) ? screen : AUTH_FLOW_STATES.LOGIN;
}

export function createAuthFlowState({
  screen = AUTH_FLOW_STATES.LOGIN,
  email = "",
  token = "",
  message = "",
  code = "",
} = {}) {
  return {
    screen: safeInitialScreen(screen),
    email: String(email || ""),
    password: "",
    confirmPassword: "",
    token: String(token || ""),
    message: String(message || ""),
    code: authErrorCode({ code }, code),
    fieldErrors: {},
    submitting: false,
    retryUntil: 0,
  };
}

export function authFlowReducer(state, action = {}) {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        screen: safeInitialScreen(action.screen),
        email: action.email !== undefined ? String(action.email || "") : state.email,
        token: action.token !== undefined ? String(action.token || "") : "",
        password: "",
        confirmPassword: "",
        message: String(action.message || ""),
        code: authErrorCode({ code: action.code }, action.code),
        fieldErrors: {},
        submitting: false,
        retryUntil: action.retryUntil || 0,
      };
    case "SET_FIELD":
      return {
        ...state,
        [action.field]: String(action.value ?? ""),
        message: action.clearMessage === false ? state.message : "",
        fieldErrors: action.field
          ? { ...state.fieldErrors, [action.field]: "" }
          : state.fieldErrors,
      };
    case "SUBMIT_START":
      return { ...state, submitting: true, message: "", code: "", fieldErrors: {} };
    case "SUBMIT_SUCCESS":
      return {
        ...state,
        submitting: false,
        message: String(action.message || ""),
        code: "",
        fieldErrors: {},
        retryUntil: 0,
      };
    case "SUBMIT_ERROR": {
      const error = action.error instanceof AuthApiError
        ? action.error
        : authApiErrorFromThrown(action.error);
      return {
        ...state,
        submitting: false,
        message: action.message || error.message,
        code: error.code,
        fieldErrors: authFieldErrors(error),
        retryUntil: error.retryUntil || 0,
      };
    }
    case "CLEAR_SECRET":
      return { ...state, token: "", password: "", confirmPassword: "" };
    case "CLEAR_MESSAGE":
      return { ...state, message: "", code: "", fieldErrors: {} };
    default:
      return state;
  }
}

export function recoveryActionsForCode(code, context = "generic") {
  const normalized = authErrorCode({ code }, code);
  if (normalized === "EMAIL_NOT_VERIFIED") return ["resendVerification", "changeEmail", "login"];
  if (normalized === "EMAIL_DELIVERY_UNAVAILABLE" || normalized === "SMTP_NOT_CONFIGURED") {
    return ["retry", "login"];
  }
  if (normalized === "TOKEN_EXPIRED") return ["requestNewLink", "login"];
  if (normalized === "TOKEN_INVALID" || normalized === "MISSING_TOKEN") {
    return context === "reset"
      ? ["requestNewLink", "register", "login"]
      : ["requestNewLink", "login", "register"];
  }
  if (normalized === "TOKEN_ALREADY_USED") return ["login", "requestNewLink"];
  if (normalized === "INVALID_CREDENTIALS") return ["retry", "forgotPassword", "register"];
  if (normalized === "SESSION_REVOKED") return ["login", "register"];
  if (normalized === "ACCOUNT_DELETED") return ["login", "register", "support"];
  return ["retry", "login"];
}
