# FruitFit Health Data Integration

Status: architecture scaffold, web/PWA safe fallback.

## Shared JS layer

The app now uses `src/services/health/healthProvider.js` as the single frontend contract for health data:

- `getHealthAvailability()`
- `requestHealthPermissions()`
- `getSteps(range)`
- `getCalories(range)`
- `getHeartRate(range)`
- `getSleep(range)`
- `getSleepStages(range)`
- `getDistance(range)`
- `getExerciseSessions(range)`
- `getWeight(range)`

States:

- `not_supported`
- `not_installed`
- `permissions_required`
- `connected`
- `no_data`
- `error`

On web/PWA the provider does not simulate data. It returns `not_supported` / `no_data`, and widgets show clean empty states.

## Android plan: Health Connect

Use Health Connect as the primary Android source. The native Capacitor plugin should expose `window.Capacitor.Plugins.FruitFitHealth` with the same method names as the JS provider.

Data to read:

- steps
- active calories / calories burned
- heart rate samples
- sleep sessions
- sleep stages
- distance
- exercise sessions
- weight, if the user grants access

UX states:

- Health Connect missing: show “Установите Health Connect”.
- Permissions missing: show “Разрешите доступ к данным здоровья”.
- No data: show “Нет данных за выбранный период”.

Manifest permissions must be added in the native Android project when the plugin is implemented. Confirm the exact Health Connect permission constants against the current Android documentation during native implementation.

## iOS plan: Apple HealthKit

Use Apple HealthKit for iOS native builds. The native Capacitor bridge should expose the same `FruitFitHealth` plugin API.

Required native setup:

- HealthKit capability.
- `NSHealthShareUsageDescription`.
- `NSHealthUpdateUsageDescription` only if FruitFit later writes health data.

First version should read only:

- steps
- active energy burned
- heart rate
- sleep analysis
- walking/running distance
- workouts/exercise sessions
- body mass, if granted

## Privacy

Health data must not be sent to the server automatically. For now it stays local and is used only for widgets, recovery/readiness display, and future workout-context decisions.
