import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [coach, openai, feedback, store] = await Promise.all([
  source("src/screens/CoachScreen.jsx"),
  source("src/services/openai.js"),
  source("src/services/aiFeedback.js"),
  source("src/data/coachChatStore.js"),
]);

assert.match(openai, /messageId: String\(data\?\.message_id/);
assert.match(openai, /conversationId: String\(data\?\.conversation_id/);
assert.match(feedback, /\/api\/ai\/feedback/);
assert.match(feedback, /message_id: messageId/);
assert.match(feedback, /conversation_id: conversationId/);
assert.match(feedback, /FEEDBACK_ALREADY_EXISTS/);
assert.match(store, /messageId:/);
assert.match(store, /conversationId:/);
assert.match(store, /feedback:/);
assert.match(coach, /ThumbsUp/);
assert.match(coach, /ThumbsDown/);
for (const reason of ["incorrect", "not_helpful", "unsafe", "other"]) {
  assert.match(coach, new RegExp(`id: "${reason}"`));
}
assert.match(coach, /Спасибо! Это поможет сделать AI Coach лучше\./);
assert.match(coach, /message\.feedback \?/);

console.log("AI Coach feedback client checks passed.");
