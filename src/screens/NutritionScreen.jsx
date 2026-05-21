import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Flame, Salad } from "lucide-react";
import { useMemo, useState } from "react";
import BottomNavigation from "../components/BottomNavigation";
import { dietTypeToRation } from "../data/profileStore";
import { getMealPlan, useNutritionData } from "../data/useNutritionData";

const defaultFilters = {
  ration: "Рыбоеды",
  caloriesTarget: 1800,
  day: "Понедельник",
  mealType: "",
};

function SelectPill({ value, options, onChange }) {
  const labelFor = (option) => ({
    "Без ограничений": "Обычное питание",
    "Мясоеды": "Люблю мясо",
    "Рыбоеды": "Люблю рыбу",
  }[option] || option || "Все приёмы");
  return (
    <label className="relative min-w-0">
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-full border border-appBorder bg-appCard px-3 pr-8 text-[12px] font-bold text-appText outline-none">
        {options.map((option) => <option key={option} value={option}>{labelFor(option)}</option>)}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3 text-appMuted" />
    </label>
  );
}

function ChoiceChips({ value, options, onChange, label }) {
  const labelFor = (option) => ({
    "Р‘РµР· РѕРіСЂР°РЅРёС‡РµРЅРёР№": "РћР±С‹С‡РЅРѕРµ РїРёС‚Р°РЅРёРµ",
    "РњСЏСЃРѕРµРґС‹": "Р›СЋР±Р»СЋ РјСЏСЃРѕ",
    "Р С‹Р±РѕРµРґС‹": "Р›СЋР±Р»СЋ СЂС‹Р±Сѓ",
  }[option] || option || "Р’СЃРµ РїСЂРёС‘РјС‹");
  const visibleOptions = (options || []).filter((option) => option !== undefined && option !== null);
  return (
    <div className="min-w-0">
      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-appMuted">{label}</p>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visibleOptions.map((option) => {
          const active = String(option) === String(value);
          return (
            <button
              key={String(option)}
              type="button"
              onClick={() => onChange(option)}
              className={`shrink-0 rounded-2xl border px-3 py-2 text-[12px] font-extrabold transition ${
                active
                  ? "border-[#9DFF57] bg-[#DDF7B4] text-[#101811] shadow-[0_10px_26px_rgba(157,255,87,0.16)]"
                  : "border-appBorder bg-appCard text-appText active:scale-[0.98]"
              }`}
            >
              {Number.isFinite(Number(option)) ? `${option} ккал` : labelFor(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MealSkeleton() {
  return (
    <div className="grid min-h-[126px] grid-cols-[96px_1fr] gap-3 rounded-[22px] border border-appBorder bg-appCard/82 p-3">
      <div className="animate-pulse rounded-[18px] bg-appBg" />
      <div className="space-y-3 py-1">
        <div className="h-4 w-3/4 animate-pulse rounded-full bg-appBg" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-appBg" />
        <div className="h-8 w-full animate-pulse rounded-2xl bg-appBg" />
      </div>
    </div>
  );
}

function MealCard({ meal }) {
  const [open, setOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  return (
    <motion.article layout className="overflow-hidden rounded-[22px] border border-appBorder bg-appCard shadow-sm">
      <button type="button" onClick={() => setOpen((value) => !value)} className="grid w-full grid-cols-[104px_1fr] gap-3 p-3 text-left">
        <div className="relative h-[104px] overflow-hidden rounded-[18px] bg-appBg">
          {!imageLoaded && <div className="absolute inset-0 animate-pulse bg-appBg" />}
          {meal.photo ? <img src={meal.photo} alt={meal.title} loading="lazy" onLoad={() => setImageLoaded(true)} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-appMuted"><Salad size={24} /></div>}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[#FFF0E0] px-2 py-1 text-[10px] font-bold text-appOrange">{meal.mealType}</span>
            <span className="text-[11px] text-appMuted">{meal.day}</span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-[15px] font-black leading-[18px] text-appText">{meal.title}</h3>
          <p className="mt-2 text-[12px] text-appMuted">{meal.calories} ккал • Б {meal.protein} / Ж {meal.fat} / У {meal.carbs}</p>
          <p className="mt-2 text-[11px] font-semibold text-[#8BBE3D]">{open ? "Свернуть рецепт" : "Открыть рецепт"}</p>
        </div>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-t border-appBorder px-4 pb-4">
            {!!meal.ingredients?.length && (
              <>
                <h4 className="mt-3 text-[12px] font-black uppercase text-appMuted">Ингредиенты</h4>
                <ul className="mt-2 space-y-1 text-[12px] leading-5 text-appText">
                  {meal.ingredients.slice(0, 10).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </>
            )}
            {meal.recipe && (
              <>
                <h4 className="mt-3 text-[12px] font-black uppercase text-appMuted">Рецепт</h4>
                <p className="mt-2 text-[12px] leading-5 text-appText">{meal.recipe}</p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

function nutritionLabel(value) {
  return {
    "Без ограничений": "Обычное питание",
    "Мясоеды": "Люблю мясо",
    "Рыбоеды": "Люблю рыбу",
  }[value] || value;
}

export default function NutritionScreen({ onNavigate, profile }) {
  const { loading, data } = useNutritionData();
  const [filters, setFilters] = useState(() => ({
    ...defaultFilters,
    ration: dietTypeToRation[profile?.dietType] || defaultFilters.ration,
    caloriesTarget: profile?.recommendedCaloriesTarget || defaultFilters.caloriesTarget,
  }));
  const mealTypeOptions = useMemo(() => ["", ...(data?.filters?.mealTypes || [])], [data]);
  const activeFilters = useMemo(() => {
    const rations = data?.filters?.rations || [];
    const calorieTargets = data?.filters?.caloriesTargets || [];
    const days = data?.filters?.days || [];
    const mealTypes = data?.filters?.mealTypes || [];
    return {
      ration: rations.includes(filters.ration) ? filters.ration : (rations.includes("Рыбоеды") ? "Рыбоеды" : rations[0] || filters.ration),
      caloriesTarget: calorieTargets.includes(Number(filters.caloriesTarget)) ? Number(filters.caloriesTarget) : (calorieTargets.includes(1800) ? 1800 : calorieTargets[0] || filters.caloriesTarget),
      day: days.includes(filters.day) ? filters.day : (days.includes("Понедельник") ? "Понедельник" : days[0] || filters.day),
      mealType: !filters.mealType || mealTypes.includes(filters.mealType) ? filters.mealType : "",
    };
  }, [data, filters]);
  const plan = useMemo(() => getMealPlan(data, activeFilters), [data, activeFilters]);

  function update(key, value) {
    setFilters((current) => ({ ...current, [key]: key === "caloriesTarget" ? Number(value) : value }));
  }

  return (
    <main className="phone-shell pb-[78px]">
      <div className="px-4 pt-5">
        <header>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#FFF0E0] text-appOrange">
            <Salad size={20} />
          </div>
          <h1 className="mt-4 text-[26px] font-black text-appText">Питание</h1>
          <p className="mt-2 text-[13px] text-appMuted">Нативный рацион из CSV: блюда, фото, КБЖУ и рецепты.</p>
        </header>

        <section className="mt-5 rounded-[24px] border border-black/5 bg-[#FFF0E0] p-4 text-[#181F19] shadow-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-bold text-appOrange">{nutritionLabel(activeFilters.ration)}</p>
              <h2 className="mt-1 text-[28px] font-black text-[#181F19]">{plan.totals.calories || activeFilters.caloriesTarget} ккал</h2>
              <p className="mt-1 text-[12px] text-[#667064]">Б {plan.totals.protein} / Ж {plan.totals.fat} / У {plan.totals.carbs}</p>
              <p className="mt-2 text-[12px] font-semibold text-[#181F19]">{plan.mealsCount} приёмов пищи</p>
            </div>
            <div className="relative h-[86px] w-[86px] rounded-full bg-[conic-gradient(#DDF7B4_0_42%,#FFD8B5_42%_72%,#FF7A2F_72%_100%)]">
              <div className="absolute inset-5 rounded-full bg-[#FFF0E0]" />
              <Flame size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-appOrange" />
            </div>
          </div>
        </section>

        <section className="mt-4 space-y-4 rounded-[24px] border border-appBorder bg-appCard/80 p-4 shadow-sm">
          <ChoiceChips label="Тип питания" value={activeFilters.ration} options={data?.filters?.rations || [activeFilters.ration]} onChange={(value) => update("ration", value)} />
          <ChoiceChips label="Калорийность плана" value={activeFilters.caloriesTarget} options={data?.filters?.caloriesTargets || [activeFilters.caloriesTarget]} onChange={(value) => update("caloriesTarget", value)} />
          <ChoiceChips label="День" value={activeFilters.day} options={data?.filters?.days || [activeFilters.day]} onChange={(value) => update("day", value)} />
          <ChoiceChips label="Прием пищи" value={activeFilters.mealType} options={mealTypeOptions} onChange={(value) => update("mealType", value)} />
        </section>

        <section className="mt-4 space-y-3">
          {loading && Array.from({ length: 4 }).map((_, index) => <MealSkeleton key={index} />)}
          {!loading && plan.meals.map((meal) => <MealCard key={meal.id} meal={meal} />)}
          {!loading && !plan.meals.length && (
            <div className="rounded-[22px] border border-appBorder bg-appCard p-5 text-center text-[13px] text-appMuted">
              Для выбранных фильтров блюд не найдено.
            </div>
          )}
        </section>
      </div>
      <BottomNavigation active="food" onNavigate={onNavigate} />
    </main>
  );
}
