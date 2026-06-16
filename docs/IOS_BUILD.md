# FruitFit iOS Local Build

Инструкция для локальной установки FruitFit на iPhone через Mac/Xcode. TestFlight и App Store сейчас не используются.

## Что уже подготовлено

- Capacitor iOS platform: `ios/`.
- Bundle ID по умолчанию: `com.tagirfruit.fruitfit`.
- App name: `FruitFit`.
- Web assets берутся из `dist`.
- Native build использует bundled assets, `server.url` не задан.
- API клиента остаётся `https://api.tagirfruit.ru`.
- iOS Health работает через Apple HealthKit и `@capgo/capacitor-health`.
- Android Health Connect остаётся на существующем Android native bridge.

## Mac Setup

1. Установи Xcode из App Store.
2. Установи Node.js LTS.
3. Клонируй репозиторий:

```bash
git clone <repo-url>
cd <repo-folder>
```

4. Установи зависимости:

```bash
npm install
```

5. Собери web assets:

```bash
npm run build
```

6. Синхронизируй iOS:

```bash
npx cap sync ios
```

Можно одной командой:

```bash
npm run ios:sync
```

## Xcode Local Device Install

1. Открой Xcode.
2. Открой `ios/App/App.xcworkspace`.
   - В проекте используется Capacitor 8 + Swift Package Manager.
   - Если Xcode попросит или workspace не откроется, открой `ios/App/App.xcodeproj`.
3. Выбери target `App`.
4. Открой `Signing & Capabilities`.
5. Выбери личный `Team` Apple ID.
6. Если Xcode ругается на Bundle Identifier, смени его на уникальный, например:

```text
com.<yourname>.fruitfit
```

7. Проверь, что capability `HealthKit` включена.
8. Подключи iPhone по кабелю.
9. Выбери iPhone как Run destination.
10. Нажми `Run`.
11. Если iPhone заблокирует запуск, открой на iPhone:

```text
Settings -> General -> VPN & Device Management
```

и доверься Developer App для своего Apple ID.

Free provisioning обычно требует переустановки локального билда примерно раз в 7 дней.

## HealthKit

FruitFit запрашивает только чтение Apple Health:

- steps;
- active calories;
- sleep;
- heart rate;
- distance;
- workouts;
- weight.

В `Info.plist` добавлен:

```text
NSHealthShareUsageDescription
```

Текст permission:

```text
FruitFit uses Apple Health data to show steps, activity, sleep, heart rate, and recovery inside the app.
```

Запись в Apple Health на первом этапе не используется, поэтому `NSHealthUpdateUsageDescription` не добавлен.

## Что Проверить На iPhone

1. Первый запуск приложения.
2. Login/register.
3. Email verify route:

```text
/email/verify?token=...
```

4. Reset password route:

```text
/email/reset-password?token=...
```

5. Profile:
   - статус доступа;
   - кнопка оплаты под статусом;
   - реферальный блок;
   - аватар после перезапуска.
6. Workouts:
   - без login/free видно только preview 2-3 тренировки;
   - paid/vip/admin видят полный список.
7. Payment:
   - без login открывается login/register;
   - с login создаётся backend payment session;
   - открывается Tilda/Robokassa checkout.
8. Subscription:
   - cancel renewal идёт через backend с JWT;
   - в клиенте нет захардкоженного subscriptionId.
9. Health:
   - iOS просит доступ к Apple Health;
   - отказ в доступе не крашит приложение;
   - при пустом Apple Health показывается empty state;
   - при разрешении подтягиваются шаги, активные kcal, сон, пульс, дистанция, тренировки/вес при наличии.

## Возможные Блокеры

- HealthKit entitlement должен быть принят Xcode signing.
- С free provisioning Apple ID Xcode может попросить уникальный Bundle Identifier.
- Если личный Team не подпишет HealthKit capability, проверь `Signing & Capabilities` и попробуй уникальный Bundle ID. Если Xcode всё равно не даст подписать HealthKit, потребуется Apple Developer Program или временная сборка без HealthKit capability.
- Windows не может выполнить реальную iOS-сборку; финальный build/run делается на Mac в Xcode.
