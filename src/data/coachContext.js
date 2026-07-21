import { legacyRestrictionValue, normalizeRestrictionKeys } from "./profileStore";

export function buildCoachContext({
  profile,
  workout,
  exercise,
  setNumber,
  weights,
  nutrition,
  recovery,
  health,
  measurements,
} = {}) {
  return {
    profile: profile ? {
      gender: profile.gender,
      goal: profile.goal,
      age: profile.age,
      height: profile.height,
      weight: profile.weight,
      restrictionKeys: normalizeRestrictionKeys(profile.restrictionKeys, profile.restrictions),
      restrictions: legacyRestrictionValue(profile.restrictionKeys ?? profile.restrictions),
    } : null,
    workout: workout ? {
      id: workout.id,
      title: workout.title,
      day: workout.day,
      goal: workout.goal,
    } : null,
    exercise: exercise ? {
      id: exercise.id,
      name: exercise.name || exercise.title,
      muscleGroup: exercise.muscleGroup || exercise.muscle_group,
      pattern: exercise.didacticPattern || exercise.pattern,
      restrictions: exercise.restrictions || [],
    } : null,
    set: {
      setNumber: setNumber || null,
      previousWeight: weights?.previousWeight || null,
      currentWeight: weights?.currentWeight || null,
      history: weights?.history || [],
    },
    nutrition: nutrition || null,
    recovery: recovery || null,
    health: health ? {
      heartRate: health.heartRate || health.heart,
      steps: health.steps,
      calories: health.calories,
      sleep: health.sleep,
      sources: health.sources,
    } : null,
    measurements: measurements || [],
  };
}
