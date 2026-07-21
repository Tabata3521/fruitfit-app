import { getAuthToken } from "../data/authStore";
import { appInfo, getAppInfo, getPlatform, normalizeApiUrl } from "./appInfo";
import { postJson } from "./nativeHttp";

const API_BASE_URL = normalizeApiUrl(import.meta.env.VITE_FRUITFIT_API_URL || appInfo.api.productionApi);
const AI_FEEDBACK_ENDPOINT = `${API_BASE_URL}/api/ai/feedback`;

export async function submitAiFeedback({ messageId, conversationId, rating, reason = null } = {}) {
  const token = getAuthToken();
  const platform = getPlatform();
  if (!token) throw new Error("Войди в аккаунт, чтобы оценить ответ.");
  if (!messageId || !conversationId) throw new Error("Этот ответ пока нельзя оценить.");
  if (!['android', 'ios'].includes(platform)) throw new Error("Оценка доступна в мобильном приложении.");

  const info = await getAppInfo();
  const response = await postJson(AI_FEEDBACK_ENDPOINT, {
    message_id: messageId,
    conversation_id: conversationId,
    rating,
    ...(reason ? { reason } : {}),
    app_version: `${info.versionName || info.version || ""} (${info.buildNumber || info.build || ""})`,
    platform,
  }, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.ok || (response.status === 409 && response.data?.error === "FEEDBACK_ALREADY_EXISTS")) {
    return response.data || { ok: true };
  }
  throw new Error("Не удалось отправить оценку. Попробуй позже.");
}
