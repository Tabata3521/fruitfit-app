import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const app = read("src/App.jsx");
const auth = read("src/screens/AuthPrompt.jsx");
const coach = read("src/screens/CoachScreen.jsx");
const engagement = read("src/components/EngagementPrompt.jsx");
const bottomNavigation = read("src/components/BottomNavigation.jsx");
const settings = read("src/screens/SettingsScreen.jsx");
const workout = read("src/screens/WorkoutScreen.jsx");
const health = read("src/data/healthStore.jsx");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("email deep links close onboarding before opening auth", () => {
  const handler = app.slice(app.indexOf("async function handleIncomingAuthUrl"), app.indexOf("async function refreshProgramStateAfterReturn"));
  assert.ok(handler.indexOf("setQuizOpen(false)") < handler.indexOf("setAuthPromptOpen(true)"));
});

test("revoked sessions close questionnaire and clear account-bound state", () => {
  const handler = app.slice(app.indexOf("function handleInvalidSession"), app.indexOf("window.addEventListener(\"fruitfit:auth-session-invalid\""));
  for (const token of ["clearLocalAuthSession()", "setAccessState(null)", "setProgramAssignment(null)", "setQuizOpen(false)", "setAuthPromptOpen(true)"]) {
    assert.ok(handler.includes(token), `missing ${token}`);
  }
});

test("auth requests have a synchronous duplicate-submit guard", () => {
  assert.ok(auth.includes("const actionInFlightRef = useRef(false)"));
  assert.ok(auth.includes("if (actionInFlightRef.current) return false"));
  assert.ok(auth.includes("finishAuthAction()"));
});

test("AI consent blocks the request and cannot double-send on accept", () => {
  const send = coach.slice(coach.indexOf("async function send"), coach.indexOf("function submit"));
  assert.ok(send.includes("if (!options.skipConsent && !aiConsentAccepted)"));
  assert.ok(send.indexOf("setAiConsentOpen(true)") < send.indexOf("askFruitFitCoach"));
  assert.ok(coach.includes("const consentActionRef = useRef(false)"));
  assert.ok(coach.includes("if (consentActionRef.current) return"));
  assert.ok(coach.includes("aiConsentKey(userId)"));
});

test("engagement prompt is native-only, delayed and duplicate-action safe", () => {
  assert.ok(engagement.includes("![\"android\", \"ios\"].includes(PLATFORM)"));
  assert.ok(engagement.includes("window.setTimeout"));
  assert.ok(engagement.includes("window.clearTimeout(timer)"));
  assert.ok(engagement.includes("actionInFlightRef.current"));
  assert.ok(engagement.includes("event.stopPropagation()"));
});

test("destructive and workout replacement dialogs cannot submit while busy", () => {
  assert.ok(settings.includes("<DeleteAccountModal"));
  assert.ok(settings.includes("disabled={loading}"));
  assert.ok(workout.includes("alternativeReason && <AlternativesModal"));
  assert.ok(workout.includes("onClose={() => setAlternativeReason(\"\")}"));
});

test("global health provider does not call account APIs before login", () => {
  const cycleEffect = health.slice(health.indexOf("function syncServerCycleForCurrentUser"), health.indexOf("const syncNativeHealth"));
  assert.ok(cycleEffect.includes("if (!currentUserId()) return"));
  assert.ok(cycleEffect.includes('window.addEventListener("fruitfit:auth-updated"'));
  assert.ok(cycleEffect.includes('window.removeEventListener("fruitfit:auth-updated"'));
});

test("active workout banner can move, save and hide without completing the workout", () => {
  assert.ok(bottomNavigation.includes("onPointerMove={moveBanner}"));
  assert.ok(bottomNavigation.includes("clampBannerLift"));
  assert.ok(bottomNavigation.includes("flushWorkoutSessionSync(sessionId"));
  assert.ok(bottomNavigation.includes('title="Сохранить и скрыть"'));
  assert.ok(bottomNavigation.includes("setHiddenSessionId(sessionId)"));
  assert.ok(!bottomNavigation.includes("completeWorkoutSession"));
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
  }
}

console.log(`Modal safety tests: ${tests.length - failed}/${tests.length} passed`);
if (failed) process.exitCode = 1;
