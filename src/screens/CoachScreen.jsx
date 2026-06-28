import { Bot, Send } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import { coachMessagesForContext, createCoachChatMessage, loadCoachChatHistory, saveCoachChatHistory } from "../data/coachChatStore";
import { fetchProgramAssignment } from "../data/authStore";
import { readUserCoreField } from "../data/dataContainers";
import { buildAiCoachClientContext, resetStaleWorkoutState, serverCurrentWorkoutFromAssignment } from "../data/dataAccess";
import { profileFirstNameForGreeting } from "../data/profileStore";
import { currentUserId } from "../data/userScopedCache";
import { answerDirectNutritionQuestion } from "../services/nutritionCoach";
import { askFruitFitCoach } from "../services/openai";

const starters = [
  "Какой вес поставить в следующем подходе?",
  "Что делать, если плохо восстановился?",
  "Чем заменить упражнение без тренажёра?",
  "Как собрать приём пищи на сегодня?",
];

const AI_CONSENT_VERSION = "2026-06-openai-context";

function aiConsentKey(userId = "") {
  const scope = String(userId || "anonymous").trim() || "anonymous";
  return `fruitfit.aiConsent:${scope}`;
}

function loadAiCoachConsent(userId = currentUserId()) {
  if (typeof window === "undefined") return false;
  try {
    const parsed = JSON.parse(localStorage.getItem(aiConsentKey(userId)) || "null");
    return Boolean(parsed?.accepted && parsed?.version === AI_CONSENT_VERSION);
  } catch (_) {
    return false;
  }
}

function saveAiCoachConsent(userId = currentUserId()) {
  if (typeof window === "undefined") return false;
  try {
    localStorage.setItem(aiConsentKey(userId), JSON.stringify({
      accepted: true,
      version: AI_CONSENT_VERSION,
      acceptedAt: new Date().toISOString(),
      provider: "OpenAI",
    }));
    return true;
  } catch (_) {
    return false;
  }
}

function coachWelcomeMessage(profile = {}) {
  const firstName = profileFirstNameForGreeting(profile);
  const greeting = firstName ? `Привет, ${firstName}!` : "Привет!";
  const creatorLine = firstName
    ? "Меня создал Тагир Мейвалиев для FruitFit"
    : "Меня создали для FruitFit";
  return {
    role: "assistant",
    content: `${greeting} Я AI Coach FruitFit - твой помощник по тренировкам, питанию и восстановлению. ${creatorLine}, и я здесь, чтобы помогать тебе с программой, нагрузкой, самочувствием и ежедневными решениями.`,
  };
}

function ThinkingDots() {
  return (
    <div className="flex w-20 items-center gap-1 rounded-[20px] bg-appCard px-4 py-3 shadow-sm">
      {[0, 1, 2].map((item) => (
        <span key={item} className="h-1.5 w-1.5 animate-bounce rounded-full bg-appMuted" style={{ animationDelay: `${item * 120}ms` }} />
      ))}
    </div>
  );
}

function AiConsentModal({ onAccept, onCancel }) {
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/60 px-4 backdrop-blur-sm">
      <section className="w-full max-w-[380px] rounded-[28px] border border-appBorder bg-appCard p-5 shadow-card">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-appGreen/15 text-appGreen">
            <Bot size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[18px] font-black text-appText">AI Coach использует OpenAI</h2>
            <p className="mt-2 text-[13px] leading-5 text-appMuted">
              Чтобы ответить точнее, FruitFit может передавать в OpenAI ваш вопрос, последние сообщения чата, профиль и анкету, текущую программу, выбранную тренировку, цель питания и краткую сводку активности, если трекер подключён.
            </p>
            <p className="mt-2 text-[12px] leading-5 text-appMuted">
              Платёжные данные, токены входа и секреты не отправляются. Без согласия запрос к AI Coach не будет выполнен.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} className="h-11 rounded-full border border-appBorder bg-appBg text-[13px] font-black text-appText">
            Отмена
          </button>
          <button type="button" onClick={onAccept} className="h-11 rounded-full bg-appGreen text-[13px] font-black text-[#181F19]">
            Согласен
          </button>
        </div>
      </section>
    </div>
  );
}

function cleanText(value) {
  return String(value || "").trim();
}

const USER_SELECTION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function workoutIdFrom(value = null) {
  return cleanText(value?.workoutId || value?.workout_id || value?.lessonId || value?.lesson_id || value?.id);
}

function workoutTitleFrom(value = null) {
  return cleanText(value?.title || value?.lesson?.lesson_title || value?.lessonTitle || value?.lesson_title || value?.name);
}

function workoutDayIndexFrom(value = null) {
  const number = Number(value?.dayIndex ?? value?.day_index ?? value?.index);
  return Number.isFinite(number) ? Math.floor(number) : null;
}

function workoutTimestampFrom(value = null) {
  const raw = cleanText(value?.selectedAt || value?.savedAt || value?.resolvedAt || value?.updatedAt || value?.createdAt);
  if (!raw) return 0;
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : 0;
}

function isFreshUserWorkoutSelection(selection = null, userId = "") {
  if (!selection || typeof selection !== "object") return false;
  const storedUserId = cleanText(selection.userId || selection.user_id);
  if (storedUserId && storedUserId !== cleanText(userId)) return false;
  if (cleanText(selection.source) !== "user_selection") return false;
  if (!workoutIdFrom(selection)) return false;
  const selectedAt = workoutTimestampFrom(selection);
  if (!selectedAt) return false;
  return Date.now() - selectedAt <= USER_SELECTION_MAX_AGE_MS;
}

function workoutIdentityMatches(left = null, right = null) {
  if (!left || !right) return false;
  const leftIds = [left?.workoutId, left?.workout_id, left?.lessonId, left?.lesson_id, left?.id].map(cleanText).filter(Boolean);
  const rightIds = [right?.workoutId, right?.workout_id, right?.lessonId, right?.lesson_id, right?.id].map(cleanText).filter(Boolean);
  if (leftIds.some((id) => rightIds.includes(id))) return true;
  const leftDayIndex = workoutDayIndexFrom(left);
  const rightDayIndex = workoutDayIndexFrom(right);
  if (leftDayIndex != null && rightDayIndex != null && leftDayIndex === rightDayIndex) return true;
  const leftTitle = workoutTitleFrom(left).toLowerCase();
  const rightTitle = workoutTitleFrom(right).toLowerCase();
  return Boolean(leftTitle && rightTitle && leftTitle === rightTitle);
}

function workoutWithBestSnapshot(primary = null, secondary = null) {
  if (!primary) return secondary || null;
  const primaryExercises = Array.isArray(primary.exercises) ? primary.exercises : [];
  const secondaryExercises = Array.isArray(secondary?.exercises) ? secondary.exercises : [];
  return {
    ...(secondary && workoutIdentityMatches(primary, secondary) ? secondary : {}),
    ...primary,
    exercises: primaryExercises.length ? primaryExercises : secondaryExercises,
  };
}

function resolveActiveWorkoutSelection({
  userId,
  storedWorkoutSelection,
  selectedWorkout,
  workout,
  currentWorkout,
} = {}) {
  const freshStoredSelection = isFreshUserWorkoutSelection(storedWorkoutSelection, userId)
    ? workoutWithBestSnapshot(storedWorkoutSelection, selectedWorkout)
    : null;
  const selectedPropMatchesStored = Boolean(freshStoredSelection && selectedWorkout && workoutIdentityMatches(freshStoredSelection, selectedWorkout));
  const selectedPropConflicts = Boolean(freshStoredSelection && selectedWorkout && !selectedPropMatchesStored);
  const serverWorkoutConflicts = Boolean(freshStoredSelection && currentWorkout && !workoutIdentityMatches(freshStoredSelection, currentWorkout));
  const activeWorkout = freshStoredSelection || selectedWorkout || workout || currentWorkout || null;
  const source = freshStoredSelection
    ? "activeWorkoutSelection"
    : selectedWorkout
      ? "selectedWorkoutProp"
      : workout
        ? "workoutProp"
        : currentWorkout
          ? "serverCurrentWorkout"
          : "none";
  const userSelectedWorkoutWins = Boolean(freshStoredSelection);
  return {
    activeWorkout,
    source,
    userSelectedWorkoutWins,
    selectedPropMatchesStored,
    selectedPropConflicts,
    serverWorkoutConflicts,
    selectionResolution: {
      source,
      priority: freshStoredSelection
        ? "activeWorkoutSelection"
        : selectedWorkout
          ? "selectedWorkoutProp"
          : workout
            ? "workoutProp"
            : "serverCurrentWorkout",
      rule: freshStoredSelection
        ? "userSelectedWorkout wins for this request"
        : "server/default fallback only because no fresh user selection exists",
      userSelectedWorkoutWinsForThisRequest: userSelectedWorkoutWins,
      selectedPropMatchesStored,
      selectedPropConflicts,
      serverWorkoutConflicts,
      storedWorkoutId: workoutIdFrom(freshStoredSelection),
      storedWorkoutTitle: workoutTitleFrom(freshStoredSelection),
      selectedPropWorkoutId: workoutIdFrom(selectedWorkout),
      selectedPropWorkoutTitle: workoutTitleFrom(selectedWorkout),
      serverWorkoutId: workoutIdFrom(currentWorkout),
      serverWorkoutTitle: workoutTitleFrom(currentWorkout),
    },
  };
}

function workoutContextText(activeWorkout = null, selectedWorkoutId = "", selectedWorkoutTitle = "", serverWorkout = null) {
  const title = cleanText(selectedWorkoutTitle || activeWorkout?.title);
  const workoutId = cleanText(selectedWorkoutId || activeWorkout?.workoutId || activeWorkout?.workout_id || activeWorkout?.lessonId || activeWorkout?.lesson_id);
  if (!title && !workoutId) return "";
  const status = cleanText(activeWorkout?.uiStatus || activeWorkout?.status || "in_progress");
  const dayNumber = activeWorkout?.lessonNumber || (Number.isFinite(Number(activeWorkout?.index)) ? Number(activeWorkout.index) + 1 : null);
  const parts = [
    "IMPORTANT ACTIVE WORKOUT OVERRIDE:",
    title ? `The user is currently viewing/selecting this FruitFit workout: ${title}.` : "",
    dayNumber ? `Workout day number: ${dayNumber}.` : "",
    workoutId ? `Workout ID: ${workoutId}.` : "",
    status ? `UI workout status: ${status}.` : "",
    serverWorkout?.title && serverWorkout.title !== title ? `Server default workout may be "${serverWorkout.title}", but the user manually selected the workout above in the app.` : "",
    "For this answer, use the manually selected workout above. Ignore older workout names and server default workout if they conflict.",
  ].filter(Boolean);
  return parts.join(" ");
}

function messagesWithSelectedWorkout(messages = [], activeWorkout = null, selectedWorkoutId = "", selectedWorkoutTitle = "", serverWorkout = null) {
  const contextText = workoutContextText(activeWorkout, selectedWorkoutId, selectedWorkoutTitle, serverWorkout);
  const recentMessages = (Array.isArray(messages) ? messages : []).slice(-12);
  if (!contextText) return recentMessages;
  const lastUserIndex = [...recentMessages].reverse().findIndex((item) => item?.role === "user");
  if (lastUserIndex < 0) {
    return [...recentMessages, { role: "user", content: contextText }].slice(-12);
  }
  const targetIndex = recentMessages.length - 1 - lastUserIndex;
  return recentMessages.map((item, index) => {
    if (index !== targetIndex) return item;
    return {
      ...item,
      content: `${contextText}\n\nUser question: ${String(item.content || "").trim()}`.trim(),
    };
  });
}

export default function CoachScreen({ program, workout, selectedWorkout = null, selectedWorkoutId = "", selectedWorkoutTitle = "", profile, programAssignment, onNavigate }) {
  const welcomeMessage = useMemo(() => coachWelcomeMessage(profile), [profile?.firstName, profile?.first_name]);
  const [messages, setMessages] = useState(loadCoachChatHistory);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiConsentState, setAiConsentState] = useState(() => ({ userId: currentUserId(), accepted: loadAiCoachConsent() }));
  const [aiConsentOpen, setAiConsentOpen] = useState(false);
  const [pendingConsentText, setPendingConsentText] = useState("");
  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const displayMessages = messages.length ? messages : [welcomeMessage];
  const aiConsentAccepted = Boolean(aiConsentState.accepted);
  const lastMessageKey = displayMessages.length
    ? displayMessages[displayMessages.length - 1]?.id || displayMessages[displayMessages.length - 1]?.content
    : "";
  const scrollChatToBottom = useCallback((behavior = "auto") => {
    const scroll = () => {
      const list = listRef.current;
      if (list) {
        list.scrollTo({ top: list.scrollHeight, behavior });
      }
      bottomRef.current?.scrollIntoView({ block: "end", behavior });
    };
    scroll();
    window.requestAnimationFrame(() => {
      scroll();
      window.requestAnimationFrame(scroll);
    });
  }, []);

  useEffect(() => {
    function syncChatHistory() {
      setMessages(loadCoachChatHistory());
      const userId = currentUserId();
      setAiConsentState({ userId, accepted: loadAiCoachConsent(userId) });
    }
    syncChatHistory();
    window.addEventListener("fruitfit:auth-updated", syncChatHistory);
    window.addEventListener("storage", syncChatHistory);
    return () => {
      window.removeEventListener("fruitfit:auth-updated", syncChatHistory);
      window.removeEventListener("storage", syncChatHistory);
    };
  }, []);

  useLayoutEffect(() => {
    scrollChatToBottom("auto");
  }, [scrollChatToBottom]);

  useEffect(() => {
    scrollChatToBottom(messages.length ? "smooth" : "auto");
  }, [lastMessageKey, displayMessages.length, loading, messages.length, scrollChatToBottom]);

  function acceptAiConsent() {
    const userId = currentUserId();
    saveAiCoachConsent(userId);
    setAiConsentState({ userId, accepted: true });
    setAiConsentOpen(false);
    const text = pendingConsentText;
    setPendingConsentText("");
    if (text) window.setTimeout(() => send(text, { skipConsent: true }), 0);
  }

  function cancelAiConsent() {
    setAiConsentOpen(false);
    setPendingConsentText("");
  }

  async function send(text = input, options = {}) {
    const content = String(text || "").trim();
    if (!content || loading) return;
    if (!options.skipConsent && !aiConsentAccepted) {
      setPendingConsentText(content);
      setAiConsentOpen(true);
      return;
    }

    const userId = currentUserId();
    const userMessage = createCoachChatMessage("user", content, userId);
    if (!userId || !userMessage) {
      setMessages([]);
      setInput("");
      setLoading(true);
      try {
        await askFruitFitCoach(content);
      } catch (error) {
        setMessages([{
          id: "auth-required",
          userId: "",
          role: "assistant",
          content: error.message || "Р’РѕР№РґРёС‚Рµ РІ Р°РєРєР°СѓРЅС‚, С‡С‚РѕР±С‹ РїРѕР»СЊР·РѕРІР°С‚СЊСЃСЏ AI Coach.",
          createdAt: new Date().toISOString(),
        }]);
      } finally {
        setLoading(false);
      }
      return;
    }

    const next = saveCoachChatHistory([...messages, userMessage], userId);
    setMessages(next);
    setInput("");
    scrollChatToBottom("smooth");
    setLoading(true);

    try {
      const directNutritionAnswer = await answerDirectNutritionQuestion(content);
      if (directNutritionAnswer) {
        const assistantMessage = createCoachChatMessage("assistant", directNutritionAnswer, userId);
        setMessages(saveCoachChatHistory([...next, assistantMessage], userId));
        return;
      }

      resetStaleWorkoutState({ userId, reason: "coach-send" });
      let freshAssignment = programAssignment;
      try {
        freshAssignment = await fetchProgramAssignment();
      } catch (_) {
        freshAssignment = programAssignment;
      }
      const currentWorkout = serverCurrentWorkoutFromAssignment(freshAssignment || programAssignment);
      const contextMessages = coachMessagesForContext(next, userId);
      const storedWorkoutSelection = readUserCoreField("activeWorkoutSelection", userId, null);
      const activeSelection = resolveActiveWorkoutSelection({
        userId,
        storedWorkoutSelection,
        selectedWorkout,
        workout,
        currentWorkout,
      });
      const activeSelectedWorkout = activeSelection.activeWorkout;
      const activeSelectedWorkoutId = cleanText(workoutIdFrom(activeSelectedWorkout) || selectedWorkoutId);
      const activeSelectedWorkoutTitle = cleanText(workoutTitleFrom(activeSelectedWorkout) || selectedWorkoutTitle);
      const payloadMessages = messagesWithSelectedWorkout(contextMessages, activeSelectedWorkout, activeSelectedWorkoutId, activeSelectedWorkoutTitle, currentWorkout);
      const context = buildAiCoachClientContext({
        profile,
        programAssignment: freshAssignment || programAssignment,
        currentWorkout: activeSelectedWorkout || currentWorkout,
        serverCurrentWorkout: currentWorkout,
        selectedWorkoutId: activeSelectedWorkoutId,
        selectedWorkoutTitle: activeSelectedWorkoutTitle,
        selectionResolution: activeSelection.selectionResolution,
        debugWorkoutHint: workout,
        messages: payloadMessages,
      });
      console.info("[FruitFit currentWorkout] AI_PAYLOAD_WORKOUT", {
        selectionSource: activeSelection.source,
        workoutId: activeSelectedWorkout?.workoutId || activeSelectedWorkout?.workout_id || null,
        title: activeSelectedWorkoutTitle || activeSelectedWorkout?.title || null,
        lessonNumber: activeSelectedWorkout?.lessonNumber || null,
        selectedWorkoutId: activeSelectedWorkoutId || null,
        selectedWorkoutTitle: activeSelectedWorkoutTitle || null,
        selectedWorkoutStatus: activeSelectedWorkout?.uiStatus || activeSelectedWorkout?.status || null,
        selectedPropConflicts: activeSelection.selectedPropConflicts,
        serverWorkoutConflicts: activeSelection.serverWorkoutConflicts,
        userSelectedWorkoutWinsForThisRequest: activeSelection.userSelectedWorkoutWins,
        serverWorkoutId: currentWorkout?.workoutId || null,
        serverWorkoutTitle: currentWorkout?.title || null,
        hasServerWorkout: Boolean(currentWorkout),
        sentMessages: payloadMessages.length,
      });
      const answer = await askFruitFitCoach(content, {
        messages: payloadMessages,
        context,
        selectedWorkoutId: activeSelectedWorkoutId,
        selectedWorkoutTitle: activeSelectedWorkoutTitle,
      });
      const assistantMessage = createCoachChatMessage("assistant", answer, userId);
      setMessages(saveCoachChatHistory([...next, assistantMessage], userId));
    } catch (error) {
      const assistantMessage = createCoachChatMessage("assistant", error.message || "AI Coach временно недоступен.", userId);
      setMessages(saveCoachChatHistory([...next, assistantMessage], userId));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="phone-shell flex min-h-screen flex-col overflow-hidden pb-[calc(134px+env(safe-area-inset-bottom))]">
      <div className="coach-safe-top shrink-0 px-4">
        <header className="flex items-start justify-between">
          <div>
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-appDark text-appGreen">
              <Bot size={22} />
            </div>
            <h1 className="mt-4 text-[26px] font-black text-appText">AI Coach</h1>
            <p className="mt-2 text-[13px] text-appMuted">Тренер внутри FruitFit. Помогает с программой, нагрузкой, питанием и восстановлением.</p>
          </div>
          <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-appGreen/60 px-3 py-1.5 text-[11px] font-bold text-[#181F19]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#6EAA24]" /> online
          </span>
        </header>

        <section className="mt-4 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
          {starters.map((item) => (
            <button key={item} type="button" onClick={() => send(item)} className="shrink-0 rounded-full bg-appCard px-3 py-2 text-left text-[12px] font-semibold text-appText shadow-sm">
              {item}
            </button>
          ))}
        </section>
      </div>

      <section ref={listRef} className="mt-2 min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-[calc(104px+env(safe-area-inset-bottom))]">
        {displayMessages.map((message, index) => (
          <div key={message.id || index} className={`max-w-[86%] rounded-[20px] px-4 py-3 text-[13px] leading-5 shadow-sm ${message.role === "user" ? "ml-auto bg-appGreen text-[#181F19]" : "bg-appCard text-appText"}`}>
            {message.content}
          </div>
        ))}
        {loading && <ThinkingDots />}
        <div ref={bottomRef} aria-hidden="true" className="h-px" />
      </section>

      <div className="fixed-shell fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-30 -translate-x-1/2 px-4">
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2 rounded-full border border-appBorder bg-appCard p-2 shadow-card">
          <input value={input} onFocus={() => scrollChatToBottom("smooth")} onChange={(event) => setInput(event.target.value)} placeholder="Спроси AI Coach..." className="min-w-0 flex-1 bg-transparent px-3 text-[14px] text-appText outline-none" />
          <button type="submit" disabled={loading} className="grid h-10 w-10 place-items-center rounded-full bg-appDark text-appGreen disabled:opacity-55">
            <Send size={17} />
          </button>
        </form>
      </div>
      {aiConsentOpen && <AiConsentModal onAccept={acceptAiConsent} onCancel={cancelAiConsent} />}
      <BottomNavigation active="coach" onNavigate={onNavigate} />
    </main>
  );
}
