# WORKLOG - FruitFit Food Database & Nutrition Parser

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
