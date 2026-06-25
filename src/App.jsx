import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { Dumbbell } from "lucide-react";
import { HealthProvider } from "./data/healthStore";
import { fetchAccess, fetchMe, fetchProfile, fetchProgramAssignment, fetchReferralInfo, loadAccessState, loadAuthUser, loadProgramAssignment, setAuthToken, transferPreAuthProfileDraft } from "./data/authStore";
import { registerDevice } from "./data/deviceStore";
import { loadProfile, profileDefaults, saveProfile } from "./data/profileStore";
import { accessTier, isWorkoutUnlocked, LOCKED_WORKOUT_MESSAGE, originalWorkoutIndex, unlockedWorkoutCount, visibleWorkoutsForAccess } from "./data/accessRules";
import { readUserCoreField, writeUserCoreField } from "./data/dataContainers";
import { findWorkoutIndexForServerWorkout, normalizeServerWorkout, persistCurrentWorkout, resetStaleWorkoutState, serverCurrentWorkoutFromAssignment } from "./data/dataAccess";
import { buildProgramView, useTrainingData } from "./data/useTrainingData";
import CoachScreen from "./screens/CoachScreen";
import AuthPrompt from "./screens/AuthPrompt";
import HomeScreen from "./screens/HomeScreen";
import NutritionScreen from "./screens/NutritionScreen";
import OnboardingQuiz from "./screens/OnboardingQuiz";
import ProfileScreen from "./screens/ProfileScreen";
import SettingsScreen from "./screens/SettingsScreen";
import WorkoutScreen from "./screens/WorkoutScreen";
import WorkoutsScreen from "./screens/WorkoutsScreen";
import { HealthDetailScreen, LectureDetailScreen } from "./components/WidgetGrid";
import { registerFirebaseMessagingPush } from "./services/notifications/firebaseMessagingPush";

const FruitFitOrientation = registerPlugin("FruitFitOrientation");
const SKIP_AUTH_KEY = "fruitfit.authSkipped";
const PAID_PROGRAM_LOCK_KEY = "fruitfit.paidProgramLock";
const LEGACY_SELECTED_WORKOUT_STATE_KEY = "fruitfit.selectedWorkoutState";
const SELECTED_WORKOUT_STATE_FIELD = "selectedWorkoutState";

function registerDeviceAndPush() {
  registerDevice().catch(() => {});
  registerFirebaseMessagingPush().catch(() => {});
}

const healthRoutes = {
  "health:heart": "#/health/heart-rate",
  "health:steps": "#/health/steps",
  "health:sleep": "#/health/sleep",
  "health:calories": "#/health/calories",
  "health:recovery": "#/health/recovery",
  "health:weekly": "#/health/workouts",
  "health:cycle": "#/health/cycle",
};

const appRoutes = {
  workouts: "#/workouts",
  food: "#/nutrition",
  coach: "#/coach",
  profile: "#/profile",
  workout: "#/workout",
  focus: "#/workout/focus",
  lecture: "#/lectures",
  settings: "#/settings",
};

const routeableScreens = new Set(["home", ...Object.keys(appRoutes), ...Object.keys(healthRoutes)]);

function healthScreenFromHash(hash = window.location.hash) {
  const normalized = String(hash || "").replace(/^#/, "");
  const match = Object.entries(healthRoutes).find(([, route]) => route.replace(/^#/, "") === normalized);
  return match?.[0] || null;
}

function appScreenFromHash(hash = window.location.hash) {
  const normalized = String(hash || "").replace(/^#/, "");
  const match = Object.entries(appRoutes).find(([, route]) => route.replace(/^#/, "") === normalized);
  return match?.[0] || null;
}

function screenFromLocation() {
  return healthScreenFromHash() || appScreenFromHash() || "home";
}

function urlForScreen(screen) {
  if (healthRoutes[screen]) return healthRoutes[screen];
  if (appRoutes[screen]) return appRoutes[screen];
  return window.location.pathname + window.location.search;
}

function LoadingScreen({ error }) {
  return (
    <main className="fruitfit-loading-screen grid place-items-center px-8 text-center">
      <div>
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-appDark text-appGreen shadow-sm">
          <Dumbbell size={24} />
        </div>
        <h1 className="mt-4 text-2xl font-black text-appText">fruitfit</h1>
        <p className="mt-2 text-sm text-appMuted">{error || "Загрузка"}</p>
      </div>
    </main>
  );
}

function getInitialTheme() {
  try {
    return localStorage.getItem("fruitfit.theme") || "light";
  } catch (_) {
    return "light";
  }
}

function resolvedTheme(theme) {
  return theme === "system"
    ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme === "dark" ? "dark" : "light";
}

const themeBootColors = {
  light: { bg: "#F7F5EF", text: "#111827" },
  dark: { bg: "#111811", text: "#F6F8EF" },
};

function applyDocumentTheme(theme) {
  const resolved = resolvedTheme(theme);
  const colors = themeBootColors[resolved] || themeBootColors.light;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  root.style.backgroundColor = colors.bg;
  root.style.setProperty("--preboot-bg", colors.bg);
  root.style.setProperty("--preboot-text", colors.text);
  root.style.setProperty("--boot-bg", colors.bg);
  root.style.setProperty("--boot-text", colors.text);
  document.body?.style.setProperty("background-color", colors.bg);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", colors.bg);
  return resolved;
}

function loadAuthSkipped() {
  localStorage.removeItem(SKIP_AUTH_KEY);
  return false;
}

function authTokenFromUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    return url.searchParams.get("auth_token") || hashParams.get("auth_token") || "";
  } catch (_) {
    const hash = String(rawUrl || "").split("#")[1] || "";
    return new URLSearchParams(hash).get("auth_token") || "";
  }
}

function paymentReturnFromUrl(rawUrl) {
  const normalized = String(rawUrl || "").toLowerCase();
  try {
    const url = new URL(rawUrl);
    if (url.protocol === "fruitfit:" && url.hostname === "payment-success") return "success";
    if (url.protocol === "fruitfit:" && url.hostname === "payment-fail") return "fail";
    if (url.pathname.includes("/payment-success")) return "success";
    if (url.pathname.includes("/payment-fail")) return "fail";
  } catch (_) {
    if (normalized.includes("payment-success")) return "success";
    if (normalized.includes("payment-fail")) return "fail";
  }
  if (normalized.includes("payment-success")) return "success";
  if (normalized.includes("payment-fail")) return "fail";
  return "";
}

function emailAuthActionFromUrl(rawUrl) {
  const normalized = String(rawUrl || "").toLowerCase();
  return normalized.includes("/email/verify") || normalized.includes("/email/reset-password");
}

function programIdFromAssignment(assignment = null) {
  return String(assignment?.programId || assignment?.program_id || assignment?.id || "").trim();
}

function programIdFromCourse(course = null) {
  return String(course?.course_id || course?.courseId || course?.id || "").trim();
}

function authUserId(user = loadAuthUser()) {
  return String(user?.id || user?.userId || user?.user_id || "").trim();
}

function selectedWorkoutOwnerId(user = loadAuthUser()) {
  return authUserId(user);
}

function normalizeSelectedWorkoutState(value = null, ownerId = "") {
  if (!value || typeof value !== "object") return null;
  const data = value.data && typeof value.data === "object" ? value.data : value;
  const storedUserId = String(value.userId || data.userId || "").trim();
  const expectedUserId = String(ownerId || "").trim();
  if (expectedUserId && storedUserId && storedUserId !== expectedUserId) return null;
  const dayIndexNumber = Number(data.dayIndex ?? data.selectedWorkoutIndex ?? data.index);
  const dayIndex = Number.isFinite(dayIndexNumber) && dayIndexNumber >= 0 ? Math.floor(dayIndexNumber) : null;
  const workoutId = String(data.workoutId || data.workout_id || data.lessonId || data.lesson_id || "").trim();
  const title = String(data.title || data.lessonTitle || data.lesson_title || "").trim();
  const programId = String(data.programId || data.program_id || "").trim();
  if (!workoutId && !title && dayIndex === null) return null;
  return {
    workoutId: workoutId || null,
    title: title || null,
    programId: programId || null,
    dayIndex,
  };
}

function loadSelectedWorkoutState(user = loadAuthUser()) {
  if (typeof window === "undefined") return null;
  const ownerId = selectedWorkoutOwnerId(user);
  if (!ownerId) {
    localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
    return null;
  }
  try {
    const scoped = normalizeSelectedWorkoutState(readUserCoreField(SELECTED_WORKOUT_STATE_FIELD, ownerId, null), ownerId);
    if (scoped) {
      localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
      return scoped;
    }
    const raw = localStorage.getItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const state = normalizeSelectedWorkoutState(parsed, ownerId);
    if (!state) {
      localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
      return null;
    }
    writeUserCoreField(SELECTED_WORKOUT_STATE_FIELD, { ...state, userId: ownerId, savedAt: new Date().toISOString() }, ownerId);
    localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
    return state;
  } catch (_) {
    localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
    return null;
  }
}

function saveSelectedWorkoutState(state = null, user = loadAuthUser()) {
  if (typeof window === "undefined") return null;
  const ownerId = selectedWorkoutOwnerId(user);
  const normalized = normalizeSelectedWorkoutState(state, ownerId);
  if (!normalized) {
    localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
    if (ownerId) writeUserCoreField(SELECTED_WORKOUT_STATE_FIELD, null, ownerId);
    return null;
  }
  localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
  if (!ownerId) return normalized;
  writeUserCoreField(SELECTED_WORKOUT_STATE_FIELD, {
    userId: ownerId,
    savedAt: new Date().toISOString(),
    ...normalized,
    data: normalized,
  }, ownerId);
  return normalized;
}

function clearSelectedWorkoutState() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(LEGACY_SELECTED_WORKOUT_STATE_KEY);
  }
  const ownerId = selectedWorkoutOwnerId();
  if (ownerId) writeUserCoreField(SELECTED_WORKOUT_STATE_FIELD, null, ownerId);
}

function loadPaidProgramLock() {
  const lock = readUserCoreField("paidProgramLock", undefined, null);
  const programId = String(lock?.programId || lock?.program_id || "").trim();
  return programId ? { ...lock, programId } : null;
}

function savePaidProgramLock(programId, source = "client_current_paid_block") {
  const id = String(programId || "").trim();
  if (!id) return null;
  return writeUserCoreField("paidProgramLock", {
    programId: id,
    source,
    lockedAt: new Date().toISOString(),
  });
}

function isPaidCycleLockedAccess(access = null) {
  const tier = accessTier(access);
  return tier === "paid" || tier === "vip";
}

function workoutSelectionId(workout = null) {
  const lesson = workout?.lesson || workout?.day || workout?.workout || {};
  return String(
    workout?.workout_id
    || workout?.workoutId
    || workout?.id
    || workout?.lesson_id
    || workout?.lessonId
    || lesson?.lesson_id
    || lesson?.lessonId
    || lesson?.id
    || ""
  ).trim();
}

function workoutSelectionTitle(workout = null) {
  const lesson = workout?.lesson || workout?.day || workout?.workout || {};
  return String(
    workout?.title
    || workout?.name
    || workout?.lessonTitle
    || workout?.lesson_title
    || lesson?.lesson_title
    || lesson?.title
    || lesson?.name
    || ""
  ).trim();
}

function selectedWorkoutStateFromWorkout(workout = null, dayIndex = 0, assignment = null) {
  if (!workout) return null;
  const snapshot = workoutSelectionSnapshot(workout, assignment);
  const indexNumber = Number(dayIndex);
  return normalizeSelectedWorkoutState({
    workoutId: snapshot?.workoutId || workoutSelectionId(workout) || null,
    title: snapshot?.title || workoutSelectionTitle(workout) || null,
    programId: snapshot?.programId || programIdFromAssignment(assignment) || programIdFromCourse(workout?.course) || null,
    dayIndex: Number.isFinite(indexNumber) && indexNumber >= 0 ? Math.floor(indexNumber) : null,
  });
}

function selectedWorkoutStateIndex(workouts = [], state = null, programId = "") {
  const items = Array.isArray(workouts) ? workouts : [];
  const normalized = normalizeSelectedWorkoutState(state);
  if (!items.length || !normalized) return -1;
  const selectedProgramId = String(normalized.programId || "").trim();
  const activeProgramId = String(programId || "").trim();
  if (selectedProgramId && activeProgramId && selectedProgramId !== activeProgramId) return -1;
  const selectedId = String(normalized.workoutId || "").trim();
  if (selectedId) {
    const idIndex = items.findIndex((item) => {
      const itemId = workoutSelectionId(item);
      const lesson = item?.lesson || {};
      return [itemId, item?.lesson_id, item?.lessonId, lesson.lesson_id, lesson.lessonId, lesson.id]
        .map((value) => String(value || "").trim())
        .filter(Boolean)
        .includes(selectedId);
    });
    if (idIndex >= 0) return idIndex;
  }
  const selectedTitle = String(normalized.title || "").trim().toLowerCase();
  if (selectedTitle) {
    const titleIndex = items.findIndex((item) => workoutSelectionTitle(item).toLowerCase() === selectedTitle);
    if (titleIndex >= 0) return titleIndex;
  }
  if (Number.isFinite(Number(normalized.dayIndex)) && items[normalized.dayIndex]) {
    return normalized.dayIndex;
  }
  return -1;
}

function workoutSelectionSnapshot(workout = null, assignment = null) {
  if (!workout) return null;
  const normalized = normalizeServerWorkout(workout, assignment) || {};
  const selectedId = workoutSelectionId(workout);
  const selectedTitle = workoutSelectionTitle(workout);
  if (!selectedId && !selectedTitle && !normalized.workoutId && !normalized.lessonId && !normalized.title) return null;
  return {
    ...normalized,
    workoutId: normalized.workoutId || selectedId || null,
    lessonId: normalized.lessonId || selectedId || null,
    title: normalized.title || selectedTitle || null,
    lessonNumber: normalized.lessonNumber || Number(workout?.lesson?.lesson_number || workout?.lessonNumber || workout?.lesson_number || workout?.index + 1) || null,
    index: normalized.index ?? (Number.isFinite(Number(workout?.index)) ? Number(workout.index) : null),
    uiStatus: "in_progress",
    status: "in_progress",
    selectedInApp: true,
    selectedAt: new Date().toISOString(),
    source: "user_selection",
  };
}

function saveActiveWorkoutSelection(selection = null) {
  writeUserCoreField("activeWorkoutSelection", selection || null);
}

function AppContent() {
  const { loading, error, data } = useTrainingData();
  const initialAuthActionUrl = emailAuthActionFromUrl(window.location.href) ? window.location.href : "";
  const [screen, setScreen] = useState(() => healthScreenFromHash() || appScreenFromHash() || "home");
  const [selectedWorkoutState, setSelectedWorkoutState] = useState(() => loadSelectedWorkoutState());
  const [selectedWorkoutIndex, setSelectedWorkoutIndex] = useState(() => {
    const restored = loadSelectedWorkoutState();
    return Number.isFinite(Number(restored?.dayIndex)) ? Number(restored.dayIndex) : 0;
  });
  const [userSelectedWorkoutId, setUserSelectedWorkoutId] = useState(() => loadSelectedWorkoutState()?.workoutId || "");
  const [userSelectedWorkoutSnapshot, setUserSelectedWorkoutSnapshot] = useState(null);
  const [theme, setTheme] = useState(getInitialTheme);
  const [profile, setProfile] = useState(loadProfile);
  const [authUser, setAuthUser] = useState(loadAuthUser);
  const [accessState, setAccessState] = useState(loadAccessState);
  const [programAssignment, setProgramAssignment] = useState(loadProgramAssignment);
  const [paidProgramLock, setPaidProgramLock] = useState(loadPaidProgramLock);
  const [authSkipped, setAuthSkipped] = useState(loadAuthSkipped);
  const [authActionUrl, setAuthActionUrl] = useState(initialAuthActionUrl);
  const [quizOpen, setQuizOpen] = useState(() => !initialAuthActionUrl && !loadProfile().onboardingCompleted);
  const [authPromptOpen, setAuthPromptOpen] = useState(() => Boolean(initialAuthActionUrl) || (loadProfile().onboardingCompleted && !loadAuthUser() && !loadAuthSkipped()));
  const screenRef = useRef(screen);
  const routeStackRef = useRef([screen]);
  const routeMetaRef = useRef(window.history.state || {});

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  function clearSelectedWorkoutSelection(reason = "clear-selected-workout", fallbackIndex = 0) {
    clearSelectedWorkoutState();
    setSelectedWorkoutState(null);
    setUserSelectedWorkoutId("");
    setUserSelectedWorkoutSnapshot(null);
    saveActiveWorkoutSelection(null);
    setSelectedWorkoutIndex(Math.max(0, Number(fallbackIndex) || 0));
    console.info("[FruitFit currentWorkout] UI_WORKOUT", {
      reason,
      action: "clear_selected_workout_state",
    });
  }

  function saveSelectedWorkoutSelection(nextWorkout, dayIndex, reason = "user-select-workout") {
    const nextState = selectedWorkoutStateFromWorkout(nextWorkout, dayIndex, programAssignment);
    const savedState = saveSelectedWorkoutState(nextState, authUser) || nextState;
    const nextSnapshot = workoutSelectionSnapshot(nextWorkout, programAssignment);
    setSelectedWorkoutState(savedState);
    setUserSelectedWorkoutId(savedState?.workoutId || "");
    setUserSelectedWorkoutSnapshot(nextSnapshot);
    saveActiveWorkoutSelection(nextSnapshot);
    setSelectedWorkoutIndex(Number.isFinite(Number(savedState?.dayIndex)) ? Number(savedState.dayIndex) : Math.max(0, Number(dayIndex) || 0));
    console.info("[FruitFit currentWorkout] UI_WORKOUT", {
      reason,
      action: "save_selected_workout_state",
      selectedWorkoutState: savedState,
      selectedWorkoutTitle: savedState?.title || null,
    });
    return savedState;
  }

  useEffect(() => {
    resetStaleWorkoutState({ reason: "app-start" });
    const restored = loadSelectedWorkoutState(authUser);
    if (restored) {
      setSelectedWorkoutState(restored);
      setUserSelectedWorkoutId(restored.workoutId || "");
      setSelectedWorkoutIndex(Number.isFinite(Number(restored.dayIndex)) ? Number(restored.dayIndex) : 0);
    }
  }, []);

  function rememberRoute(nextScreen, { replace = false } = {}) {
    if (!routeableScreens.has(nextScreen)) return;
    const stack = routeStackRef.current.length ? [...routeStackRef.current] : [screenRef.current || "home"];
    if (replace) {
      stack[stack.length - 1] = nextScreen;
    } else if (stack[stack.length - 1] !== nextScreen) {
      stack.push(nextScreen);
    }
    routeStackRef.current = stack.slice(-32);
  }

  function syncRouteStackFromBrowser(nextScreen) {
    if (!routeableScreens.has(nextScreen)) return;
    const stack = routeStackRef.current.length ? [...routeStackRef.current] : ["home"];
    if (stack.length > 1 && stack[stack.length - 2] === nextScreen) {
      stack.pop();
    } else if (stack[stack.length - 1] !== nextScreen) {
      stack.push(nextScreen);
    }
    routeStackRef.current = stack.slice(-32);
  }

  function writeRoute(nextScreen, { replace = false, source = "screen" } = {}) {
    if (!routeableScreens.has(nextScreen)) return;
    const nextState = { fruitfitScreen: nextScreen, fruitfitSource: source };
    const method = replace ? "replaceState" : "pushState";
    window.history[method](nextState, "", urlForScreen(nextScreen));
    routeMetaRef.current = nextState;
    rememberRoute(nextScreen, { replace });
  }

  function navigate(nextScreen, options = {}) {
    setScreen((current) => {
      if (typeof nextScreen === "string" && current !== nextScreen) {
        writeRoute(nextScreen, options);
      }
      return nextScreen;
    });
  }

  function popAppRoute(fallback = "home", source = "app-back") {
    const stack = routeStackRef.current.length ? [...routeStackRef.current] : [screenRef.current || "home"];
    if (stack.length > 1) {
      stack.pop();
      const previousScreen = stack[stack.length - 1] || fallback;
      routeStackRef.current = stack;
      const nextState = { fruitfitScreen: previousScreen, fruitfitSource: source };
      window.history.replaceState(nextState, "", urlForScreen(previousScreen));
      routeMetaRef.current = nextState;
      setScreen(previousScreen);
      return true;
    }
    return false;
  }

  function goBack(fallback = "home") {
    if (popAppRoute(fallback, "toolbar-back")) {
      return;
    }
    writeRoute(fallback, { replace: true, source: "back-fallback" });
    setScreen(fallback);
  }

  function handleBackNavigation(source = "app-back") {
    if (popAppRoute("home", source)) {
      return true;
    }
    if (screenRef.current !== "home") {
      writeRoute("home", { replace: true, source: `${source}-fallback` });
      setScreen("home");
      return true;
    }
    return false;
  }

  useEffect(() => {
    function handlePopState() {
      routeMetaRef.current = window.history.state || {};
      const nextScreen = screenFromLocation();
      syncRouteStackFromBrowser(nextScreen);
      setScreen(nextScreen);
    }
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("hashchange", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("hashchange", handlePopState);
    };
  }, []);

  useEffect(() => {
    if (!window.location.hash.includes("auth_token=")) {
      const initialScreen = screenFromLocation();
      const currentState = window.history.state || {};
      if (currentState.fruitfitScreen !== initialScreen) {
        writeRoute(initialScreen, { replace: true, source: "initial" });
      } else {
        routeMetaRef.current = currentState;
      }
    }
  }, []);

  useEffect(() => {
    let listener;
    CapacitorApp.addListener("backButton", () => {
      if (!handleBackNavigation("android-back")) CapacitorApp.minimizeApp?.();
    }).then((handle) => {
      listener = handle;
    }).catch(() => {});
    return () => listener?.remove?.();
  }, []);

  useEffect(() => {
    const nativeBackHandler = () => handleBackNavigation("android-native-back");
    const backEventHandler = () => nativeBackHandler();
    window.__fruitfitHandleAndroidBack = nativeBackHandler;
    window.addEventListener("fruitfit:android-back", backEventHandler);
    return () => {
      if (window.__fruitfitHandleAndroidBack === nativeBackHandler) {
        delete window.__fruitfitHandleAndroidBack;
      }
      window.removeEventListener("fruitfit:android-back", backEventHandler);
    };
  }, []);

  async function applyAuthToken(token, { cleanUrl = false } = {}) {
    if (!token) return;
    setAuthToken(token);
    localStorage.removeItem(SKIP_AUTH_KEY);
    setAuthSkipped(false);
    registerDeviceAndPush();
    if (cleanUrl) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const user = await fetchMe();
    if (user) {
      registerDeviceAndPush();
      await transferPreAuthProfileDraft({ reason: "token-auth" });
      const [access, serverProfile, assignment] = await Promise.all([
        fetchAccess(),
        fetchProfile(),
        fetchProgramAssignment()
      ]);
      if (serverProfile) {
        const mergedProfile = saveProfile(serverProfile);
        setProfile(mergedProfile);
      }
      setAuthUser(user);
      setAccessState(access);
      setProgramAssignment(assignment);
      setPaidProgramLock(loadPaidProgramLock());
      setAuthPromptOpen(false);
      const pendingProvider = sessionStorage.getItem("fruitfit.pendingProviderLink") || "";
      if (pendingProvider) {
        window.dispatchEvent(new CustomEvent("fruitfit:auth-link-returned", { detail: { provider: pendingProvider } }));
      }
    } else {
      setAuthPromptOpen(true);
    }
  }

  async function refreshPaymentStateAfterReturn() {
    const [access, assignment, referralInfo] = await Promise.all([fetchAccess(), fetchProgramAssignment(), fetchReferralInfo()]);
    if (access) setAccessState(access);
    setProgramAssignment(assignment);
    window.dispatchEvent(new CustomEvent("fruitfit:referral-updated", { detail: referralInfo || null }));
  }

  useEffect(() => {
    const paymentReturn = paymentReturnFromUrl(window.location.href);
    if (paymentReturn) {
      writeRoute("profile", { replace: true, source: `payment-${paymentReturn}` });
      setScreen("profile");
      if (loadAuthUser()) refreshPaymentStateAfterReturn().catch(() => {});
      return;
    }
    if (emailAuthActionFromUrl(window.location.href)) {
      setAuthActionUrl(window.location.href);
      setQuizOpen(false);
      setAuthPromptOpen(true);
      return;
    }
    const token = authTokenFromUrl(window.location.href);
    if (token) {
      applyAuthToken(token, { cleanUrl: true }).catch(() => setAuthPromptOpen(true));
    } else if (loadAuthUser()) {
      // Validate session on load
      fetchMe().then(async (user) => {
        if (user) {
          registerDeviceAndPush();
          await transferPreAuthProfileDraft({ reason: "existing-session" });
          const [access, serverProfile, assignment] = await Promise.all([
            fetchAccess(),
            fetchProfile(),
            fetchProgramAssignment()
          ]);
          if (serverProfile) {
            const mergedProfile = saveProfile(serverProfile);
            setProfile(mergedProfile);
          }
          setAuthUser(user);
          setAccessState(access);
          setProgramAssignment(assignment);
          setPaidProgramLock(loadPaidProgramLock());
        } else {
          setAuthPromptOpen(true);
        }
      });
    }
  }, []);

  useEffect(() => {
    let listener;
    CapacitorApp.addListener("appUrlOpen", ({ url }) => {
      const paymentReturn = paymentReturnFromUrl(url);
      if (paymentReturn) {
        writeRoute("profile", { replace: true, source: `payment-${paymentReturn}` });
        setScreen("profile");
        if (loadAuthUser()) refreshPaymentStateAfterReturn().catch(() => {});
        return;
      }
      if (emailAuthActionFromUrl(url)) {
        setAuthActionUrl(url);
        setQuizOpen(false);
        setAuthPromptOpen(true);
        return;
      }
      const token = authTokenFromUrl(url);
      if (token) applyAuthToken(token).catch(() => setAuthPromptOpen(true));
    }).then((handle) => {
      listener = handle;
    }).catch(() => {});
    return () => listener?.remove?.();
  }, []);

  useLayoutEffect(() => {
    applyDocumentTheme(theme);
    try {
      localStorage.setItem("fruitfit.theme", theme);
    } catch (_) {}
  }, [theme]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.classList.remove("fruitfit-preboot");
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const lockPortrait = () => {
      FruitFitOrientation.lockPortrait?.().catch?.(() => {});
      window.screen?.orientation?.lock?.("portrait").catch?.(() => {});
    };
    const unlockForFullscreenVideo = () => {
      FruitFitOrientation.unlock?.().catch?.(() => {});
      window.screen?.orientation?.unlock?.();
    };
    document.documentElement.classList.add("portrait-lock");
    lockPortrait();
    const onFullscreenChange = () => {
      const element = document.fullscreenElement || document.webkitFullscreenElement;
      const isFullscreenMedia = Boolean(element);
      if (isFullscreenMedia) unlockForFullscreenVideo();
      else lockPortrait();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    function syncProfile(event) {
      setProfile(event?.detail || loadProfile());
    }
    window.addEventListener("fruitfit:profile-updated", syncProfile);
    window.addEventListener("storage", syncProfile);
    return () => {
      window.removeEventListener("fruitfit:profile-updated", syncProfile);
      window.removeEventListener("storage", syncProfile);
    };
  }, []);

  useEffect(() => {
    function syncAuth(event) {
      const nextAuthUser = event?.detail || loadAuthUser();
      setAuthUser(nextAuthUser);
      setPaidProgramLock(loadPaidProgramLock());
      const restored = nextAuthUser ? loadSelectedWorkoutState(nextAuthUser) : null;
      if (restored) {
        setSelectedWorkoutState(restored);
        setUserSelectedWorkoutId(restored.workoutId || "");
        setSelectedWorkoutIndex(Number.isFinite(Number(restored.dayIndex)) ? Number(restored.dayIndex) : 0);
      } else {
        clearSelectedWorkoutSelection(nextAuthUser ? "auth-user-switch-no-selection" : "logout-clear-selection", 0);
      }
    }
    window.addEventListener("fruitfit:auth-updated", syncAuth);
    window.addEventListener("storage", syncAuth);
    return () => {
      window.removeEventListener("fruitfit:auth-updated", syncAuth);
      window.removeEventListener("storage", syncAuth);
    };
  }, []);

  useEffect(() => {
    function syncAccess(event) {
      setAccessState(event?.detail || loadAccessState());
    }
    window.addEventListener("fruitfit:access-updated", syncAccess);
    window.addEventListener("storage", syncAccess);
    return () => {
      window.removeEventListener("fruitfit:access-updated", syncAccess);
      window.removeEventListener("storage", syncAccess);
    };
  }, []);

  useEffect(() => {
    function syncProgramAssignment(event) {
      setProgramAssignment(event?.detail || loadProgramAssignment());
    }
    window.addEventListener("fruitfit:program-assignment-updated", syncProgramAssignment);
    window.addEventListener("storage", syncProgramAssignment);
    return () => {
      window.removeEventListener("fruitfit:program-assignment-updated", syncProgramAssignment);
      window.removeEventListener("storage", syncProgramAssignment);
    };
  }, []);

  useEffect(() => {
    if (!authUser) return undefined;
    let listener;
    async function refreshServerState() {
      const [access, assignment, referralInfo] = await Promise.all([fetchAccess(), fetchProgramAssignment(), fetchReferralInfo()]);
      if (access) setAccessState(access);
      setProgramAssignment(assignment);
      window.dispatchEvent(new CustomEvent("fruitfit:referral-updated", { detail: referralInfo || null }));
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshServerState().catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    CapacitorApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) refreshServerState().catch(() => {});
    }).then((handle) => {
      listener = handle;
    }).catch(() => {});
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      listener?.remove?.();
    };
  }, [authUser]);

  const assignedProgramId = programIdFromAssignment(programAssignment);
  const paidCycleLocked = isPaidCycleLockedAccess(accessState);
  const serverWorkoutForProgram = useMemo(() => serverCurrentWorkoutFromAssignment(programAssignment), [programAssignment]);
  const serverWorkoutProgramId = String(serverWorkoutForProgram?.programId || serverWorkoutForProgram?.program_id || "").trim();
  const effectiveAssignedProgramId = serverWorkoutProgramId || assignedProgramId || (paidCycleLocked ? (paidProgramLock?.programId || "") : "");
  const programForServerIndex = useMemo(() => buildProgramView(data, 0, profile, effectiveAssignedProgramId), [data, profile, effectiveAssignedProgramId]);
  const serverSelectedWorkoutIndex = findWorkoutIndexForServerWorkout(programForServerIndex, serverWorkoutForProgram);
  const selectedWorkoutStateResolvedIndex = selectedWorkoutStateIndex(programForServerIndex?.workouts || [], selectedWorkoutState, effectiveAssignedProgramId);
  const hasPersistentWorkoutSelection = selectedWorkoutStateResolvedIndex >= 0;
  const renderSelectedWorkoutIndex = hasPersistentWorkoutSelection
    ? selectedWorkoutStateResolvedIndex
    : (serverSelectedWorkoutIndex >= 0 ? serverSelectedWorkoutIndex : selectedWorkoutIndex);
  const program = useMemo(() => buildProgramView(data, renderSelectedWorkoutIndex, profile, effectiveAssignedProgramId), [data, profile, renderSelectedWorkoutIndex, effectiveAssignedProgramId]);
  const workout = program?.selectedWorkout;
  const uiSelectedWorkoutIndex = program?.selectedWorkoutIndex ?? renderSelectedWorkoutIndex;
  const derivedWorkoutForCoach = useMemo(() => workoutSelectionSnapshot(workout, programAssignment), [programAssignment, workout]);
  const uiSelectedWorkoutForCoach = hasPersistentWorkoutSelection ? (userSelectedWorkoutSnapshot || derivedWorkoutForCoach) : derivedWorkoutForCoach;
  const uiSelectedWorkoutId = String(selectedWorkoutState?.workoutId || userSelectedWorkoutId || uiSelectedWorkoutForCoach?.workoutId || uiSelectedWorkoutForCoach?.lessonId || workoutSelectionId(workout) || "").trim();
  const uiSelectedWorkoutTitle = String(selectedWorkoutState?.title || uiSelectedWorkoutForCoach?.title || workoutSelectionTitle(workout) || "").trim();
  const lastProgramIdRef = useRef("");

  useEffect(() => {
    const nextProgramId = String(effectiveAssignedProgramId || "").trim();
    if (!nextProgramId) return;
    if (lastProgramIdRef.current && lastProgramIdRef.current !== nextProgramId) {
      clearSelectedWorkoutSelection("program-change-clear-selection", serverSelectedWorkoutIndex >= 0 ? serverSelectedWorkoutIndex : 0);
    }
    lastProgramIdRef.current = nextProgramId;
  }, [effectiveAssignedProgramId, serverSelectedWorkoutIndex]);

  function syncSelectedWorkoutFromServerAssignment(assignment = programAssignment, reason = "state-sync", options = {}) {
    const serverWorkout = persistCurrentWorkout({ programAssignment: assignment });
    const nextIndex = findWorkoutIndexForServerWorkout(programForServerIndex, serverWorkout);
    const forceServerSelection = Boolean(options.forceServerSelection);
    const activeSelectionIndex = selectedWorkoutStateIndex(programForServerIndex?.workouts || [], selectedWorkoutState, effectiveAssignedProgramId);
    const userSelectionStillValid = activeSelectionIndex >= 0
      ? isWorkoutUnlocked(activeSelectionIndex, program?.workouts || [], accessState)
      : false;
    const shouldApplyServerSelection = forceServerSelection || !userSelectionStillValid;
    console.info("[FruitFit currentWorkout] SERVER_WORKOUT", {
      reason,
      workoutId: serverWorkout?.workoutId || null,
      title: serverWorkout?.title || null,
      lessonNumber: serverWorkout?.lessonNumber || null,
      mappedIndex: nextIndex,
      selectedWorkoutState: selectedWorkoutState || null,
      selectedWorkoutStateIndex: activeSelectionIndex,
      shouldApplyServerSelection,
    });
    console.info("[FruitFit currentWorkout] UI_WORKOUT", {
      reason,
      selectedWorkoutIndex: uiSelectedWorkoutIndex,
      stateSelectedWorkoutIndex: selectedWorkoutIndex,
      selectedWorkoutState: selectedWorkoutState || null,
      title: workout?.lesson?.lesson_title || workout?.title || null,
      nextIndex,
    });
    if (selectedWorkoutState && !userSelectionStillValid) {
      clearSelectedWorkoutSelection(`${reason}-invalid-selection`, nextIndex >= 0 ? nextIndex : 0);
    }
    if (nextIndex >= 0 && shouldApplyServerSelection && nextIndex !== selectedWorkoutIndex) {
      setSelectedWorkoutIndex(nextIndex);
    }
    return serverWorkout;
  }

  useEffect(() => {
    if (!paidCycleLocked || !program?.course) return;
    const serverProgramId = assignedProgramId;
    const currentProgramId = programIdFromCourse(program.course);
    const nextLockId = serverProgramId || paidProgramLock?.programId || currentProgramId;
    if (!nextLockId || paidProgramLock?.programId === nextLockId) return;
    const nextLock = savePaidProgramLock(nextLockId, serverProgramId ? "server_assignment" : "client_current_paid_block");
    if (nextLock) {
      setPaidProgramLock(nextLock);
      console.info("[FruitFit Program] PAID_PROGRAM_LOCKED", {
        programId: nextLock.programId,
        source: nextLock.source,
        accessTier: accessTier(accessState)
      });
    }
  }, [accessState, assignedProgramId, paidCycleLocked, paidProgramLock?.programId, program?.course]);

  useEffect(() => {
    if (!program?.workouts?.length) return;
    const unlockedCount = unlockedWorkoutCount(program.workouts, accessState);
    if (unlockedCount > 0 && !isWorkoutUnlocked(uiSelectedWorkoutIndex, program.workouts, accessState)) {
      const visibleWorkouts = visibleWorkoutsForAccess(program.workouts, accessState);
      const fallbackIndex = originalWorkoutIndex(program.workouts, visibleWorkouts[visibleWorkouts.length - 1]);
      const safeIndex = fallbackIndex >= 0 ? fallbackIndex : unlockedCount - 1;
      const fallbackWorkout = program.workouts[safeIndex] || null;
      saveSelectedWorkoutSelection(fallbackWorkout, safeIndex, "fallback-to-visible-workout");
    }
  }, [accessState, program?.workouts, uiSelectedWorkoutIndex]);

  useEffect(() => {
    if (!authUser) return;
    syncSelectedWorkoutFromServerAssignment(programAssignment, "assignment-state");
  }, [authUser, programAssignment, programForServerIndex?.workouts, selectedWorkoutState]);

  useEffect(() => {
    if (!authUser || (screen !== "workout" && screen !== "coach")) return undefined;
    let cancelled = false;
    resetStaleWorkoutState({ reason: `${screen}-open` });
    fetchProgramAssignment().then((assignment) => {
      if (cancelled) return;
      setProgramAssignment(assignment);
      if (!selectedWorkoutState) {
        syncSelectedWorkoutFromServerAssignment(assignment, `${screen}-open`);
      }
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [authUser, screen, selectedWorkoutState]);

  if (loading || error || !program || !workout) return <LoadingScreen error={error} />;

  if (quizOpen) {
    return (
      <OnboardingQuiz
        initialProfile={profile}
        restart={profile.onboardingCompleted}
        onCancel={profile.onboardingCompleted ? () => setQuizOpen(false) : null}
        onComplete={(savedProfile) => {
          setProfile(savedProfile);
          clearSelectedWorkoutSelection("questionnaire-complete-clear-selection", 0);
          setQuizOpen(false);
          setAuthPromptOpen(!loadAuthUser() && !loadAuthSkipped());
          navigate("home");
        }}
      />
    );
  }

  if (authPromptOpen || (!authUser && !authSkipped)) {
    return (
      <AuthPrompt
        key={authActionUrl || "auth"}
        initialUrl={authActionUrl || window.location.href}
        onComplete={async (user, meta = {}) => {
          if (meta.skipped) {
            setAuthActionUrl("");
            localStorage.setItem(SKIP_AUTH_KEY, "1");
            setAuthSkipped(true);
            setAuthUser(null);
            setAccessState(null);
            setProgramAssignment(null);
            setPaidProgramLock(null);
            setProfile(profileDefaults);
            clearSelectedWorkoutSelection("auth-skipped-clear-selection", 0);
            setAuthPromptOpen(false);
            return;
          }
          setAuthActionUrl("");
          localStorage.removeItem(SKIP_AUTH_KEY);
          setAuthSkipped(false);
          const nextUser = user || loadAuthUser();
          setAuthUser(nextUser);
          setProfile(loadProfile());
          setAccessState(null);
          setProgramAssignment(null);
          setPaidProgramLock(loadPaidProgramLock());
          clearSelectedWorkoutSelection("auth-complete-clear-previous-selection", 0);
          await transferPreAuthProfileDraft({ reason: "auth-complete" });
          const [access, serverProfile, assignment] = await Promise.all([fetchAccess(), fetchProfile(), fetchProgramAssignment()]);
          if (serverProfile) setProfile(saveProfile(serverProfile));
          else setProfile(loadProfile());
          setAccessState(access);
          setProgramAssignment(assignment);
          setAuthPromptOpen(false);
        }}
      />
    );
  }

  function selectWorkoutFromUi(nextIndex) {
    const total = program?.workouts?.length || 0;
    const safeIndex = Math.max(0, Math.min(Number(nextIndex) || 0, Math.max(total - 1, 0)));
    if (!isWorkoutUnlocked(safeIndex, program?.workouts || total, accessState)) {
      window.alert(LOCKED_WORKOUT_MESSAGE);
      return;
    }
    const selectedWorkout = program?.workouts?.[safeIndex] || null;
    const savedState = saveSelectedWorkoutSelection(selectedWorkout, safeIndex, "user-select-workout");
    console.info("[FruitFit currentWorkout] UI_WORKOUT", {
      reason: "user-select-workout",
      selectedWorkoutIndex: safeIndex,
      selectedWorkoutId: savedState?.workoutId || null,
      selectedWorkoutTitle: savedState?.title || workoutSelectionTitle(selectedWorkout) || null,
      serverIndex: serverSelectedWorkoutIndex,
    });
  }

  async function openWorkout(index = uiSelectedWorkoutIndex) {
    const total = program?.workouts?.length || 0;
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(total - 1, 0)));
    console.info("[FruitFit currentWorkout] UI_WORKOUT", {
      reason: "open-workout",
      requestedIndex: index,
      safeIndex,
      serverIndex: serverSelectedWorkoutIndex,
      selectedWorkoutState: selectedWorkoutState || null,
    });
    if (!isWorkoutUnlocked(safeIndex, program?.workouts || total, accessState)) {
      window.alert(LOCKED_WORKOUT_MESSAGE);
      return;
    }
    const selectedWorkout = program?.workouts?.[safeIndex] || null;
    saveSelectedWorkoutSelection(selectedWorkout, safeIndex, "open-workout");
    navigate("workout");
    resetStaleWorkoutState({ reason: "open-workout" });
    if (authUser) {
      fetchProgramAssignment().then((assignment) => {
        setProgramAssignment(assignment);
      }).catch(() => {});
    }
  }

  if (screen.startsWith("health:")) {
    return <HealthDetailScreen type={screen.split(":")[1]} onBack={() => goBack("home")} />;
  }

  if (screen === "focus") {
    return (
      <WorkoutScreen
        mode="focus"
        program={program}
        workout={workout}
        selectedWorkoutIndex={uiSelectedWorkoutIndex}
        onSelectWorkout={selectWorkoutFromUi}
        onBack={() => goBack("workout")}
        onNavigate={navigate}
        profile={profile}
        access={accessState}
      />
    );
  }

  if (screen === "workout") {
    return (
      <WorkoutScreen
        program={program}
        workout={workout}
        selectedWorkoutIndex={uiSelectedWorkoutIndex}
        onSelectWorkout={selectWorkoutFromUi}
        onBack={() => goBack("home")}
        onNavigate={navigate}
        profile={profile}
        access={accessState}
      />
    );
  }

  if (screen === "workouts") {
    return (
      <WorkoutsScreen
        program={program}
        selectedWorkoutIndex={uiSelectedWorkoutIndex}
        onOpenWorkout={openWorkout}
        onNavigate={navigate}
        profile={profile}
        access={accessState}
      />
    );
  }

  if (screen === "food") {
    return <NutritionScreen onNavigate={navigate} profile={profile} access={accessState} user={authUser} showBack={routeMetaRef.current?.fruitfitSource === "screen"} onBack={() => goBack("home")} />;
  }

  if (screen === "coach") {
    return <CoachScreen program={program} workout={workout} selectedWorkout={uiSelectedWorkoutForCoach} selectedWorkoutId={uiSelectedWorkoutId} selectedWorkoutTitle={uiSelectedWorkoutTitle} profile={profile} access={accessState} programAssignment={programAssignment} onNavigate={navigate} />;
  }

  if (screen === "profile") {
    return <ProfileScreen profile={profile} access={accessState} onProfileChange={setProfile} theme={theme} onThemeChange={setTheme} onNavigate={navigate} onRestartQuiz={() => setQuizOpen(true)} onRequireAuth={() => setAuthPromptOpen(true)} />;
  }

  if (screen === "settings") {
    return <SettingsScreen theme={theme} onThemeChange={setTheme} onNavigate={navigate} onBack={() => goBack("profile")} />;
  }

  if (screen === "lecture") {
    return <LectureDetailScreen onBack={() => goBack("home")} access={accessState} />;
  }

  return (
    <HomeScreen
      program={program}
      workout={workout}
      profile={profile}
      authUser={authUser}
      access={accessState}
      onStartWorkout={() => openWorkout(uiSelectedWorkoutIndex)}
      onNavigate={navigate}
    />
  );
}

export default function App() {
  return (
    <HealthProvider>
      <AppContent />
    </HealthProvider>
  );
}
