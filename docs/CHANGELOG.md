# FruitFit Changelog

This is a human-readable project log. Add entries whenever behavior changes.

## 2026-06-16

### iOS Local Build and HealthKit Preparation

- Added Capacitor iOS platform for local Mac/Xcode installation on iPhone.
- Added `@capgo/capacitor-health` as the iOS Apple HealthKit provider while keeping Android on the existing `FruitFitHealth` Health Connect bridge.
- Added read-only HealthKit capability and `NSHealthShareUsageDescription`; Apple Health write permission is not requested.
- Added iOS health adapter for steps, active calories, sleep, heart rate, distance, workouts, and weight through the existing health provider interface.
- Added `ios:sync` and Android sync hardening so the iOS-only Capgo health plugin is not wired into Android Gradle builds.
- Subscription cancellation now accepts an optional backend `cancelUrl`/`cancel_url`/`url` response and opens it without hardcoding any subscription id.
- Added `docs/IOS_BUILD.md` with local Xcode/free provisioning install steps.
- Validation: `npm run build`, `npm run ios:sync`, `npm run android:sync`, and `android/gradlew assembleDebug --no-daemon` passed; Vite still reports only the existing large chunk warning.

### Client Payment, Referral, Access, and Activity Patch

- Nutrition day chips now normalize weekday order in the client as `Понедельник → Вторник → Среда → Четверг → Пятница → Суббота → Воскресенье`, even when `public/data/nutrition.json` provides `filters.days` out of order.
- Profile avatar now persists across app restarts: selected photos are cropped/compressed before saving, stored under `fruitfit.avatar`, mirrored into the local/server profile as `avatar`, and restored from local/profile/auth-user fallbacks on app entry.
- Profile referral now shows only the user's own referral block: code, invited count, 14-day bonus, copy, and share actions. The old external promo-code input is removed from the profile UI.
- Payment CTA is visible directly under the access status card and creates a backend payment session only with JWT plus product metadata before opening `https://tagirfruit.ru/payment?ps=<session.id>`.
- Access card now has a dedicated `FruitFit Admin` state with a fully filled infinity access ring. Free, Pro, and VIP states remain distinct.
- Infinite access rings now show only `∞` without a bottom caption; paid/VIP rings with an expiry show the numeric days count plus `дней`.
- AI Coach first-screen copy is now non-technical: the header is plain user-facing text, and the welcome message uses the user's first name when available, introduces the Coach, says it was created by Tagir Meyvaliev for FruitFit, and explains what it can help with.
- FREE users now see only the program preview workouts: 2 for two-day programs, 3 for three-day programs, maximum 3. Hidden workouts are not rendered as locked list items.
- Email verify/reset links open the auth flow directly instead of falling through to the regular home screen.
- Settings now keeps app icon, theme, VIP/admin trainer report, logout, and working account deletion. Payment methods, payment history, and export placeholders are hidden.
- VIP/admin trainer report is visible again and submits progress photos, scores, comments, real saved measurements, `healthSummary`, and compact Health Connect data to `/api/me/trainer-reports`: steps, active/total calories, sleep, heart rate, readiness, and calendar-aligned weekly activity.
- Subscription UI now uses backend-only subscription endpoints: `GET /api/payments/subscription` and `POST /api/payments/subscription/cancel`. Cancelling turns off renewal while preserving paid access until the paid-until date. The profile now always shows the auto-renewal block for authorized paid/VIP/admin users; if no recurring subscription exists, it explicitly says that active auto-renewal was not found.
- Weekly activity history is bound to local calendar dates and now overlays dated local Health history/today values over empty native weekly slots, so days like `Вс 14.06`, `Пн 15.06`, and `Вт 16.06` do not disappear after Health Connect sync.
- Weekly activity chart labels now show both weekday and date.
- Measurement history now keeps only real saved measurements; old demo `sim-*` rows and empty date-only rows are filtered out, and new empty measurements cannot be added.
- Android local notifications now use a FruitFit orange notification icon resource instead of the generic system info icon, with the orange app artwork as the large notification icon.

Validation:

- `npm run build` passed; Vite only reported the existing large chunk warning.
- `npx cap sync android` passed.
- `android/gradlew assembleDebug` passed.
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded on device `8f647179`.
- Follow-up build after the Health-in-VIP-report and subscription-visibility changes also passed `npm run build`, `npx cap sync android`, and `android/gradlew assembleDebug`. The follow-up APK installed successfully on device `8f647179`. Device `bac22b47` was visible too, but install there was intentionally rejected on the tablet (`INSTALL_FAILED_USER_RESTRICTED`).
- Follow-up APK after the nutrition weekday and avatar persistence fixes passed `npm run build`, `npx cap sync android`, and `android/gradlew assembleDebug --no-daemon`; `adb install -r` succeeded on phone `8f647179` with `versionName=1.9`, `versionCode=10`, `lastUpdateTime=2026-06-16 23:44:33`, and the app was launched.
- Live APK Health detail check after sync showed calendar-aligned activity: `Вс 14.06` 12,718 steps, `Пн 15.06` 28,056 steps, `Вт 16.06` 24,995 steps and 1,102 active kcal.
- Live APK settings check showed the VIP/admin trainer report, measurements preview, submit report button, logout button, and account deletion block.
- Local Browser checks passed for profile payment/referral UI, settings cleanup, email verify route, activity detail route, and FREE workout preview.

## 2026-05-17

### Workout Warm-Up UI

- Polished the workout warm-up accordion in `src/screens/WorkoutScreen.jsx`.
- Warm-up now opens by default and uses a more compact premium dark card.
- Added structured joint cards, short movement cues, and cleaner duration/safety/breathing tips.
- Added `docs/WORKLOG.md` as an operational journal for parallel development.
- No admin, backend, nutrition, video, replacement, or anatomy mapping logic was changed.

## 2026-05-16

### Manual Anatomy Mapping

- Added `src/data/anatomyMuscleMapping.js`.
- Switched anatomy image lookup to manual muscle label mapping.
- Added canonical labels, aliases, and explicit label-to-image asset paths.
- Added extracted manual anatomy assets under `public/muscle-templates/manual/`.
- Updated `src/data/muscleTemplates.js` to return image info from label mapping.
- Updated `src/components/MuscleWorkBlock.jsx` to render image assets directly with `object-fit: contain`.
- Updated `scripts/audit-muscle-templates.mjs` to audit label/image status, not just template presence.

Audit after the change:

- total exercises: 190
- exact mapped ok: 167
- alias used: 23
- missing images: 0
- missing labels: 0
- needs review: 25

Known review item:

- biceps-related labels use `upper_biceps_needs_review.jpg` because the xlsx referenced a missing `xl/media/image35.png`.

### Replacement Undo

- Added `Вернуть` button for replaced exercise in `WorkoutScreen.jsx`.
- Undo removes the replacement from localStorage so original exercise, video, description, and anatomy image are restored together.

### Deploy

- Production build succeeded.
- Deployed to https://fruitfit.pages.dev/
- Latest known JS bundle after deploy: `index-BBvDipfb.js`.

## 2026-05-15 and Earlier

### Videos and Lectures

- Exercise videos are intended to prefer Selectel / Russian-hosted URLs.
- Lecture migration to Selectel was worked on previously.
- YouTube should be treated as fallback or temporary source, not the stable production video base.

### Training App MVP

- Built mobile-first FruitFit PWA.
- Added Home, Workout, Nutrition, Coach, Profile, widgets, timers, measurements, and replacement logic.

### InSkill Parser

- Earlier work parsed InSkill programs into local JSON/CSV exports.
- Parsed training data feeds the app via `public/data`.
