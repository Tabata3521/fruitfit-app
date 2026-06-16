import { Capacitor, registerPlugin } from "@capacitor/core";

const TelegramNative = registerPlugin("FruitFitTelegram");

export const TELEGRAM_NATIVE_CLIENT_ID = "8800719097";
export const TELEGRAM_NATIVE_REDIRECT_URI = "https://app3329121288-login.tg.dev/tglogin";
export const TELEGRAM_OAUTH_URL = "https://oauth.telegram.org";

export function canUseTelegramNativeLogin() {
  try {
    return Boolean(Capacitor?.isNativePlatform?.() && TelegramNative?.startLogin);
  } catch (_) {
    return false;
  }
}

export async function startTelegramNativeLogin() {
  if (!canUseTelegramNativeLogin()) {
    throw new Error("Telegram Native Login доступен только в Android-приложении.");
  }

  let listener;
  try {
    const result = await new Promise(async (resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Telegram не вернул ответ. Попробуйте ещё раз или используйте Яндекс ID."));
      }, 90_000);

      listener = await TelegramNative.addListener("telegramNativeLoginResult", (payload) => {
        window.clearTimeout(timeout);
        if (payload?.ok && payload?.idToken) resolve(payload);
        else reject(new Error(payload?.error || "Telegram Login не завершился."));
      });

      try {
        await TelegramNative.startLogin({
          clientId: TELEGRAM_NATIVE_CLIENT_ID,
          redirectUri: TELEGRAM_NATIVE_REDIRECT_URI,
          oauthBaseUrl: TELEGRAM_OAUTH_URL,
        });
      } catch (error) {
        window.clearTimeout(timeout);
        reject(error);
      }
    });
    return result;
  } finally {
    listener?.remove?.();
  }
}
