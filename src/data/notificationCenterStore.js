import { buildLocalMotivationEvents } from "../../shared/motivationMessages.js";

const STORAGE_KEY = "fruitfit.notificationCenter.v1";
const MAX_ITEMS = 60;

export function loadNotificationCenter(now = new Date()) {
  const stored = readStore();
  const storedItems = Array.isArray(stored.items) ? stored.items : [];
  const generated = buildLocalMotivationEvents({ now, daysBack: 4, existingItems: storedItems });
  const generatedIds = new Set(generated.map((item) => item.id));
  const customItems = storedItems
    .filter((item) => !generatedIds.has(item.id))
    .filter((item) => item.sentAt && new Date(item.sentAt) <= now);
  const items = [...generated, ...customItems]
    .sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt))
    .slice(0, MAX_ITEMS);

  writeStore({ items, updatedAt: now.toISOString() });
  return items;
}

export function markNotificationRead(id) {
  const now = new Date().toISOString();
  const items = loadNotificationCenter().map((item) => (
    item.id === id ? { ...item, readAt: item.readAt || now } : item
  ));
  writeStore({ items, updatedAt: now });
  return items;
}

export function markAllNotificationsRead() {
  const now = new Date().toISOString();
  const items = loadNotificationCenter().map((item) => ({ ...item, readAt: item.readAt || now }));
  writeStore({ items, updatedAt: now });
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

function readStore() {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function writeStore(value) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (_) {
    // Notification center should never block the dashboard.
  }
}
