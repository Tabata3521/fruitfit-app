import { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, ArrowRight, Check, ChevronDown, X } from "lucide-react";
import RestrictionMultiSelect from "../components/RestrictionMultiSelect";
import { legacyRestrictionValue, normalizeProfile, profileDefaults, saveProfile } from "../data/profileStore";

const HEALTH_PROVIDER_NAME = Capacitor.getPlatform?.() === "android" ? "Google Health Connect" : "Apple Health";

const steps = [
  {
    key: "gender",
    title: "Твой пол",
    options: [
      ["male", "Мужчина"],
      ["female", "Женщина"],
    ],
  },
  {
    key: "goal",
    title: "Какая у тебя основная цель?",
    options: ["Поддержание формы", "Похудение", "Набор мышечной массы"],
  },
  {
    key: "trainingFrequency",
    title: "Сколько раз в неделю ты готов тренироваться?",
    options: ["2 раза в неделю", "3 раза в неделю"],
    labels: {
      "2 раза в неделю": "2 раза",
      "3 раза в неделю": "3 раза",
    },
  },
  {
    key: "restrictionKeys",
    title: "Есть ли у тебя ограничения или дискомфорт?",
    multiple: true,
    options: [],
  },
  {
    key: "experience",
    title: "Какой у тебя уровень подготовки?",
    options: ["Новичок", "С опытом"],
  },
  {
    key: "dietType",
    title: "Какой тип питания тебе ближе?",
    options: ["Обычное питание", "Люблю мясо", "Люблю рыбу", "Вегетарианство", "Без лактозы", "Без глютена", "Без глютена и без лактозы"],
  },
];

function optionParts(option, labels = {}) {
  const value = Array.isArray(option) ? option[0] : option;
  return {
    value,
    label: Array.isArray(option) ? option[1] : labels[value] || option,
  };
}

export default function OnboardingQuiz({
  initialProfile = profileDefaults,
  onComplete,
  onCancel,
  restart = false,
  requireAccountChoice = false,
}) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(() => normalizeProfile(initialProfile));
  const [completedProfile, setCompletedProfile] = useState(null);
  const [showDietScrollHint, setShowDietScrollHint] = useState(false);
  const footerRef = useRef(null);
  const step = steps[index];
  const progress = Math.round(((index + 1) / steps.length) * 100);
  const options = useMemo(() => step.options.map((option) => optionParts(option, step.labels)), [step]);
  const selected = draft[step.key];

  useEffect(() => {
    if (step.key !== "dietType" || !footerRef.current) {
      setShowDietScrollHint(false);
      return undefined;
    }

    const footer = footerRef.current;
    const observer = new IntersectionObserver(
      ([entry]) => setShowDietScrollHint(!entry.isIntersecting),
      { threshold: 0.25 },
    );
    observer.observe(footer);
    return () => observer.disconnect();
  }, [step.key]);

  function scrollToFooter() {
    footerRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }

  function choose(value) {
    setDraft((current) => ({ ...current, [step.key]: value }));
  }

  function chooseRestrictions(restrictionKeys) {
    setDraft((current) => ({
      ...current,
      restrictionKeys,
      restrictions: legacyRestrictionValue(restrictionKeys),
    }));
  }

  function next() {
    if (index < steps.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    const saved = saveProfile({ ...draft, onboardingCompleted: true });
    if (requireAccountChoice) {
      setCompletedProfile(saved);
      return;
    }
    onComplete?.(saved);
  }

  if (completedProfile) {
    return (
      <main className="phone-shell flex min-h-screen flex-col bg-appBg px-4 pb-[var(--app-safe-bottom)] pt-[var(--app-safe-top)]">
        <header>
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#6FA62F]">fruitfit</p>
        </header>

        <section className="flex flex-1 flex-col justify-center py-8">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-appGreen text-[#181F19] shadow-card">
            <Check size={36} strokeWidth={3} />
          </div>
          <h1 className="mt-7 text-center text-[30px] font-black leading-tight text-appText">Анкета готова</h1>
          <p className="mx-auto mt-4 max-w-[330px] text-center text-[15px] leading-6 text-appMuted">
            Создай аккаунт, чтобы сохранить ответы анкеты и получить персонально подобранный план тренировок.
          </p>

          <div className="mt-8 rounded-[22px] border border-appBorder bg-appCard p-4 shadow-card">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-appGreen text-[#181F19]">
                <Check size={17} strokeWidth={3} />
              </span>
              <div>
                <p className="text-[14px] font-black text-appText">Ответы уже сохранены</p>
                <p className="mt-1 text-[12px] leading-5 text-appMuted">
                  После входа они будут безопасно перенесены в твой аккаунт.
                </p>
              </div>
            </div>
          </div>
        </section>

        <footer className="grid gap-3 pb-3">
          <button
            type="button"
            onClick={() => onComplete?.(completedProfile, { authMode: "register" })}
            className="flex h-[58px] w-full items-center justify-center gap-2 rounded-full bg-appGreen px-5 text-[16px] font-black text-[#181F19] shadow-card"
          >
            Создать аккаунт
            <ArrowRight size={19} />
          </button>
          <button
            type="button"
            onClick={() => onComplete?.(completedProfile, { authMode: "login" })}
            className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full border border-appBorder bg-appCard px-5 text-[14px] font-black text-appText shadow-sm"
          >
            Уже есть аккаунт? Войти
          </button>
        </footer>
      </main>
    );
  }

  return (
    <main className="phone-shell flex min-h-screen flex-col bg-appBg px-4 pb-[var(--app-safe-bottom)] pt-[var(--app-safe-top)]">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[12px] font-black uppercase tracking-[0.16em] text-[#6FA62F]">fruitfit</p>
          <h1 className="mt-2 text-[26px] font-black leading-tight text-appText">{restart ? "Повторный квиз" : "Настроим программу"}</h1>
          <p className="mt-1 text-[13px] leading-5 text-appMuted">Подберём программу без лишней сложности.</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-appBorder bg-appCard text-appText shadow-sm" aria-label="Закрыть">
            <X size={18} />
          </button>
        )}
      </header>

      <div className="mt-6 rounded-[22px] border border-appBorder bg-appCard p-4 shadow-card">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold text-appMuted">Шаг {index + 1} из {steps.length}</span>
          <span className="text-[12px] font-black text-appText">{progress}%</span>
        </div>
        <div className="mt-3 h-2 rounded-full bg-appBg">
          <div className="h-full rounded-full bg-appGreen transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <section className="mt-6 flex-1">
        <h2 className="text-[28px] font-black leading-tight text-appText">{step.title}</h2>
        {index === steps.length - 1 && (
          <div className="mt-4 rounded-[20px] border border-appBorder bg-appCard px-4 py-3 text-[12px] leading-5 text-appMuted shadow-sm">
            После квиза можно подключить {HEALTH_PROVIDER_NAME}. Это поможет FruitFit учитывать сон, пульс и активность в рекомендациях. Данные нужны только для персонализации и не передаются третьим лицам.
          </div>
        )}
        <div className="mt-5 space-y-3">
          {step.multiple ? (
            <RestrictionMultiSelect value={draft.restrictionKeys} onChange={chooseRestrictions} />
          ) : options.map((option) => {
            const active = selected === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => choose(option.value)}
                className={`flex min-h-16 w-full items-center justify-between rounded-[22px] border px-4 text-left text-[16px] font-black shadow-sm transition ${
                  active
                    ? "border-[#A9D95A] bg-appGreen text-[#181F19]"
                    : "border-appBorder bg-appCard text-appText"
                }`}
              >
                <span className="min-w-0 pr-3">{option.label}</span>
                {active && <Check size={20} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      </section>

      {showDietScrollHint && (
        <button
          type="button"
          onClick={scrollToFooter}
          className="fixed-shell fixed bottom-[calc(24px+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center rounded-full border border-appBorder bg-appCard/95 px-4 py-2 text-center text-[11px] font-black text-appText shadow-card backdrop-blur transition active:scale-95"
          aria-label="Прокрутить к кнопке Дальше"
        >
          <span>К кнопке «Дальше»</span>
          <ChevronDown size={18} className="mt-0.5 animate-bounce text-appGreen" />
        </button>
      )}

      <footer ref={footerRef} className="flex items-center gap-3">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          className="grid h-[52px] w-[52px] place-items-center rounded-full border border-appBorder bg-appCard text-appText shadow-sm disabled:opacity-35"
          aria-label="Назад"
        >
          <ArrowLeft size={19} />
        </button>
        <button
          type="button"
          onClick={next}
          className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-appDark text-[15px] font-black text-appGreen shadow-card"
        >
          {index === steps.length - 1 ? "Готово" : "Дальше"}
          <ArrowRight size={18} />
        </button>
      </footer>
    </main>
  );
}
