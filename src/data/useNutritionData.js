import { useEffect, useMemo, useState } from "react";
import bundledNutritionData from "../../public/data/nutrition.json";

let nutritionCache = bundledNutritionData;

export function useNutritionData() {
  const [state, setState] = useState({ loading: false, error: "", data: nutritionCache });

  useEffect(() => {
    let mounted = true;
    fetch("/data/nutrition.json")
      .then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить питание");
        return response.json();
      })
      .then((data) => {
        nutritionCache = data;
        if (mounted) setState({ loading: false, error: "", data });
      })
      .catch((error) => {
        if (mounted) setState({ loading: false, error: error.message, data: nutritionCache });
      });
    return () => {
      mounted = false;
    };
  }, []);

  return useMemo(() => state, [state]);
}

export function getMealPlan(data, filters) {
  if (!data?.meals?.length) return { meals: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 }, mealsCount: 0 };

  const rawMeals = data.meals.filter((meal) => (
    meal.rations.includes(filters.ration) &&
    meal.caloriesTargets.includes(Number(filters.caloriesTarget)) &&
    meal.day === filters.day &&
    (!filters.mealType || meal.mealType === filters.mealType)
  ));

  // Оставляем только одно блюдо на каждый прием пищи, чтобы варианты не суммировались
  const uniqueMeals = [];
  const seenTypes = new Set();
  for (const meal of rawMeals) {
    if (!seenTypes.has(meal.mealType)) {
      seenTypes.add(meal.mealType);
      uniqueMeals.push(meal);
    }
  }

  const meals = uniqueMeals;

  const totals = meals.reduce((acc, meal) => ({
    calories: acc.calories + Number(meal.calories || 0),
    protein: acc.protein + Number(meal.protein || 0),
    fat: acc.fat + Number(meal.fat || 0),
    carbs: acc.carbs + Number(meal.carbs || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });

  return {
    meals,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value)])),
    mealsCount: meals.length,
  };
}
