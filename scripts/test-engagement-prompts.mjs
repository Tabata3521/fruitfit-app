import assert from "node:assert/strict";
import { createServer } from "vite";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 6, 11, 12);
const user = { id: "user-a", createdAt: new Date(now - 15 * DAY_MS).toISOString() };
const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });

try {
  const module = await vite.ssrLoadModule("/src/data/engagementPrompts.js");
  const baseState = { firstSeenAt: user.createdAt, launchCount: 6, rating: {}, program: {} };

  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "free" }, platform: "android", state: baseState, now }), "program");
  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "paid", isPaid: true }, platform: "android", state: baseState, now }), "rating");
  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "test", isTest: true }, platform: "android", state: baseState, now }), "rating");
  assert.equal(module.selectEngagementPrompt({ user, access: { role: "trainer" }, platform: "ios", state: baseState, now }), "rating");
  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "free" }, platform: "web", state: baseState, now }), null);
  assert.equal(module.selectEngagementPrompt({ user: { ...user, createdAt: new Date(now - 6 * DAY_MS).toISOString() }, access: { billingStatus: "free" }, platform: "ios", state: { ...baseState, firstSeenAt: new Date(now - 6 * DAY_MS).toISOString() }, now }), null);
  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "free" }, platform: "ios", state: { ...baseState, program: { lastShownAt: new Date(now - DAY_MS).toISOString() } }, now }), "rating");
  assert.equal(module.selectEngagementPrompt({ user, access: { billingStatus: "paid", isPaid: true }, platform: "ios", state: { ...baseState, rating: { completedAt: new Date(now - DAY_MS).toISOString() } }, now }), null);
  assert.match(module.ratingStoreUrl("ios"), /id6784431088/);
  assert.match(module.ratingStoreUrl("android"), /com\.tagirfruit\.fruitfit/);
  console.log("engagement prompt tests: PASS");
} finally {
  await vite.close();
}
