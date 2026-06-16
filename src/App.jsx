import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { registerPlugin } from "@capacitor/core";
import { Dumbbell } from "lucide-react";
import { HealthProvider } from "./data/healthStore";
import { fetchAccess, fetchMe, fetchProfile, fetchProgramAssignment, fetchReferralInfo, loadAccessState, loadAuthUser, loadProgramAssignment, setAuthToken } from "./data/authStore";
import { registerDevice } from "./data/deviceStore";
import { loadProfile, saveProfile } from "./data/profileStore";
import { isWorkoutUnlocked, LOCKED_WORKOUT_MESSAGE, unlockedWorkoutCount } from "./data/accessRules";
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

const FruitFitOrientation = registerPlugin("FruitFitOrientation");
const SKIP_AUTH_KEY = "fruitfit.authSkipped";

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
    <main className="phone-shell grid place-items-center px-8 text-center">
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
  return localStorage.getItem("fruitfit.theme") || "light";
}

function loadAuthSkipped() {
  return localStorage.getItem(SKIP_AUTH_KEY) === "1";
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

function AppContent() {
  const { loading, error, data } = useTrainingData();
  const initialAuthActionUrl = emailAuthActionFromUrl(window.location.href) ? window.location.href : "";
  const [screen, setScreen] = useState(() => healthScreenFromHash() || appScreenFromHash() || "home");
  const [selectedWorkoutIndex, setSelectedWorkoutIndex] = useState(0);
  const [theme, setTheme] = useState(getInitialTheme);
  const [profile, setProfile] = useState(loadProfile);
  const [authUser, setAuthUser] = useState(loadAuthUser);
  const [accessState, setAccessState] = useState(loadAccessState);
  const [programAssignment, setProgramAssignment] = useState(loadProgramAssignment);
  const [authSkipped, setAuthSkipped] = useState(loadAuthSkipped);
  const [authActionUrl, setAuthActionUrl] = useState(initialAuthActionUrl);
  const [quizOpen, setQuizOpen] = useState(() => !initialAuthActionUrl && !loadProfile().onboardingCompleted);
  const [authPromptOpen, setAuthPromptOpen] = useState(() => Boolean(initialAuthActionUrl) || (loadProfile().onboardingCompleted && !loadAuthUser() && !loadAuthSkipped()));
  const screenRef = useRef(screen);
  const routeMetaRef = useRef(window.history.state || {});

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  function writeRoute(nextScreen, { replace = false, source = "screen" } = {}) {
    if (!routeableScreens.has(nextScreen)) return;
    const nextState = { fruitfitScreen: nextScreen, fruitfitSource: source };
    const method = replace ? "replaceState" : "pushState";
    window.history[method](nextState, "", urlForScreen(nextScreen));
    routeMetaRef.current = nextState;
  }

  function navigate(nextScreen, options = {}) {
    setScreen((current) => {
      if (typeof nextScreen === "string" && current !== nextScreen) {
        writeRoute(nextScreen, options);
      }
      return nextScreen;
    });
  }

  function canPopCurrentRoute() {
    const state = window.history.state || {};
    return state.fruitfitScreen === screenRef.current && state.fruitfitSource !== "initial";
  }

  function goBack(fallback = "home") {
    if (canPopCurrentRoute()) {
      window.history.back();
      return;
    }
    writeRoute(fallback, { replace: true, source: "back-fallback" });
    setScreen(fallback);
  }

  useEffect(() => {
    function handlePopState() {
      routeMetaRef.current = window.history.state || {};
      setScreen(screenFromLocation());
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
      if (screenRef.current !== "home" && canPopCurrentRoute()) {
        window.history.back();
        return;
      }
      if (screenRef.current !== "home") {
        writeRoute("home", { replace: true, source: "android-back-fallback" });
        setScreen("home");
        return;
      }
      CapacitorApp.minimizeApp?.();
    }).then((handle) => {
      listener = handle;
    }).catch(() => {});
    return () => listener?.remove?.();
  }, []);

  async function applyAuthToken(token, { cleanUrl = false } = {}) {
    if (!token) return;
    setAuthToken(token);
    localStorage.removeItem(SKIP_AUTH_KEY);
    setAuthSkipped(false);
    registerDevice().catch(() => {});
    if (cleanUrl) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    const user = await fetchMe();
    if (user) {
      registerDevice().catch(() => {});
      const [access, serverProfile, assignment] = await Promise.all([
        fetchAccess(),
        fetchProfile(),
        fetchProgramAssignment()
      ]);
      if (serverProfile) {
        const mergedProfile = saveProfile({ ...loadProfile(), ...serverProfile, onboardingCompleted: loadProfile().onboardingCompleted || serverProfile.onboardingCompleted });
        setProfile(mergedProfile);
      }
      setAuthUser(user);
      setAccessState(access);
      setProgramAssignment(assignment);
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
          registerDevice().catch(() => {});
          const [access, serverProfile, assignment] = await Promise.all([
            fetchAccess(),
            fetchProfile(),
            fetchProgramAssignment()
          ]);
          if (serverProfile) {
            const mergedProfile = saveProfile({ ...loadProfile(), ...serverProfile, onboardingCompleted: loadProfile().onboardingCompleted || serverProfile.onboardingCompleted });
            setProfile(mergedProfile);
          }
          setAuthUser(user);
          setAccessState(access);
          setProgramAssignment(assignment);
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

  useEffect(() => {
    const resolved = theme === "system"
      ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("fruitfit.theme", theme);
  }, [theme]);

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
      setAuthUser(event?.detail || loadAuthUser());
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

  const assignedProgramId = programAssignment?.programId || programAssignment?.program_id || "";
  const program = useMemo(() => buildProgramView(data, selectedWorkoutIndex, profile, assignedProgramId), [data, profile, selectedWorkoutIndex, assignedProgramId]);
  const workout = program?.selectedWorkout;

  useEffect(() => {
    if (!program?.workouts?.length) return;
    const unlockedCount = unlockedWorkoutCount(program.workouts, accessState);
    if (unlockedCount > 0 && selectedWorkoutIndex >= unlockedCount) {
      setSelectedWorkoutIndex(unlockedCount - 1);
    }
  }, [accessState, program?.workouts, selectedWorkoutIndex]);

  if (loading || error || !program || !workout) return <LoadingScreen error={error} />;

  if (quizOpen) {
    return (
      <OnboardingQuiz
        initialProfile={profile}
        restart={profile.onboardingCompleted}
        onCancel={profile.onboardingCompleted ? () => setQuizOpen(false) : null}
        onComplete={(savedProfile) => {
          setProfile(savedProfile);
          setSelectedWorkoutIndex(0);
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
            setAuthPromptOpen(false);
            return;
          }
          setAuthActionUrl("");
          localStorage.removeItem(SKIP_AUTH_KEY);
          setAuthSkipped(false);
          setAuthUser(user || loadAuthUser());
          const [access, assignment] = await Promise.all([fetchAccess(), fetchProgramAssignment()]);
          setAccessState(loadAccessState() || access);
          setProgramAssignment(assignment);
          setAuthPromptOpen(false);
        }}
      />
    );
  }

  function openWorkout(index = selectedWorkoutIndex) {
    const total = program?.workouts?.length || 0;
    const safeIndex = Math.max(0, Math.min(Number(index) || 0, Math.max(total - 1, 0)));
    if (!isWorkoutUnlocked(safeIndex, program?.workouts || total, accessState)) {
      window.alert(LOCKED_WORKOUT_MESSAGE);
      return;
    }
    setSelectedWorkoutIndex(safeIndex);
    navigate("workout");
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
        selectedWorkoutIndex={selectedWorkoutIndex}
        onSelectWorkout={setSelectedWorkoutIndex}
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
        selectedWorkoutIndex={selectedWorkoutIndex}
        onSelectWorkout={setSelectedWorkoutIndex}
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
        selectedWorkoutIndex={selectedWorkoutIndex}
        onOpenWorkout={openWorkout}
        onNavigate={navigate}
        profile={profile}
        access={accessState}
      />
    );
  }

  if (screen === "food") {
    return <NutritionScreen onNavigate={navigate} profile={profile} access={accessState} showBack={routeMetaRef.current?.fruitfitSource === "screen"} onBack={() => goBack("home")} />;
  }

  if (screen === "coach") {
    return <CoachScreen program={program} workout={workout} profile={profile} access={accessState} onNavigate={navigate} />;
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
      onStartWorkout={() => openWorkout(selectedWorkoutIndex)}
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
