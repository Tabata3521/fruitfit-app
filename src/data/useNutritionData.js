import { useEffect, useMemo, useState } from "react";
import { apiUrl, getAuthToken } from "./authStore";
import {
  activeNutritionData,
  bundledNutritionCatalog,
  isValidNutritionData,
  loadBundledNutritionCatalog,
  nutritionCacheMatches,
  readCachedNutritionData,
  writeCachedNutritionData,
} from "./nutritionCatalogStore";
import { currentUserId } from "./userScopedCache";

export function useNutritionData({ profile = {}, fullCatalog = false } = {}) {
  const userId = currentUserId();
  const profileKey = JSON.stringify({
    ration: profile?.nutritionAssignment?.ration || profile?.nutrition_assignment?.ration || profile?.dietType || profile?.diet_type || "",
    calories: profile?.nutritionAssignment?.caloriesTarget
      || profile?.nutrition_assignment?.calories_target
      || profile?.recommendedCaloriesTarget
      || profile?.recommended_calories_target
      || profile?.calculatedCalories
      || profile?.calculated_calories
      || "",
  });
  const initialData = useMemo(
    () => activeNutritionData(profile, { fullCatalog, userId }),
    [fullCatalog, profileKey, userId]
  );
  const [state, setState] = useState(() => ({
    ownerId: userId,
    loading: !isValidNutritionData(initialData),
    error: "",
    data: initialData,
    source: initialData === bundledNutritionCatalog() ? "bundled" : "cache",
  }));

  useEffect(() => {
    let mounted = true;
    const token = getAuthToken();
    const cached = readCachedNutritionData({ profile, fullCatalog, userId });
    const fallback = cached || bundledNutritionCatalog();
    setState({
      ownerId: userId,
      loading: !cached,
      error: "",
      data: fallback,
      source: cached ? "cache" : "bundled",
    });

    const useBundledFallback = async (errorMessage = "") => {
      try {
        const bundled = await loadBundledNutritionCatalog();
        if (mounted) {
          setState({
            ownerId: userId,
            loading: false,
            error: errorMessage,
            data: bundled,
            source: "bundled",
          });
        }
      } catch (error) {
        if (mounted) {
          setState({
            ownerId: userId,
            loading: false,
            error: errorMessage || error?.message || "Не удалось загрузить рацион",
            data: fallback,
            source: cached ? "cache" : "bundled",
          });
        }
      }
    };

    if (!userId || !token) {
      if (!cached) void useBundledFallback();
      return () => {
        mounted = false;
      };
    }

    const suffix = fullCatalog ? "?catalog=1" : "";
    fetch(apiUrl(`/api/me/nutrition-plan${suffix}`), {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось обновить рацион");
        return response.json();
      })
      .then((data) => {
        if (!isValidNutritionData(data)) throw new Error("Сервер вернул некорректный рацион");
        if (!nutritionCacheMatches(data, { profile, fullCatalog, userId })) {
          throw new Error("Рацион не соответствует текущему профилю");
        }
        writeCachedNutritionData(data, userId);
        if (mounted) {
          setState({
            ownerId: userId,
            loading: false,
            error: "",
            data,
            source: "server",
          });
        }
      })
      .catch((error) => {
        if (cached && mounted) {
          setState({
            ownerId: userId,
            loading: false,
            error: error?.message || "Не удалось обновить рацион",
            data: cached,
            source: "cache",
          });
        } else {
          void useBundledFallback(error?.message || "Не удалось обновить рацион");
        }
      });

    return () => {
      mounted = false;
    };
  }, [fullCatalog, profileKey, userId]);

  const safeState = state.ownerId === userId
    ? state
    : {
      ownerId: userId,
      loading: !isValidNutritionData(initialData),
      error: "",
      data: initialData,
      source: initialData === bundledNutritionCatalog() ? "bundled" : "cache",
    };
  return useMemo(() => safeState, [safeState]);
}

export function getMealPlan(data, filters) {
  if (!data?.meals?.length) return { meals: [], totals: { calories: 0, protein: 0, fat: 0, carbs: 0 }, mealsCount: 0 };

  const planKey = `${filters.ration}|${Number(filters.caloriesTarget)}|${filters.day}`;
  const selectedIds = data?.plans?.[planKey]?.mealIds || [];
  const mealById = new Map(data.meals.map((meal) => [String(meal.id), meal]));
  const plannedMeals = selectedIds.map((id) => mealById.get(String(id))).filter(Boolean);
  const rawMeals = (plannedMeals.length ? plannedMeals : data.meals.filter((meal) => (
    meal.rations.includes(filters.ration)
      && meal.caloriesTargets.includes(Number(filters.caloriesTarget))
      && meal.day === filters.day
  ))).filter((meal) => !filters.mealType || meal.mealType === filters.mealType);

  const uniqueMeals = [];
  const seenTypes = new Set();
  for (const meal of rawMeals) {
    if (!seenTypes.has(meal.mealType)) {
      seenTypes.add(meal.mealType);
      uniqueMeals.push(meal);
    }
  }

  const totals = uniqueMeals.reduce((acc, meal) => ({
    calories: acc.calories + Number(meal.calories || 0),
    protein: acc.protein + Number(meal.protein || 0),
    fat: acc.fat + Number(meal.fat || 0),
    carbs: acc.carbs + Number(meal.carbs || 0),
  }), { calories: 0, protein: 0, fat: 0, carbs: 0 });

  return {
    meals: uniqueMeals,
    totals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value)])),
    mealsCount: uniqueMeals.length,
  };
}
