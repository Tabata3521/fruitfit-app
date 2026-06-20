import { buildLocalPushEvents } from "../../shared/pushMessages.js";
import { currentUserId } from "./userScopedCache.js";

const STORAGE_KEY = "fruitfit.notificationCenter.v2";
const MAX_ITEMS = 60;

export function loadNotificationCenter(now = new Date()) {
  const userId = currentUserId();
  if (!userId) return [];
  const stored = readStore(userId);
  const storedItems = Array.isArray(stored.items) ? stored.items : [];
  const generated = buildLocalPushEvents({ now, daysBack: 4, existingItems: storedItems, userId });
  const generatedIds = new Set(generated.map((item) => item.id));
  const customItems = storedItems
    .filter((item) => !generatedIds.has(item.id))
    .filter((item) => item.sentAt && new Date(item.sentAt) <= now);
  const items = [...generated, ...customItems]
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, MAX_ITEMS);

  writeStore(userId, { userId, items, updatedAt: now.toISOString() });
  return items;
}

export function markNotificationRead(id) {
  const userId = currentUserId();
  if (!userId) return [];
  const now = new Date().toISOString();
  const items = loadNotificationCenter().map((item) => (
    item.id === id ? { ...item, readAt: item.readAt || now } : item
  ));
  writeStore(userId, { userId, items, updatedAt: now });
  return items;
}

export function markAllNotificationsRead() {
  const userId = currentUserId();
  if (!userId) return [];
  const now = new Date().toISOString();
  const items = loadNotificationCenter().map((item) => ({ ...item, readAt: item.readAt || now }));
  writeStore(userId, { userId, items, updatedAt: now });
  return items;
}

export function formatNotificationTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  if (sameLocalDay(date, now)) return `сегодня, ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return `вчера, ${time}`;

  const day = date.toLocaleDateString("ru-RU", { day: "2-digit", month: "short" });
  return `${day}, ${time}`;
}

function sameLocalDay(left, right) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function scopedStorageKey(userId) {
  return `${STORAGE_KEY}:${userId}`;
}

function readStore(userId) {
  if (typeof localStorage === "undefined") return {};
  try {
    const value = JSON.parse(localStorage.getItem(scopedStorageKey(userId)) || "{}") || {};
    return value.userId && value.userId !== userId ? {} : value;
  } catch (_) {
    return {};
  }
}

function writeStore(userId, value) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(scopedStorageKey(userId), JSON.stringify({ ...value, userId }));
  } catch (_) {
    // Notification center should never block the dashboard.
  }
}
