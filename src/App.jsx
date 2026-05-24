import { useEffect, useMemo, useRef, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { Dumbbell } from "lucide-react";
import { HealthProvider } from "./data/healthStore";
import { loadAuthUser, setAuthToken, fetchMe } from "./data/authStore";
import { loadProfile } from "./data/profileStore";
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
        <p className="mt-2 text-sm text-appMuted">{error || "Загружаю локальные программы тренировок"}</p>
      </div>
    </main>
  );
}

function getInitialTheme() {
  return localStorage.getItem("fruitfit.theme") || "light";
}

function AppContent() {
  const { loading, error, data } = useTrainingData();
  const [screen, setScreen] = useState(() => healthScreenFromHash() || appScreenFromHash() || "home");
  const [selectedWorkoutIndex, setSelectedWorkoutIndex] = useState(0);
  const [theme, setTheme] = useState(getInitialTheme);
  const [profile, setProfile] = useState(loadProfile);
  const [authUser, setAuthUser] = useState(loadAuthUser);
  const [quizOpen, setQuizOpen] = useState(() => !loadProfile().onboardingCompleted);
  const [authPromptOpen, setAuthPromptOpen] = useState(() => loadProfile().onboardingCompleted && !loadAuthUser());
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

  useEffect(() => {
    // Check URL hash for token from OAuth/Telegram
    if (window.location.hash.includes("auth_token=")) {
      const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const token = params.get("auth_token");
      if (token) {
        setAuthToken(token);
        // clean hash
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        fetchMe().then((user) => {
          if (user) {
            setAuthUser(user);
            setAuthPromptOpen(false);
          }
        });
      }
    } else if (loadAuthUser()) {
      // Validate session on load
      fetchMe().then((user) => {
        if (user) setAuthUser(user);
      });
    }
  }, []);

  useEffect(() => {
    const resolved = theme === "system"
      ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : theme;
    document.documentElement.dataset.theme = resolved;
    localStorage.setItem("fruitfit.theme", theme);
  }, [theme]);

  useEffect(() => {
    const lockPortrait = () => window.screen?.orientation?.lock?.("portrait").catch?.(() => {});
    const unlockForFullscreenVideo = () => window.screen?.orientation?.unlock?.();
    document.documentElement.classList.add("portrait-lock");
    lockPortrait();
    const onFullscreenChange = () => {
      const element = document.fullscreenElement || document.webkitFullscreenElement;
      const isVideoFullscreen = element?.tagName?.toLowerCase?.() === "video";
      if (isVideoFullscreen) unlockForFullscreenVideo();
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

  const program = useMemo(() => buildProgramView(data, selectedWorkoutIndex, profile), [data, profile, selectedWorkoutIndex]);
  const workout = program?.selectedWorkout;

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
          setAuthPromptOpen(!loadAuthUser());
          navigate("home");
        }}
      />
    );
  }

  if (authPromptOpen) {
    return <AuthPrompt onComplete={(user) => { setAuthUser(user || loadAuthUser()); setAuthPromptOpen(false); }} />;
  }

  function openWorkout(index = selectedWorkoutIndex) {
    setSelectedWorkoutIndex(index);
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
      />
    );
  }

  if (screen === "food") {
    return <NutritionScreen onNavigate={navigate} profile={profile} showBack={routeMetaRef.current?.fruitfitSource === "screen"} onBack={() => goBack("home")} />;
  }

  if (screen === "coach") {
    return <CoachScreen program={program} workout={workout} profile={profile} onNavigate={navigate} />;
  }

  if (screen === "profile") {
    return <ProfileScreen profile={profile} onProfileChange={setProfile} theme={theme} onThemeChange={setTheme} onNavigate={navigate} onRestartQuiz={() => setQuizOpen(true)} />;
  }

  if (screen === "settings") {
    return <SettingsScreen theme={theme} onThemeChange={setTheme} onNavigate={navigate} onBack={() => goBack("profile")} />;
  }

  if (screen === "lecture") {
    return <LectureDetailScreen onBack={() => goBack("home")} />;
  }

  return (
    <HomeScreen
      program={program}
      workout={workout}
      profile={profile}
      authUser={authUser}
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
