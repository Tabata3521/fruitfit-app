import { ArrowRight, ChevronLeft, Mail, UserCheck } from "lucide-react";
import { useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import IconButton from "../components/IconButton";
import { createTrainerRequest, getAuthToken } from "../data/authStore";
import { restrictionLabels } from "../data/profileStore";

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function questionnaireLabel(value, field) {
  const original = compact(value);
  const key = original
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-zа-яё\d]+/gi, "_")
    .replace(/^_+|_+$/g, "");
  const aliases = {
    experience: {
      beginner: "Новичок",
      newbie: "Новичок",
      novice: "Новичок",
      no_experience: "Новичок",
      less_than_6_months: "Новичок",
      up_to_1_year: "Новичок",
      intermediate: "С опытом",
      experienced: "С опытом",
      advanced: "С опытом",
      more_than_1_year: "С опытом",
      one_to_three_years: "С опытом",
      three_plus_years: "С опытом",
    },
    goal: {
      maintain: "Поддержание формы",
      maintenance: "Поддержание формы",
      weight_loss: "Похудение",
      lose_weight: "Похудение",
      fat_loss: "Похудение",
      muscle_gain: "Набор мышечной массы",
      gain_mass: "Набор мышечной массы",
      mass_gain: "Набор мышечной массы",
      gain_muscle: "Набор мышечной массы",
    },
    diet: {
      unrestricted: "Обычное питание",
      no_restrictions: "Обычное питание",
      regular: "Обычное питание",
      omnivore: "Обычное питание",
      meat: "Люблю мясо",
      meat_lover: "Люблю мясо",
      fish: "Люблю рыбу",
      fish_lover: "Люблю рыбу",
      vegetarian: "Вегетарианство",
      lactose_free: "Без лактозы",
      gluten_free: "Без глютена",
      gluten_and_lactose_free: "Без глютена и без лактозы",
      gluten_lactose_free: "Без глютена и без лактозы",
    },
  };
  if (aliases[field]?.[key]) return aliases[field][key];
  if (field === "experience") {
    if (/begin|new|novice|no_experience|less_than|до_?1|без_?опыт/i.test(key)) return "Новичок";
    if (/intermediate|experience|advanced|year|опыт|год/i.test(key)) return "С опытом";
  }
  if (field === "goal") {
    if (/maintain|maintenance|поддерж/i.test(key)) return "Поддержание формы";
    if (/weight_loss|lose|fat_loss|похуд/i.test(key)) return "Похудение";
    if (/muscle|mass|gain|набор/i.test(key)) return "Набор мышечной массы";
  }
  if (field === "diet") {
    if (/gluten.*lactose|lactose.*gluten|глют.*лакт|лакт.*глют/i.test(key)) return "Без глютена и без лактозы";
    if (/lactose|лакт/i.test(key)) return "Без лактозы";
    if (/gluten|глют/i.test(key)) return "Без глютена";
    if (/veget|вегет/i.test(key)) return "Вегетарианство";
    if (/fish|рыб/i.test(key)) return "Люблю рыбу";
    if (/meat|мяс/i.test(key)) return "Люблю мясо";
    if (/unrestricted|regular|omnivore|обыч|без_огранич/i.test(key)) return "Обычное питание";
  }
  return original;
}

function trainingFrequencyLabel(value) {
  const text = compact(value);
  if (/\b3\b/.test(text) || /three|три/i.test(text)) return "3 раза в неделю";
  if (/\b2\b/.test(text) || /two|два/i.test(text)) return "2 раза в неделю";
  return text;
}

function profileRows(profile = {}) {
  const gender = compact(profile.gender).toLowerCase();
  const genderLabel = ["female", "woman", "женщина", "женский"].includes(gender)
    ? "Женщина"
    : ["male", "man", "мужчина", "мужской"].includes(gender) ? "Мужчина" : "";
  const calories = Number(
    profile.recommendedCaloriesTarget
      || profile.recommended_calories_target
      || profile.calculatedCalories
      || profile.calculated_calories
      || 0,
  );
  return [
    ["Пол", genderLabel],
    ["Возраст", profile.age ? `${profile.age} лет` : ""],
    ["Рост", profile.height ? `${profile.height} см` : ""],
    ["Вес", profile.weight ? `${profile.weight} кг` : ""],
    ["Цель", questionnaireLabel(profile.goal || profile.goalKey || profile.goal_key, "goal")],
    ["Тренировки", trainingFrequencyLabel(profile.trainingFrequency || profile.training_frequency || profile.workoutsPerWeek || profile.workouts_per_week)],
    ["Питание", questionnaireLabel(profile.dietType || profile.diet_type || profile.diet || profile.nutritionType || profile.nutrition_type, "diet")],
    ["Опыт", questionnaireLabel(profile.experience || profile.level, "experience")],
    ["Ограничения", restrictionLabels(profile.restrictionKeys ?? profile.restrictions).join(", ")],
    ["Калорийность", calories > 0 ? `${Math.round(calories)} ккал` : ""],
  ].map(([label, value]) => ({ label, value: compact(value) })).filter((item) => item.value);
}

function trainerRequestSubmissionProfile(profile = {}) {
  const restrictions = restrictionLabels(profile.restrictionKeys ?? profile.restrictions);
  const rows = profileRows(profile);
  const valuesByLabel = Object.fromEntries(rows.map((item) => [item.label, item.value]));
  return {
    ...profile,
    gender: valuesByLabel["Пол"] || compact(profile.gender),
    goal: valuesByLabel["Цель"] || compact(profile.goal),
    trainingFrequency: valuesByLabel["Тренировки"] || compact(profile.trainingFrequency || profile.training_frequency),
    dietType: valuesByLabel["Питание"] || compact(profile.dietType || profile.diet_type),
    experience: valuesByLabel["Опыт"] || compact(profile.experience || profile.level),
    restrictions: restrictions.join(", "),
  };
}

export default function TrainerRequestScreen({ profile, onBack, onNavigate, onRequireAuth }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const rows = profileRows(profile);

  async function submit() {
    if (!getAuthToken()) {
      setStatus("Войди или создай аккаунт, чтобы я получил твою анкету.");
      onRequireAuth?.({ reason: "trainer-request" });
      return;
    }
    setLoading(true);
    setStatus("");
    try {
      await createTrainerRequest({
        profile: trainerRequestSubmissionProfile(profile || {}),
        source: "personal-support-form",
        submit: true,
      });
      setStatus("Заявка отправлена. Я изучу твою анкету и свяжусь с тобой по электронной почте.");
    } catch (error) {
      setStatus(error?.message || "Не удалось отправить заявку. Попробуй позже.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="phone-shell safe-tab-screen">
      <div className="safe-top px-4">
        <header className="flex items-center justify-between">
          <IconButton label="Назад" onClick={onBack} className="h-10 w-10"><ChevronLeft size={22} /></IconButton>
          <h1 className="text-[18px] font-black text-appText">Заявка на сопровождение</h1>
          <div className="h-10 w-10" />
        </header>

        <section className="mt-4 rounded-[28px] border border-appBorder bg-appCard p-4 shadow-card">
          <div className="flex items-start gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-appBg text-appText">
              <UserCheck size={23} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-[0.14em] text-appMuted">Персональное сопровождение</p>
              <h2 className="mt-1 text-[24px] font-black leading-tight text-appText">Подать заявку</h2>
              <p className="mt-2 text-[13px] font-semibold leading-5 text-appMuted">
                Я получу твою анкету и подготовлю дальнейший маршрут под твои цели и ограничения.
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-[22px] border border-appBorder bg-appBg p-3">
            <div className="flex items-center gap-2 text-appMuted">
              <Mail size={16} />
              <p className="text-[12px] font-bold">Ответ придёт на почту аккаунта</p>
            </div>
            {rows.length ? (
              <div className="mt-3 grid gap-2">
                {rows.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 rounded-2xl bg-appCard px-3 py-2">
                    <span className="text-[11px] font-black uppercase tracking-[0.08em] text-appMuted">{item.label}</span>
                    <span className="min-w-0 truncate text-right text-[12px] font-black text-appText">{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-2xl bg-appCard px-3 py-3 text-[12px] font-semibold leading-5 text-appMuted">
                Если анкета ещё не заполнена, обнови её в профиле перед отправкой заявки.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={loading}
            className="exercise-replace-button mt-4 flex h-12 w-full items-center justify-between rounded-full px-4 text-[14px] font-black transition active:scale-[0.98] disabled:opacity-70"
          >
            <span>{loading ? "Отправляем..." : "Подать заявку"}</span>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#181F19]/12 text-current">
              <ArrowRight size={17} />
            </span>
          </button>

          {status && <p className="mt-3 rounded-2xl bg-appBg px-3 py-3 text-[12px] font-bold leading-5 text-appText">{status}</p>}
        </section>
      </div>
      <BottomNavigation active="home" onNavigate={onNavigate} />
    </main>
  );
}
