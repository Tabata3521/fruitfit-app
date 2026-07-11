import { Capacitor } from "@capacitor/core";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Sparkles, Star, X } from "lucide-react";
import { useEffect, useState } from "react";
import { APP_STORE_REVIEW } from "../config/appStoreReview";
import {
  engagementPromptTypes,
  prepareEngagementPrompt,
  ratingStoreUrl,
  recordEngagementPromptOutcome,
} from "../data/engagementPrompts";
import { openProfileProgramAction } from "#fruitfit/programAction";

const PLATFORM = Capacitor.getPlatform?.() || "web";

async function openExternalUrl(url) {
  const target = String(url || "").trim();
  if (!target) return false;
  try {
    const browser = window.Capacitor?.Plugins?.Browser;
    if (browser?.open) {
      await browser.open({ url: target });
      return true;
    }
  } catch (_) {
    // Continue with the browser fallback.
  }
  const opened = window.open(target, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = target;
  return true;
}

export default function EngagementPrompt({ user, access, profile }) {
  const [type, setType] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setType(null);
    setError("");
    if (!user || !access || !["android", "ios"].includes(PLATFORM)) return undefined;
    const timer = window.setTimeout(() => {
      setType(prepareEngagementPrompt({ user, access, platform: PLATFORM }));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [access, access?.billingStatus, access?.paymentStatus, access?.status, access?.updatedAt, user, user?.id]);

  function dismiss() {
    if (!type || loading) return;
    recordEngagementPromptOutcome({ user, type, outcome: "dismissed" });
    setType(null);
  }

  async function runPrimaryAction() {
    if (!type || loading) return;
    setLoading(true);
    setError("");
    try {
      if (type === engagementPromptTypes.RATING) {
        const opened = await openExternalUrl(ratingStoreUrl(PLATFORM));
        if (!opened) throw new Error("Не удалось открыть страницу приложения.");
        recordEngagementPromptOutcome({ user, type, outcome: "completed" });
      } else {
        await openProfileProgramAction({
          profile,
          source: APP_STORE_REVIEW ? `${PLATFORM}-home-program-prompt` : "home-program-prompt",
          openExternalUrl,
        });
        recordEngagementPromptOutcome({ user, type, outcome: "action" });
      }
      setType(null);
    } catch (actionError) {
      setError(actionError?.message || "Не удалось выполнить действие. Попробуйте позже.");
    } finally {
      setLoading(false);
    }
  }

  const rating = type === engagementPromptTypes.RATING;

  return (
    <AnimatePresence>
      {type && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-12 backdrop-blur-sm sm:items-center sm:pb-4"
          onClick={dismiss}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="engagement-prompt-title"
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-[390px] rounded-[24px] border border-appBorder bg-appCard p-5 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-appGreen/20 text-appGreen">
                {rating ? <Star size={21} fill="currentColor" /> : <Sparkles size={21} />}
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="engagement-prompt-title" className="text-[18px] font-black leading-6 text-appText">
                  {rating ? "Нравится FruitFit?" : "Я рядом"}
                </h2>
                <p className="mt-2 text-[13px] leading-5 text-appMuted">
                  {rating
                    ? "Твоя оценка помогает мне развивать приложение и делать тренировки удобнее."
                    : "Я надеюсь, тебе очень нравится моё приложение. Ты всегда можешь обратиться ко мне за помощью в дальнейших тренировках"}
                </p>
              </div>
              <button
                type="button"
                title="Закрыть"
                aria-label="Закрыть"
                onClick={dismiss}
                disabled={loading}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-appMuted transition hover:bg-appBg disabled:opacity-50"
              >
                <X size={19} />
              </button>
            </div>

            {error && <p className="mt-4 rounded-[16px] bg-red-500/10 px-3 py-2 text-[12px] font-semibold leading-5 text-red-500">{error}</p>}

            <button
              type="button"
              onClick={runPrimaryAction}
              disabled={loading}
              className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-appGreen px-5 text-[14px] font-black text-[#181F19] disabled:opacity-65"
            >
              {loading ? "Подождите..." : rating ? "Оценить приложение" : "Оформить персональную программу"}
              {!loading && <ArrowRight size={18} />}
            </button>
            <button
              type="button"
              onClick={dismiss}
              disabled={loading}
              className="mt-2 h-10 w-full text-[12px] font-bold text-appMuted disabled:opacity-50"
            >
              Позже
            </button>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
