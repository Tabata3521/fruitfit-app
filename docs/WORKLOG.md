# WORKLOG - FruitFit Food Database & Nutrition Parser

## 2026-07-01 - iOS registration privacy consent

Scope: iOS/App Store registration compliance. No backend, payments, HealthKit, Firebase, or Android release logic changes were made.

- Added a required privacy/personal data processing consent checkbox to the email registration form.
- Linked the consent text to the public policy page: `https://tagirfruit.ru/privacy-policy`.
- Blocked `/api/auth/email/register` submission until the user accepts the consent.
- Switched the policy link to `https://tagirfruit.ru/privacy-policy` and added Capacitor Browser so it opens in-app instead of handing users to an external browser.

## 2026-06-29 - iOS release-candidate sync

Scope: iOS/App Store release-candidate preparation. No backend, Robokassa, auth redirects, HealthKit connector logic, or Firebase config changes were made.

- Synced current Android release-candidate client changes into the iOS branch.
- Kept iOS marketing version `1.0` and bumped iOS build number to `3`.
- Added Codemagic workflow `fruitfit-ios-app-store` for signed IPA generation without automatic publishing.
- Kept App Store release signing/APNS settings from the iOS branch.
- Included nutrition/TDEE fixes and local bundled nutrition images.
- Included AI Coach first-use OpenAI consent and Settings privacy section.
- Replaced payment CTAs with `Оформить персональную программу`.
- Hid the automatic renewal block only on iOS.
- Preserved server/admin muscle map overrides and local muscle map cache.
- Normalized server-relative muscle map paths like `/uploads/...` to `https://api.tagirfruit.ru/...`; bundled `/muscle-templates/...` assets remain local.

Validation:

- `npm run build` passed.
- `npx cap sync ios` passed.
- Forbidden UI text grep returned no matches for old payment/debug/video strings.
- Nutrition data in iOS assets has `1960` local image paths, `0` remote photo URLs, and `0` missing local images.

## 2026-06-25 - iOS lecture/auth UX cleanup

Scope: iOS client UX on the `ios-first-build` branch. Backend, payments backend, Android main workspace, HealthKit native reads, AI Coach, and push delivery were not changed.

- Removed the startup `РџСЂРѕРґРѕР»Р¶РёС‚СЊ Р±РµР· СЂРµРіРёСЃС‚СЂР°С†РёРё` button and stopped honoring the legacy `fruitfit.authSkipped` flag.
- Removed technical lecture helper text under the video player, including Selectel/HTML5/YouTube fallback copy.
- Added the sixth free lecture CTA: `РЈ С‚РµР±СЏ РІСЃС‘ РїРѕР»СѓС‡РёС‚СЃСЏ! рџ’Є` plus `РљСѓРїРёС‚СЊ РїРѕР»РЅС‹Р№ РєСѓСЂСЃ`.
- The lecture CTA uses the existing JWT-only payment session flow and opens the configured payment page with `ps=<session.id>`.
- Updated the settings step-source picker in this iOS branch/web preview to use Apple Health-oriented sources instead of Android/Google Fit defaults.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync ios` passed; `ios/App/CapApp-SPM/Package.swift` paths were restored to Mac-safe forward slashes after sync.

## 2026-06-25 - Apple Health source-aware steps/calories

Scope: iOS HealthKit client mapping on the `ios-first-build` branch. Android Health Connect, backend, payments, AI Coach, push delivery, and native Swift plugin code were not changed.

- Added iOS `readSamples` source breakdown for steps and active calories in addition to the Apple Health aggregate.
- Apple Health aggregate remains the default Auto source.
- If the user selects Apple Watch, Fitbit, Garmin, WHOOP, or Oura and HealthKit returns that source, steps/calories and weekly history use only samples from that source.
- Source options for Apple Watch/Fitbit/Garmin/WHOOP/Oura are shown only when HealthKit actually reports that source.
- Added Apple Health aggregate handling in the health mapper so selected iOS sources are not treated as diagnostics-only.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync ios` passed; `ios/App/CapApp-SPM/Package.swift` paths were restored to Mac-safe forward slashes after sync.

## 2026-06-21 - Android Firebase Messaging sync

Scope: Android Firebase Cloud Messaging setup on the `ios-first-build` branch. Huawei-specific build scripts, backend, payments, Robokassa, Health Connect aggregation, and iOS Firebase plist were not changed.

- Reused the same Firebase Messaging token registration layer for Android and iOS.
- Added Android `google-services.json` for package `com.tagirfruit.fruitfit` in Firebase project `fruitfit`.
- Added Android 13+ `POST_NOTIFICATIONS` permission.
- Ran Capacitor Android sync so `@capacitor-firebase/messaging` is included in Android Gradle settings/build files.
- Added Android notification channels for admin and motivation notifications through Firebase Messaging.
- Did not add the legacy `@capacitor/push-notifications` plugin.

Validation:

- `npx cap sync android` passed and reported `@capacitor-firebase/messaging`, `@capacitor/app`, `@capacitor/local-notifications`, and `@capgo/capacitor-health`.
- Android Firebase config matches project number `518207427141` and package `com.tagirfruit.fruitfit`.
- Android `assembleDebug` passed with the shared local JDK/Android SDK from the main Android workspace.
- `npx cap sync ios` was rerun after the shared push service update; `Package.swift` paths were normalized back to Mac-safe forward slashes.

## 2026-06-21 - Firebase iOS push notifications setup

Scope: iOS Firebase Cloud Messaging setup on the `ios-first-build` branch. Backend, Android native project, Robokassa, payments, Health Connect/HealthKit aggregation, and app architecture were not changed.

- Added the Firebase iOS app for bundle id `com.tagirfruit.fruitfit` in project `fruitfit`.
- Added `ios/App/App/GoogleService-Info.plist` for the iOS app.
- Added `@capacitor-firebase/messaging` and Firebase Web SDK dependencies for iOS FCM token support.
- Added iOS Firebase Messaging plugin configuration with foreground presentation options.
- Added Push Notifications entitlement and Background Modes `remote-notification`.
- Added AppDelegate remote-notification callbacks required by the Firebase Messaging Capacitor plugin.
- Added iOS-only FCM token registration after successful auth/session restore; token registration posts to `/api/push/register-token` with `provider=fcm` and `platform=ios`.
- Kept Android push delivery untouched in this branch.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync ios` passed after switching away from Windows-blocked SPM symlink mode.
- `ios/App/CapApp-SPM/Package.swift` was normalized to Mac-safe forward-slash paths after sync.
- Verified bundle id is `com.tagirfruit.fruitfit` in Capacitor config, Xcode project, and `GoogleService-Info.plist`.

## 2026-06-21 - Move step source settings out of profile diagnostics

Scope: client Profile/Settings health UI on the `ios-first-build` branch only. Health native reads, backend, payments, AI Coach, push delivery, and Xcode signing were not changed.

- Removed the expanded diagnostics block from the profile health section.
- Removed profile UI access to raw health JSON generation/copy/share.
- Moved step source selection into Settings as the advanced activity source settings section.
- Updated the description to explain this is for choosing a more accurate step source when devices/apps duplicate step data.
- Source changes still save to `fruitfit.health.preferredSourcePackage` and trigger a 7-day health resync.
- Added Apple Health/HealthKit preference recognition to source matching.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync ios` passed on Windows; `ios/App/CapApp-SPM/Package.swift` was restored to Mac-safe forward-slash paths before commit.
- iOS install was not run on Windows; pull/build/sync is required on Mac.

## 2026-06-21 - Referral copy text update

Scope: client profile referral block on the `ios-first-build` branch only. Referral backend, payments, push delivery, AI Coach, HealthKit, and Xcode signing were not changed.

- Updated the referral block headline from generic referral/program wording to `Р”РµР»РёСЃСЊ РїСЂРѕРјРѕРєРѕРґРѕРј: С‚РµР±Рµ 14 РґРЅРµР№, РґСЂСѓРіСѓ 1000 в‚Ѕ!`.
- Updated explanatory referral copy to say the user shares a promo code.
- Changed the bonus card label to `Р’Р°С€ Р±РѕРЅСѓСЃ` and text to `14 РґРЅРµР№ РїСЂРµРјРёСѓРјР°`.
- Reworded the bottom explanation to use `РїСЂРѕРјРѕРєРѕРґ` instead of program-sharing language.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- iOS install was not run on Windows; pull/build/sync is required on Mac.

## 2026-06-21 - iOS push message library parity

Scope: shared push content library for the `ios-first-build` branch only. iOS/APNs token setup, backend push delivery, payments, AI Coach, HealthKit, and app signing were not changed.

- Replaced `daily_motivation` with the current 50-message motivation set used by the Android client.
- Replaced `discipline_gym_etiquette` with the current 15-message gym order/cleanup set.
- Added `weekly_progress_praise` with 10 conditional weekly positive reinforcement messages.
- Added `female_cycle_messages` with 12 conditional cycle-aware messages grouped by `phase`.
- Kept `clarification_messages` unchanged.

Validation:

- `node -e "import('./shared/pushMessages.js')..."` passed and reported message counts: `50 / 15 / 35 / 10 / 12`.
- `npm install` passed in the clean iOS branch clone.
- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync ios` passed on Windows; `ios/App/CapApp-SPM/Package.swift` paths were kept in Mac-safe forward-slash format.

## 2026-06-20 - Admin nutrition unrestricted ration and calories

Scope: client nutrition screen only. Payments, Robokassa, email auth, Health Connect, AI Coach, program assignment, and backend were not changed.

- Passed the authenticated user into `NutritionScreen` so the nutrition UI can apply admin-only client overrides.
- Added unrestricted nutrition access for admin/trainer roles and the admin email `meyvaliev3521@gmail.com`.
- Admin nutrition mode now shows all available ration types from the nutrition dataset.
- Admin nutrition mode now shows all available calorie targets from the nutrition dataset.
- Regular users still see only the questionnaire-derived ration and single calorie target.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-20 - AI Coach selected workout priority

Scope: client AI Coach request context only. Payments, Robokassa, email auth, Health Connect, admin builder, backend program assignment, and deployment were not changed.

- Changed AI Coach workout resolution so a fresh user-scoped `activeWorkoutSelection` from `user_core` wins over potentially stale `selectedWorkout` props.
- A stored selection is accepted only when it belongs to the current user, has `source=user_selection`, has a workout id, and is not older than 24 hours.
- Kept `selectedWorkout` prop as fallback only when no fresh user selection exists, or when it matches the stored user selection.
- `selectedWorkoutId` and `selectedWorkoutTitle` are now always sent as top-level `/api/coach` payload fields.
- Added structured `selectionResolution` and `workoutSelectionConflict` context so `serverCurrentWorkout` can differ while `userSelectedWorkout wins for this request` is explicit.
- The workout selection remains transient for the AI request; nothing is saved to backend and `programAssignment` is not changed.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-20 - User-scoped workout and lecture cache containers

Scope: client cache containers only. Payments, email auth flows, Robokassa, Health Connect aggregation, admin builder, and AI prompt logic were not changed.

- Added `fruitfit.workout_history:<userId>` for workout-local cache:
  - `exerciseWeights`;
  - `workoutReports`;
  - `exerciseReplacements`.
- Added `fruitfit.lectures:<userId>` for lecture progress.
- Moved selected workout persistence from legacy global `fruitfit.selectedWorkoutState` into `fruitfit.user_core:<userId>.selectedWorkoutState`.
- Kept selected workout legacy migration only when the stored `userId` matches the current authenticated user, then removes the global key.
- Expanded legacy cache cleanup on login/logout to remove:
  - `exerciseWeights`;
  - `fruitfit.workoutReport.*`;
  - `fruitfit.exerciseReplacements.*`;
  - `fruitfit.lectureProgress.v1`;
  - `fruitfit.selectedWorkoutState`.
- User B now reads empty/new scoped workout and lecture containers instead of seeing user A local weights, replacements, workout reports, or lecture progress from global localStorage.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-20 - AI chat anchor, questionnaire nutrition target, persistent workout selection

Scope: client AI chat UX, nutrition plan selection, and workout selection state only. Payments, recurring, backend program logic, Health Connect native reads, and Robokassa were not changed.

- Added a bottom sentinel/anchor to the AI Coach chat so the latest messages are opened and kept in view on chat load, new messages, loading state changes, and input focus.
- Locked nutrition plan calories to the single questionnaire-derived target (`recommendedCaloriesTarget` / `calculatedCalories`) instead of offering neighbouring `-200/+200` calorie options.
- Locked nutrition type to the questionnaire diet type in the client UI; changing questionnaire data is now the path that changes ration/calories in the app.
- Added `nutritionTarget` to the sanitized client AI Coach context so the client sends one questionnaire-based nutrition target, not a manually selected calorie variant.
- Added persistent `fruitfit.selectedWorkoutState` with `workoutId`, `title`, `programId`, and `dayIndex`.
- `fruitfit.selectedWorkoutState` now stores those four fields at the top level as well as inside the guarded payload, making WebView/ADB diagnostics explicit while keeping user isolation metadata.
- `selectedWorkoutState` is now the primary client UI selection when valid; `serverCurrentWorkout` is only the fallback/default.
- User workout clicks now save the selected workout state and preserve it while navigating to AI Coach.
- Coach payload now prefers the App-selected workout over stale `activeWorkoutSelection` from user core.
- Expanded the AI Coach client runtime context with `selectedWorkout` plus full exercise snapshots (`id`, `name`, `order`, `sets`, `reps`, `weight`, `notes`, `rest`).
- Expanded `nutritionTarget` with questionnaire-based calories/macros (`calories`, `protein`, `fat`, `carbs`, `goal`, `dietType`) and zero tolerance.
- Replaced the raw AI health cache payload with a compact runtime `healthSnapshot` containing steps, sleep, calories, heart rate, source, freshness, and `lastSyncAt`.
- Added `window.__fruitfitLastCoachPayload` and `COACH_REQUEST_PAYLOAD` debug logging for smoke-checking the exact `/api/coach` body from WebView DevTools.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.
- `npx cap sync android` passed.
- `.\gradlew.bat assembleDebug --no-daemon` passed.
- APK built at `android/app/build/outputs/apk/debug/app-debug.apk`.
- ADB install was not run because `adb devices -l` returned no connected devices.

## 2026-06-19 - Workout selection state vs server current workout

Scope: client workout selection/navigation and AI Coach request payload only. Payments, recurring, backend program logic, push, and Health Connect were not changed.

- Split server current workout and user-selected workout behavior in `App.jsx`.
- Server current workout now acts as the default/fallback on initial load, auth refresh, and assignment refresh, but no longer overrides a valid user click on every render.
- Fixed `selectWorkoutFromUi()` and `openWorkout()` so visible/unlocked workout cards and day chips open the actual selected workout instead of being replaced with `serverSelectedWorkoutIndex`.
- Kept stale legacy workout cache cleanup, but removed the `setSelectedWorkoutIndex(0)` reset on opening workout/coach screens.
- Added selected workout metadata (`selectedWorkoutId`, `selectedWorkoutTitle`) to the AI Coach client context and `/api/coach` request so backend validation can target the user's active visible workout.
- Added an explicit in-memory `userSelectedWorkoutSnapshot` so the Coach screen keeps the user's selected workout even after `/api/me/program-assignment` refreshes server default state.
- Injected the selected workout context into the latest user chat message because the current backend `/api/coach` path reads `payload.messages` and does not yet consume `payload.context` directly.
- Persisted the active UI workout selection in the user-scoped `fruitfit.user_core:<userId>.activeWorkoutSelection` field while the app is open, so navigation from Workout to Coach does not lose the user's selected day.
- Added an AI-only workout status hint (`in_progress` / selected in app) and workout day number to the Coach payload; this does not alter real workout progress state.
- Added the same selected-workout hint to the top-level `/api/coach` `message` field as a fallback for backend variants that read `message` instead of `messages`.
- Prevented workout/coach screen refresh from reapplying server current workout when a manual `userSelectedWorkoutId` is already active.
- Debug logs now include selected workout id/title alongside server workout id/title for UI/AI divergence checks.
- Raised Android `minSdkVersion` from 24 to 26 because `@capgo/capacitor-health` declares min SDK 26 and Gradle manifest merge blocks APK assembly otherwise.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-19 - Pre-auth questionnaire draft transfer

Scope: client profile/auth data flow only. Payments, recurring, AI Coach, push, Health Connect, and admin logic were not changed.

- Added `fruitfit.profile.draft` for questionnaire answers saved before authentication.
- `saveProfile()` now writes to the pre-auth draft when there is no current `userId`, and to the user-scoped profile container after login.
- `loadProfile()` now reads the draft for unauthenticated users, preserving onboarding answers before register/login.
- Added server-safe draft merge:
  - server-filled fields win;
  - draft fills only empty/incomplete profile fields;
  - draft is removed only after `/api/me/profile` succeeds.
- Added `transferPreAuthProfileDraft()` after successful login/register/token auth/existing-session restore.
- After transfer, the client clears stale current workout/program-assignment state and refetches `/api/me` plus `/api/me/program-assignment`.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-19 - Referral dashboard stats endpoint

Scope: backend referral read endpoints and profile referral display data contract only. Payments, recurring, AI Coach, Health Connect, and program assignment logic were not changed.

- Extended `/api/referrals/me/code` to return a full referral dashboard payload, not only the personal code.
- Added `/api/referrals/me` as the same authenticated dashboard endpoint for the existing client fallback.
- Dashboard payload now includes `referralCode`, flat `invitedCount` / `paidCount` / `bonusDaysTotal`, snake_case aliases, `lastBonusAt`, `bonusGranted`, `stats`, and recent `referralUses`.
- Stats are computed from `referral_uses` by `referrer_user_id` and the current referral code id, so qualified uses with `bonus_granted=true` surface in the profile referral block.
- Owned referral code lookup now prefers an active code with actual referral uses before falling back to an auto-generated personal code, so admin/referrer codes like `APPLE1` remain visible after a successful referral.
- Kept the client profile referral block visible for admin/referrer accounts; it already fetches with `cache: "no-store"` and reads `stats.invitedCount` / `stats.paidCount`.

## 2026-06-19 - Home coach tip instead of notification bell

Scope: home-screen notification presentation only. Firebase delivery, push scheduling, payments, AI Coach, Health Connect, and program logic were not changed.

- Replaced the top-right notification bell on the home screen with an always-visible inline coach tip.
- The coach tip uses the latest generated push message text from `loadNotificationCenter()` and falls back to a calm default message when no user-scoped push text is available.
- Removed the home-screen notification popover/dropdown UI and its unused CSS layer.
- Tightened the home header: greeting/access badge moved to the top-right, and the coach tip is now a compact two-line inline message.
- Removed the coach-tip label/card treatment; the home header now shows only the quote text without a border or `Coach` title.
- Kept background lock-screen/local push scheduling active on home mount.
- Design direction follows the inline/banner message pattern: visible, passive guidance instead of a modal/dropdown interaction.

## 2026-06-19 - Push behavior message library

Scope: push notification content and scheduling layer only. Firebase delivery, payments, AI Coach, program logic, Health Connect, and recurring logic were not changed.

- Added `shared/pushMessages.js` as the unified push content module.
- Push library now has three active categories:
  - `daily_motivation`: 120 user-provided morning motivation messages;
  - `discipline_gym_etiquette`: 42 calm gym order/etiquette messages;
  - `clarification_messages`: 35 soft reminders for water, technique, rest, weight selection, and safe training behavior.
- Kept `shared/motivationMessages.js` as a compatibility re-export.
- Updated local native notification scheduling:
  - one daily morning `daily_motivation`;
  - `discipline_gym_etiquette` on Tuesday/Friday evenings;
  - `clarification_messages` on Monday/Wednesday/Saturday midday;
  - local scheduled notification history is now user-scoped under `fruitfit.localPushNotifications.v2:<userId>`.
- Updated in-app notification center generation to use the same push library and user-scoped storage under `fruitfit.notificationCenter.v2:<userId>`.
- Updated backend notification scheduling endpoints to create the new push kinds while keeping the existing endpoint URL for client compatibility.
- Added 7-day no-repeat protection using `data.messageId` in backend `notification_events` and local scheduled history.

## 2026-06-19 - Android loading screen theme paint stabilization

Scope: client startup/theme paint only. Health, payments, AI, program access, and routing logic were not changed.

- Kept the pre-React theme bootstrap background as persistent `--boot-bg` / `--boot-text` variables instead of removing the early background after React mounts.
- Switched React theme application to `useLayoutEffect`, so `data-theme`, `color-scheme`, `theme-color`, and boot colors are applied before the first React paint.
- Made the dumbbell loading screen a fixed full-WebView layer using the boot theme colors, removing the `phone-shell` width/background dependency during startup.
- Added startup transition/animation suppression while `fruitfit-preboot` is present.
- Updated Android `NoActionBar` and launch themes to use the same light/dark splash background under the WebView; dark splash now matches the React dark background `#111811`.
- Validation:
  - `npm run build` passed.
  - `npm run android:sync` passed.
  - `.\gradlew.bat assembleDebug --no-daemon` passed after clearing locked generated Gradle resource intermediates.
  - `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded on device `8f647179`.
  - App launch via ADB succeeded and `pidof com.tagirfruit.fruitfit` returned a live process.

## 2026-06-18 - Client data access cache recovery after security refactor

- Added a small client data access layer in `src/data/dataAccess.js` over the existing validated user-scoped containers.
- Restored `currentWorkout` as a user-scoped field inside `fruitfit.user_core:<userId>`:
  - derived from the active program and `/api/me/program-assignment`;
  - respects assignment delivery mode (`first_half` / `second_half`) when present;
  - logs `CURRENT_WORKOUT_RESOLVED`.
- AI Coach client requests now include a sanitized context payload:
  - profile;
  - access state;
  - program assignment;
  - current workout;
  - user-scoped health snapshot;
  - last scoped chat messages;
  - AI memory preferences/summaries.
- AI Coach context strips token/secret/authorization-shaped fields and never reads raw global localStorage.
- `/api/me` client handling now saves returned `profile` and `programAssignment` into `fruitfit.user_core:<userId>` after the authenticated user is known.
- Program assignment changes clear stale `currentWorkout`; the app recalculates it from the current program.
- Fixed Health weekly metric mapper regression:
  - steps week continues to sum `history7d.steps`;
  - calories week now also uses `history7d.calories` when present;
  - weekly activity/details render from `history7d` through `buildActivityWeekForUi` instead of falling back to stale generic metric arrays first.
- No payments, Robokassa, push, backend logic, AI server logic, or Health Connect native reads were changed.

## 2026-06-18 - Android loading theme flicker guard and widget diagnostics

- Added a pre-React theme bootstrap in `index.html`: it reads `fruitfit.theme`, resolves light/dark/system, sets `data-theme`, `color-scheme`, `theme-color`, and preboot background/text CSS variables before the app bundle loads.
- Updated the React loading screen to use the app theme variables immediately, with a stable `100svh` height and no transition on the loading surface.
- Added Android light/dark splash background resources: light launch uses `#F7F5EF`, night launch uses `#050805`.
- Updated the launch theme to use `@color/splashBackground` instead of the old drawable splash background, reducing top-to-bottom flash between native splash and WebView.
- Diagnostic only for Health widgets, no widget mapper fix yet:
  - activity widget reads `history7d.steps` and `history7d.calories` through `buildActivityWeekForUi`;
  - steps detail already prefers `history7d.steps` for the week sum;
  - calories detail still relies on generic metric week values and does not use `history7d.calories` the same way steps detail does;
  - missing Monday-Wednesday rows are most likely caused by an incomplete/stale `fruitfit.health:<userId>` snapshot or history cache gating reusing previous week data until a forced native history refresh.
- Validation:
  - `npm run build` passed.
  - `npm run android:sync` passed.
  - `.\gradlew.bat assembleDebug --no-daemon` passed after clearing locked generated Gradle resource intermediates.
  - APK built at `android/app/build/outputs/apk/debug/app-debug.apk`.
  - ADB install was not run because `adb devices` returned no connected devices.

## 2026-06-18 - Security architecture data container isolation

- Added strict user-scoped data containers:
  - `fruitfit.user_core:<userId>` for profile, access state, subscription-like client state, measurements, avatar, and program assignment;
  - `fruitfit.health:<userId>` for Health metrics, `history7d`, activity history, and local health fallback history;
  - `fruitfit.ai_memory:<userId>` for AI Coach chat memory.
- Kept `userScopedCache` as the low-level envelope validator: every read requires matching `userId`, `savedAt`, and `data`; missing or mismatched users reject cache.
- Moved profile, access, program assignment, measurements, avatar, paid program lock, health snapshot/history, and AI chat history onto the container layer.
- Logout now deletes the current user's data containers and legacy scoped sensitive keys before clearing in-memory state.
- Health widgets and steps detail now use the single validated Health container instead of splitting fallback history into a separate cache key.
- AI Coach local history now reads only from `ai_memory:<userId>`; UI/Health cache is not used as AI source of truth.
- Backend `/api/coach` now requires an authenticated user, strips client-provided `system` messages, and builds profile/access/program context server-side from `req.user.id`.
- No payment, Health Connect native read, FCM, builder, or program content logic was changed.

## 2026-06-18 - Android back navigation native fallback

- Fixed Android hardware/swipe back handling at the navigation layer only.
- Added a shared JS back handler in `src/App.jsx` that first pops FruitFit's internal route stack, then falls back to home, and only allows app minimize from home.
- Added a native WebView fallback in `MainActivity` so Android back calls `window.__fruitfitHandleAndroidBack()` even if the Capacitor `App.addListener("backButton")` path is skipped by the system.
- If the JS handler is not ready yet, native back falls back to WebView history; otherwise it minimizes only when JS explicitly reports `exit`.
- No Health, payments, FCM, or business logic was changed.

## 2026-06-18 - Questionnaire paid-cycle program behavior

- Audited profile/questionnaire save flow and confirmed `/api/me/profile` only saves profile data; backend does not instantly reassign workout programs on questionnaire edit.
- Fixed the client-side source of instant paid-program switching: FREE users still build the program from the latest questionnaire, while PAID/VIP users keep the current paid block by server assignment or a user-scoped local paid program lock.
- Added user-scoped paid program lock under `fruitfit.paidProgramLock:<userId>` so account switching does not leak the locked program between users.
- Nutrition remains live profile-driven and can refresh immediately after questionnaire changes for both FREE and PAID/VIP users.
- Payment session creation now falls back to the current saved backend profile snapshot for authenticated app users, while the client still sends only JWT/product metadata.
- Recurring program assignment now prefers the current user profile for a new billing cycle; first paid assignment continues to use the payment-session snapshot.

## 2026-06-18 - Profile default names and greetings

- Replaced profile name placeholders with `РРјСЏ` and `Р¤Р°РјРёР»РёСЏ` instead of person-specific defaults.
- Added profile greeting helpers that use only an explicitly entered profile first name.
- Home greeting now falls back to `РџСЂРёРІРµС‚, СЃРїРѕСЂС‚СЃРјРµРЅ!` for male/unknown profile gender and `РџСЂРёРІРµС‚, СЃРїРѕСЂС‚СЃРјРµРЅРєР°!` for female profile gender when no first name is entered.
- AI Coach no longer falls back to auth/provider `profile.name`, so it does not address a user as `РўР°РіРёСЂ` unless that first name was explicitly entered in the profile.
- When no first name is entered, the AI Coach welcome copy also avoids the literal creator name and says it was created for FruitFit.

## 2026-06-18 - Health weekly UI mapper

- Audited Android WebView localStorage for the active user and confirmed `fruitfit.health:<userId>` stores date-bound `history7d.steps` and `history7d.calories`.
- Added a UI-only weekly activity normalizer in `src/components/WidgetGrid.jsx`.
- Weekly activity widgets now build the displayed 7-day range from local calendar dates and prefer `history7d.steps` / `history7d.calories` by date when those rows exist.
- `РЁР°РіРё -> РќРµРґРµР»СЏ` now sums the normalized `history7d.steps` rows and only falls back to `steps.detailValue` when weekly history rows are absent.
- Days with zero values remain visible when the JSON contains weekly rows, so the last days do not disappear just because their value is `0`.
- No Health Connect native read, backend, recovery, sleep, or payment logic was changed.

## 2026-06-18 - User-scoped sensitive client cache

- Fixed confirmed Android WebView localStorage leakage between accounts.
- Added `src/data/userScopedCache.js` with envelope storage: `userId`, `savedAt`, and `data`.
- Moved sensitive caches from global keys to user-scoped keys:
  - `fruitfit.profile:<userId>`;
  - `fruitfit.health:<userId>`;
  - `fruitfit.health.history:<userId>`;
  - `fruitfit.measurements:<userId>`;
  - `fruitfit.avatar:<userId>`;
  - `fruitfit.programAssignment:<userId>`;
  - `fruitfit.accessState:<userId>`.
- Legacy global sensitive keys are removed after authenticated user load and ignored by scoped readers.
- Profile, avatar, measurements, Health snapshot/history, access state, program assignment, and VIP report local fallbacks now reject cache when `currentUser.id` is missing or mismatched.
- Logout and user switch now clear in-memory sensitive state and dispatch reset events before the UI can render stale profile/health/measurements/program/access data.
- Added debug logs for cache acceptance/rejection, logout sensitive-state clearing, and login user-switch detection.
- No backend, Robokassa, builder, admin filters, Health Connect native read logic, or iOS project changes were made.

## 2026-06-18 - Steps detail weekly mapper

- Fixed the `РЁР°РіРё -> РќРµРґРµР»СЏ` detail screen so weekly steps use `health.history7d.steps` when date-bound history exists.
- Today's steps detail value still prefers `finalDashboardValue` / `dashboardValue` / `today`.
- Weekly steps total now sums `history7d.steps[].value`; `steps.detailValue` remains only an empty-history fallback.
- Weekly steps goal is fixed at `70000`, so progress is `weeklySteps / 70000 * 100`.
- No Health Connect native, HealthKit, backend, recovery, calories, or sleep logic was changed.

## 2026-06-18 - AI Coach local chat history

- Added user-scoped AI Coach chat storage under `fruitfit.aiCoach.chat:<userId>`.
- Stored chat messages contain `id`, `userId`, `role`, `content`, and `createdAt`.
- Chat history is pruned to 30 days on open/load, send, and save.
- AI Coach now shows the welcome message only when the current user's local history is empty.
- Logout/account switching reloads only the current user's scoped chat history and does not show the previous account's chat.
- `/api/coach` requests now include the current message and the last 12 local chat messages for the current user.
- Backend audit: `backend/src/coach.js` already accepts `payload.messages` and sends the last 12 messages to OpenAI, but server-side long-term coach memory/profile/program/health context is not wired yet. Minimal backend follow-up should load memory/context by `req.user.id` and add it to the system prompt without accepting user ids from the body.

## 2026-06-18 - Client workout visibility hard cap

- Added a client-side safety guard in `src/data/accessRules.js` for workout visibility.
- Admin users still see the full program.
- Every non-admin is capped after server restrictions are applied: 24-workout programs show at most 12 workouts, and 16-workout programs show at most 8 workouts.
- Server `visibleWorkoutIds` and `visibleWorkoutCount` are respected first, so the client never expands a backend-limited list.
- FREE users still use the existing preview logic and hidden workouts are not rendered as locked cards.
- Workout list and in-workout day navigation now resolve visible workouts back to their original program index, including future non-prefix `visibleWorkoutIds`.
- Added debug logging for `totalWorkouts`, `serverVisibleCount`, `clientHardCap`, `finalVisibleCount`, `userRole`, and `accessLevel` in dev/debug mode.
- No Robokassa, backend payment, Health Connect, builder save, admin builder, or exercise catalog changes were made.

## 2026-06-18 - Access card ring progress

- Fixed the profile access ring so finite Pro/VIP access fills proportionally to remaining paid time.
- When access has `startsAt`/`expiresAt`, the ring uses the exact remaining fraction of that interval.
- If the backend does not provide a start date, the client falls back to the nearest known tariff duration, including 30 days for monthly access.
- Free and admin/infinite access keep a fully filled ring with only the infinity symbol.
- No payment, backend, Health Connect, builder, or program access list changes were made.

## 2026-06-18 - Theme boot flash guard

- Added an inline theme bootstrap in `index.html` so saved `fruitfit.theme` is applied before React and bundled CSS render.
- The app now also updates `color-scheme` and the browser/native `theme-color` meta when the theme changes.
- Replaced the white Android launch background with a dark brand splash background to avoid a white flash before WebView content appears.
- No auth, payment, Health Connect, builder, or program access logic was changed.

## 2026-06-18 - Android in-app back navigation guard

- Audited `src/App.jsx` routing: screens are mapped to hash URLs, navigation uses `history.pushState`, and Android back is handled through `CapacitorApp.addListener("backButton")`.
- Root cause: the Android back handler relied on `window.history.state` metadata, but auth/cache flows can replace or clear that metadata. When metadata was missing, Android back could treat the app as having no internal route to pop.
- Added a small in-memory route stack in `App.jsx` that is updated by app navigation, `replace` routes, and browser `popstate`/`hashchange`.
- Android back and in-app toolbar back now pop the app route stack first; only the home screen falls through to `CapacitorApp.minimizeApp()`.
- No Health, payment, access, program, builder, or trainer-report logic was changed.

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

- Nutrition fix: `NutritionScreen` now sorts weekday chips as `РџРѕРЅРµРґРµР»СЊРЅРёРє, Р’С‚РѕСЂРЅРёРє, РЎСЂРµРґР°, Р§РµС‚РІРµСЂРі, РџСЏС‚РЅРёС†Р°, РЎСѓР±Р±РѕС‚Р°, Р’РѕСЃРєСЂРµСЃРµРЅСЊРµ` instead of trusting the scrambled `public/data/nutrition.json` filter order.
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
- Settings now shows a "Health РІ РѕС‚С‡С‘С‚Рµ" preview for steps, sleep, pulse, and active kcal, so the user can see what will be sent.
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
- Updated heart UI copy so stale heart-rate samples are not displayed as current pulse; stale state now shows "РќРµС‚ СЃРІРµР¶РёС… РґР°РЅРЅС‹С…" while preserving the last sample in details/debug.
- Validation:
  - `npm run build` passed.
  - `npx cap sync android` passed.
  - Client release APK built and locally signed for install testing.
  - Admin release APK rebuilt and locally signed for tablet testing.

## 2026-05-23 - Finish remaining exercise video bindings

### Р§С‚Рѕ РёСЃРїСЂР°РІР»РµРЅРѕ

- Р—Р°РєСЂС‹С‚С‹ РїРѕСЃР»РµРґРЅРёРµ 3 media gap РІ client runtime fallbacks: `РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РІС‹РїР°РґС‹`, `РћС‚Р¶РёРјР°РЅРёСЏ РІ СЃРјРёС‚С‚Рµ`, `РџСЂРёСЃРµРґ РїР»РёРµ`.
- Р’РёРґРµРѕ РїРѕРґРєР»СЋС‡РµРЅС‹ С‡РµСЂРµР· `src/data/exerciseRuntimeFallbacks.js`, С‚Рѕ РµСЃС‚СЊ С‡РµСЂРµР· С‚РѕС‚ Р¶Рµ runtime binding pipeline, РєРѕС‚РѕСЂС‹Р№ РёСЃРїРѕР»СЊР·СѓСЋС‚ workout card, exercise detail Рё video modal.
- РќР°Р·РЅР°С‡РµРЅС‹ С‚РѕР»СЊРєРѕ Р±РµР·РѕРїР°СЃРЅС‹Рµ Р±Р»РёР·РєРёРµ canonical videos СЃ СЃРѕРІРїР°РґР°СЋС‰РёРј movement pattern:
  - `РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РІС‹РїР°РґС‹` -> canonical video `Р’С‹РїР°РґС‹ СЃ РіР°РЅС‚РµР»СЏРјРё`.
  - `РћС‚Р¶РёРјР°РЅРёСЏ РІ СЃРјРёС‚С‚Рµ` -> canonical video `РћС‚Р¶РёРјР°РЅРёСЏ РІ С‚СЂРµРЅР°Р¶С‘СЂРµ СЃРјРёС‚С‚Р°`.
  - `РџСЂРёСЃРµРґ РїР»РёРµ` -> canonical video `РџСЂРёСЃРµРґ СЃ С‚РѕС‡РєРѕР№ РѕРїРѕСЂС‹`.

### РС‚РѕРіРё Р°СѓРґРёС‚Р°

- TOTAL CLIENT EXERCISES: 196.
- WITH VIDEO: 196.
- WITH MUSCLE MAP: 196.
- BROKEN VIDEO: 0.
- BROKEN MAPS: 0.
- UNRESOLVED EXERCISES: 0.
- VIDEO URL CHECK: 163/163 runtime video URLs ok, broken URL 0.

### РџСЂРѕРІРµСЂРєРё

- `node scripts/audit-client-exercise-runtime.mjs` - ok.
- HEAD-check РґР»СЏ РІСЃРµС… runtime video URL - ok.

## 2026-05-23 - Client exercise media binding audit

### Р§С‚Рѕ РёСЃРїСЂР°РІР»РµРЅРѕ

- РџСЂРѕРІРµРґС‘РЅ full client runtime audit: `public/data/exercises.json` -> alias resolver -> didactic/runtime catalog -> video lookup -> anatomy map lookup -> workout card/detail fallback.
- Р”РѕР±Р°РІР»РµРЅ `scripts/audit-client-exercise-runtime.mjs`; РѕС‚С‡С‘С‚С‹ СЃРѕС…СЂР°РЅСЏСЋС‚СЃСЏ РІ `audit/client_exercise_runtime_audit.json` Рё `.csv`.
- РСЃРїСЂР°РІР»РµРЅС‹ broken aliases/runtime bindings РґР»СЏ РІР°СЂРёР°РЅС‚РѕРІ: `РџСЂРёСЃРµРґР°РЅРёСЏ РІ РєСЂРѕСЃСЃРѕРІРµСЂРµ`, `Р‘РѕРєРѕРІР°СЏ РёР»Рё Р»Р°С‚РµСЂР°Р»СЊРЅР°СЏ РїР»Р°РЅРєР°`, `Р”СѓРіРѕРІС‹Рµ РјР°С…Рё РЅР° Р·Р°РґРЅСЋСЋ РґРµР»СЊС‚Сѓ`, `РР·РѕРґРёРЅР°РјРёС‡РµСЃРєРёРµ РјР°С…Рё РЅР° Р·Р°РґРЅСЋСЋ РґРµР»СЊС‚Сѓ`, `РљРѕРјРїР»РµРєСЃ Р›Р¤Рљ СѓРїСЂР°Р¶РЅРµРЅРёР№ РЅР° РїР»РµС‡Рё`, `Р›Р°С‚РµСЂР°Р»СЊРЅР°СЏ РёР»Рё Р±РѕРєРѕРІР°СЏ РІС‹С‚СЏР¶РєР° РІ РєСЂРѕСЃСЃРѕРІРµСЂРµ`, `РњРѕР»РѕС‚РєРѕРІС‹Рµ СЃРіРёР±Р°РЅРёСЏ СЃ РєР°РЅР°С‚РЅРѕР№ СЂСѓРєРѕСЏС‚СЊСЋ РІ РєСЂРѕСЃСЃРѕРІРµСЂРµ`, `РџСЂРёСЃРµРґ РІ СЃРјРёС‚Рµ`, `РЎРё-СЃРё РїСЂРёСЃРµРґ РЅР° Р±РёС†РµРїСЃ Р±РµРґСЂР°`, `РЎРєСЂСѓС‡РёРІР°РЅРёРµ РЅР° РїРѕР»Сѓ`.
- Р”РѕР±Р°РІР»РµРЅС‹ client runtime fallback bindings РґР»СЏ СѓРїСЂР°Р¶РЅРµРЅРёР№, РєРѕС‚РѕСЂС‹С… РЅРµС‚ РІ didactic table: `Р Р°СЃС‚СЏР¶РєР° РЅР° РІСЃРµ С‚РµР»Рѕ`, `РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РІС‹РїР°РґС‹`, `РћС‚Р¶РёРјР°РЅРёСЏ РІ СЃРјРёС‚С‚Рµ`, `РџСЂРёСЃРµРґ РїР»РёРµ`.
- Р”Р»СЏ Р›Р¤Рљ Р±РѕРєРѕРІРѕР№/Р»Р°С‚РµСЂР°Р»СЊРЅРѕР№ РІС‹С‚СЏР¶РєРё anatomy fallback С‚РµРїРµСЂСЊ РІС‹Р±РёСЂР°РµС‚ `РљРІР°РґСЂР°С‚РЅР°СЏ РјС‹С€С†Р° РїРѕСЏСЃРЅРёС†С‹`, Р° РЅРµ РѕР±С‰РёР№ СЃР»СѓС‡Р°Р№РЅС‹Р№ template.
- Media placeholder С‚РµРїРµСЂСЊ СЏРІРЅРѕ РїРѕРєР°Р·С‹РІР°РµС‚ `Р”РµРјРѕРЅСЃС‚СЂР°С†РёСЏ СЃРєРѕСЂРѕ РїРѕСЏРІРёС‚СЃСЏ`, РµСЃР»Рё Р±РµР·РѕРїР°СЃРЅРѕРіРѕ РІРёРґРµРѕ РЅРµС‚.

### РС‚РѕРіРё Р°СѓРґРёС‚Р°

- TOTAL CLIENT EXERCISES: 196.
- WITH VIDEO: 193.
- WITH MUSCLE MAP: 196.
- BROKEN VIDEO: 3 (`РљР»Р°СЃСЃРёС‡РµСЃРєРёРµ РІС‹РїР°РґС‹.`, `РћС‚Р¶РёРјР°РЅРёСЏ РІ СЃРјРёС‚С‚Рµ`, `РџСЂРёСЃРµРґ РїР»РёРµ`) - Р±РµР·РѕРїР°СЃРЅРѕРіРѕ РІРёРґРµРѕ РІ Selectel/catalog/upload log РЅРµ РЅР°Р№РґРµРЅРѕ, UI РїРѕРєР°Р·С‹РІР°РµС‚ placeholder.
- BROKEN MAPS: 0.
- UNRESOLVED EXERCISES: 0.
- AUTO-BINDINGS APPLIED: 14.
- VIDEO URL CHECK: 161/161 runtime video URLs ok, broken URL 0.

### РџСЂРѕРІРµСЂРєРё

- `node scripts/audit-client-exercise-runtime.mjs` - ok.
- `npm run build` - ok.

## 2026-05-23 - Health refresh wiring

### Р§С‚Рѕ РёСЃРїСЂР°РІР»РµРЅРѕ

- Debug/export health report Р±РѕР»СЊС€Рµ РЅРµ РєРѕРјРјРёС‚РёС‚ UI РѕС‚РґРµР»СЊРЅС‹Рј РїСѓС‚С‘Рј: РїРµСЂРµРґ СЃР±РѕСЂРєРѕР№ JSON РѕРЅ Р·Р°РїСѓСЃРєР°РµС‚ РѕР±С‰РёР№ `syncNativeHealth({ force: true, reason: "debug-export" })`.
- Dashboard health widgets Рё health detail pages РёСЃРїРѕР»СЊР·СѓСЋС‚ С‚РѕС‚ Р¶Рµ `syncNativeHealth` refresh pipeline.
- `syncNativeHealth` С‚РµРїРµСЂСЊ РїС‹С‚Р°РµС‚СЃСЏ С‡РёС‚Р°С‚СЊ native Health Connect records РїСЂРё Р»СЋР±РѕРј СѓСЃС‚Р°РЅРѕРІР»РµРЅРЅРѕРј Health Connect СЃРѕСЃС‚РѕСЏРЅРёРё, РєСЂРѕРјРµ `not_supported` / `not_installed`.
- Р”РѕР±Р°РІР»РµРЅС‹ console logs РґР»СЏ acceptance-РїСЂРѕРІРµСЂРєРё: `refresh started`, `native health read started`, `health store updated`, `refresh finished`.
- In-flight guard РѕСЃС‚Р°РІР»РµРЅ, РЅРѕ stale/forced refresh Р±РѕР»СЊС€Рµ РЅРµ РјРѕР¶РµС‚ РЅР°РІСЃРµРіРґР° Р±Р»РѕРєРёСЂРѕРІР°С‚СЊ РЅРѕРІС‹Рµ Р·Р°РїСЂРѕСЃС‹; СЃС‚Р°СЂС‹Р№ Р·Р°РІРµСЂС€РёРІС€РёР№СЃСЏ request РЅРµ СЃР±СЂР°СЃС‹РІР°РµС‚ refs РЅРѕРІРѕРіРѕ request.
- РќР° Р·Р°РїРѕР»РЅРµРЅРЅС‹Рµ Dashboard health cards РґРѕР±Р°РІР»РµРЅС‹ РѕС‚РґРµР»СЊРЅС‹Рµ РјР°Р»РµРЅСЊРєРёРµ refresh-РёРєРѕРЅРєРё: РїСѓР»СЊСЃ, С€Р°РіРё, РєР°Р»РѕСЂРёРё, СЃРѕРЅ, РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅРёРµ.

### РџСЂРѕРІРµСЂРєРё

- `npm run build` - ok.

## 2026-05-22 - Stretching video hotfix

### Р§С‚Рѕ РёСЃРїСЂР°РІР»РµРЅРѕ

- Р’РµСЂРЅСѓР» РІРёРґРµРѕ РґР»СЏ СѓРїСЂР°Р¶РЅРµРЅРёСЏ `Р Р°СЃС‚СЏР¶РєР° РЅР° РІСЃРµ С‚РµР»Рѕ`.
- РџСЂРёС‡РёРЅР°: СЌС‚Рѕ СѓРїСЂР°Р¶РЅРµРЅРёРµ РµСЃС‚СЊ РІ С‚СЂРµРЅРёСЂРѕРІРѕС‡РЅС‹С… РїСЂРѕРіСЂР°РјРјР°С…, РЅРѕ РµРіРѕ РЅРµС‚ РІ РЅРѕРІРѕР№ РґРёРґР°РєС‚РёС‡РµСЃРєРѕР№ С‚Р°Р±Р»РёС†Рµ РЅР° 190 СѓРїСЂР°Р¶РЅРµРЅРёР№, РїРѕСЌС‚РѕРјСѓ `resolveDidacticExercise()` РЅРµ РІРѕР·РІСЂР°С‰Р°Р» `video_url`.
- Р”РѕР±Р°РІР»РµРЅ С‚РѕС‡РµС‡РЅС‹Р№ manual video override Р±РµР· РёР·РјРµРЅРµРЅРёСЏ exercise ontology Рё Р±РµР· РїРµСЂРµРёРјРµРЅРѕРІР°РЅРёСЏ СѓРїСЂР°Р¶РЅРµРЅРёСЏ.

### РџСЂРѕРІРµСЂРєРё

- РџСЂСЏРјР°СЏ Selectel СЃСЃС‹Р»РєР° РїСЂРѕРІРµСЂРµРЅР° С‡РµСЂРµР· HEAD-Р·Р°РїСЂРѕСЃ: `200 video/mp4`.
- `npm run build` - ok.

### Р§С‚Рѕ РїСЂРѕРІРµСЂРёС‚СЊ

- РћС‚РєСЂС‹С‚СЊ С‚СЂРµРЅРёСЂРѕРІРєСѓ, РіРґРµ РµСЃС‚СЊ `Р Р°СЃС‚СЏР¶РєР° РЅР° РІСЃРµ С‚РµР»Рѕ`.
- РЈР±РµРґРёС‚СЊСЃСЏ, С‡С‚Рѕ РІ РєР°СЂС‚РѕС‡РєРµ СѓРїСЂР°Р¶РЅРµРЅРёСЏ РІРјРµСЃС‚Рѕ РїСѓСЃС‚РѕРіРѕ preview/Р·Р°РіР»СѓС€РєРё РіСЂСѓР·РёС‚СЃСЏ MP4 СЃ Selectel.

## 2026-05-22 - UI polish: РїСЂРѕС„РёР»СЊ, РЅР°СЃС‚СЂРѕР№РєРё, auth placeholders, app icons

### Р§С‚Рѕ СЃРґРµР»Р°РЅРѕ

1. **Profile / account refactor**
   - Р’РєР»Р°РґРєР° "РџСЂРѕС„РёР»СЊ" СЂР°Р·РіСЂСѓР¶РµРЅР°: РЅР°СЃС‚СЂРѕР№РєРё РїСЂРёР»РѕР¶РµРЅРёСЏ, РІС‹С…РѕРґ, РѕРїР°СЃРЅС‹Рµ РґРµР№СЃС‚РІРёСЏ, С‚РµРјР°, РІРµСЂСЃРёСЏ Рё РёРєРѕРЅРєР° РїСЂРёР»РѕР¶РµРЅРёСЏ РІС‹РЅРµСЃРµРЅС‹ РЅР° РѕС‚РґРµР»СЊРЅС‹Р№ СЌРєСЂР°РЅ РЅР°СЃС‚СЂРѕРµРє.
   - Р’ РїСЂРѕС„РёР»Рµ РѕСЃС‚Р°РІР»РµРЅС‹ РїСЂРѕС„РёР»СЊРЅС‹Рµ РґР°РЅРЅС‹Рµ, Р·Р°РјРµСЂС‹, Health Connect block Рё Р±СѓРґСѓС‰РёР№ referral/promo placeholder.
   - Р”РѕР±Р°РІР»РµРЅР° С€РµСЃС‚РµСЂС‘РЅРєР° РЅР°СЃС‚СЂРѕРµРє РІ profile header.

2. **Settings page**
   - Р”РѕР±Р°РІР»РµРЅ РѕС‚РґРµР»СЊРЅС‹Р№ СЌРєСЂР°РЅ `SettingsScreen` СЃ route `#/settings`.
   - Р’ РЅР°СЃС‚СЂРѕР№РєРё РІС‹РЅРµСЃРµРЅС‹:
     - logout;
     - delete account placeholder;
     - payment/billing placeholders;
     - app icon settings;
     - theme settings;
     - privacy/data placeholders;
     - version/build info.
   - Android back СЃ СЌРєСЂР°РЅР° РЅР°СЃС‚СЂРѕРµРє РІРѕР·РІСЂР°С‰Р°РµС‚ РІ РїСЂРѕС„РёР»СЊ, Р° РЅРµ СЃРІРѕСЂР°С‡РёРІР°РµС‚ РїСЂРёР»РѕР¶РµРЅРёРµ.

3. **Referral / promo placeholders**
   - Р”РѕР±Р°РІР»РµРЅР° РєР°СЂС‚РѕС‡РєР° "Р РµС„РµСЂР°Р»СЊРЅР°СЏ РїСЂРѕРіСЂР°РјРјР°".
   - Р”РѕР±Р°РІР»РµРЅ С‚РµРєСЃС‚ "РџСЂРёРіР»Р°СЃРё РґСЂСѓРіР° - РїРѕР»СѓС‡Рё РјРµСЃСЏС† Р±РµСЃРїР»Р°С‚РЅРѕ".
   - Р”РѕР±Р°РІР»РµРЅС‹ РїРѕР»Рµ РїСЂРѕРјРѕРєРѕРґР° Рё РєРЅРѕРїРєР° "РџСЂРёРјРµРЅРёС‚СЊ" РІ disabled/soon СЃРѕСЃС‚РѕСЏРЅРёРё.
   - Backend logic РЅРµ РїРѕРґРєР»СЋС‡Р°Р»Р°СЃСЊ.

4. **Auth UI preparation**
   - Р’ РЅР°СЃС‚СЂРѕР№РєР°С… РґРѕР±Р°РІР»РµРЅС‹ Р°РєРєСѓСЂР°С‚РЅС‹Рµ disabled placeholders:
     - "Р’РѕР№С‚Рё С‡РµСЂРµР· Telegram";
     - "Р’РѕР№С‚Рё С‡РµСЂРµР· РЇРЅРґРµРєСЃ".
   - Р РµР°Р»СЊРЅР°СЏ auth/backend logic РЅРµ РґРѕР±Р°РІР»СЏР»Р°СЃСЊ Рё РЅРµ РјРµРЅСЏР»Р°СЃСЊ.

5. **App icon polish**
   - Android adaptive icons РїРµСЂРµРІРµРґРµРЅС‹ РЅР° black background + transparent fruit foreground.
   - Р”РѕР±Р°РІР»РµРЅС‹ РѕС‚РґРµР»СЊРЅС‹Рµ foreground artwork assets РґР»СЏ orange/apple/pear/strawberry.
   - РРєРѕРЅРєРё С†РµРЅС‚СЂРёСЂРѕРІР°РЅС‹ РІ safe zone Р±РµР· Р±РµР»РѕР№ РїРѕРґР»РѕР¶РєРё Рё Р±РµР· СЂР°СЃС‚СЏРіРёРІР°РЅРёСЏ fruit artwork.

### РџСЂРѕРІРµСЂРєРё

- `npm run build` - ok.
- `npx cap sync android` - ok.
- `.\gradlew.bat :app:assembleDebug` - ok.
- Р›РѕРєР°Р»СЊРЅРѕ РїСЂРѕРІРµСЂРµРЅС‹:
  - `#/settings`;
  - РїРµСЂРµС…РѕРґ РёР· РїСЂРѕС„РёР»СЏ РІ РЅР°СЃС‚СЂРѕР№РєРё;
  - РІРѕР·РІСЂР°С‚ РёР· РЅР°СЃС‚СЂРѕРµРє РІ РїСЂРѕС„РёР»СЊ;
  - referral/promo placeholder;
  - РѕС‚СЃСѓС‚СЃС‚РІРёРµ inline app icon Р±Р»РѕРєР° РІ РїСЂРѕС„РёР»Рµ.

### APK

- РЎРѕР±СЂР°РЅ debug APK:
  - `android/app/build/outputs/apk/debug/app-debug.apk`
- РЎРєРѕРїРёСЂРѕРІР°РЅ РІ РєРѕСЂРµРЅСЊ РїСЂРѕРµРєС‚Р°:
  - `FruitFit-ui-polish-debug.apk`

### Р§С‚Рѕ РїСЂРѕРІРµСЂРёС‚СЊ РЅР° С‚РµР»РµС„РѕРЅРµ

- РџСЂРѕС„РёР»СЊ РѕС‚РєСЂС‹РІР°РµС‚СЃСЏ Р±РµР· РїРµСЂРµРіСЂСѓР·Р°.
- РЁРµСЃС‚РµСЂС‘РЅРєР° РѕС‚РєСЂС‹РІР°РµС‚ РЅР°СЃС‚СЂРѕР№РєРё.
- Android back РёР· РЅР°СЃС‚СЂРѕРµРє РІРѕР·РІСЂР°С‰Р°РµС‚ РІ РїСЂРѕС„РёР»СЊ.
- Telegram/Yandex РєРЅРѕРїРєРё РІС‹РіР»СЏРґСЏС‚ РєР°Рє Р·Р°РіРѕС‚РѕРІРєРё Рё РЅРµ РѕР±РµС‰Р°СЋС‚ Р°РєС‚РёРІРЅС‹Р№ login.
- Referral/promo Р±Р»РѕРє РѕС‚РѕР±СЂР°Р¶Р°РµС‚СЃСЏ РєР°Рє "СЃРєРѕСЂРѕ/РіРѕС‚РѕРІРёС‚СЃСЏ".
- РџРµСЂРµРєР»СЋС‡РµРЅРёРµ С‚РµРјС‹ РЅРµ СЃР»РѕРјР°РЅРѕ.
- App icon settings СЃРѕС…СЂР°РЅСЏСЋС‚ РІС‹Р±РѕСЂ.
- Launcher icons orange/apple/pear/strawberry РІС‹РіР»СЏРґСЏС‚ Р±РµР· Р±РµР»РѕР№ РїРѕРґР»РѕР¶РєРё Рё Р±РµР· РєСЂРѕРїР°.

## 2026-05-22 - Health refresh buttons + exercise video patch

### Р§С‚Рѕ РёСЃРїСЂР°РІР»РµРЅРѕ

- РњР°Р»РµРЅСЊРєРёРµ refresh-РєРЅРѕРїРєРё health detail pages С‚РµРїРµСЂСЊ РІС‹Р·С‹РІР°СЋС‚ РѕР±С‰РёР№ `syncNativeHealth({ force: true })`, Р° РЅРµ РѕС‚РґРµР»СЊРЅС‹Р№/РїР°СЃСЃРёРІРЅС‹Р№ UI refresh.
- `syncNativeHealth` Р±РѕР»СЊС€Рµ РЅРµ Р·Р°РІРёСЃР°РµС‚ РЅР°РІСЃРµРіРґР° РЅР° СЃС‚Р°СЂРѕРј in-flight promise: РґРѕР±Р°РІР»РµРЅ age guard Рё СЃР±СЂРѕСЃ stale-Р·Р°РїСЂРѕСЃР° РїРѕСЃР»Рµ 45 СЃРµРєСѓРЅРґ.
- Р•СЃР»Рё Health Connect РІРѕР·РІСЂР°С‰Р°РµС‚ `no_data`, pipeline РІСЃС‘ СЂР°РІРЅРѕ РјРѕР¶РµС‚ С‡РёС‚Р°С‚СЊ native records. Р­С‚Рѕ РІР°Р¶РЅРѕ РґР»СЏ СЃР»СѓС‡Р°РµРІ, РєРѕРіРґР° availability РµС‰С‘ РЅРµ РѕС‚СЂР°Р¶Р°РµС‚ СЂРµР°Р»СЊРЅС‹Рµ Р·Р°РїРёСЃРё, РЅРѕ debug/export СѓР¶Рµ РІРёРґРёС‚ РґР°РЅРЅС‹Рµ.
- Р’СЂРµРјСЏ `lastFruitFitRefreshAt` РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ РґР°Р¶Рµ РµСЃР»Рё РЅРѕРІС‹С… Р·Р°РїРёСЃРµР№ РЅРµС‚, С‡С‚РѕР±С‹ UI РїРѕРєР°Р·С‹РІР°Р» С„Р°РєС‚ РїСЂРѕРІРµСЂРєРё.
- РћС€РёР±РєРё refresh СЃРѕС…СЂР°РЅСЏСЋС‚СЃСЏ РІ `syncError` / `lastHealthSyncError` Рё РІС‹РІРѕРґСЏС‚СЃСЏ РЅР° health detail pages.
- Empty health cards СЃ РґРµР№СЃС‚РІРёРµРј вЂњРћР±РЅРѕРІРёС‚СЊвЂќ С‚РµРїРµСЂСЊ РІС‹Р·С‹РІР°СЋС‚ С‡С‚РµРЅРёРµ РґР°РЅРЅС‹С…, Р° РЅРµ РїРѕРІС‚РѕСЂРЅС‹Р№ permission-flow.
- РљРЅРѕРїРєР° вЂњРћР±РЅРѕРІРёС‚СЊ РґР°РЅРЅС‹РµвЂќ РІ РїСЂРѕС„РёР»Рµ С‚РµРїРµСЂСЊ РёСЃРїРѕР»СЊР·СѓРµС‚ refresh pipeline, РµСЃР»Рё СЂР°Р·СЂРµС€РµРЅРёСЏ СѓР¶Рµ РµСЃС‚СЊ; permission-flow РѕСЃС‚Р°С‘С‚СЃСЏ РґР»СЏ РїРµСЂРІРёС‡РЅРѕРіРѕ РґРѕСЃС‚СѓРїР°.
- Р”РѕР±Р°РІР»РµРЅС‹ source labels/shortcuts РґР»СЏ WHOOP. Apple Health РѕСЃС‚Р°РІР»РµРЅ РєР°Рє iOS/HealthKit provider; Android APK РЅРµ РјРѕР¶РµС‚ РЅР°РїСЂСЏРјСѓСЋ РїСЂРѕРІРµСЂРёС‚СЊ HealthKit.
- РўРѕС‡РµС‡РЅРѕ РІРѕСЃСЃС‚Р°РЅРѕРІР»РµРЅР° СЃСЃС‹Р»РєР° Selectel РґР»СЏ СѓРїСЂР°Р¶РЅРµРЅРёСЏ вЂњР’С‹РїР°РґС‹ РІ РєСЂРѕСЃСЃРѕРІРµСЂРµвЂќ.

### РџСЂРѕРІРµСЂРєРё

- `npm run build` - ok.
- `npx cap sync android` - ok.
- `.\gradlew.bat :app:assembleDebug` - ok.
- Selectel URL вЂњР’С‹РїР°РґС‹ РІ РєСЂРѕСЃСЃРѕРІРµСЂРµвЂќ РѕС‚РІРµС‡Р°РµС‚ `HTTP 200`, `Content-Type: video/mp4`.

### Р§С‚Рѕ РїСЂРѕРІРµСЂРёС‚СЊ РЅР° С‚РµР»РµС„РѕРЅРµ

- Samsung Health / Galaxy Watch: РјР°Р»РµРЅСЊРєР°СЏ РєРЅРѕРїРєР° refresh РЅР° health page РѕР±РЅРѕРІР»СЏРµС‚ timestamp вЂњFruitFit РѕР±РЅРѕРІРёР» РґР°РЅРЅС‹РµвЂќ.
- Р•СЃР»Рё Health Connect РѕС‚РґР°С‘С‚ СЃРІРµР¶РёР№ `com.sec.android.app.shealth`, Dashboard Рё detail pages РїРѕРєР°Р·С‹РІР°СЋС‚ Samsung Health, Р° РЅРµ СЃС‚Р°СЂС‹Р№ Google Fit cache.
- Empty cards вЂњРћР±РЅРѕРІРёС‚СЊвЂќ Р·Р°РїСѓСЃРєР°СЋС‚ С‡С‚РµРЅРёРµ Health Connect, Р° РЅРµ С‚РѕР»СЊРєРѕ СЌРєСЂР°РЅ СЂР°Р·СЂРµС€РµРЅРёР№.
- вЂњР’С‹РїР°РґС‹ РІ РєСЂРѕСЃСЃРѕРІРµСЂРµвЂќ РѕС‚РєСЂС‹РІР°СЋС‚ РІРёРґРµРѕ РёР· Selectel.

## 2026-05-22 - tagirfruit food MVP iteration

### Р§С‚Рѕ Р±С‹Р»Рѕ РЅРµР·Р°РІРµСЂС€РµРЅРѕ

- Food seed Рё parser Р±С‹Р»Рё РїРѕРґРіРѕС‚РѕРІР»РµРЅС‹, РЅРѕ С‡Р°СЃС‚СЊ С„Р°Р№Р»РѕРІ Р±С‹Р»Р° Р·Р°РїРёСЃР°РЅР° РІ mojibake-РєРѕРґРёСЂРѕРІРєРµ.
- Parser РјРѕРі РїСЂРёРЅРёРјР°С‚СЊ Р»СЋР±РѕР№ СЃРІРѕР±РѕРґРЅС‹Р№ С‚РµРєСЃС‚ Р·Р° nutrition intent, РЅР°РїСЂРёРјРµСЂ РІРѕРїСЂРѕСЃ "РєС‚Рѕ С‚С‹?".
- РЎРёСЃС‚РµРјР° Р±С‹Р»Р° С‚РѕР»СЊРєРѕ local DB; external API fallback Рё РєРµС€РёСЂРѕРІР°РЅРёРµ РЅРµРёР·РІРµСЃС‚РЅС‹С… РїСЂРѕРґСѓРєС‚РѕРІ РµС‰С‘ РЅРµ Р±С‹Р»Рё РїРѕРґРєР»СЋС‡РµРЅС‹.
- РўРµСЃС‚РѕРІС‹Р№ СЃРєСЂРёРїС‚ Р±С‹Р» destructive: РѕС‡РёС‰Р°Р» Р±Р°Р·Сѓ РїРµСЂРµРґ РїСЂРѕРІРµСЂРєРѕР№.

### Р§С‚Рѕ СЃРґРµР»Р°РЅРѕ

1. **Food Database MVP**
   - `server/foodMvpSeed.js` СЂР°СЃС€РёСЂСЏРµС‚ Р±Р°Р·Сѓ РґРѕ 817 РїСЂРѕРґСѓРєС‚РѕРІ.
   - Р’ Р±Р°Р·Рµ СЃРµР№С‡Р°СЃ 817 РїСЂРѕРґСѓРєС‚РѕРІ Рё 2775 aliases.
   - РџСЂРёРѕСЂРёС‚РµС‚С‹ MVP: РјСЏСЃРѕ, РїС‚РёС†Р°, СЂС‹Р±Р°, СЏР№С†Р°, РєСЂСѓРїС‹, РјРѕР»РѕС‡РєР°, РѕРІРѕС‰Рё, С„СЂСѓРєС‚С‹, С…Р»РµР±, СЃР»Р°РґРѕСЃС‚Рё, РЅР°РїРёС‚РєРё, С„Р°СЃС‚С„СѓРґ Рё РїРѕРїСѓР»СЏСЂРЅС‹Рµ Р±Р»СЋРґР°.
   - Р”Р»СЏ РїСЂРѕРґСѓРєС‚РѕРІ РґРѕР±Р°РІР»РµРЅС‹ `serving_examples` Рё `default_serving_grams`.

2. **Nutrition parser**
   - РСЃРїСЂР°РІР»РµРЅРѕ СЂР°Р·РґРµР»РµРЅРёРµ РїРѕ "Рё", Р·Р°РїСЏС‚С‹Рј, `+`, `;`.
   - РџРѕРґРґРµСЂР¶Р°РЅС‹ РіСЂР°РјРјС‹: `250 Рі СЂРёСЃР°`.
   - РџРѕРґРґРµСЂР¶Р°РЅС‹ С€С‚СѓРєРё/default serving: `2 СЏР№С†Р°`, `Р±Р°РЅР°РЅ`, `Р±СѓСЂРіРµСЂ`, `РєРѕР»Р°`.
   - `isNutritionIntent()` С‚РµРїРµСЂСЊ РЅРµ РїРµСЂРµС…РІР°С‚С‹РІР°РµС‚ РѕР±С‹С‡РЅС‹Рµ РІРѕРїСЂРѕСЃС‹, РµСЃР»Рё РїСЂРѕРґСѓРєС‚С‹ РЅРµ РЅР°С…РѕРґСЏС‚СЃСЏ РІ Р»РѕРєР°Р»СЊРЅРѕР№ Р±Р°Р·Рµ.

3. **Hybrid food database**
   - Primary source: local SQLite `data/nutrition.db`.
   - External fallback: OpenFoodFacts С‡РµСЂРµР· `server/externalFoodApi.js`.
   - Р•СЃР»Рё external API РЅР°С…РѕРґРёС‚ РїСЂРѕРґСѓРєС‚, РїСЂРѕРґСѓРєС‚ РєРµС€РёСЂСѓРµС‚СЃСЏ РІ local DB СЃ `source=openfoodfacts:<code>`.
   - GPT РЅРµ СЃС‡РёС‚Р°РµС‚ РєР°Р»РѕСЂРёРё РёР· РїР°РјСЏС‚Рё: backend parser СЃРЅР°С‡Р°Р»Р° РІРѕР·РІСЂР°С‰Р°РµС‚ structured nutrition result.

4. **tagirfruit prompt**
   - `server/coachPrompt.js` СЃРѕРґРµСЂР¶РёС‚ РµРґРёРЅС‹Р№ server-side prompt/config.
   - РђСЃСЃРёСЃС‚РµРЅС‚ РЅР°Р·С‹РІР°РµС‚СЃСЏ `tagirfruit`.
   - Р’ prompt Р·Р°РєСЂРµРїР»РµРЅРѕ РїСЂР°РІРёР»Рѕ: РљР‘Р–РЈ СЃС‡РёС‚Р°С‚СЊ С‚РѕР»СЊРєРѕ С‡РµСЂРµР· nutrition calculator / nutrition_db Рё РЅРµ РІС‹РґСѓРјС‹РІР°С‚СЊ РєР°Р»РѕСЂРёРё.

5. **Tests**
   - `scripts/test-nutrition.js` С‚РµРїРµСЂСЊ non-destructive.
   - Р”РѕР±Р°РІР»РµРЅ npm script: `npm run test:nutrition`.

### РџСЂРѕРІРµСЂРµРЅРЅС‹Рµ С„СЂР°Р·С‹

| Р¤СЂР°Р·Р° | Match | Result |
|---|---|---|
| `2 СЏР№С†Р° Рё Р±Р°РЅР°РЅ` | РЇР№С†Рѕ РєСѓСЂРёРЅРѕРµ 110 Рі + Р‘Р°РЅР°РЅ 120 Рі | 288 РєРєР°Р», Р‘ 15.8 / Р– 12.6 / РЈ 26 |
| `250 Рі СЂРёСЃР° Рё РєСѓСЂРёРЅР°СЏ РіСЂСѓРґРєР°` | Р РёСЃ Р±РµР»С‹Р№ РІР°СЂРµРЅР°СЏ 250 Рі + РљСѓСЂРёРЅР°СЏ РіСЂСѓРґРєР° 150 Рі | 483 РєРєР°Р», Р‘ 41.4 / Р– 3.6 / РЈ 72.4 |
| `Р±СѓСЂРіРµСЂ Рё РєРѕР»Р°` | Р‘СѓСЂРіРµСЂ 220 Рі + РљРѕР»Р° 330 Рі | 700 РєРєР°Р», Р‘ 26.4 / Р– 24.2 / РЈ 94.4 |
| `С‚РІРѕСЂРѕРі 5% 200 Рі` | РўРІРѕСЂРѕРі 5% 200 Рі | 240 РєРєР°Р», Р‘ 34 / Р– 10 / РЈ 6 |
| `РіСЂРµС‡РєР° СЃ РјРѕР»РѕРєРѕРј` | Р“СЂРµС‡РєР° СЃ РјРѕР»РѕРєРѕРј 250 Рі | 348 РєРєР°Р», Р‘ 15.5 / Р– 6.5 / РЈ 64.3 |

### РџСЂРѕРІРµСЂРєРё

- `npm run db:nutrition:seed` - ok.
- `npm run test:nutrition` - ok.
- `node --check` РґР»СЏ server/parser/db/external API/test script - ok.
- `npm run build` - ok, Vite production build passed.

### РћРіСЂР°РЅРёС‡РµРЅРёСЏ

- External API fallback Р·Р°РІРёСЃРёС‚ РѕС‚ РґРѕСЃС‚СѓРїРЅРѕСЃС‚Рё OpenFoodFacts. Р’Рѕ РІСЂРµРјСЏ Р»РѕРєР°Р»СЊРЅРѕР№ РїСЂРѕРІРµСЂРєРё СЃРµСЂРІРёСЃ РѕС‚РІРµС‡Р°Р» 503, РїРѕСЌС‚РѕРјСѓ fallback СЂРµР°Р»РёР·РѕРІР°РЅ Рё Р±РµР·РѕРїР°СЃРЅРѕ РґРµРіСЂР°РґРёСЂСѓРµС‚, РЅРѕ СѓСЃРїРµС€РЅРѕРµ API-РєРµС€РёСЂРѕРІР°РЅРёРµ РЅСѓР¶РЅРѕ РїСЂРѕРІРµСЂРёС‚СЊ РїСЂРё РґРѕСЃС‚СѓРїРЅРѕРј СЃРµСЂРІРёСЃРµ.
- Р‘СЂРµРЅРґРѕРІР°СЏ Р Р¤-Р±Р°Р·Р° РїРѕРєР° MVP, Р±РµР· barcode scanner Рё Р±РµР· Р±РѕР»СЊС€РѕР№ branded Р±Р°Р·С‹.

## 2026-05-22 - Production VDS tagirfruit AI/Nutrition update

Production backend path: `/var/www/fruitfit-ai-api`.

## 2026-05-23 - Lecture transcripts attached

- Added `src/data/lectureTexts.js` generated from the 16 lecture PDFs in `C:/Users/Meyva/Downloads/Р›РµРєС†РёРё`.
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
- Parser supports common phrases: `2 СЏР№С†Р° Рё Р±Р°РЅР°РЅ`, `250 Рі СЂРёСЃР° Рё РєСѓСЂРёРЅР°СЏ РіСЂСѓРґРєР°`, `Р±СѓСЂРіРµСЂ Рё РєРѕР»Р°`, `С‚РІРѕСЂРѕРі 5% 200 Рі`, `РіСЂРµС‡РєР° СЃ РјРѕР»РѕРєРѕРј`, `3 СЃС‹СЂРЅРёРєР°`, `С€Р°СѓСЂРјР°`, `РїСЂРѕС‚РµРёРЅ 30Рі`.
- `/api/coach` now supports both `messages[]` and single `message/text/prompt/content` payloads.
- `/api/nutrition/parse-calc` now supports `message`, `text`, `prompt`, `content`, `query`, and `input`.
- Nutrition intent short-circuits GPT: backend parser/DB calculates calories and macros first, then returns structured nutrition result.
- `pm2 restart fruitfit-ai-api --update-env` completed successfully and `pm2 save` completed.

Production checks:

- `GET /api/health` returned `assistant: tagirfruit`, model `gpt-4.1-mini`, DB loaded, 1066 products, 2405 aliases.
- `POST /api/nutrition/parse-calc` returned expected nutrition totals for test phrases.
- `POST /api/coach` returned nutrition answers without GPT calorie invention for food phrases.
- `POST /api/coach` personality tests passed for `РєС‚Рѕ С‚С‹?`, `РјРѕР¶РµС€СЊ СЃРѕСЃС‚Р°РІРёС‚СЊ РјРЅРµ С‚СЂРµРЅРёСЂРѕРІРєСѓ?`, `РїРѕС‡РµРјСѓ РїСЂРёР»РѕР¶РµРЅРёРµ РёРЅРѕРіРґР° РѕС€РёР±Р°РµС‚СЃСЏ?`.

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
  - Local browser check: Profile diagnostic `РћР±РЅРѕРІРёС‚СЊ` / `РЎРєРѕРїРёСЂРѕРІР°С‚СЊ` / `РџРѕРґРµР»РёС‚СЊСЃСЏ` did not show `.catch` errors.
  - Detail refresh timestamp remained visible after refresh.
- Scope intentionally did not touch AI, admin, food DB, exercise media, or muscle maps.

## 2026-05-24 - Lecture flow dedicated screen

- Replaced the dashboard mini-lecture modal flow with a dedicated app screen at `#/lectures`.
- Dashboard lecture widget now reads saved lecture progress and shows the active lecture title, thumbnail, progress bar and CTA (`РќР°С‡Р°С‚СЊ` / `РџСЂРѕРґРѕР»Р¶РёС‚СЊ` / `РџРµСЂРµСЃРјРѕС‚СЂРµС‚СЊ`).
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
  - `stale` / `aging` style badges now render as "Р¶РґС‘Рј СЃРёРЅС…СЂРѕРЅРёР·Р°С†РёСЋ" / "РѕР±РЅРѕРІР»СЏРµС‚СЃСЏ".
  - Heart widget now says "РћС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ С‡Р°СЃРѕРІ, С‡С‚РѕР±С‹ СЃРёРЅС…СЂРѕРЅРёР·РёСЂРѕРІР°С‚СЊ РїСѓР»СЊСЃ" instead of source/debug language.
  - Calories estimate copy now says that part of the values is calculated automatically from activity.
  - Empty sleep/recovery states explain what to add next instead of presenting an error-like "no data" state.
- Added contextual hints in dashboard widgets and health detail pages for sleep, heart freshness, calories, weekly activity, and recovery accuracy.
- Removed ordinary UI exposure of source reasons, `Health Connect aggregate`, raw freshness names, and technical sync errors.
- Profile health connection copy now explains why Health Connect is useful, that data is used for personalization, and that it is not shared with third parties.
- Moved tracker diagnostics behind an explicit "РћС‚РєСЂС‹С‚СЊ РґРёР°РіРЅРѕСЃС‚РёРєСѓ" control so normal users do not see JSON/debug wording by default.
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

- Fixed heart widget/detail labels so weekly heart history is shown as "Р·Р° 7 РґРЅРµР№" when 24h min/avg/max are empty.
- Stopped rendering empty "РњРёРЅ 24С‡ / РЎСЂРµРґРЅРёР№ 24С‡ / РњР°РєСЃ 24С‡" fields next to a weekly heart range.
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
  - final fallback is `СЃРїРѕСЂС‚СЃРјРµРЅ`.
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
  - verify the in-app update endpoint used by the "РџСЂРѕРІРµСЂРёС‚СЊ РѕР±РЅРѕРІР»РµРЅРёРµ" button;
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

- Added Dashboard widget `AI СЂР°СЃС…РѕРґС‹`.
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
  - calories В±200.
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
  - calorie choices remain limited to profile target В±200.

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
  - Russian subject: `РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ email РІ FruitFit`;
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

- Removed the external promo-code input from profile; profile now shows only the personal referral block with "Р’Р°С€ РєРѕРґ", "РџСЂРёРіР»Р°С€РµРЅРѕ", "Р‘РѕРЅСѓСЃ: 14 РґРЅРµР№", copy, and share actions.
- Referral code loading now avoids a final `-` state and uses `/api/referrals/me/code` with fallback reads.
- Payment CTA now sits directly under the access status card for all access states. It requires JWT, creates `/api/payments/sessions` with only `productCode` and `recurringEnabled`, and opens `https://tagirfruit.ru/payment?ps=<session.id>`.
- Client no longer sends `userId`/`user_id`, price, profile snapshot, program params, promo code, or referral code when creating a payment session.
- Added admin access card state: `FruitFit Admin`, "РђРґРјРёРЅ-РґРѕСЃС‚СѓРї", active meta, and a fully filled infinity ring.
- Infinite access rings now show only `в€ћ` with no bottom caption. Paid/VIP access with an expiry shows the day count and `РґРЅРµР№`.
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
- Live APK WebView check after Health sync showed fixed weekly activity values and labels: `Р’СЃ 14.06` 12,718 steps, `РџРЅ 15.06` 28,056 steps, `Р’С‚ 16.06` 24,995 steps / 1,102 active kcal.
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

## 2026-06-18 - Health widgets weekly aggregate/source fix

Scope: Android client Health UI/native bridge only.

- Dashboard widgets now request `history_7d` instead of reusing dashboard-only cache, so the weekly activity widget and steps detail screen share the same 7-day data source.
- `history_7d` refresh no longer reuses a fresh dashboard snapshot; it performs the weekly aggregate read.
- Health Connect aggregate weekly steps/calories are treated as the primary Auto source, matching Google Health totals.
- User-selected source is supported through Health Connect `DataOrigin` aggregate filters. For example, selecting `com.xiaomi.wearable` reads Mi Fitness daily aggregate buckets for today/week without raw-record scans.
- Normal steps/calories reads no longer run raw source diagnostics by default. Diagnostics remain opt-in, which avoids heavy reads on phones with multiple trackers.
- Weekly UI mapper now keeps source-filtered aggregate buckets instead of filtering them out when samples do not carry per-row source package metadata.
- Profile source selector persists the selected source and forces a light `history_7d` refresh when changed.

Live ADB verification before device disconnected:

- Installed `android/app/build/outputs/apk/debug/app-debug.apk` on device `8f647179`.
- `FruitFitHealth.getSteps({ range: "week" })` returned `150455` steps from Health Connect aggregate in about 1.2 seconds.
- `FruitFitHealth.getSteps({ range: "week", preferredSourcePackage: "com.xiaomi.wearable" })` returned `124137` Mi Fitness steps with all 7 daily buckets, including Tuesday and Wednesday.
- `FruitFitHealth.getCalories({ range: "week", preferredSourcePackage: "com.xiaomi.wearable" })` returned Mi Fitness active calories with all 7 daily buckets.
- Raw/source diagnostics were not present in the normal result (`hasSourceSamples: false`), confirming the heavy path is not used for regular widgets.

Validation:

- `npm run build` passed.
- `npm run android:sync` passed.
- `.\gradlew.bat assembleDebug --no-daemon` passed.
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded.

## 2026-06-18 - Client subscription cycle base program guard

Scope: client program-assignment/cache layer only. Payments, AI Coach, push, and health logic were not changed.

- Added client-side `baseProgramId` persistence in `fruitfit.user_core:<userId>.baseProgramId`.
- `saveProgramAssignment` now normalizes assignments before storing them in `fruitfit.user_core:<userId>.programAssignment`.
- Cycle logic:
  - cycle 1 / `first_half`: store the incoming `programId` as `baseProgramId`;
  - cycle 2 / `second_half`: reuse `baseProgramId` and ignore a different incoming `programId`;
  - cycle 3+ / `replacement_cycle` and `fresh_program`: allow a new `programId` and update `baseProgramId`.
- Added migration fallback for existing users: if `baseProgramId` is missing, the client tries `currentWorkout`, `paidProgramLock`, then the previous assignment before accepting a cycle-2 server change.
- Added race protection for the case where `/api/me/program-assignment` arrives before `/api/me/access`; pending paid-cycle changes preserve the hard base program instead of clearing it.
- Program changes or delivery-mode changes clear stored `currentWorkout`, allowing the existing current-workout resolver to recalculate it from the normalized assignment.
- Added debug log `PROGRAM_ASSIGNMENT_CYCLE_GUARD` when the client rejects a cycle-2 program swap.

Validation:

- `npm run build` passed.

## 2026-06-19 - Client currentWorkout server-truth sync

Scope: client current-workout state flow only. Payments, push, Health Connect, and backend logic were not changed.

- Disabled client-side current-workout derivation from dates, assignment start date, cadence, or local selected index.
- `fruitfit.user_core:<userId>.currentWorkout` is now overwritten only from `/api/me/program-assignment` server `currentWorkout` fields, or cleared when the server does not provide a current workout.
- `/api/me/program-assignment` parsing now supports both `assignment.currentWorkout` and top-level `currentWorkout` response shapes.
- Home/Workout UI maps the server current workout to `selectedWorkoutIndex` only for display; cache no longer decides the workout.
- Opening Workout or Coach refreshes `/api/me/program-assignment` before using workout state.
- AI Coach now builds `context.currentWorkout` only from the fresh server assignment. UI/cache workout is sent only as debug hint.
- Added temporary debug logs: `SERVER_WORKOUT`, `CACHE_WORKOUT`, `UI_WORKOUT`, `AI_PAYLOAD_WORKOUT`.

Validation:

- `npm run build` passed. Existing Vite large chunk warning only.

## 2026-06-19 - Client stale workout cache hard reset

Scope: client current-workout/cache reset layer only. Payments, program content, push, Health Connect, and backend AI logic were not changed.

- Added `resetStaleWorkoutState()` to clear stale workout display state before server overwrite.
- Reset clears:
  - `fruitfit.user_core:<userId>.currentWorkout`;
  - `fruitfit.user_core:<userId>.selectedWorkoutIndex`;
  - legacy `fruitfit.currentWorkout`;
  - legacy/scoped selected workout/index keys.
- Reset now runs on:
  - login;
  - app start for an already authenticated user;
  - Workout screen open;
  - Coach screen open;
  - manual workout open;
  - Coach send;
  - program-assignment update.
- After reset, only `/api/me/program-assignment` server `currentWorkout` may repopulate cache and UI index.
- If server `currentWorkout.workoutId` contains a local Inskill course id, the client extracts it and syncs `programAssignment.programId` to that server workout program, preventing stale local course ids like `14503` from overriding a current server workout from `14500`.
- Existing debug logs now include stale-state reset reasons under `CACHE_WORKOUT`, plus `SERVER_WORKOUT`, `UI_WORKOUT`, and `AI_PAYLOAD_WORKOUT`.

Validation:

- `npm run build` passed.
- `npm run android:sync` passed.
- `npm run android:debug` passed.
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded on device `8f647179`.
- WebView CDP after launch confirmed:
  - legacy `fruitfit.currentWorkout` absent;
  - legacy `fruitfit.selectedWorkoutIndex` absent;
  - `fruitfit.user_core:<userId>.currentWorkout.programId` is `14500`;
  - `fruitfit.user_core:<userId>.programAssignment.programId` is `14500`;
  - home UI shows `РўСЂРµРЅРёСЂРѕРІРєР° 9/24` / `РЎРїРёРЅР°, Р±РёС†РµРїСЃ, РїСЂРµСЃСЃ` instead of stale `РќРѕРіРё, РїР»РµС‡Рё`.

## 2026-06-19 - Server-only currentWorkout UI program override

Scope: client current-workout UI selection only. Payments, program content, push, Health Connect, and backend logic were not changed.

- Fixed the remaining admin UI mismatch where server/cache used assignment program `14500`, but the Home hero could still render a profile/default 24-workout program because assigned program selection was gated behind paid/vip access.
- The app now derives the rendered program id from server `currentWorkout.programId` first, then assignment `programId`, then paid lock fallback.
- The app now derives the rendered workout index from server `currentWorkout` before building the final program view.
- Server workout ids that contain a local lesson id are matched by that lesson id before any lesson-number fallback, so a generated server id ending in `175274` maps to local lesson `175274`.
- `selectedWorkoutIndex` remains only a display pointer; when server currentWorkout exists, UI selection calls are forced back to the server index.
- Access fallback selection no longer overrides a server currentWorkout index.

Validation:

- `npm run build` passed.
- `npm run android:sync` passed.
- `npm run android:debug` passed.
- `adb install -r android/app/build/outputs/apk/debug/app-debug.apk` succeeded on device `8f647179`.
- WebView CDP after launch confirmed:
  - app bundle `index-CjJpBVWr.js`;
  - legacy workout keys absent;
  - cache currentWorkout `programId=14500`, `lessonId=175274`, `lessonNumber=8`, `index=7`;
  - local assignment `programId=14500`;
  - Home UI shows `РўСЂРµРЅРёСЂРѕРІРєР° 8/16` / `РўСЏРіРѕРІР°СЏ С‚СЏР¶РµР»Р°СЏ`, matching server workout id `175274`.
# FruitFit worklog

## 2026-06-19 - Huawei diagnostic APK support

Scope: Android diagnostics and debug packaging only. Payments, AI Coach, program logic, backend, and Health Connect native read limits were not changed.

- Added a native uncaught exception reporter in `MainActivity` that writes the latest Android crash to app cache diagnostics before the process exits.
- Added `FruitFitHealth.getDeviceDiagnostics()` with Android/EMUI/device metadata, WebView version, Health Connect availability, permission status, installed package checks for Huawei Health/HMS/AppGallery/Wear Engine/common fitness sources, and latest native crash text.
- Added a separate safe `FruitFitDiagnostics` native plugin without Health Connect framework imports.
- `MainActivity` now registers `FruitFitHealthPlugin` only when `android.health.connect` framework classes are present; otherwise the app skips Health Connect bridge registration and writes `fruitfit_native_startup.txt`.
- `getDeviceDiagnostics()` now prefers the safe diagnostics plugin, so Huawei/EMUI devices can report device/WebView/package data even when Health Connect bridge is unavailable.
- Added Huawei package visibility queries to `AndroidManifest.xml`.
- Extended the Health debug JSON export with `deviceDiagnostics`, persisted JS boot/runtime errors, and `errors.lastNativeCrash`.
- Added boot-level JS error persistence in `src/main.jsx` so startup React errors are saved to `fruitfit.client.errors`.
- Added a boot error screen copy button for sharing saved startup diagnostics when React fails before the normal UI opens.
- Added `scripts/build-huawei-debug.ps1` and `npm run android:huawei`; the script builds debug assets and copies the APK to `С…СѓР°РІРµР№/FruitFit-huawei-diagnostic-debug.apk`.

Manual check on Huawei:

- Install `С…СѓР°РІРµР№/FruitFit-huawei-diagnostic-debug.apk`.
- If the app opens: Profile -> Health and activity -> Extended diagnostics -> Refresh -> Share.
- If the app crashes before UI: collect `adb logcat` plus app cache file `fruitfit_last_native_crash.txt` if ADB is available.

## 2026-06-25 - iOS parity sync prep

Scope: iOS client sync and platform labels only. Backend, payments, Robokassa, Android native Health Connect, and AI Coach logic were not changed.

- Checked the GitHub `ios-first-build` branch in a clean worktree at commit `4f5af15`.
- Kept iOS Health UI on Apple Health / HealthKit wording and made the Settings step-source picker platform-aware.
- Backend push-token registration now uses the current Capacitor platform, so iOS registers as `ios` instead of the Android default.
- Admin push readiness was checked for iOS: Firebase plist is included in Xcode resources, APNs entitlement/background mode are present, and the profile notification toggle now forces FCM token registration.
- Trainer progress report source now uses the current platform (`ios-client`, `android-client`, or `web-client`).
- Synced the built web bundle into `ios/App/App/public` with Capacitor.

Validation:

- `npm install` completed in the clean iOS worktree.
- `npm run build` passed.
- `npx cap sync ios` passed.
