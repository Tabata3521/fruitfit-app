# WORKLOG - FruitFit Food Database & Nutrition Parser

## 2026-06-16 - iOS local build and Apple HealthKit preparation

- Added Capacitor iOS platform under `ios/` for local Mac/Xcode iPhone installs.
- Added `@capgo/capacitor-health@8.6.6` after checking the current Capgo GitHub/docs and npm metadata:
  - supports Capacitor 8;
  - supports iOS Apple HealthKit;
  - supports SPM, which matches Capacitor 8 iOS projects.
- Kept Android Health Connect on the existing `FruitFitHealth` native bridge. The Capgo plugin is used by JS only on iOS.
- Added an iOS health adapter inside `src/services/health/healthProvider.js`:
  - `Health.isAvailable`;
  - `Health.requestAuthorization`;
  - `Health.checkAuthorization`;
  - `Health.queryAggregated` for steps, calories, and distance;
  - `Health.readSamples` for heart rate, sleep, and weight;
  - `Health.queryWorkouts` for workouts.
- Added read-only HealthKit native config:
  - `ios/App/App/App.entitlements` with `com.apple.developer.healthkit`;
  - `NSHealthShareUsageDescription` in `ios/App/App/Info.plist`;
  - `CODE_SIGN_ENTITLEMENTS` and HealthKit capability marker in the Xcode project.
- Did not add `NSHealthUpdateUsageDescription` because FruitFit is not writing to HealthKit in this patch.
- Added `ios/App/App.xcworkspace` wrapper for the requested Xcode workflow; the underlying Capacitor 8 project still uses SPM and `App.xcodeproj`.
- Added `npm run ios:sync`.
- Added `scripts/sync-android.ps1` and routed `android:sync` / `android:debug` through it because Capacitor CLI discovers installed native plugins globally. The script runs Android sync, then removes `@capgo/capacitor-health` from generated Android Gradle wiring so Android keeps the existing bridge.
- Updated subscription cancellation client handling so a backend `cancelUrl`, `cancel_url`, or `url` can be opened without hardcoding any subscription id. If no URL is returned, the existing status/subscription response path remains.
- Validation:
  - `npm run build` passed; Vite only reported the existing large chunk warning.
  - `npx cap sync ios` passed.
  - `npm run ios:sync` passed and iOS listed `@capgo/capacitor-health@8.6.6`.
  - `npm run android:sync` passed and removed Capgo from Android Gradle wiring.
  - `android/gradlew assembleDebug --no-daemon` passed.
- Notes:
  - Windows cannot run Xcode/iPhone build; final iOS run must happen on Mac.
  - Free provisioning may require a unique Bundle Identifier and may need reinstall roughly every 7 days.
  - If free Apple ID signing rejects HealthKit capability, Xcode signing is the blocker; use a unique Bundle ID first, then Apple Developer Program if needed.

## 2026-06-16 - Client payment/profile/VIP report follow-up

- Nutrition fix: `NutritionScreen` now sorts weekday chips as `Понедельник, Вторник, Среда, Четверг, Пятница, Суббота, Воскресенье` instead of trusting the scrambled `public/data/nutrition.json` filter order.
- Avatar persistence fix: profile avatar upload now crops/compresses the selected image to a small JPEG, saves it to `fruitfit.avatar`, mirrors it into `fruitfit.profile.avatar`, sends it with `/api/me/profile` when authenticated, and restores from local/profile/auth-user fallbacks after app restart.
- These client changes were synced into the Android app and installed on the connected phone after the user's follow-up request.
- Validation:
  - `npm run build` passed; Vite only reported the existing large chunk warning.
  - Follow-up phone deploy passed `npx cap sync android` and `android/gradlew assembleDebug --no-daemon`.
  - APK built at `android/app/build/outputs/apk/debug/app-debug.apk`.
  - ADB install succeeded on phone `8f647179`; package `com.tagirfruit.fruitfit` updated to `versionName=1.9`, `versionCode=10`, `lastUpdateTime=2026-06-16 23:44:33`, and the app was launched.

- VIP/admin trainer report payload now includes a compact Health snapshot alongside photos, scores, comments, and real measurements:
  - `healthSummary` with today's steps, active/total calories, sleep minutes, latest heart rate, readiness score, provider state/source, and last successful native read time.
  - `health` with steps, calories, sleep, heart-rate, readiness, sources, and calendar-aligned weekly activity/history rows.
- Before sending the trainer report, the client tries a forced Health Connect history refresh and falls back to the cached `fruitfit.health` snapshot if native refresh is unavailable or rate-limited.
- Settings now shows a "Health в отчёте" preview for steps, sleep, pulse, and active kcal, so the user can see what will be sent.
- Profile subscription UI now shows the auto-renewal block for authorized Pro/VIP/admin users even when `GET /api/payments/subscription` returns `subscription: null`; the disabled cancel button stays visible with an explicit "active auto-renewal not found" status.
- Validation:
  - `npm run build` passed; Vite only reported the existing large chunk warning.
  - `npx cap sync android` passed.
  - `android/gradlew assembleDebug --no-daemon` passed.
  - APK built at `android/app/build/outputs/apk/debug/app-debug.apk`.
  - ADB install succeeded on phone `8f647179`; package `com.tagirfruit.fruitfit` updated to `versionName=1.9`, `versionCode=10`, `lastUpdateTime=2026-06-16 15:37:22`, and the app was launched.
  - ADB also detected tablet `bac22b47`, but install there was intentionally rejected on-device with `INSTALL_FAILED_USER_RESTRICTED: Install canceled by user`.
  - Local Browser read-only smoke opened `#/settings` and `#/profile`; React rendered both screens. Console errors were only local API fetch failures caused by running without backend/JWT.

## 2026-06-03 - Fix Health Connect pagination crash and history-based recovery

- Fixed critical Health Connect crash: paginated native reads no longer combine `pageToken` with `setAscending(true)`. Records are collected page-by-page and sorted locally by record time after all pages are read.
- Added native read error protection around request construction/page reads. Health Connect read failures now resolve as `state:error` with `recordType`, `pageIndex`, `pageTokenUsed`, and `errorCode` where available, so the app/debug report can show the failure instead of crashing.
- Recovery scoring now uses history-first inputs: sleep 7d average, steps 7d average, calories 7d average, and heart `min24h/avg24h/max24h` with 7d heart fallback. Recovery no longer depends on a realtime/latest pulse sample.
- Health store now keeps top-level `history7d` for steps, calories, heartRate, and sleep from Health Connect reads.
- Debug report heart section now includes explicit `sourcePackage` and `queryErrors`; general debug `errors.failedQueries` lists failed Health Connect queries.
- Validation:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - `gradlew :app:assembleRelease` passed.
  - `fruitfit-client-health-connect-history-fix-release.apk` was zipaligned, locally release-test signed, and verified with APK Signature Scheme v2/v3.

## 2026-06-02 - Health heart-rate history regression diagnostics

- Regression analysis: no committed native `HeartRateRecord` query/source-filter change was found after the working May log; native read still queries Health Connect without source filtering. Found two client-side regressions/risks:
  - heart freshness thresholds were too strict (`>30m` became `stale`), so valid watch data at 33 minutes looked stale/no-data in UI;
  - the native bridge read only the first Health Connect page (`pageSize=1000`) and did not follow `nextPageToken`, which could truncate high-volume 7d heart history.
- Updated heart freshness model: `0-60m=fresh`, `1-6h=today`, `6-24h=old_today`, `>24h=stale`, no samples=`no_data`.
- Updated Dashboard heart widget and Heart detail to show 24h range, avg24h, latest bpm+age, source name, and explicit displayMode (`range_today`, `latest_only`, `no_data`) instead of requiring realtime/current pulse.
- Recovery no longer depends on realtime `heart_rate.current`; it uses heart history/ranges/latest sample.
- Added 7d heart history and query diagnostics to health state/debug export: permission status, query start/end, record count, raw record count, samples count inside `HeartRateRecord`, source counts, latest record/sample timestamps, displayMode reason.
- Added `healthRefresh` debug telemetry for refresh started/finished, native read started/finished, duration, cache/native status, reason, and errors.
- Validation:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - `:app:assembleRelease` passed.
  - `fruitfit-client-health-history-release.apk` was zipaligned, locally release-test signed, and verified with APK Signature Scheme v2/v3.

## 2026-06-01 - Health Connect calories unit and stale heart debug fix

- Root cause: Android Health Connect `ActiveCaloriesBurnedRecord` was read with `Energy.getInCalories()` and the native bridge returned that raw calorie value as if it were UI kilocalories. A real ~19 kcal active value could therefore appear as ~19000 in FruitFit.
- Updated `FruitFitHealthPlugin` to expose explicit raw calorie units (`cal`), converted UI units (`kcal`), converted active calories, record counts, source package/name, and per-source calorie debug totals.
- Added step record counts/raw aggregate debug fields and latest heart-rate age minutes from the native bridge.
- Removed the JS-side calorie unit guessing heuristic; calories are now treated as kilocalories after the native conversion.
- Added a suspicious-data flag when active calories are above 5000 while steps are below 1000, including the reason in health state and debug export.
- Updated heart UI copy so stale heart-rate samples are not displayed as current pulse; stale state now shows "Нет свежих данных" while preserving the last sample in details/debug.
- Validation:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - Client release APK built and locally signed for install testing.
  - Admin release APK rebuilt and locally signed for tablet testing.

## 2026-05-23 - Finish remaining exercise video bindings

### Что исправлено

- Закрыты последние 3 media gap в client runtime fallbacks: `Классические выпады`, `Отжимания в смитте`, `Присед плие`.
- Видео подключены через `src/data/exerciseRuntimeFallbacks.js`, то есть через тот же runtime binding pipeline, который используют workout card, exercise detail и video modal.
- Назначены только безопасные близкие canonical videos с совпадающим movement pattern:
  - `Классические выпады` -> canonical video `Выпады с гантелями`.
  - `Отжимания в смитте` -> canonical video `Отжимания в тренажёре смитта`.
  - `Присед плие` -> canonical video `Присед с точкой опоры`.

### Итоги аудита

- TOTAL CLIENT EXERCISES: 196.
- WITH VIDEO: 196.
- WITH MUSCLE MAP: 196.
- BROKEN VIDEO: 0.
- BROKEN MAPS: 0.
- UNRESOLVED EXERCISES: 0.
- VIDEO URL CHECK: 163/163 runtime video URLs ok, broken URL 0.

### Проверки

- `node scripts/audit-client-exercise-runtime.mjs` - ok.
- HEAD-check для всех runtime video URL - ok.

## 2026-05-23 - Client exercise media binding audit

### Что исправлено

- Проведён full client runtime audit: `public/data/exercises.json` -> alias resolver -> didactic/runtime catalog -> video lookup -> anatomy map lookup -> workout card/detail fallback.
- Добавлен `scripts/audit-client-exercise-runtime.mjs`; отчёты сохраняются в `audit/client_exercise_runtime_audit.json` и `.csv`.
- Исправлены broken aliases/runtime bindings для вариантов: `Приседания в кроссовере`, `Боковая или латеральная планка`, `Дуговые махи на заднюю дельту`, `Изодинамические махи на заднюю дельту`, `Комплекс ЛФК упражнений на плечи`, `Латеральная или боковая вытяжка в кроссовере`, `Молотковые сгибания с канатной рукоятью в кроссовере`, `Присед в смите`, `Си-си присед на бицепс бедра`, `Скручивание на полу`.
- Добавлены client runtime fallback bindings для упражнений, которых нет в didactic table: `Растяжка на все тело`, `Классические выпады`, `Отжимания в смитте`, `Присед плие`.
- Для ЛФК боковой/латеральной вытяжки anatomy fallback теперь выбирает `Квадратная мышца поясницы`, а не общий случайный template.
- Media placeholder теперь явно показывает `Демонстрация скоро появится`, если безопасного видео нет.

### Итоги аудита

- TOTAL CLIENT EXERCISES: 196.
- WITH VIDEO: 193.
- WITH MUSCLE MAP: 196.
- BROKEN VIDEO: 3 (`Классические выпады.`, `Отжимания в смитте`, `Присед плие`) - безопасного видео в Selectel/catalog/upload log не найдено, UI показывает placeholder.
- BROKEN MAPS: 0.
- UNRESOLVED EXERCISES: 0.
- AUTO-BINDINGS APPLIED: 14.
- VIDEO URL CHECK: 161/161 runtime video URLs ok, broken URL 0.

### Проверки

- `node scripts/audit-client-exercise-runtime.mjs` - ok.
- `npm run build` - ok.

## 2026-05-23 - Health refresh wiring

### Что исправлено

- Debug/export health report больше не коммитит UI отдельным путём: перед сборкой JSON он запускает общий `syncNativeHealth({ force: true, reason: "debug-export" })`.
- Dashboard health widgets и health detail pages используют тот же `syncNativeHealth` refresh pipeline.
- `syncNativeHealth` теперь пытается читать native Health Connect records при любом установленном Health Connect состоянии, кроме `not_supported` / `not_installed`.
- Добавлены console logs для acceptance-проверки: `refresh started`, `native health read started`, `health store updated`, `refresh finished`.
- In-flight guard оставлен, но stale/forced refresh больше не может навсегда блокировать новые запросы; старый завершившийся request не сбрасывает refs нового request.
- На заполненные Dashboard health cards добавлены отдельные маленькие refresh-иконки: пульс, шаги, калории, сон, восстановление.

### Проверки

- `npm run build` - ok.

## 2026-05-22 - Stretching video hotfix

### Что исправлено

- Вернул видео для упражнения `Растяжка на все тело`.
- Причина: это упражнение есть в тренировочных программах, но его нет в новой дидактической таблице на 190 упражнений, поэтому `resolveDidacticExercise()` не возвращал `video_url`.
- Добавлен точечный manual video override без изменения exercise ontology и без переименования упражнения.

### Проверки

- Прямая Selectel ссылка проверена через HEAD-запрос: `200 video/mp4`.
- `npm run build` - ok.

### Что проверить

- Открыть тренировку, где есть `Растяжка на все тело`.
- Убедиться, что в карточке упражнения вместо пустого preview/заглушки грузится MP4 с Selectel.

## 2026-05-22 - UI polish: профиль, настройки, auth placeholders, app icons

### Что сделано

1. **Profile / account refactor**
   - Вкладка "Профиль" разгружена: настройки приложения, выход, опасные действия, тема, версия и иконка приложения вынесены на отдельный экран настроек.
   - В профиле оставлены профильные данные, замеры, Health Connect block и будущий referral/promo placeholder.
   - Добавлена шестерёнка настроек в profile header.

2. **Settings page**
   - Добавлен отдельный экран `SettingsScreen` с route `#/settings`.
   - В настройки вынесены:
     - logout;
     - delete account placeholder;
     - payment/billing placeholders;
     - app icon settings;
     - theme settings;
     - privacy/data placeholders;
     - version/build info.
   - Android back с экрана настроек возвращает в профиль, а не сворачивает приложение.

3. **Referral / promo placeholders**
   - Добавлена карточка "Реферальная программа".
   - Добавлен текст "Пригласи друга - получи месяц бесплатно".
   - Добавлены поле промокода и кнопка "Применить" в disabled/soon состоянии.
   - Backend logic не подключалась.

4. **Auth UI preparation**
   - В настройках добавлены аккуратные disabled placeholders:
     - "Войти через Telegram";
     - "Войти через Яндекс".
   - Реальная auth/backend logic не добавлялась и не менялась.

5. **App icon polish**
   - Android adaptive icons переведены на black background + transparent fruit foreground.
   - Добавлены отдельные foreground artwork assets для orange/apple/pear/strawberry.
   - Иконки центрированы в safe zone без белой подложки и без растягивания fruit artwork.

### Проверки

- `npm run build` - ok.
- `npx cap sync android` - ok.
- `.\gradlew.bat :app:assembleDebug` - ok.
- Локально проверены:
  - `#/settings`;
  - переход из профиля в настройки;
  - возврат из настроек в профиль;
  - referral/promo placeholder;
  - отсутствие inline app icon блока в профиле.

### APK

- Собран debug APK:
  - `android/app/build/outputs/apk/debug/app-debug.apk`
- Скопирован в корень проекта:
  - `FruitFit-ui-polish-debug.apk`

### Что проверить на телефоне

- Профиль открывается без перегруза.
- Шестерёнка открывает настройки.
- Android back из настроек возвращает в профиль.
- Telegram/Yandex кнопки выглядят как заготовки и не обещают активный login.
- Referral/promo блок отображается как "скоро/готовится".
- Переключение темы не сломано.
- App icon settings сохраняют выбор.
- Launcher icons orange/apple/pear/strawberry выглядят без белой подложки и без кропа.

## 2026-05-22 - Health refresh buttons + exercise video patch

### Что исправлено

- Маленькие refresh-кнопки health detail pages теперь вызывают общий `syncNativeHealth({ force: true })`, а не отдельный/пассивный UI refresh.
- `syncNativeHealth` больше не зависает навсегда на старом in-flight promise: добавлен age guard и сброс stale-запроса после 45 секунд.
- Если Health Connect возвращает `no_data`, pipeline всё равно может читать native records. Это важно для случаев, когда availability ещё не отражает реальные записи, но debug/export уже видит данные.
- Время `lastFruitFitRefreshAt` обновляется даже если новых записей нет, чтобы UI показывал факт проверки.
- Ошибки refresh сохраняются в `syncError` / `lastHealthSyncError` и выводятся на health detail pages.
- Empty health cards с действием “Обновить” теперь вызывают чтение данных, а не повторный permission-flow.
- Кнопка “Обновить данные” в профиле теперь использует refresh pipeline, если разрешения уже есть; permission-flow остаётся для первичного доступа.
- Добавлены source labels/shortcuts для WHOOP. Apple Health оставлен как iOS/HealthKit provider; Android APK не может напрямую проверить HealthKit.
- Точечно восстановлена ссылка Selectel для упражнения “Выпады в кроссовере”.

### Проверки

- `npm run build` - ok.
- `npx cap sync android` - ok.
- `.\gradlew.bat :app:assembleDebug` - ok.
- Selectel URL “Выпады в кроссовере” отвечает `HTTP 200`, `Content-Type: video/mp4`.

### Что проверить на телефоне

- Samsung Health / Galaxy Watch: маленькая кнопка refresh на health page обновляет timestamp “FruitFit обновил данные”.
- Если Health Connect отдаёт свежий `com.sec.android.app.shealth`, Dashboard и detail pages показывают Samsung Health, а не старый Google Fit cache.
- Empty cards “Обновить” запускают чтение Health Connect, а не только экран разрешений.
- “Выпады в кроссовере” открывают видео из Selectel.

## 2026-05-22 - tagirfruit food MVP iteration

### Что было незавершено

- Food seed и parser были подготовлены, но часть файлов была записана в mojibake-кодировке.
- Parser мог принимать любой свободный текст за nutrition intent, например вопрос "кто ты?".
- Система была только local DB; external API fallback и кеширование неизвестных продуктов ещё не были подключены.
- Тестовый скрипт был destructive: очищал базу перед проверкой.

### Что сделано

1. **Food Database MVP**
   - `server/foodMvpSeed.js` расширяет базу до 817 продуктов.
   - В базе сейчас 817 продуктов и 2775 aliases.
   - Приоритеты MVP: мясо, птица, рыба, яйца, крупы, молочка, овощи, фрукты, хлеб, сладости, напитки, фастфуд и популярные блюда.
   - Для продуктов добавлены `serving_examples` и `default_serving_grams`.

2. **Nutrition parser**
   - Исправлено разделение по "и", запятым, `+`, `;`.
   - Поддержаны граммы: `250 г риса`.
   - Поддержаны штуки/default serving: `2 яйца`, `банан`, `бургер`, `кола`.
   - `isNutritionIntent()` теперь не перехватывает обычные вопросы, если продукты не находятся в локальной базе.

3. **Hybrid food database**
   - Primary source: local SQLite `data/nutrition.db`.
   - External fallback: OpenFoodFacts через `server/externalFoodApi.js`.
   - Если external API находит продукт, продукт кешируется в local DB с `source=openfoodfacts:<code>`.
   - GPT не считает калории из памяти: backend parser сначала возвращает structured nutrition result.

4. **tagirfruit prompt**
   - `server/coachPrompt.js` содержит единый server-side prompt/config.
   - Ассистент называется `tagirfruit`.
   - В prompt закреплено правило: КБЖУ считать только через nutrition calculator / nutrition_db и не выдумывать калории.

5. **Tests**
   - `scripts/test-nutrition.js` теперь non-destructive.
   - Добавлен npm script: `npm run test:nutrition`.

### Проверенные фразы

| Фраза | Match | Result |
|---|---|---|
| `2 яйца и банан` | Яйцо куриное 110 г + Банан 120 г | 288 ккал, Б 15.8 / Ж 12.6 / У 26 |
| `250 г риса и куриная грудка` | Рис белый вареная 250 г + Куриная грудка 150 г | 483 ккал, Б 41.4 / Ж 3.6 / У 72.4 |
| `бургер и кола` | Бургер 220 г + Кола 330 г | 700 ккал, Б 26.4 / Ж 24.2 / У 94.4 |
| `творог 5% 200 г` | Творог 5% 200 г | 240 ккал, Б 34 / Ж 10 / У 6 |
| `гречка с молоком` | Гречка с молоком 250 г | 348 ккал, Б 15.5 / Ж 6.5 / У 64.3 |

### Проверки

- `npm run db:nutrition:seed` - ok.
- `npm run test:nutrition` - ok.
- `node --check` для server/parser/db/external API/test script - ok.
- `npm run build` - ok, Vite production build passed.

### Ограничения

- External API fallback зависит от доступности OpenFoodFacts. Во время локальной проверки сервис отвечал 503, поэтому fallback реализован и безопасно деградирует, но успешное API-кеширование нужно проверить при доступном сервисе.
- Брендовая РФ-база пока MVP, без barcode scanner и без большой branded базы.

## 2026-05-22 - Production VDS tagirfruit AI/Nutrition update

Production backend path: `/var/www/fruitfit-ai-api`.

## 2026-05-23 - Lecture transcripts attached

- Added `src/data/lectureTexts.js` generated from the 16 lecture PDFs in `C:/Users/Meyva/Downloads/Лекции`.
- Connected lecture text to the existing mini-lecture video modal, preserving the current lecture video URLs.
- Removed PDF-style horizontal divider lines during text cleanup and kept the lecture wording intact.
- Added a copy action for each lecture transcript and made the transcript area selectable via `.allow-select`.
- Next phone check: open mini-lectures, switch between lecture videos, expand text, copy text into another app.

## 2026-05-23 - Health detail raw series reference fix

- Fixed the runtime `caloriesWeekRaw is not defined` error that appeared on the Steps detail page after a real Health Connect refresh.
- Root cause: `readNativeHealthSnapshot` created `calorieWeekRaw` / `calorieMonthRaw`, but later referenced `caloriesWeekRaw`. The undefined plural variable only surfaced at runtime after the native refresh rebuilt health state.
- Renamed the raw calorie series variables consistently to `caloriesWeekRaw` / `caloriesMonthRaw`.
- Added safe `[]` fallbacks when Health Connect does not return calorie samples for week/month ranges.
- Did not change Health Connect permissions, source detection, AI, food DB, admin, exercise media, muscle maps, payments/auth, or APK config.
- Validation: `npm run build` passed.

Backup created before changes:
`/root/fruitfit-backups/fruitfit-ai-api-20260522-213515.tar.gz`.

Additional single-file backup before API input normalization:
`/root/fruitfit-backups/server.js-api-input-normalization-20260522-2149.bak`.

Changed on production VDS:

- `server.js`
- `src/nutrition/foodParser.js`
- `src/coach/prompt.js`
- `src/lectures/lectureContexts.js`
- `scripts/seed-fruitfit-mvp-products.js`
- `data/fruitfit-food-mvp-products.json`
- `data/nutrition.db`

What was done:

- Assistant identity fixed as `tagirfruit`.
- Added server-side tagirfruit prompt/personality and free vs active-program access rules.
- Added lecture context architecture with 16 lecture summaries/categories/keywords.
- Expanded production nutrition DB to 1066 products.
- Production DB stats after seed: 984 verified products, 82 external products, 2405 aliases.
- Parser supports common phrases: `2 яйца и банан`, `250 г риса и куриная грудка`, `бургер и кола`, `творог 5% 200 г`, `гречка с молоком`, `3 сырника`, `шаурма`, `протеин 30г`.
- `/api/coach` now supports both `messages[]` and single `message/text/prompt/content` payloads.
- `/api/nutrition/parse-calc` now supports `message`, `text`, `prompt`, `content`, `query`, and `input`.
- Nutrition intent short-circuits GPT: backend parser/DB calculates calories and macros first, then returns structured nutrition result.
- `pm2 restart fruitfit-ai-api --update-env` completed successfully and `pm2 save` completed.

Production checks:

- `GET /api/health` returned `assistant: tagirfruit`, model `gpt-4.1-mini`, DB loaded, 1066 products, 2405 aliases.
- `POST /api/nutrition/parse-calc` returned expected nutrition totals for test phrases.
- `POST /api/coach` returned nutrition answers without GPT calorie invention for food phrases.
- `POST /api/coach` personality tests passed for `кто ты?`, `можешь составить мне тренировку?`, `почему приложение иногда ошибается?`.

Notes:

- APK rebuild is not required for this server-side prompt/nutrition iteration.
- Public DNS check for `tagirfruit-mini.duckdns.org` did not resolve from the local machine during this run; VDS-local API checks passed on `127.0.0.1:8787`.

## 2026-05-24 - Health detail runtime regression fix

- Fixed the Profile tracker diagnostics runtime crash caused by an extra invocation in the Health Connect refresh promise chain: `catch(handler)().finally(...)` now correctly continues as `catch(handler).finally(...)`.
- Split native raw health series by metric type with safe empty-array fallbacks: `stepsWeekRaw`, `caloriesWeekRaw`, `heartRateWeekRaw`, and `sleepWeekRaw`.
- Stored raw week/month series on the matching metric only, so the Steps detail page no longer depends on calorie raw series.
- Hardened Profile diagnostic copy/share handlers so clipboard/share failures show a controlled status instead of surfacing raw JS errors.
- Verification:
  - `npm run build` passed.
  - Local browser check: Steps detail opened without `caloriesWeekRaw`/runtime errors.
  - Local browser check: Heart detail opened without runtime errors.
  - Local browser check: Profile diagnostic `Обновить` / `Скопировать` / `Поделиться` did not show `.catch` errors.
  - Detail refresh timestamp remained visible after refresh.
- Scope intentionally did not touch AI, admin, food DB, exercise media, or muscle maps.

## 2026-05-24 - Lecture flow dedicated screen

- Replaced the dashboard mini-lecture modal flow with a dedicated app screen at `#/lectures`.
- Dashboard lecture widget now reads saved lecture progress and shows the active lecture title, thumbnail, progress bar and CTA (`Начать` / `Продолжить` / `Пересмотреть`).
- Added local lecture progress storage under `fruitfit.lectureProgress.v1` with current lecture index and completed lecture ids.
- Added `LectureDetailScreen` with sticky safe-area header, video player, title, summary/subtitle, course progress, previous/next controls, mark-complete action, external video button and selectable/copyable transcript.
- Lecture navigation now uses the same screen/hash stack pattern as health/settings screens, so back returns to Dashboard instead of closing a modal overlay.
- Removed the old lecture modal render path from `WidgetGrid`; general health widgets and other flows were not changed.
- Validation: `npm run build` passed.

## 2026-05-24 - Mobile back navigation and compact layout

- Root cause: FruitFit used mixed navigation state. Health detail, lectures and settings wrote hash/history entries, but root tabs and workout/focus screens often only changed React `screen` state. On Android this left Capacitor `backButton` with no web history entry and allowed `minimizeApp` from internal screens.
- Added route/history entries for `workouts`, `food`, `coach`, `profile`, `workout`, and `focus`, while keeping the existing health and lecture hash routes.
- Updated the Capacitor `backButton` handler: internal screens pop FruitFit history first, fall back to `home` if opened directly, and only minimize on `home`.
- Wired visible back arrows to real route back behavior for settings, health detail pages, lectures, workout, focus, and Nutrition when Nutrition is opened from a dashboard widget.
- Kept bottom tab navigation intact and marked tab-origin navigation separately so root tabs do not show unnecessary iOS back arrows.
- Improved profile/settings top safe-area spacing and made the profile settings gear larger, bordered, and readable below status bars/notches.
- Added shared `safe-top` / `safe-tab-screen` layout helpers, reduced a few vertical gaps, compacted detail headers, and included safe-area bottom padding so bottom navigation/input bars do not cover content.
- Browser QA:
  - Profile -> Settings -> back arrow returned to Profile.
  - Health Steps detail -> back arrow returned to Dashboard.
  - Lecture route -> back arrow returned to Dashboard.
  - Workout route -> back arrow returned to Dashboard.
  - Dashboard Nutrition widget -> Nutrition showed a back arrow and returned to Dashboard.
- Validation: `npm run build` passed.
- Scope intentionally did not touch Health Connect logic, health refresh pipeline, AI backend, food DB, exercise media bindings, muscle maps, admin builder, payments/auth, or APK config.

## 2026-05-24 - Health widget UX and onboarding copy polish

- Replaced technical health widget wording with calm consumer-facing copy:
  - `stale` / `aging` style badges now render as "ждём синхронизацию" / "обновляется".
  - Heart widget now says "Откройте приложение часов, чтобы синхронизировать пульс" instead of source/debug language.
  - Calories estimate copy now says that part of the values is calculated automatically from activity.
  - Empty sleep/recovery states explain what to add next instead of presenting an error-like "no data" state.
- Added contextual hints in dashboard widgets and health detail pages for sleep, heart freshness, calories, weekly activity, and recovery accuracy.
- Removed ordinary UI exposure of source reasons, `Health Connect aggregate`, raw freshness names, and technical sync errors.
- Profile health connection copy now explains why Health Connect is useful, that data is used for personalization, and that it is not shared with third parties.
- Moved tracker diagnostics behind an explicit "Открыть диагностику" control so normal users do not see JSON/debug wording by default.
- Added onboarding hint on the final quiz step explaining Health Connect benefit and privacy before the user enters the app.
- Browser QA:
  - Dashboard health widgets did not expose `stale`, `partial_data`, `no_data`, `estimated`, `aging`, `live HR`, or `Health Connect aggregate`.
  - Profile visible copy did not expose raw source reason/debug wording.
- Validation: `npm run build` passed.
- Scope intentionally did not change health logic, recovery calculations, source priority, AI backend, routing, nutrition, admin, or payments/auth.

## 2026-06-04 - Health Connect rate-limit refresh strategy

- Added Health Connect `rate_limited` normalization for quota/429/rate-limit native and JS errors.
- Added health snapshot cache/cooldown fields: `rateLimitedUntil`, `lastRateLimitAt`, `lastSuccessfulNativeReadAt`, `cacheAgeMs`, `cacheReason`, plus refresh diagnostics for `queryMode`, `skippedDueToCooldown`, `nativeReadReason`, and `cooldownRemainingMs`.
- Added 15 minute cooldown after rate limit. Manual `force:true` refresh now respects cooldown unless an explicit future `bypassCooldown:true` call is used.
- Added per-metric TTL cache guards: steps/calories/heart 5 minutes, sleep 30 minutes, workouts 15 minutes, weight 60 minutes.
- Split native query modes:
  - Dashboard light: steps today, calories today, heart last24h, sleep week summary.
  - History heavy: steps week/month, calories week/month, heart week, sleep week, workouts week.
- Reduced heart-rate reads to one Health Connect heart query per refresh. Dashboard reads last24h; history reads week and derives last15min/today/last24h from that single result.
- Removed the extra distance read from the full history path.
- Limited native Health Connect pagination to `MAX_READ_PAGES = 2`; native results now expose `pagesRead`, `maxPages`, `truncated`, `omittedRecordsCount`, `queryCount`, and `quotaExceeded`.
- Dashboard widget refresh buttons now use dashboard-light mode; health detail pages and Profile manual health refresh use history-heavy mode.
- Debug export no longer starts a new Health Connect native read. It builds JSON from the last cached FruitFit health snapshot and reports `debug_snapshot_no_native_read`.
- Debug JSON now includes `queryCount`, `pagesRead`, `maxPages`, and `quotaExceeded` alongside cache/cooldown fields.
- Rate-limited widgets no longer report `no_data`; they show `rate_limited`, `using_cache`, or `temporarily_unavailable` depending on cache availability.
- Preserved cached weekly/history arrays during dashboard-light refresh so lightweight reads do not erase detail/history state.
- Verification:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - `gradlew :app:assembleRelease` passed and produced `android/app/build/outputs/apk/release/app-release-unsigned.apk`.
  - `gradlew :app:assembleDebug` passed and produced `android/app/build/outputs/apk/debug/app-debug.apk`.
- Scope intentionally did not touch admin, nutrition, workouts/training, auth, payments, or APK config.

## 2026-06-04 - Health Connect UI/debug cleanup

- Fixed heart widget/detail labels so weekly heart history is shown as "за 7 дней" when 24h min/avg/max are empty.
- Stopped rendering empty "Мин 24ч / Средний 24ч / Макс 24ч" fields next to a weekly heart range.
- Mapped known Health Connect source packages to readable labels, including Mi Fitness, Zepp / Amazfit, Google Fit, and Samsung Health.
- Kept debug export snapshot-only while cleaning sleep diagnostics: fake zero-minute sessions are no longer created from weekly sleep summaries.
- Added steps/calories suspicious-source guards and debug `suspiciousReason` output for implausible daily totals or sources above 3x peer median.
- Verification:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - `gradlew :app:assembleDebug` passed and produced `android/app/build/outputs/apk/debug/app-debug.apk`.
- Scope intentionally did not touch admin, nutrition, training, auth, payments, or Health Connect rate-limit/cache architecture.

## 2026-06-08 - FruitFit P0 admin/client/server sync

- Started the P0 patch from the admin UX request: program assignment, server persistence, admin/client/server sync, login/providers status, and client first/last name.
- Confirmed current backend already has users/access/auth identities/devices, `/api/me/profile`, `/api/me/program-progress`, `/api/admin/users`, and catalog documents.
- Found that user program progress exists, but a dedicated server-side "assigned program" record did not exist yet.
- Added backend migration draft `007_user_program_assignments` for persistent one-program-per-user assignment.
- Added backend API draft:
  - `GET /api/admin/programs`
  - `GET/PATCH/PUT/DELETE /api/admin/users/:userId/program-assignment`
  - `GET /api/me/program-assignment`
- Extended `/api/me` draft response with `profile` and `programAssignment`.
- Extended `/api/admin/users` draft response with `profile` and `programAssignment`.
- Started client-side planning to read assigned program from server and use it as the source of truth when present.
- Health Connect pipeline and Android native bridge were not changed in this P0 patch.
- Status: superseded by the deployed P0 section below.

## 2026-06-08 - FruitFit P0 program/profile deployment

- Completed backend program-assignment persistence with `user_program_assignments`.
- Deployed backend file patch to VDSina and applied migration `007_user_program_assignments`.
- Imported server catalogs so `/api/admin/programs` returns 150 programs instead of an empty catalog.
- Verified admin API with `ADMIN_API_TOKEN`:
  - `/api/admin/programs`: 200, 150 programs.
  - `/api/admin/users`: 200, 10 users.
  - `/api/admin/users/:id/program-assignment`: 200 for test user `c672d131-e2b1-4658-a397-7a735dc319ab`.
- Verified test user assignment end-to-end:
  - admin assignment stored program `14506`.
  - `/api/me/program-assignment` returned the same assignment for the test user JWT.
- Updated client web/PWA to:
  - fetch `/api/me/profile`;
  - save first/last name through `/api/me/profile`;
  - fetch `/api/me/program-assignment`;
  - prefer the server assigned program over local recommendation fallback.
- Built client, ran Capacitor sync, and built Android debug APK.
- Deployed client release:
  - `/var/www/fruitfit-client/releases/20260608T200625Z-p0-program-profile`.
- Published Android latest APK:
  - `/var/www/fruitfit-downloads/fruitfit-android-v0.1.1-build5.apk`.
  - `/var/www/fruitfit-downloads/fruitfit-latest.apk`.
- Updated app version manifest:
  - version `0.1.1`, build `5`.
  - build `1` sees update, build `5` does not.
- Verified APK headers:
  - `Content-Type: application/vnd.android.package-archive`.
  - `Content-Length: 58378935`.
  - sha256: `7ea09049b0becb285d22ba26c38d39c5de7955f382026fe9c6a3f1bcb74b59c5`.
- Verified public endpoints:
  - `https://api.tagirfruit.ru/api/health`: 200.
  - `https://api.tagirfruit.ru/api/auth/providers/available`: public and returns Telegram, Yandex, Google, Apple placeholder.
  - `https://api.tagirfruit.ru/api/app/version?platform=android&build=1`: `hasUpdate=true`.
  - `https://api.tagirfruit.ru/api/app/version?platform=android&build=5`: `hasUpdate=false`.
- Security scan:
  - frontend build does not contain Yandex/Google/Telegram/JWT/Admin/OpenAI secrets.
  - old production URLs and backend IP were not found as primary API URLs.
  - `Selectel` appears only as non-secret UI/media text in the client bundle.
- ADB install was attempted after APK build, but no Android device was visible to `adb` at that moment.
- Health Connect pipeline and Android native bridge were not changed.

## 2026-06-08 - LMS lecture access policy

- Added backend migration `008_lms_access_policy`.
- Added `app_settings` storage for `lecture_access_policy`.
- Added public client endpoint:
  - `GET /api/lms/lecture-access`.
- Added protected admin endpoints:
  - `GET /api/admin/lms/lecture-access`;
  - `PATCH/PUT /api/admin/lms/lecture-access`.
- Default production policy:
  - `mode=first_n`;
  - `freeLectureCount=3`;
  - `freeLectureIds=[]`;
  - `paidAccess=all`.
- Updated client lecture screen:
  - fetches lecture access policy from backend;
  - free users can open only allowed lectures;
  - paid/vip/admin/trainer users can open all lectures;
  - locked lectures show a paid/VIP access message and disable video actions.
- Updated admin LMS screen:
  - free access mode `first N lectures`;
  - free access mode `custom lecture list`;
  - explicit Paid/VIP all-lectures rule;
  - save via backend admin API.
- Deployed backend patch to `/opt/fruitfit/backend`, applied migration, and restarted PM2.
- Deployed client release:
  - `/var/www/fruitfit-client/releases/20260608T205916Z-lms-access`.
- Deployed admin release:
  - `/var/www/fruitfit-admin/releases/20260608T205917Z-lms-access`.
- Verified:
  - `https://api.tagirfruit.ru/api/health`: 200.
  - `https://api.tagirfruit.ru/api/lms/lecture-access`: returns the default policy.
  - CORS preflight from `https://client.tagirfruit.ru`: 204.
  - `https://client.tagirfruit.ru`: 200.
  - `https://admin.tagirfruit.ru`: 200.
- Admin PATCH was tested with a temporary custom list and reset back to `first_n=3`.
- Security scan:
  - client/admin builds do not contain Yandex/Google/Telegram/JWT/Admin/OpenAI secrets.
  - old production URLs and backend IP were not found.
- Health Connect pipeline and Android native bridge were not changed.

## 2026-06-09 - Profile first-name greeting

- Updated client auth display-name logic:
  - explicit profile `firstName` / `first_name` is used first;
  - greeting uses only the first readable name token;
  - email, provider login, `@username`, URLs, and full FIO are not used in the greeting;
  - if profile first name is empty, fallback is provider name only;
  - final fallback is `спортсмен`.
- Updated profile saving:
  - after `/api/me/profile` save, local auth user profile is refreshed even when backend does not return a new `name`.
- Updated backend profile name normalization:
  - `users.name` is updated only when profile first name exists;
  - last name alone is not promoted into the greeting source.
- Built client successfully with `npm run build`.
- Deployed client release:
  - `/var/www/fruitfit-client/releases/20260608T211058Z-profile-first-name`.
- Backed up and patched backend `src/userState.js`, then restarted PM2.
- Verified:
  - `https://api.tagirfruit.ru/api/health`: 200.
  - `https://client.tagirfruit.ru`: 200.
  - `fruitfit-backend`: online.
- Security scan:
  - frontend build does not contain Telegram/Yandex/Google/JWT/Admin/OpenAI/Selectel/FCM secrets.
  - old production URLs and backend IP were not found.
- Health Connect pipeline and Android native bridge were not changed.

## 2026-06-09 - APK sync for latest client release

- Adopted release rule:
  - after each client release, build and publish a matching APK;
  - update `/api/app/version`;
  - verify the in-app update endpoint used by the "Проверить обновление" button;
  - verify `https://client.tagirfruit.ru/downloads/fruitfit-latest.apk`.
- Bumped Android package version:
  - `versionName=1.5`;
  - `versionCode=6`.
- Built fresh Android debug APK from the current client assets:
  - `npm run android:debug`;
  - local APK: `FruitFit-test-debug.apk`;
  - size: `58,415,170` bytes;
  - sha256: `4495137198e0d4cd57a9f7bb812f53f0ba60fe2bbd9f41ffa2ecb9b5a9786b55`.
- Published APK on the server:
  - `/var/www/fruitfit-downloads/fruitfit-android-v1.5-build6.apk`;
  - `/var/www/fruitfit-downloads/fruitfit-latest.apk` -> `fruitfit-android-v1.5-build6.apk`.
- Updated server manifest:
  - latestVersion `1.5`;
  - latestBuild `6`;
  - minSupportedBuild `1`;
  - updateRequired `false`;
  - apkUrl `https://client.tagirfruit.ru/downloads/fruitfit-latest.apk`.
- Verified version endpoint:
  - build `1`: `hasUpdate=true`;
  - build `5`: `hasUpdate=true`;
  - build `6`: `hasUpdate=false`.
- Verified APK URL:
  - HTTP 200;
  - `Content-Type: application/vnd.android.package-archive`;
  - `Content-Length: 58415170`;
  - curl downloaded the full APK;
  - server sha256 and local sha256 match;
  - local APK zip listing passed.
- Security scan:
  - frontend web assets and packaged Android public assets do not contain Telegram/Yandex/Google/JWT/Admin/OpenAI/Selectel/FCM secrets.
- Note:
  - `adb.exe` was not available in PATH or standard Android SDK locations in this environment, so a physical tap test of the button was not run here.
  - The button path was checked in code: `SettingsScreen.jsx` -> `checkForAppUpdate()` -> `/api/app/version`.

## 2026-06-09 - AI usage accounting and OpenAI webhook readiness

Scope: FruitFit backend + FruitFit Admin web release. Client app, Android native code, Health Connect and Cloudflare DNS were not changed.

Backend changes:

- Added migration `009_ai_usage_accounting`.
- Created `ai_usage_logs` for OpenAI usage accounting:
  - user_id, provider, model, request_id, response_id;
  - prompt/completion/total tokens;
  - estimated_cost_usd;
  - source backend_log/webhook;
  - status completed/failed and error.
- Created `openai_webhook_events`:
  - webhook_id primary key/dedupe;
  - event_id, event_type, response_id, raw_json, created_at.
- Added server-only env keys:
  - OPENAI_WEBHOOK_SECRET;
  - OPENAI_INPUT_COST_PER_1M;
  - OPENAI_OUTPUT_COST_PER_1M;
  - OPENAI_BUDGET_USD.
- Added `POST /api/webhooks/openai` before JSON parsing so raw body is preserved for signature verification.
- Webhook verification uses the OpenAI Node SDK `webhooks.unwrap` path.
- Added webhook dedupe by `webhook-id`.
- Added backend usage logging in `/api/coach` after OpenAI responses and failed OpenAI calls.
- Added Admin API:
  - `GET /api/admin/ai/usage?period=7d|30d|90d`;
  - `GET /api/admin/ai/usage/by-user`;
  - `GET /api/admin/ai/usage/by-model`;
  - `GET/PUT /api/admin/ai/budget` for manual budget/balance.

Admin changes:

- Added Dashboard widget `AI расходы`.
- Widget shows:
  - tokens today;
  - tokens for selected period;
  - estimated cost;
  - requests;
  - average tokens per request;
  - top users by spend;
  - top model;
  - forecast days left from manual AI budget.
- Widget participates in existing dashboard visibility/order/size/collapse settings.

Deploy and validation:

- Backend deployed to `/opt/fruitfit/backend` with backup in `/opt/fruitfit/backend-release-backups`.
- `npm install --omit=dev` completed on server; `openai` SDK installed.
- Migration applied: `009_ai_usage_accounting`.
- PM2 restarted: `fruitfit-backend` online.
- Admin deployed release: `/var/www/fruitfit-admin/releases/20260608T215132Z-ai-usage-widget`.
- `https://admin.tagirfruit.ru` returned HTTP 200.
- Frontend security scan found no OpenAI webhook/API secrets, JWT/Admin tokens, Yandex/Google secrets, Selectel/FCM secrets, or old production URLs in built assets.
- Confirmed tables exist: `ai_usage_logs`, `openai_webhook_events`.
- Admin AI endpoint returned HTTP 200.
- Real OpenAI request from the Moscow VPS returned provider error `Country, region, or territory not supported`; this was recorded in `ai_usage_logs` as `status=failed`, `source=backend_log`, `model=gpt-5-nano`.

Known follow-up:

- `OPENAI_WEBHOOK_SECRET` is not configured yet on the server, so `/api/webhooks/openai` returns 503 until the secret is added.
- After adding the secret, create the webhook in OpenAI Dashboard:
  - URL: `https://api.tagirfruit.ru/api/webhooks/openai`;
  - events: `response.completed`, `response.failed`.
- OpenAI completed usage cannot be tested from the current Moscow VPS while OpenAI returns the regional unsupported error. A supported proxy/region or another backend route is needed for successful completed AI calls.

## 2026-06-11 - Delayed program assignment after Robokassa payment

Scope: FruitFit backend only. Client UI, Admin UI, Tilda, Robokassa secrets, Health Connect and Android native code were not changed.

Backend changes:

- Added delayed automatic program assignment after successful Robokassa payment for `individual_program`.
- `user_access` is still granted immediately after payment.
- Program assignment is now scheduled through persisted `payment_sessions` fields instead of an in-memory timeout.
- Added env-controlled delay:
  - `PAYMENT_PROGRAM_ASSIGNMENT_DELAY_SECONDS=180`;
  - `PAYMENT_ASSIGNMENT_WORKER_INTERVAL_SECONDS=30`.
- Added configurable program price mode:
  - `PROGRAM_PRICE_MODE=test`;
  - `PROGRAM_PRICE_TEST=100`;
  - `PROGRAM_PRICE_PROD=2990`.
- The same `individual_program` product code is used for both the temporary 100 RUB test price and the future 2990 RUB production price.
- Added migration `012_program_assignment_payment_meta`:
  - `user_program_assignments.assigned_at`;
  - `payment_sessions.assignment_status`;
  - `payment_sessions.assignment_due_at`;
  - `payment_sessions.assignment_attempted_at`;
  - `payment_sessions.assignment_error`;
  - `payment_sessions.assigned_program_id`;
  - scheduled assignment index.
- Added backend worker that scans due sessions every 30 seconds and processes `assignment_status='scheduled'`.
- Added admin-protected test endpoint:
  - `POST /api/payments/sessions/:id/simulate-paid`.
- Added backend logs:
  - payment paid;
  - assignment scheduled;
  - assignment started;
  - assignment assigned;
  - assignment pending manual.

Assignment logic:

- Uses `payment_sessions.profile_snapshot` and `payment_sessions.program_params`.
- Matching fields:
  - gender;
  - goal;
  - experience/level;
  - trainingFrequency/frequency/days_per_week;
  - restrictions/limitations.
- Reads courses from PostgreSQL `catalog_documents` where `key='courses'`.
- Scores courses in backend code and selects the highest scoring course.
- Upserts into `user_program_assignments` by `user_id`, so repeated callbacks do not create duplicate assignments.
- Assignment source is `payment/robokassa_delayed`.
- If no matching program is found:
  - payment remains paid;
  - paid access remains active;
  - `payment_sessions.assignment_status='pending_manual'`;
  - `assignment_error='no_matching_program'`.
- VIP does not auto-assign a program:
  - `user_access` becomes `vip`;
  - `assignment_status='pending_manual'`;
  - `assignment_error='vip_manual_coaching'`.

Server validation:

- Migration applied: `012_program_assignment_payment_meta`.
- Backend restarted with PM2 and `/api/health` returned HTTP 200.
- Demo individual-program session with `PROGRAM_PRICE_MODE=test` created amount `100`.
- `simulate-paid` immediately produced:
  - payment saved;
  - `user_access=paid`;
  - `assignment_status=scheduled`;
  - no immediate `user_program_assignments` row.
- Test due time was manually accelerated for only the test session.
- Worker assigned program:
  - `program_id=14506`;
  - `source=payment/robokassa_delayed`;
  - `assignment_status=assigned`.
- `GET /api/me/program-assignment` returned the assigned program for the test user.
- Repeated `simulate-paid` did not create duplicate payments or duplicate program assignments.
- VIP simulation produced:
  - `user_access=vip`;
  - no program assignment;
  - `assignment_status=pending_manual`;
  - `assignment_error=vip_manual_coaching`.

Notes:

- The production server is currently configured for the temporary test price:
  - `PROGRAM_PRICE_MODE=test`;
  - `PROGRAM_PRICE_TEST=100`;
  - `PROGRAM_PRICE_PROD=2990`.
- To return the program price to 2990 RUB, set `PROGRAM_PRICE_MODE=prod` and restart `fruitfit-backend`.

## 2026-06-09 - Admin app version endpoint support

Scope: FruitFit backend version manifest. Client APK, Health Connect, Android native bridge and Cloudflare DNS were not changed.

Backend changes:

- Added separate platform support for `android_admin` in `/api/app/version`.
- Kept existing `android` platform behavior for the client APK unchanged.
- Updated server manifest with:
  - `android_admin.latestVersion=1.1`;
  - `android_admin.latestBuild=2`;
  - `android_admin.minSupportedBuild=1`;
  - `android_admin.updateRequired=false`;
  - `android_admin.apkUrl=null`.

Deploy and validation:

- Backed up `/opt/fruitfit/backend/src/appVersion.js` and `/opt/fruitfit/backend/app-version.json`.
- Deployed backend patch to `/opt/fruitfit/backend`.
- Restarted PM2; `fruitfit-backend` stayed online.
- `https://api.tagirfruit.ru/api/app/version?platform=android_admin&build=2` returned `hasUpdate=false`.
- `https://api.tagirfruit.ru/api/app/version?platform=android_admin&build=1` returned `hasUpdate=true`.

Note:

- Admin cloud APK download is not active yet because the Admin APK was intentionally not uploaded to server downloads in this task.

## 2026-06-11 - Client FREE/PAID/VIP access rules

Scope: FruitFit client web release and owner admin access. Health Connect and Android native bridge were not changed.

Client changes:

- Added shared workout access rules:
  - FREE: first 3 workouts;
  - PAID: first half of assigned program with `Math.ceil(totalWorkouts / 2)`;
  - VIP, ADMIN and TRAINER: all workouts.
- Locked workouts stay visible in the program list and day selector.
- Opening a locked workout shows the configured upgrade/renewal message instead of removing the workout.
- Access and program assignment are refreshed when the app returns to foreground or the browser tab becomes visible, so paid/vip changes can apply without reinstalling the app.
- Nutrition screen now fixes ration type from onboarding profile and limits calorie choices to profile target, -200 kcal and +200 kcal inside that ration.
- Manual ration switching after plan selection is disabled.

Owner access:

- Google user `Meyvaliev3521@gmail.com` was found in PostgreSQL as user `95c0b1a8-c1cc-4f7a-8133-abb06f0e7d29`.
- User role confirmed/set to `admin`.
- `user_access` confirmed/set to `status=admin`, `plan=admin`, `is_active=true`.
- Telegram username `tagirfruit` was not found as a linked Telegram identity yet.

Deploy and validation:

- Client build completed successfully with Vite.
- Deployed client release through `fruitfit-static-deploy`:
  - `20260611T065701Z-access-rules-refresh`.
- Built and published synced Android APK:
  - version `1.7`;
  - build `8`;
  - `/var/www/fruitfit-downloads/fruitfit-android-v1.7-build8.apk`;
  - `/var/www/fruitfit-downloads/fruitfit-latest.apk`.
- Updated `/api/app/version`:
  - build `7`: `hasUpdate=true`, `updateRequired=false`;
  - build `8`: `hasUpdate=false`, `updateRequired=false`.
- APK URL headers:
  - `Content-Type: application/vnd.android.package-archive`;
  - `Content-Length: 57724313`;
  - sha256: `f2b7cda0fc8e4ec264387d31729536f5e65b40385bfe17c9463201d099d24e7c`.
- `https://client.tagirfruit.ru/` returned HTTP 200.
- `https://api.tagirfruit.ru/api/health` returned HTTP 200.
- Frontend build scan found no:
  - old DuckDNS production URL;
  - `fruitfit.pages.dev`;
  - backend IP as API URL;
  - `JWT_SECRET`;
  - `SERVER_ADMIN_TOKEN`;
  - OpenAI key;
  - Google/Yandex/Telegram secrets.

## 2026-06-11 - Admin unrestricted nutrition access

Scope: FruitFit client nutrition access check. Backend, Admin app, Health Connect and Android native bridge were not changed.

Problem:

- Nutrition filtering used only onboarding profile:
  - selected ration type;
  - calculated calories;
  - calories ±200.
- `NutritionScreen` did not receive `accessState`, so ADMIN/TRAINER users were treated like ordinary clients in the nutrition screen.

Client changes:

- Passed `accessState` into `NutritionScreen`.
- Added role check for unrestricted nutrition access:
  - `admin`;
  - `trainer`;
  - `isAdmin`;
  - `isTrainer`.
- For ADMIN/TRAINER:
  - all ration types are shown;
  - all calorie targets are shown;
  - ration switching is enabled.
- For ordinary users:
  - profile ration remains locked;
  - calorie choices remain limited to profile target ±200.

Catalog audit:

- Nutrition catalog contains:
  - 1959 meals;
  - 7 ration types;
  - 10 calorie targets: 1200-3000.

Deploy and validation:

- Client build completed successfully with Vite.
- Deployed client release:
  - `20260611T125228Z-nutrition-admin-unrestricted`.
- Built and published synced Android APK:
  - version `1.8`;
  - build `9`;
  - `/var/www/fruitfit-downloads/fruitfit-android-v1.8-build9.apk`;
  - `/var/www/fruitfit-downloads/fruitfit-latest.apk`.
- Updated `/api/app/version`:
  - build `8`: `hasUpdate=true`, `updateRequired=false`;
  - build `9`: `hasUpdate=false`, `updateRequired=false`.
- APK URL headers:
  - `Content-Type: application/vnd.android.package-archive`;
  - `Content-Length: 57724561`;
  - sha256: `89e0a2bf382c90444abd7bd7293b210b4e3595c543bbf9b84f7e70d57d529c55`.
- `https://client.tagirfruit.ru/` returned HTTP 200.
- `https://api.tagirfruit.ru/api/health` returned HTTP 200.
- Frontend build scan found no old production URLs or server secrets.

## 2026-06-14 - Email/password auth backend foundation

Scope: local backend preparation only. No production deploy, no client/admin UI changes.

Auth audit:

- Existing JWT/session flow stays in `backend/src/auth.js`.
- Telegram, Yandex, Google, test login and admin-session continue to use `auth_identities`.
- Device/installation linking remains in `user_devices` through the existing device registry helpers.

Backend changes:

- Added `email` as an internal auth identity provider.
- Added migration `013_email_password_auth`:
  - `users.email_verified_at`;
  - `user_credentials` with hashed password, email verification token hash and password reset token hash fields.
- Added email auth endpoints:
  - `POST /api/auth/email/register`;
  - `POST /api/auth/email/verify`;
  - `POST /api/auth/email/login`;
  - `POST /api/auth/email/resend-verification`.
- Added bcrypt password hashing through `bcryptjs`.
- Added hashed opaque email verification tokens.
- Added simple in-memory rate limiting for register/login/resend.
- Added SMTP config placeholders and an email sender stub.

Validation:

- `node --check src/auth.js` passed.
- `node --check src/config.js` passed.
- `node --check src/emailSender.js` passed.
- `node --check src/migrations.js` passed.
- `npm run test:payments` passed: 4/4 tests.

Not done yet:

- No real SMTP provider connected.
- Password reset endpoints are schema-ready but not implemented.
- No frontend login UI changes.
- No production deploy.

## 2026-06-14 - MVP SMTP email verification sender

Scope: local backend preparation only. No production deploy, no client/admin UI changes, no Robokassa/payment changes.

Backend changes:

- Replaced the email verification sender stub with a Nodemailer SMTP sender.
- SMTP config is read from backend env:
  - `SMTP_HOST`;
  - `SMTP_PORT`;
  - `SMTP_USER`;
  - `SMTP_PASS`;
  - `SMTP_FROM`;
  - `APP_PUBLIC_URL`.
- SMTP `secure` mode is derived from port:
  - `465` -> secure TLS;
  - other ports -> non-secure transport/STARTTLS flow.
- Verification email now includes:
  - Russian subject: `Подтверждение email в FruitFit`;
  - plain text body;
  - simple HTML body;
  - verification link.
- Local/non-production fallback logs the verification link when SMTP is not configured.
- Production without SMTP returns/logs `SMTP_NOT_CONFIGURED`; SMTP password is never logged.
- Added `nodemailer` backend dependency.
- Added commented domain-mail SMTP example to `backend/.env.example`.

Validation:

- `node --check src/emailSender.js` passed.
- `node --check src/auth.js` passed.
- `node --check src/config.js` passed.
- `npm run test:payments` passed: 5/5 tests.

Not done yet:

- Real domain mailbox credentials are not configured.
- DNS records for domain mail must be supplied by the mailbox provider before production use.
- No production deploy.

## 2026-06-14 - Email/password auth completion with password reset

Scope: local backend preparation only. No production deploy, no client/admin UI changes, no Robokassa/payment/Health Connect changes.

Backend changes:

- Added password reset config:
  - `PASSWORD_RESET_TTL_MINUTES`, default `30`.
- Added SMTP email sender support for password reset emails.
- Added email auth endpoints:
  - `POST /api/auth/email/request-password-reset`;
  - `POST /api/auth/email/reset-password`.
- Reset tokens are generated as opaque random values and stored only as SHA-256 hashes.
- Reset tokens expire and are cleared after successful password change.
- Password reset is available only for verified email credentials.
- Added rate limits for reset request and reset password.
- Added frontend integration contract:
  - `docs/EMAIL_AUTH_CONTRACT.md`.

Validation:

- `node --check src/auth.js` passed.
- `node --check src/emailSender.js` passed.
- `node --check src/config.js` passed.
- `node --check src/migrations.js` passed.
- Email sender module import check passed.
- `npm run test:payments` passed: 5/5 tests.

Not done yet:

- Live SMTP/Brevo send was not tested because production SMTP env is not configured here.
- Full live DB E2E should be run after approved deploy and Brevo env setup.

## 2026-06-14 - Email auth production readiness pass

Scope: local backend hardening only. No production deploy, no client/admin UI changes, no Robokassa/payment/Health Connect changes.

Findings fixed:

- Production register/resend could start email flow before SMTP readiness was checked.
- Password policy only checked length.
- Parallel duplicate registration could surface a database unique violation as a 500.

Backend changes:

- `POST /api/auth/email/register` now returns `SMTP_NOT_CONFIGURED` before creating credentials when production SMTP is missing.
- `POST /api/auth/email/resend-verification` now returns `SMTP_NOT_CONFIGURED` before rotating tokens when production SMTP is missing.
- Password validation now requires:
  - length 8-128;
  - at least one letter;
  - at least one digit;
  - password must not equal the normalized email.
- Duplicate registration race now returns the generic safe `202` response instead of `500`.
- Email auth frontend contract was updated with the new password errors.

Validation:

- `node --check src/auth.js` passed.
- `node --check src/emailSender.js` passed.
- `node --check src/config.js` passed.
- `node --check src/migrations.js` passed.
- `npm run test:payments` passed: 5/5 tests.

## 2026-06-14 - Self-hosted SMTP audit and local SMTP backend support

Scope: audit plus local backend preparation only. No server package installation, no DNS changes, no production deploy.

Server audit:

- VPS `138.16.186.146` runs Ubuntu 26.04 LTS.
- Hostname/PTR currently resolves to `v3154939.hosted-by-vdsina.ru`.
- `fruitfit` user has no passwordless sudo.
- Postfix/Exim/OpenDKIM are not installed or active.
- No SMTP listeners on `25/465/587`.
- Outbound TCP `25` from VPS to Gmail/Yandex/Mail.ru timed out, so direct Postfix delivery is currently blocked.

DNS audit:

- DNS is managed by Cloudflare.
- `tagirfruit.ru` and `www` still point to Tilda.
- `api`, `admin`, `client` point to `138.16.186.146`.
- No `mail.tagirfruit.ru`, MX, SPF, DKIM or DMARC records exist yet.

Backend change:

- `backend/src/emailSender.js` now supports localhost SMTP without auth:
  - `SMTP_HOST=127.0.0.1`;
  - `SMTP_PORT=25`;
  - empty `SMTP_USER`/`SMTP_PASS`.
- `backend/.env.example` documents the local Postfix env.

Validation:

- `node --check src/emailSender.js` passed.
- Email sender import check passed.
- `npm run test:payments` passed: 5/5 tests.

Blockers:

- VDSina must unblock outbound TCP `25`.
- PTR/rDNS must be changed to `mail.tagirfruit.ru`.
- Root/sudo access is required for Postfix/OpenDKIM installation.

## 2026-06-14 - Email auth backend hardening and authenticated payment sessions

Scope: local backend changes only. No production deploy, no Health Connect, program, AI Coach, admin frontend, or Robokassa callback changes.

Backend changes:

- `POST /api/auth/email/register` now requires password confirmation:
  - `confirmPassword`;
  - `confirm_password`.
- Register returns:
  - `MISSING_PASSWORD_CONFIRMATION`;
  - `PASSWORD_CONFIRMATION_MISMATCH`.
- `POST /api/payments/sessions` now requires authenticated user JWT.
- Public payment session creation no longer accepts `userId`/`user_id` from body.
- Payment session `user_id` is taken from `req.user`.
- Demo/admin body `userId` remains allowed only through dev/admin-token paths.
- Email auth frontend contract updated with register and payment-session requirements.

Validation:

- `node --check src/auth.js` passed.
- `node --check src/payments.js` passed.
- `node --check src/emailSender.js` passed.
- `npm run test:payments` passed: 5/5 tests.

## 2026-06-15 - Referral MVP backend

Scope: local backend changes only. No UI, no production deploy, no payouts, no dashboard, no Robokassa amount discounting.

Backend changes:

- Added migration `014_referral_system_mvp`.
- Added `referral_codes` for personal/user referral codes and future campaign/admin promo codes.
- Added `referral_uses` for one-code-per-user application and payment qualification.
- Added `/api/referrals/me/code` to generate/read the current user's personal code.
- Added `/api/referrals/apply` to apply a code before payment and optionally attach it to a payment session.
- Payment sessions can still receive `promoCode`/`promo_code` at creation.
- Referral use is attached to `payment_sessions` when a promo code is present.
- Successful Robokassa payment qualifies the referral use and links `payment_id`.
- Self-referral is blocked.
- `referred_user_id` is unique across referral uses.
- `payment_id` and `payment_session_id` are unique when present.
- Discount preview is stored in referral/session metadata, but Robokassa charge amount is not changed yet.

Validation:

- `node --check src/referrals.js` passed.
- `node --check src/payments.js` passed.
- `node --check src/server.js` passed.
- `node --check src/migrations.js` passed.
- `npm run test:payments` passed: 5/5 tests.

## 2026-06-15 - Referral discount payment amount backend

Scope: local backend changes only. No UI and no production deploy.

Backend changes:

- Added migration `015_payment_amount_breakdown`.
- Added `base_amount`, `discount_amount`, `final_amount` to `payment_sessions`.
- Added `base_amount`, `discount_amount`, `final_amount` to `payments`.
- Kept existing `amount` as backward-compatible `final_amount`.
- Payment session creation now computes price server-side:
  - `base_amount` from `sessionAmount(product)`;
  - `discount_amount` from backend referral code validation;
  - `final_amount` as the Robokassa payable amount.
- Robokassa checkout `OutSum` uses `final_amount`.
- Robokassa result callback now rejects mismatched `OutSum` versus expected session final amount before access is issued.
- Successful payment stores the full amount breakdown in `payments`.
- Repeat referral discount after a qualified first purchase is blocked before checkout.

Validation:

- `node --check src/migrations.js` passed.
- `node --check src/referrals.js` passed.
- `node --check src/payments.js` passed.
- `node --check src/server.js` passed.
- `npm run test:payments` passed: 5/5 tests.

## 2026-06-16 - Client payment/referral/access/admin/activity patch

Scope: client app only. Backend, SMTP, Robokassa callback, Health Connect native internals, Programs Admin, and AI Coach internals were not changed.

Client changes:

- Removed the external promo-code input from profile; profile now shows only the personal referral block with "Ваш код", "Приглашено", "Бонус: 14 дней", copy, and share actions.
- Referral code loading now avoids a final `-` state and uses `/api/referrals/me/code` with fallback reads.
- Payment CTA now sits directly under the access status card for all access states. It requires JWT, creates `/api/payments/sessions` with only `productCode` and `recurringEnabled`, and opens `https://tagirfruit.ru/payment?ps=<session.id>`.
- Client no longer sends `userId`/`user_id`, price, profile snapshot, program params, promo code, or referral code when creating a payment session.
- Added admin access card state: `FruitFit Admin`, "Админ-доступ", active meta, and a fully filled infinity ring.
- Infinite access rings now show only `∞` with no bottom caption. Paid/VIP access with an expiry shows the day count and `дней`.
- Kept Free/Pro/VIP tariff card behavior and ring styling; dark theme still uses green/lime, light theme uses orange.
- Replaced the technical AI Coach first-screen copy with user-facing text: header copy no longer mentions server/limits, and the welcome uses the profile first name when available, introduces AI Coach FruitFit, credits Tagir Meyvaliev as creator, and states that the Coach helps with training, nutrition, recovery, load, and daily decisions.
- FREE access now renders only preview workouts: 2 for two-day programs, 3 for three-day programs, maximum 3. Extra workouts are hidden from the list.
- Email verify/reset links route into `AuthPrompt` screens instead of opening the regular home screen.
- Settings now shows app icon, theme, VIP/admin trainer report, logout, and working account deletion. Payment methods/history/export placeholders are hidden.
- Account deletion calls `DELETE /api/me/account` with `{ "confirm": true }`, then clears local auth/JWT and returns to login.
- Payment return refresh now includes access, program assignment, and referral code.
- VIP/admin trainer report is restored in settings and sends progress photos, subjective scores, comments, and real saved measurements to `/api/me/trainer-reports`. Trainer/test users do not see this block.
- Added backend-only subscription contract: `GET /api/payments/subscription` returns the current recurring renewal state, and `POST /api/payments/subscription/cancel` disables renewal without changing already paid access dates.
- Weekly activity history now prefers date-stamped Health/local history values for steps, active calories, and total calories. The client overlays today's live Health Connect totals and local dated history over empty/stale native weekly slots, then rebuilds `history7d` from the calendar-aligned series.
- Weekly activity UI now shows weekday plus compact date labels in the chart and selected-day summary.
- Measurement history now filters old demo `sim-*` rows and date-only empty rows, and prevents saving a new measurement unless at least one body metric is filled.
- Android notifications now have a FruitFit orange small icon resource plus orange icon color in Capacitor config, per-notification payloads, and Firebase default notification manifest metadata. The large local-notification icon points to the bundled orange artwork.

Validation:

- `npm run build` passed. Only the existing Vite large chunk warning was reported.
- `npx cap sync android` passed.
- `.\gradlew.bat assembleDebug` passed.
- APK built at `android/app/build/outputs/apk/debug/app-debug.apk`.
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded on device `8f647179`.
- Live APK WebView check after Health sync showed fixed weekly activity values and labels: `Вс 14.06` 12,718 steps, `Пн 15.06` 28,056 steps, `Вт 16.06` 24,995 steps / 1,102 active kcal.
- Live APK settings check showed restored VIP/admin trainer report, measurements preview, submit report button, logout button, and account deletion block. Current real-measurement preview was `0` after demo/empty measurement filtering.
- Local Browser checks passed:
  - profile shows payment button under access status;
  - referral block has no external promo-code input;
  - settings shows only app icon/theme/account deletion and hides payment methods/history/export;
  - AI Coach welcome text is non-technical and name-aware;
  - `/email/verify?token=...` opens the email verification screen;
  - FREE workout list shows only two workouts for the current two-day program;
  - activity detail route opens without runtime errors.

Manual phone checks still needed:

- Confirm real admin account shows `FruitFit Admin` with only the infinity icon in the fully filled ring after `/api/me/access` and `/api/me` refresh.
- Refresh Health Connect activity on the phone and confirm Tuesday receives Tuesday's real steps/active calories instead of shifted cached data.
- With a real JWT, press payment CTA and confirm backend session creation plus Tilda URL with `?ps=`.
- Test real account deletion only on a disposable account.
