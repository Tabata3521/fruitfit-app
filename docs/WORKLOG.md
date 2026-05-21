# FruitFit Worklog

Operational journal for active development. Use this file for small implementation notes so parallel agents can see what changed without reverse-engineering the whole codebase.

## 2026-05-17

### Client UI/UX Polish - Local Only

Scope:

- Worked only in the main FruitFit PWA project.
- Did not deploy and did not touch APK/Android.
- Focused on the current client UI screens and interaction polish.

Changes:

- Replaced generated warm-up placeholders with final PNG warm-up icons in `public/warmup-icons/`.
- Updated the warm-up block copy, joint cues, and cardio/zaminka recommendations.
- Made profile permissions a compact accordion so tracker toggles do not clutter the profile screen.
- Reworked measurements into a cleaner graph-first block with period selector, interactive scrubber, only 3 recent measurements on the profile, and a fullscreen history modal.
- Removed the technical replacement explanation from the exercise replacement bottom sheet and restored button-like borders/active states.
- Replaced the heart condition native select with app-styled option buttons.
- Replaced sleep native time inputs with compact custom +/- time controls and added week/month sleep chart tabs plus short guidance.
- Added short mini-guides for steps, calories, pulse, and sleep details.
- Centered the rest wheel picker more deliberately and kept the maximum set count at 8.

Verification:

- `npm run build` passed.

### Health Cache And Muscle Mapping Stabilization

Date: 2026-05-21

Changes:

- Fixed the health refresh race where debug export could show fresh Zepp/Amazfit data while Dashboard rendered an older Google Fit snapshot.
- Added a single in-flight native health sync guard and commit sequence guard so stale async reads no longer overwrite newer Health Connect payloads.
- Dashboard and health detail pages now trigger Health Connect refresh on mount; provider refreshes on app focus/foreground and every 4 minutes while active.
- Heart-rate source selection now prefers the selected source when it has a recent sample and otherwise falls back to the freshest valid sample.
- Added visible `lastFruitFitRefreshAt` timing on health detail pages and a refresh action in the sticky header.
- Rebuilt `anatomyMuscleMapping.js` from the manual anatomy mapping labels with strict normalization, alias handling, and no fuzzy final assignment.
- Updated muscle template resolution to decode legacy mojibake labels and handle LFK/manual labels safely.
- Removed lock icons from upcoming workout exercise cards without changing workout order.
- Added per-set working weight storage and autofill foundation; set 1/2/3/4 can now keep separate previous weights.
- Replaced native nutrition dropdown controls with horizontal app-style choice chips.
- Added a lightweight `coachContext` builder for future FruitFit coach context without changing current AI/recovery logic.

Audit:

- Didactic exercises checked for muscle mapping: 190.
- Mapped with image asset: 190.
- Missing muscle image: 0.
- Spot checks passed: `Приседания со штангой`, `Разгибание ног`, `Жим Арнольда`, `Тяга Ли Хэйни`, `Скручивания`, `Боковая планка`, `Разгибание на трицепс`.

Verification planned:

- `npm run build`
- `npx cap sync android`
- `android\\gradlew.bat :app:assembleDebug`

### Health Cache And Muscle Mapping Stabilization

Date: 2026-05-21

Changes:

- Fixed the health refresh chain so native Health Connect sync reads from the current in-memory state instead of starting from an older localStorage snapshot.
- Added a single in-flight guard for native health refreshes to prevent stale requests from overwriting fresher debug/refresh results.
- Heart-rate source selection now considers the preferred package when it has a fresh sample, then falls back to the freshest valid record across Mi Fitness, Zepp/Amazfit, Samsung Health, Google Fit, and Android aggregate.
- Added active health auto-refresh on visibility/app resume and a periodic 4-minute dashboard refresh, with a faster refresh on the heart detail page.
- Added manual refresh on health detail pages and displayed the FruitFit refresh time separately from the Health Connect record time.
- Removed the lock icon from upcoming training exercises so all exercises in the current program look available.
- Rebuilt the anatomy muscle mapping config from the provided “Анатомический мапинг” labels with real UTF-8 canonical labels and strict normalization.
- Muscle map labels now decode mojibake target zones from the didactic catalog before matching to anatomy assets.

Audit:

- Didactic exercises checked for anatomy images: 190.
- Anatomy mapped: 190.
- Missing anatomy images: 0.
- Review note remains for biceps assets because the original XLSX image reference was missing in an earlier import and the existing project biceps asset is used.
- `wrangler pages deploy dist --project-name fruitfit` completed.
- `npm run android:debug` completed, APK copied to `FruitFit-test-debug.apk`.

### Health Calories Split / History Charts

Date: 2026-05-21

Changes:

- Split calories into active movement calories, resting/BMR calories, and total daily calories.
- Dashboard calories card remains active calories only.
- Calories detail page now shows active calories, resting/BMR, and total daily calories separately.
- Android Health Connect bridge no longer writes active calories into the `total` field for `ActiveCaloriesBurnedRecord`.
- Reworked step-based active calorie fallback to a more conservative physiological estimate; about 4k-4.5k steps now lands in the expected low-hundreds range unless explicit workout calories are present.
- Added local daily health history snapshots so steps/calories week/month charts can show real accumulated history when Health Connect only provides aggregate day totals.
- Added aggregate progress and clear empty states instead of drawing blank charts when hourly buckets are unavailable.

Verification:

- `npm run build` passed.

### Client Health UI / Warmup / APK Pass

Date: 2026-05-21

Changes:

- Fixed the Health Connect UI-state mismatch where debug payloads contained real tracker data but dashboard widgets could still render `no_data`.
- Relaxed the native health snapshot mapper for heart rate, steps, sleep, and calories:
  - heart rate now treats `latestBpm`, records, and samples as valid data even when the last-15-minute live value is absent;
  - steps accept selected Health Connect source packages such as `com.xiaomi.wearable`, `com.sec.android.app.shealth`, `com.google.android.apps.fitness`, and `android`;
  - sleep accepts `latestSleep`, main sessions, and week sessions;
  - calories normalize unusually large native calorie values and fall back to an activity estimate from steps/distance/workouts.
- Replaced health widget modal/bottom-sheet navigation with route-like full app screens via `health:*` screens and `HealthDetailScreen`.
- Android back / browser popstate from a health detail screen now returns to the dashboard instead of closing the app immediately.
- Kept the corrected warmup block with final `/warmup-icons/*.png` assets and default-collapsed state.
- Added mobile-safe UI text selection rules while preserving selectable inputs, debug output, `pre`, and `code`.
- Preserved the current Selectel exercise video resolution chain in `useTrainingData` and `ExerciseMediaProvider`.

Verification:

- `npm run build` passed.
- `wrangler pages deploy dist --project-name fruitfit` completed.
- `npm run android:debug` completed.
- Debug APK: `FruitFit-test-debug.apk`.

### Client Health UX / Calories Production Pass

Date: 2026-05-21

Changes:

- Tightened health navigation into explicit hash routes (`#/health/...`) and kept native `@capacitor/app` back handling for Android.
- Made the health detail header fixed with `env(safe-area-inset-top)` padding so the back button stays visible on long pages and on notched devices.
- Fixed calorie fallback estimation: weekly workouts are no longer counted in today’s fallback estimate; only same-day workouts can add workout calories.
- Kept the realistic step estimate around `steps * weight * 0.00045`, so roughly 4k steps lands in the expected low-hundreds kcal range instead of thousands.
- Rechecked that the global UI text-selection guard remains in place while preserving selectable inputs/debug/code.
- Verified warmup assets and Selectel video resolution paths were not touched.

Verification:

- `npm run build` passed.
- `wrangler pages deploy dist --project-name fruitfit` completed.
- `npm run android:debug` completed.
- Debug APK: `FruitFit-test-debug.apk`.

### Client Health Routes / Dashboard Values Fix

Date: 2026-05-21

Changes:

- Converted health detail navigation from internal fullscreen state to real hash routes:
  - `#/health/heart-rate`
  - `#/health/steps`
  - `#/health/sleep`
  - `#/health/calories`
  - `#/health/recovery`
  - `#/health/workouts`
- Added `@capacitor/app` and native Android `backButton` handling so back from health pages returns to the dashboard instead of minimizing the app.
- Removed health detail content from `DetailRouter`/`AppModal`; that modal path now remains only for mini lectures.
- Updated debug-report flow to also apply the freshly read native Health Connect data to the live dashboard store. This fixes the split where diagnostic JSON had values but dashboard cards still rendered empty values.
- Added source label support for `com.huami.watch.hmwatchmanager` as `Zepp / Amazfit`.
- Dashboard/store now preserves and renders:
  - latest heart BPM from debug/native reads;
  - selected-source steps;
  - estimated calories from steps/workouts;
  - manual sleep as the primary visual sleep value when native sleep is absent;
  - partial recovery state when only some inputs are present.

Verification:

- `npm run build` passed.
- `wrangler pages deploy dist --project-name fruitfit` completed.
- `npm run android:debug` completed and included `@capacitor/app`.
- Debug APK: `FruitFit-test-debug.apk`.
- Local client dev server is reachable at `http://127.0.0.1:5176/`.
- No deploy was performed because the current instruction says not to deploy without confirmation.

### Admin/Client Linkage Prep

Scope:

- Client PWA: `tagirfruit-fitness-app`.
- Admin panel: `fruitfit-admin`.

Changes:

- Copied real lecture catalog into admin source so the admin lectures tab can display the same 16 lecture titles and Selectel MP4 URLs as the client PWA.
- Copied the curated exercise catalog with `rfVideoUrl`, target zones, restrictions, and equipment into admin public data.
- Started an admin/client protocol document for future backend APIs and Selectel upload flow.
- Changed admin static data reads to `import.meta.env.BASE_URL + data/...` and switched admin Vite base to `/`, so the admin panel can be deployed on its own domain while the app routes stay under `/admin/...`.
- Replaced remaining program-constructor wording away from "ИИ-конструктор" toward a neutral program constructor where found.

Verification:

- Pending admin and client builds after edits.

### Workout Warm-Up Polish

Scope:

- Worked only in the main FruitFit PWA project.
- Did not touch `fruitfit-admin`.
- Updated the workout warm-up block in `src/screens/WorkoutScreen.jsx`.

Changes:

- Made the warm-up block open by default on the workout screen.
- Reworked the card into a darker premium pre-workout module with softer gradient, clearer hierarchy, and tighter spacing.
- Replaced the plain repeated warm-up tiles with data-driven joint cards: neck, shoulders, elbows, hips, knees, ankle.
- Added compact cues for each joint and a cleaner tips row for duration, pain-free motion, and breathing.
- Kept the interaction local to the existing accordion; no training data, video, replacement logic, nutrition, profile, backend, or admin code was changed.

Verification:

- `npm run build` passed.
- Local dev server is reachable at `http://127.0.0.1:5174/`.
- Vite reported the existing large chunk warning, but no build errors.

### Health Provider + App Icon Prep - Local Only

Scope:

- Main FruitFit PWA only.
- No deploy and no APK build.
- Prepared native-ready architecture without adding a real native Health Connect / HealthKit plugin yet.

Changes:

- Added `src/services/health/healthProvider.js` as the common health data interface for web, Android Health Connect, and iOS HealthKit.
- Reworked `src/data/healthStore.jsx` so web/PWA no longer creates simulated pulse, steps, calories, sleep, readiness, or live tracker status.
- Health widgets now show clean “Трекер не подключён” empty states when no real/manual source exists.
- Changed manual sleep entry to direct `HH:MM` inputs instead of plus/minus time buttons.
- Added fruit icon assets under `public/app-icons/`.
- Added app icon registry in `src/config/appIcons.js` and local selection store in `src/data/appIconStore.js`.
- Added a profile appearance section for choosing the app icon, ready to map to Android activity-alias and iOS alternate icon names later.
- Added `docs/HEALTH_INTEGRATION.md` with Android/iOS implementation notes and privacy rules.
- Warm-up block is now collapsed by default again, per UX request.

Verification:

- Pending fresh build after final cleanup.

### Android Health Connect + Launcher Icon APK

Scope:

- Main FruitFit client APK only.
- Did not touch admin panel and did not deploy PWA.

Changes:

- Added native Capacitor plugin `FruitFitHealthPlugin` for Android Health Connect.
- Declared Health Connect read permissions for steps, active calories, heart rate, sleep, distance, exercise sessions, and weight.
- Updated the JS health store so the “Подключить Health Connect” action now requests native permissions and reads real Health Connect data instead of only toggling local UI state.
- Added `FruitFitAppIconPlugin` and Android `activity-alias` launcher entries for orange, pear, apple, and strawberry app icons.
- Changed the profile app icon UI into a compact collapsible menu with a real “Использовать” action.
- Increased warm-up block text contrast and kept the warm-up block collapsed by default.
- Bumped Android version to `versionCode 5`, `versionName 1.4`.

Verification:

- `npm run build` passed.
- `npx cap sync android` passed.
- `android :app:assembleDebug` passed.
- APK copied to `dist-apk/FruitFit-1.4-health-icon-debug.apk`.

Notes:

- Xiaomi watch data will appear only if Mi Fitness / Xiaomi ecosystem writes those values into Health Connect and FruitFit receives the requested permissions.

### Client APK Debug Pass - Health, Warmup, Replacements, Icons

Date: 2026-05-18

Scope:

- FruitFit client app only.
- No APK assembly was run; only web production build and Android Java compile check.
- Admin app was not touched.

Changes:

- Reworked Android `FruitFitHealthPlugin` to support partial Health Connect permissions instead of all-or-nothing access.
- Added per-metric permission checks for steps, active calories, heart rate, sleep, distance, workout sessions, and weight.
- Added `HeartRateRecord` read flow into the same native permission/read path.
- Added Health Connect source metadata to samples where available, with source labels for Mi Fitness, Zepp/Amazfit, Samsung Health, Google Fit, Garmin, Fitbit, WHOOP, and Oura.
- Steps now choose one preferred source instead of blindly summing every source together; raw source breakdown is kept for debugging.
- Sleep sessions shorter than 2 hours are treated as fragments/naps and are not used as the main sleep block.
- Updated JS health store to sync when permissions are `connected` or `partially_granted`.
- Updated profile permissions UI to show clear states: connected, partially granted, permission missing, no data, or tracker not connected.
- Removed the confusing “active ?” permissions summary.
- Increased warmup block text contrast for Android WebView/dark cards without changing the supplied warmup icons.
- Restored stronger visual affordance for replacement action buttons.
- Tightened replacement filtering so near-duplicate names such as “Разгибание ног” vs “Разгибание ног на 10 раз” are not offered as meaningful alternatives.
- Added Android adaptive icon XML layers for orange, pear, apple, and strawberry aliases with a consistent dark background and centered foreground.
- Updated native app icon plugin messages to valid UTF-8 Russian.

Verification:

- `npm run build` passed.
- `android :app:compileDebugJavaWithJavac` passed.

Known notes:

- The current native bridge uses Android framework Health Connect APIs, so full native health reading is expected on Android 14+ / system Health Connect. If lower Android support is required later, migrate the plugin to Jetpack `androidx.health.connect.client`.
- Git CLI was not available in the current Codex terminal PATH, so GitHub commit/push was not performed here. Record this work in the repository once Git is available.

### Warmup Copy Cleanup

Date: 2026-05-18

Changes:

- Removed the small per-joint cue line from warmup cards.
- Kept only joint name and required reps/movement prescription in each card.
- Kept the shared recommendation row below the cards so the guidance is not duplicated.

Note:

- Mi Fitness data still depends on Xiaomi/Mi Fitness writing into Health Connect. If Mi Fitness is absent from Health Connect data sources/permissions on the phone, FruitFit cannot read Xiaomi watch data through Health Connect until that source is connected or a separate vendor integration is added.

### Health Connect Source Pipeline

Date: 2026-05-18

Changes:

- Hardened the Xiaomi Watch 2 Pro path for the practical chain: Mi Fitness -> Google Fit -> Health Connect -> FruitFit.
- Treated Google Fit as a first-class valid Health Connect origin instead of requiring Mi Fitness to appear directly.
- Improved native source labels: Google Fit, Mi Fitness, Zepp/Amazfit, Samsung Health, Garmin, Fitbit, WHOOP, Oura, Health Connect aggregate, or the raw unknown package name.
- Added an optional preferred step source package stored in `fruitfit.health.preferredSourcePackage`.
- Kept step totals deduplicated by choosing one origin instead of blindly summing every package; raw totals and all sources remain available for diagnostics.
- Added profile guidance explaining how to connect tracker apps through Google Fit when they do not write directly into Health Connect.

Verification planned:

- `npm run build`
- `npx cap sync android`
- `android :app:compileDebugJavaWithJavac`

### Client APK Final Bugfix Pass

Date: 2026-05-18

Changes:

- Raised contrast in the warmup card for Android WebView: darker card surface, brighter headings, clearer captions, and stronger expanded-card backgrounds.
- Fixed `FruitFitHealthPlugin.java` mojibake strings and kept the file UTF-8 without BOM.
- Heart rate now reads `HeartRateRecord` with `last15min`, `last24h`, `today`, and `week` ranges.
- Home heart widget now treats “current pulse” as the latest sample from the last 15 minutes only; stale day-level data shows “Нет актуальных данных”.
- Added heart-rate diagnostics: latest BPM/timestamp/source package, today/24h/7d record counts, sample counts, and source breakdowns.
- Added Profile -> Connections and permissions -> “Диагностика трекера” with refresh, copy JSON, and share JSON actions.
- Kept health states separate: missing permission, no data, stale data, connected, and not installed/not supported.
- Allowed video fullscreen to unlock orientation while keeping the normal app shell portrait-locked.
- Removed the hard manifest portrait lock so fullscreen video can rotate; JS re-locks portrait outside fullscreen.
- Tightened exercise replacement filtering against normalized duplicate names such as “Разгибание ног” vs “Разгибание ног на 10 раз”.
- Reduced Android adaptive icon foreground size with a larger safe-zone inset for orange, pear, apple, and strawberry icons.

Verification:

- `npm run build` passed.

Next manual APK checks:

- Samsung/Galaxy Watch: verify latest pulse matches a recent 10-15 minute sample, not max/day aggregate.
- Xiaomi/Mi Fitness: verify the practical path Mi Fitness -> Google Fit -> Health Connect -> FruitFit and export a health debug JSON if data is missing.
- Launcher icons on HyperOS: inspect all fruit aliases after reinstall/update.

### Didactic Exercise Ontology Migration

Date: 2026-05-19

Changes:

- Imported `Дидактическая таблица упражнений..xlsx` as the new source of truth for exercise metadata and replacement grouping.
- Added `tools/import-didactic-exercises.mjs` to read the XLSX, scan Selectel `exercises/*.mp4`, build the runtime catalog, and export audit CSV/JSON files.
- Added `src/data/didacticExerciseCatalog.json` and `src/data/didacticExerciseData.js`.
- Replaced runtime replacement logic in `src/data/exerciseAlternatives.js` with strict didactic matching: movement vector + muscle group + exercise type, with gender and restriction filtering.
- Updated training data enrichment to use didactic metadata/video links instead of the legacy exercise table for runtime video resolution.
- Removed old root `replacement_audit.csv/json` and the legacy replacement audit generator.

Audit:

- Didactic exercises: 190.
- Selectel mp4 files in `exercises/`: 187.
- Confident video matches: 181.
- Missing videos: 2 (`Жим Арнольда`, `Разгибание ног`).
- Manual review matches: 5.
- Duplicate conflicts: 2.
- Audit folder: `audit/didactic-ontology-2026-05-19`.

Verification:

- `npm run build` passed.
