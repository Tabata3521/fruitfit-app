import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUTH_FLOW_STATES,
  AuthApiError,
  authApiErrorFromResponse,
  authFlowReducer,
  authMessageForCode,
  createAuthFlowState,
  recoveryActionsForCode,
  retryAfterSecondsFromResponse,
} from "../src/services/authFlow.js";
import { parseAuthDeepLink } from "../src/services/authDeepLinks.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appSource = readFileSync(path.join(root, "src/App.jsx"), "utf8");
const promptSource = readFileSync(path.join(root, "src/screens/AuthPrompt.jsx"), "utf8");
const settingsSource = readFileSync(path.join(root, "src/screens/SettingsScreen.jsx"), "utf8");
const manifestSource = readFileSync(path.join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
const mainActivitySource = readFileSync(path.join(root, "android/app/src/main/java/com/tagirfruit/fruitfit/MainActivity.java"), "utf8");

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("register custom scheme accepts mode and preserves editable email", () => {
  const route = parseAuthDeepLink("fruitfit://auth?mode=register&email=first%2Blast-test%40example.com");
  assert.equal(route.recognized, true);
  assert.equal(route.screen, AUTH_FLOW_STATES.REGISTER);
  assert.equal(route.email, "first+last-test@example.com");
});

test("register aliases and HTTPS register path are supported", () => {
  assert.equal(parseAuthDeepLink("fruitfit://auth?event=email_register&email=a%40b.ru").kind, "register");
  assert.equal(parseAuthDeepLink("https://tagirfruit.ru/email/register?email=a%40b.ru").kind, "register");
});

test("verification token is accepted from query and hash", () => {
  assert.equal(parseAuthDeepLink("https://tagirfruit.ru/email/verify?token=abc").token, "abc");
  assert.equal(parseAuthDeepLink("fruitfit://auth?event=email_verify#token=def").token, "def");
});

test("reset token is accepted from legacy and event links", () => {
  assert.equal(parseAuthDeepLink("https://tagirfruit.ru/email/reset-password?token=abc").kind, "reset");
  assert.equal(parseAuthDeepLink("fruitfit://auth?event=password_reset&token=def").screen, AUTH_FLOW_STATES.RESET_PASSWORD_LINK);
});

test("external provider callbacks are rejected by the email-only client", () => {
  const route = parseAuthDeepLink("fruitfit://auth?event=auth_success&auth_token=super-secret");
  assert.equal(route.recognized, false);
  assert.equal(route.kind, "none");
  assert.equal("authToken" in route, false);
});

test("unknown commands, schemes and hosts are rejected", () => {
  assert.equal(parseAuthDeepLink("fruitfit://auth?event=delete_everything").recognized, false);
  assert.equal(parseAuthDeepLink("evil://auth?event=email_verify&token=x").recognized, false);
  assert.equal(parseAuthDeepLink("https://evil.example/email/verify?token=x").recognized, false);
});

test("state navigation preserves email and clears passwords", () => {
  const initial = {
    ...createAuthFlowState({ screen: AUTH_FLOW_STATES.LOGIN, email: "a@b.ru" }),
    password: "secret-password",
    confirmPassword: "secret-password",
  };
  const next = authFlowReducer(initial, { type: "NAVIGATE", screen: AUTH_FLOW_STATES.FORGOT_PASSWORD });
  assert.equal(next.email, "a@b.ru");
  assert.equal(next.password, "");
  assert.equal(next.confirmPassword, "");
});

test("field validation errors are attached to the correct field", () => {
  const initial = createAuthFlowState({ screen: AUTH_FLOW_STATES.REGISTER });
  const next = authFlowReducer(initial, {
    type: "SUBMIT_ERROR",
    error: new AuthApiError({ status: 400, code: "PASSWORD_CONFIRMATION_MISMATCH" }),
  });
  assert.equal(next.fieldErrors.confirmPassword, "Пароли не совпадают.");
});

test("Retry-After is read from response body and header", () => {
  assert.equal(retryAfterSecondsFromResponse({ data: { retryAfterSeconds: 75 } }), 75);
  assert.equal(retryAfterSecondsFromResponse({ headers: { "retry-after": "120" } }), 120);
  const error = authApiErrorFromResponse({
    status: 429,
    data: { code: "RATE_LIMITED" },
    headers: { "Retry-After": "60" },
  });
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.retryAfterSeconds, 60);
  assert.ok(error.retryUntil > Date.now());
});

test("verification and reset token messages stay distinct", () => {
  assert.equal(authMessageForCode("TOKEN_EXPIRED", "verification"), "Срок действия ссылки истёк.");
  assert.equal(authMessageForCode("TOKEN_INVALID", "verification"), "Ссылка повреждена или недействительна.");
  assert.equal(authMessageForCode("TOKEN_ALREADY_USED", "verification"), "Email уже подтверждён. Теперь можно войти.");
  assert.equal(authMessageForCode("TOKEN_ALREADY_USED", "reset"), "Эта ссылка уже использована. Попробуйте войти с новым паролем.");
  assert.equal(authMessageForCode("MISSING_TOKEN", "reset"), "В ссылке отсутствует код восстановления.");
});

test("every critical error has recovery actions", () => {
  for (const code of [
    "INVALID_CREDENTIALS",
    "EMAIL_NOT_VERIFIED",
    "TOKEN_EXPIRED",
    "TOKEN_INVALID",
    "TOKEN_ALREADY_USED",
    "MISSING_TOKEN",
    "SESSION_REVOKED",
    "ACCOUNT_DELETED",
  ]) {
    assert.ok(recoveryActionsForCode(code).length >= 2, `${code} has insufficient recovery actions`);
  }
});

test("App uses one parser across cold, warm and foreground delivery", () => {
  assert.ok(appSource.includes("parseAuthDeepLink"));
  assert.ok(appSource.includes("CapacitorApp.getLaunchUrl"));
  assert.ok(appSource.includes('"appUrlOpen"'));
  assert.ok(appSource.includes('"appStateChange"'));
  assert.ok(appSource.includes("fruitfit:auth-session-invalid"));
  assert.equal(appSource.includes("function emailAuthActionFromUrl"), false);
  assert.equal(appSource.includes("function authTokenFromUrl"), false);
});

test("Auth UI does not ask users to paste technical tokens", () => {
  assert.equal(promptSource.includes("Код из письма"), false);
  assert.ok(promptSource.includes("Отправить новую ссылку"));
  assert.ok(promptSource.includes("Нет аккаунта — создать"));
});

test("Settings has password recovery, safe logout and logout-all", () => {
  assert.ok(settingsSource.includes("requestPasswordResetEmail"));
  assert.ok(settingsSource.includes("Отправить ссылку для смены пароля"));
  assert.ok(settingsSource.includes("logoutAllDevices"));
  assert.ok(settingsSource.includes("Удалить данные только с этого устройства"));
});

test("external login providers are absent from shared and Android auth surfaces", () => {
  for (const source of [promptSource, settingsSource, appSource]) {
    assert.equal(source.includes("/api/auth/providers/available"), false);
    assert.equal(source.includes("linkAuthProvider"), false);
    assert.equal(source.includes("unlinkAuthProvider"), false);
    assert.equal(source.includes("startTelegramNativeLogin"), false);
  }
  assert.equal(manifestSource.includes("app3329121288-login.tg.dev"), false);
  assert.equal(manifestSource.includes("org.telegram.messenger"), false);
  assert.equal(mainActivitySource.includes("FruitFitTelegramPlugin"), false);
});

test("auth UI cannot expose the legacy guest entry point", () => {
  assert.equal(promptSource.includes("Продолжить без регистрации"), false);
  assert.equal(promptSource.includes("onSkip"), false);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

console.log(`Auth recovery tests: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exitCode = 1;
