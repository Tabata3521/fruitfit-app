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
  lecture: "#/lectures",
  settings: "#/settings",
};

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

  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  function navigate(nextScreen) {
    setScreen((current) => {
      if (typeof nextScreen === "string" && nextScreen.startsWith("health:") && current !== nextScreen) {
        window.history.pushState({ fruitfitScreen: nextScreen }, "", healthRoutes[nextScreen] || `#/${nextScreen.replace(":", "/")}`);
      }
      if (typeof nextScreen === "string" && appRoutes[nextScreen] && current !== nextScreen) {
        window.history.pushState({ fruitfitScreen: nextScreen }, "", appRoutes[nextScreen]);
      }
      if (nextScreen === "profile" && current === "settings") {
        window.history.replaceState({ fruitfitScreen: "profile" }, "", window.location.pathname + window.location.search);
      }
      return nextScreen;
    });
  }

  function backFromHealth() {
    if (window.history.state?.fruitfitScreen === screenRef.current) {
      window.history.back();
      return;
    }
    window.history.replaceState({ fruitfitScreen: "home" }, "", window.location.pathname + window.location.search);
    setScreen("home");
  }

  function backFromLecture() {
    if (window.history.state?.fruitfitScreen === "lecture") {
      window.history.back();
      return;
    }
    window.history.replaceState({ fruitfitScreen: "home" }, "", window.location.pathname + window.location.search);
    setScreen("home");
  }

  useEffect(() => {
    function handlePopState() {
      const nextHealthScreen = healthScreenFromHash();
      if (nextHealthScreen) {
        setScreen(nextHealthScreen);
        return;
      }
      const nextAppScreen = appScreenFromHash();
      if (nextAppScreen) {
        setScreen(nextAppScreen);
        return;
      }
      if (screenRef.current?.startsWith?.("health:")) {
        setScreen("home");
      } else if (screenRef.current === "settings") {
        setScreen("profile");
      } else if (screenRef.current === "lecture") {
        setScreen("home");
      }
    }
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("hashchange", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("hashchange", handlePopState);
    };
  }, []);

  useEffect(() => {
    let listener;
    CapacitorApp.addListener("backButton", ({ canGoBack }) => {
      if (screenRef.current?.startsWith?.("health:")) {
        backFromHealth();
        return;
      }
      if (screenRef.current === "settings") {
        window.history.replaceState({ fruitfitScreen: "profile" }, "", window.location.pathname + window.location.search);
        setScreen("profile");
        return;
      }
      if (screenRef.current === "lecture") {
        window.history.replaceState({ fruitfitScreen: "home" }, "", window.location.pathname + window.location.search);
        setScreen("home");
        return;
      }
      if (canGoBack) {
        window.history.back();
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
    return <HealthDetailScreen type={screen.split(":")[1]} onBack={backFromHealth} />;
  }

  if (screen === "focus") {
    return (
      <WorkoutScreen
        mode="focus"
        program={program}
        workout={workout}
        selectedWorkoutIndex={selectedWorkoutIndex}
        onSelectWorkout={setSelectedWorkoutIndex}
        onBack={() => navigate("workout")}
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
        onBack={() => navigate("home")}
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
    return <NutritionScreen onNavigate={navigate} profile={profile} />;
  }

  if (screen === "coach") {
    return <CoachScreen program={program} workout={workout} profile={profile} onNavigate={navigate} />;
  }

  if (screen === "profile") {
    return <ProfileScreen profile={profile} onProfileChange={setProfile} theme={theme} onThemeChange={setTheme} onNavigate={navigate} onRestartQuiz={() => setQuizOpen(true)} />;
  }

  if (screen === "settings") {
    return <SettingsScreen theme={theme} onThemeChange={setTheme} onNavigate={navigate} />;
  }

  if (screen === "lecture") {
    return <LectureDetailScreen onBack={backFromLecture} />;
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
