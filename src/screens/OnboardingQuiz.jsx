import { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowLeft, ArrowRight, Check, ChevronDown, X } from "lucide-react";
import { normalizeProfile, profileDefaults, saveProfile } from "../data/profileStore";

const HEALTH_PROVIDER_NAME = Capacitor.getPlatform?.() === "android" ? "Google Health Connect" : "Apple Health";

const steps = [
  {
    key: "gender",
    title: "Ваш пол",
    options: [
      ["male", "Мужчина"],
      ["female", "Женщина"],
    ],
  },
  {
    key: "goal",
    title: "Какая ваша основная цель?",
    options: ["Поддержание формы", "Похудение", "Набор мышечной массы"],
  },
  {
    key: "trainingFrequency",
    title: "Сколько раз в неделю вы готовы тренироваться?",
    options: ["2 раза в неделю", "3 раза в неделю"],
    labels: {
      "2 раза в неделю": "2 раза",
      "3 раза в неделю": "3 раза",
    },
  },
  {
    key: "restrictions",
    title: "Есть ли у вас ограничения или дискомфорт?",
    options: ["Боли в коленях", "Боли в спине", "Боли в плечах", "Боли в тазобедренном суставе", "Нет ограничений"],
  },
  {
    key: "experience",
    title: "Какой у вас уровень подготовки?",
    options: ["Новичок", "С опытом"],
  },
  {
    key: "dietType",
    title: "Какой тип питания вам ближе?",
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

export default function OnboardingQuiz({ initialProfile = profileDefaults, onComplete, onCancel, restart = false }) {
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState(() => normalizeProfile(initialProfile));
  const step = steps[index];
  const showDietScrollHint = step.key === "dietType";
  const progress = Math.round(((index + 1) / steps.length) * 100);
  const options = useMemo(() => step.options.map((option) => optionParts(option, step.labels)), [step]);
  const selected = draft[step.key];

  function choose(value) {
    setDraft((current) => ({ ...current, [step.key]: value }));
  }

  function next() {
    if (index < steps.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    const saved = saveProfile({ ...draft, onboardingCompleted: true });
    onComplete?.(saved);
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
          {options.map((option) => {
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
        <div className="fixed-shell pointer-events-none fixed bottom-[calc(86px+env(safe-area-inset-bottom))] left-1/2 z-30 flex -translate-x-1/2 flex-col items-center px-4">
          <div className="rounded-full border border-appBorder bg-appCard/95 px-4 py-2 text-center text-[11px] font-black text-appText shadow-card backdrop-blur">
          <span>Ниже кнопка Далее</span>
          <ChevronDown size={18} className="mt-0.5 animate-bounce text-appGreen" />
          </div>
        </div>
      )}

      <footer className="flex items-center gap-3">
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
