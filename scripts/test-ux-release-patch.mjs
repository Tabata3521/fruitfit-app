import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

const [home, profile, onboarding, trainerRequest, appIconStore, appIconSettings, manifest, nativePlugin, app, workouts, workout, completion, engagement, widgets] = await Promise.all([
  source("src/screens/HomeScreen.jsx"),
  source("src/screens/ProfileScreen.jsx"),
  source("src/screens/OnboardingQuiz.jsx"),
  source("src/screens/TrainerRequestScreen.jsx"),
  source("src/data/appIconStore.js"),
  source("src/components/AppIconSettings.jsx"),
  source("android/app/src/main/AndroidManifest.xml"),
  source("android/app/src/main/java/com/tagirfruit/fruitfit/FruitFitAppIconPlugin.java"),
  source("src/App.jsx"),
  source("src/screens/WorkoutsScreen.jsx"),
  source("src/screens/WorkoutScreen.jsx"),
  source("src/data/workoutCompletion.js"),
  source("src/components/EngagementPrompt.jsx"),
  source("src/components/WidgetGrid.jsx"),
]);

assert.match(home, /Персональное сопровождение/);
assert.match(home, /Отправь мне анкету/);
assert.match(home, /h-9 w-full/);
assert.doesNotMatch(home, /Отправьте анкету тренеру/);

assert.match(trainerRequest, /trainerRequestSubmissionProfile\(profile \|\| \{\}\)/);
assert.match(trainerRequest, /submit: true/);
assert.doesNotMatch(trainerRequest, /trainerRequestPageUrl|window\.open|Browser/);
assert.match(trainerRequest, /profile\.trainingFrequency \|\| profile\.training_frequency/);
assert.match(trainerRequest, /profile\.experience \|\| profile\.level/);
assert.match(trainerRequest, /beginner: "Новичок"/);
assert.match(trainerRequest, /intermediate: "С опытом"/);
assert.match(trainerRequest, /less_than_6_months: "Новичок"/);
assert.match(trainerRequest, /more_than_1_year: "С опытом"/);
assert.match(trainerRequest, /muscle_gain: "Набор мышечной массы"/);
assert.match(trainerRequest, /profile\.dietType \|\| profile\.diet_type/);
assert.match(trainerRequest, /recommendedCaloriesTarget/);
assert.match(trainerRequest, /restrictions: restrictions\.join\(", "\)/);
assert.match(profile, /onNavigate\?\.\("trainerRequest", \{ source: "profile-program-card" \}\)/);

assert.match(profile, /subtitle: `\$\{previewWorkoutCount\(access, programAssignment\)\} тренировки/);
assert.match(profile, /ringLabel: ACCESS_INFINITY_LABEL/);
assert.match(profile, /ringLabel: daysLeft == null \? ACCESS_INFINITY_LABEL : String/);

assert.match(onboarding, /IntersectionObserver/);
assert.match(onboarding, /scrollIntoView\(\{ behavior: "smooth", block: "end" \}\)/);
assert.match(onboarding, /aria-label="Прокрутить к кнопке Дальше"/);
assert.match(onboarding, /ref=\{footerRef\}/);

assert.match(appIconStore, /platform !== "ios" && platform !== "android"/);
assert.doesNotMatch(appIconStore, /getPlatform\(\) !== "ios"/);
assert.match(appIconStore, /FruitFitAppIcon\.setAlternateIcon/);
assert.match(appIconSettings, /Выбери фруктовый ярлык\./);
assert.doesNotMatch(appIconSettings, /web\/PWA|iPhone/);

for (const alias of ["MainActivityOrange", "MainActivityPear", "MainActivityApple", "MainActivityStrawberry"]) {
  assert.match(manifest, new RegExp(alias));
  assert.match(nativePlugin, new RegExp(alias));
}

assert.doesNotMatch(workouts, /completedUntil|safeSourceIndex <=/);
assert.match(workouts, /isWorkoutCompleted\(workout\.workout_id\)/);
assert.match(workout, /markWorkoutCompleted\(workout\.workout_id/);
assert.match(completion, /writeWorkoutHistoryField\(COMPLETED_WORKOUTS_FIELD/);
assert.match(app, /workoutDetailOpenRef\.current = true/);
assert.match(app, /targetScreen = "workout"/);
assert.match(engagement, /onNavigate\?\.\("trainerRequest"/);
assert.doesNotMatch(engagement, /openProfileProgramAction/);
assert.match(widgets, /onNavigate\?\.\("trainerRequest"/);
assert.doesNotMatch(widgets, /openLectureProgramAction/);
assert.doesNotMatch(`${home}\n${profile}\n${trainerRequest}\n${engagement}\n${widgets}`, /tagirfruit\.ru\/trainer-request/);

console.log("UX release patch checks passed.");
