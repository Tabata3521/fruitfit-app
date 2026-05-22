# WORKLOG - FruitFit Food Database & Nutrition Parser

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
