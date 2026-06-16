import { Bot, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import { askFruitFitCoach } from "../services/openai";

const starters = [
  "Какой вес поставить в следующем подходе?",
  "Что делать, если плохо восстановился?",
  "Чем заменить упражнение без тренажёра?",
  "Как собрать приём пищи на сегодня?",
];

function firstNameFromProfile(profile = {}) {
  return String(profile.firstName || profile.first_name || profile.name || "").trim().split(/\s+/)[0] || "";
}

function coachWelcomeMessage(profile = {}) {
  const firstName = firstNameFromProfile(profile);
  const greeting = firstName ? `Привет, ${firstName}!` : "Привет!";
  return {
    role: "assistant",
    content: `${greeting} Я AI Coach FruitFit - твой помощник по тренировкам, питанию и восстановлению. Меня создал Тагир Мейвалиев для FruitFit, и я здесь, чтобы помогать тебе с программой, нагрузкой, самочувствием и ежедневными решениями.`,
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

export default function CoachScreen({ profile, onNavigate }) {
  const welcomeMessage = useMemo(() => coachWelcomeMessage(profile), [profile?.firstName, profile?.first_name, profile?.name]);
  const [messages, setMessages] = useState(() => [welcomeMessage]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  useEffect(() => {
    setMessages((current) => {
      if (current.length !== 1 || current[0]?.role !== "assistant") return current;
      if (current[0]?.content === welcomeMessage.content) return current;
      return [welcomeMessage];
    });
  }, [welcomeMessage]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function send(text = input) {
    const content = String(text || "").trim();
    if (!content || loading) return;

    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const answer = await askFruitFitCoach(content);
      setMessages([...next, { role: "assistant", content: answer }]);
    } catch (error) {
      setMessages([...next, { role: "assistant", content: error.message || "AI Coach временно недоступен." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="phone-shell flex min-h-screen flex-col pb-[calc(134px+env(safe-area-inset-bottom))]">
      <div className="safe-top px-4">
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

      <section ref={listRef} className="mt-2 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        {messages.map((message, index) => (
          <div key={index} className={`max-w-[86%] rounded-[20px] px-4 py-3 text-[13px] leading-5 shadow-sm ${message.role === "user" ? "ml-auto bg-appGreen text-[#181F19]" : "bg-appCard text-appText"}`}>
            {message.content}
          </div>
        ))}
        {loading && <ThinkingDots />}
      </section>

      <div className="fixed bottom-[calc(72px+env(safe-area-inset-bottom))] left-1/2 z-30 w-full max-w-[393px] -translate-x-1/2 px-4">
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2 rounded-full border border-appBorder bg-appCard p-2 shadow-card">
          <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Спроси AI Coach..." className="min-w-0 flex-1 bg-transparent px-3 text-[14px] text-appText outline-none" />
          <button type="submit" disabled={loading} className="grid h-10 w-10 place-items-center rounded-full bg-appDark text-appGreen disabled:opacity-55">
            <Send size={17} />
          </button>
        </form>
      </div>
      <BottomNavigation active="coach" onNavigate={onNavigate} />
    </main>
  );
}
