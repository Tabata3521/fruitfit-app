import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "vite";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(String(key)) ? this.values.get(String(key)) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
  clear() { this.values.clear(); }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = {
  location: {
    href: "https://client.tagirfruit.ru/",
    origin: "https://client.tagirfruit.ru",
  },
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {},
  Capacitor: {
    getPlatform: () => "web",
    isNativePlatform: () => false,
    Plugins: {},
  },
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    language: "ru-RU",
    languages: ["ru-RU"],
    onLine: false,
    platform: "test",
  },
});

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

try {
  const device = await vite.ssrLoadModule("/src/data/deviceStore.js");
  const firstInstallationId = device.getInstallationId();
  assert.match(firstInstallationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(device.getInstallationId(), firstInstallationId);

  localStorage.clear();
  localStorage.setItem("fruitfit.installationId", "inst_legacy-value");
  assert.equal(device.getInstallationId(), "inst_legacy-value");
  assert.equal(localStorage.getItem("fruitfit.installationId.v1"), "inst_legacy-value");

  localStorage.clear();
  const attribution = await vite.ssrLoadModule("/src/services/attribution.js");
  attribution.captureAttributionUrl("fruitfit://auth?utm_source=vk&utm_campaign=summer&redirect_token=first-token");
  attribution.captureAttributionUrl("fruitfit://auth?utm_source=yandex&yclid=42");
  const touch = attribution.attributionDebugState().touch;
  assert.equal(touch.firstTouch.utm_source, "vk");
  assert.equal(touch.firstTouch.redirect_token, "first-token");
  assert.equal(touch.lastTouch.utm_source, "yandex");
  assert.equal(touch.lastTouch.yclid, "42");

  const eventId = await attribution.trackAnalyticsEvent("nutrition_opened", { screen: "food", forbiddenHealth: "secret" });
  assert.match(eventId, /^[0-9a-f-]{36}$/i);
  const queued = attribution.attributionDebugState().queue.find((item) => item.payload?.event_id === eventId);
  assert.equal(queued.payload.event_name, "nutrition_opened");
  assert.deepEqual(queued.payload.properties, { screen: "food" });
  assert.equal(await attribution.trackAnalyticsEvent("payment_completed", {}), null);

  const onboarding = await vite.ssrLoadModule("/src/data/healthOnboarding.js");
  const user = { id: "health-user" };
  assert.equal(onboarding.healthOnboardingDue(user), true);
  onboarding.updateHealthOnboardingState(user, { laterAt: new Date().toISOString() });
  assert.equal(onboarding.healthOnboardingDue(user), false);
  sessionStorage.clear();
  onboarding.updateHealthOnboardingState(user, { laterAt: new Date(Date.now() - onboarding.HEALTH_ONBOARDING_RETRY_MS - 1).toISOString() });
  assert.equal(onboarding.healthOnboardingDue(user), true);
  onboarding.markHealthOnboardingSessionHandled(user);
  assert.equal(onboarding.healthOnboardingDue(user), false);

  const onboardingSource = fs.readFileSync("src/components/HealthConnectionOnboarding.jsx", "utf8");
  assert.match(onboardingSource, /requestConnection\?\.\(\{ openSettingsOnMissing: false \}\)/);
  assert.match(onboardingSource, /registerFirebaseMessagingPush\(\{ force: true, prompt: true \}\)/);
  assert.doesNotMatch(onboardingSource, /requestConnection\?\.\(\).*registerFirebaseMessagingPush/s);

  const referrerSource = fs.readFileSync("android/app/src/main/java/com/tagirfruit/fruitfit/FruitFitInstallReferrerPlugin.java", "utf8");
  assert.match(referrerSource, /InstallReferrerClient/);
  assert.match(referrerSource, /getReferrerClickTimestampSeconds/);
  assert.match(referrerSource, /getInstallBeginTimestampSeconds/);
  assert.match(referrerSource, /getGooglePlayInstantParam/);

  console.log("attribution and health onboarding client tests: PASS");
} finally {
  await vite.close();
}
