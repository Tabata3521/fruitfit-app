import { readAiMemoryField, writeAiMemoryField } from "./dataContainers.js";
import { currentUserId } from "./userScopedCache.js";

export const COACH_CHAT_STORAGE_KEY = "fruitfit.aiCoach.chat";
export const COACH_AI_MEMORY_FIELD = "chatHistory";
export const COACH_CHAT_RETENTION_DAYS = 30;
export const COACH_CONTEXT_MESSAGE_LIMIT = 12;

const RETENTION_MS = COACH_CHAT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function cutoffMs(now = Date.now()) {
  return now - RETENTION_MS;
}

function messageTimestamp(message = {}) {
  const timestamp = new Date(message.createdAt || message.created_at || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeRole(role) {
  return role === "assistant" ? "assistant" : "user";
}

function normalizeMessage(message = {}, userId = currentUserId()) {
  const id = String(userId || "").trim();
  const content = String(message.content || "").trim();
  if (!id || !content) return null;
  return {
    id: String(message.id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`),
    userId: id,
    role: normalizeRole(message.role),
    content,
    createdAt: message.createdAt || message.created_at || new Date().toISOString(),
    messageId: String(message.messageId || message.message_id || "").trim(),
    conversationId: String(message.conversationId || message.conversation_id || "").trim(),
    feedback: message.feedback && typeof message.feedback === "object" ? message.feedback : null,
  };
}

function normalizeStoredMessage(message = {}, userId = currentUserId()) {
  const id = String(userId || "").trim();
  const storedUserId = String(message.userId || message.user_id || "").trim();
  if (!id || storedUserId !== id) return null;
  return normalizeMessage(message, storedUserId);
}

export function pruneCoachMessages(messages = [], userId = currentUserId(), now = Date.now()) {
  const id = String(userId || "").trim();
  if (!id) return [];
  const oldestAllowed = cutoffMs(now);
  return (Array.isArray(messages) ? messages : [])
    .map((message) => normalizeStoredMessage(message, id))
    .filter(Boolean)
    .filter((message) => message.userId === id)
    .filter((message) => messageTimestamp(message) >= oldestAllowed)
    .sort((a, b) => messageTimestamp(a) - messageTimestamp(b));
}

export function loadCoachChatHistory(userId = currentUserId()) {
  const id = String(userId || "").trim();
  if (!id) return [];
  const stored = readAiMemoryField(COACH_AI_MEMORY_FIELD, id, []);
  const pruned = pruneCoachMessages(stored, id);
  if (pruned.length !== (Array.isArray(stored) ? stored.length : 0)) {
    writeAiMemoryField(COACH_AI_MEMORY_FIELD, pruned, id);
  }
  return pruned;
}

export function saveCoachChatHistory(messages = [], userId = currentUserId()) {
  const id = String(userId || "").trim();
  if (!id) return [];
  const pruned = pruneCoachMessages(messages, id);
  writeAiMemoryField(COACH_AI_MEMORY_FIELD, pruned, id);
  return pruned;
}

export function createCoachChatMessage(role, content, userId = currentUserId(), metadata = {}) {
  return normalizeMessage({ role, content, ...metadata }, userId);
}

export function coachMessagesForContext(messages = [], userId = currentUserId(), limit = COACH_CONTEXT_MESSAGE_LIMIT) {
  return pruneCoachMessages(messages, userId)
    .slice(-Math.max(1, Number(limit) || COACH_CONTEXT_MESSAGE_LIMIT))
    .map((message) => ({
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    }));
}
