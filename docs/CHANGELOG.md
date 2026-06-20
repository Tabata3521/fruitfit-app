# FruitFit Changelog

This is a human-readable project log. Add entries whenever behavior changes.

## 2026-06-18

### Client Data Access Cache Recovery

- Added a client data access layer over validated user-scoped containers.
- Restored `currentWorkout` in `fruitfit.user_core:<userId>` and recalculates it from the active program plus program assignment.
- AI Coach now sends sanitized scoped context with profile, access, program assignment, current workout, Health snapshot, and recent chat messages.
- Client `/api/me` handling now writes returned profile and program assignment into the current user's core container.
- Program assignment changes clear stale current workout before recalculation.
- Weekly metric details now use `history7d.calories` for calories the same way steps use `history7d.steps`.

### Android Loading Theme Flicker Guard

- Loading screen now receives the saved app theme before React starts, so light theme starts on a light surface and dark theme starts on a dark surface.
- Android launch splash now uses light/night resource colors to reduce the native splash to WebView color jump.
- Added a stable themed loading surface to prevent startup height/paint transitions.
- Health widget investigation only: activity uses `history7d`, steps detail already sums `history7d.steps`, while calories detail still does not consume `history7d.calories` in the same path. No widget behavior was changed in this pass.

### Security Architecture Data Container Isolation

- Added strict user-scoped containers: `fruitfit.user_core:<userId>`, `fruitfit.health:<userId>`, and `fruitfit.ai_memory:<userId>`.
- Profile, access, program assignment, measurements, avatar, paid program lock, Health metrics/history, and AI Coach chat history now go through validated container reads.
- Any cache read with missing or mismatched `userId` is rejected and cannot be shown as current-user data.
- Logout deletes the current user's containers and legacy scoped sensitive keys, then clears in-memory sensitive state.
- Health widgets use one validated Health container so `history7d.steps` and `history7d.calories` remain attached to the same snapshot.
- AI Coach local memory is isolated from UI/Health cache, and backend `/api/coach` now requires auth and builds server context from `req.user.id`.

### Android Back Navigation Native Fallback

- Android hardware/swipe back now goes through a shared FruitFit navigation handler before the app is allowed to minimize.
- Added a native WebView fallback in `MainActivity` so back navigation still reaches the app router when Capacitor's JS back listener is skipped.
- Internal routes pop the FruitFit route stack or return to home; the app minimizes only from home.
- No Health, payments, FCM, or business logic was changed.

### Questionnaire Paid-Cycle Program Behavior

- Questionnaire/profile edits no longer switch the current PAID/VIP workout program immediately on the client.
- FREE users still get immediate profile-driven program selection, with existing preview limits.
- PAID/VIP users keep the current paid block by server assignment or user-scoped `fruitfit.paidProgramLock:<userId>`.
- Nutrition remains profile-driven and can update immediately after questionnaire changes for every access tier.
- Authenticated app payment sessions now get the current saved backend profile snapshot without sending profile/user id from the client.
- Recurring program assignment now uses the current profile for the next paid cycle while the first paid cycle keeps the payment-session snapshot.

### Profile Defaults and Greetings

- Profile name field placeholders are now `Имя` and `Фамилия` instead of person-specific examples.
- Home greeting now uses an explicitly entered profile first name; otherwise it falls back to `спортсмен`, `спортсменка`, or `спортсмен` when gender is unknown.
- AI Coach welcome no longer uses auth/provider names as a first-name fallback, so it does not address an unnamed user as `Тагир`.
- If the user has not entered a first name, AI Coach also avoids the literal creator name in the default welcome text.

### Health Weekly UI Mapper

- Weekly activity UI now uses a normalized 7-day local calendar range.
- `history7d.steps` and `history7d.calories` are preferred by date when present, so the activity widget and activity detail screen do not drop recent days because `activity_history.week` is stale.
- `Шаги -> Неделя` now sums the normalized `history7d.steps` rows and uses `steps.detailValue` only when weekly history rows are absent.
- Weekly rows with zero values remain visible when the JSON contains those dates.

### User-Scoped Client Cache Isolation

- Fixed confirmed localStorage leakage between accounts on Android WebView.
- Sensitive local caches now use user-scoped keys and envelope values with `userId`, `savedAt`, and `data`.
- Profile, avatar, measurements, Health snapshot/history, access state, program assignment, and VIP report local fallbacks no longer read legacy global keys for authenticated users.
- Logout and account switching now reset in-memory sensitive UI state so the next account cannot see the previous account's profile, health, measurements, access, or program cache.
- Legacy global sensitive keys are removed after authenticated user load.
- Added debug logs for cache accepted/rejected, logout sensitive-state clearing, and login user-switch detection.

### Steps Detail Weekly Total

- Fixed `Шаги -> Неделя` so the detail screen uses `health.history7d.steps` as the source of truth when weekly history exists.
- Weekly total is now `sum(history7d.steps[].value)` with a `70000` step goal; `steps.detailValue` is only a fallback when weekly history is empty.

### AI Coach Chat History

- AI Coach chat now persists locally for 30 days per account under `fruitfit.aiCoach.chat:<userId>`.
- Stored messages include `id`, `userId`, `role`, `content`, and `createdAt`.
- Opening the chat, sending a message, and saving history prune messages older than 30 days.
- Account switching/logout reloads only the current user's scoped chat history, so another account does not see the previous account's chat.
- `/api/coach` requests now send the current message plus the last 12 local messages for the current user.

### Client Workout Visibility Hard Cap

- Added a client-side workout visibility guard in `src/data/accessRules.js`.
- Admin users can still see all workouts.
- Non-admin users are capped after server restrictions: 24-workout programs show at most 12 workouts, and 16-workout programs show at most 8 workouts.
- Existing backend limits such as `visibleWorkoutIds` and `visibleWorkoutCount` are respected first, so the client never expands a server-limited list.
- Hidden workouts are not rendered as locked cards, and workout day navigation uses the same visible list.
- Added dev/debug visibility logs with total count, server count, hard cap, final visible count, user role, and access level.

### Profile Access Ring Progress

- Profile Pro/VIP access rings now shrink proportionally to the paid time remaining.
- Monthly access without an explicit start date falls back to a 30-day duration, so a fresh 30-day purchase renders as full and then decreases over time.
- Free and admin/infinite access rings remain fully filled with the infinity symbol.

### Theme Boot Flash Guard

- Saved app theme is now applied from `index.html` before React starts, preventing the dark theme from briefly rendering on the light default.
- Theme changes update `color-scheme` and the page `theme-color` meta.
- Android launch background now uses a dark brand color instead of the default white splash.

### Android Back Navigation

- Android back/swipe now uses an internal app route stack before falling through to app minimize.
- Browser/history metadata can be cleared by auth/cache flows without breaking in-app back navigation.
- The app minimizes only when the current screen is already home and there is no previous in-app screen.

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
