package com.tagirfruit.fruitfit;

import android.content.Context;
import com.getcapacitor.BridgeActivity;
import com.capacitorjs.plugins.app.AppPlugin;
import com.capacitorjs.plugins.localnotifications.LocalNotificationsPlugin;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;
import androidx.activity.OnBackPressedCallback;
import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.io.StringWriter;

public class MainActivity extends BridgeActivity {
    private static final Object CRASH_LOCK = new Object();
    private static boolean crashReporterInstalled = false;
    private static Thread.UncaughtExceptionHandler previousCrashHandler = null;
    private static final String BACK_HANDLER_SCRIPT =
        "(function(){try{" +
        "if(typeof window.__fruitfitHandleAndroidBack!=='function')return 'missing';" +
        "return window.__fruitfitHandleAndroidBack('android-native-back')?'handled':'exit';" +
        "}catch(e){return 'missing';}})();";

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        installCrashReporter(getApplicationContext());
        registerPlugin(FruitFitDiagnosticsPlugin.class);
        if (isHealthConnectFrameworkAvailable()) {
            try {
                registerPlugin(FruitFitHealthPlugin.class);
            } catch (Throwable throwable) {
                writeStartupDiagnostic(getApplicationContext(), "Health plugin registration failed: " + throwable.getClass().getName() + ": " + throwable.getMessage());
            }
        } else {
            writeStartupDiagnostic(getApplicationContext(), "Health plugin registration skipped: android.health.connect framework classes are unavailable.");
        }
        registerPlugin(AppPlugin.class);
        registerPlugin(FirebaseMessagingPlugin.class);
        registerPlugin(LocalNotificationsPlugin.class);
        registerPlugin(FruitFitAppIconPlugin.class);
        registerPlugin(FruitFitOrientationPlugin.class);
        registerPlugin(FruitFitTelegramPlugin.class);
        super.onCreate(savedInstanceState);
        FruitFitTelegramPlugin.handleIntent(getIntent());
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                dispatchFruitFitBack();
            }
        });
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        FruitFitTelegramPlugin.handleIntent(intent);
    }

    private void dispatchFruitFitBack() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            moveTaskToBack(true);
            return;
        }

        getBridge().getWebView().evaluateJavascript(BACK_HANDLER_SCRIPT, value -> {
            if (isHandledBackResult(value)) return;
            if (isMissingBackHandlerResult(value) && getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
                getBridge().getWebView().goBack();
                return;
            }
            moveTaskToBack(true);
        });
    }

    private boolean isHandledBackResult(String value) {
        return "\"handled\"".equals(value) || "handled".equals(value);
    }

    private boolean isMissingBackHandlerResult(String value) {
        return "\"missing\"".equals(value) || "missing".equals(value) || value == null;
    }

    private static boolean isHealthConnectFrameworkAvailable() {
        if (android.os.Build.VERSION.SDK_INT < 34) return false;
        try {
            Class.forName("android.health.connect.HealthConnectManager");
            Class.forName("android.health.connect.HealthPermissions");
            return true;
        } catch (Throwable throwable) {
            return false;
        }
    }

    private static void installCrashReporter(Context context) {
        synchronized (CRASH_LOCK) {
            if (crashReporterInstalled) return;
            crashReporterInstalled = true;
            previousCrashHandler = Thread.getDefaultUncaughtExceptionHandler();
            Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
                writeCrashReport(context, thread, throwable);
                if (previousCrashHandler != null) {
                    previousCrashHandler.uncaughtException(thread, throwable);
                    return;
                }
                System.exit(2);
            });
        }
    }

    private static void writeCrashReport(Context context, Thread thread, Throwable throwable) {
        if (context == null || throwable == null) return;
        String report = buildCrashReport(context, thread, throwable);
        writeCrashFile(new File(context.getCacheDir(), "diagnostics"), "fruitfit_last_native_crash.txt", report, false);
        File externalCache = context.getExternalCacheDir();
        if (externalCache != null) {
            writeCrashFile(new File(externalCache, "diagnostics"), "fruitfit_last_native_crash.txt", report, false);
        }
    }

    private static void writeStartupDiagnostic(Context context, String message) {
        if (context == null || message == null) return;
        String report = "FruitFit startup diagnostic\n"
            + "capturedAt=" + System.currentTimeMillis() + "\n"
            + "package=" + context.getPackageName() + "\n"
            + "manufacturer=" + android.os.Build.MANUFACTURER + "\n"
            + "brand=" + android.os.Build.BRAND + "\n"
            + "model=" + android.os.Build.MODEL + "\n"
            + "sdkInt=" + android.os.Build.VERSION.SDK_INT + "\n"
            + "release=" + android.os.Build.VERSION.RELEASE + "\n"
            + "message=" + message + "\n";
        writeCrashFile(new File(context.getCacheDir(), "diagnostics"), "fruitfit_native_startup.txt", report, false);
        File externalCache = context.getExternalCacheDir();
        if (externalCache != null) {
            writeCrashFile(new File(externalCache, "diagnostics"), "fruitfit_native_startup.txt", report, false);
        }
    }

    private static String buildCrashReport(Context context, Thread thread, Throwable throwable) {
        StringWriter stack = new StringWriter();
        throwable.printStackTrace(new PrintWriter(stack));
        StringBuilder builder = new StringBuilder();
        builder.append("FruitFit native crash report\n");
        builder.append("capturedAt=").append(System.currentTimeMillis()).append('\n');
        builder.append("package=").append(context.getPackageName()).append('\n');
        builder.append("thread=").append(thread == null ? "unknown" : thread.getName()).append('\n');
        builder.append("manufacturer=").append(android.os.Build.MANUFACTURER).append('\n');
        builder.append("brand=").append(android.os.Build.BRAND).append('\n');
        builder.append("model=").append(android.os.Build.MODEL).append('\n');
        builder.append("device=").append(android.os.Build.DEVICE).append('\n');
        builder.append("product=").append(android.os.Build.PRODUCT).append('\n');
        builder.append("sdkInt=").append(android.os.Build.VERSION.SDK_INT).append('\n');
        builder.append("release=").append(android.os.Build.VERSION.RELEASE).append('\n');
        builder.append("incremental=").append(android.os.Build.VERSION.INCREMENTAL).append('\n');
        builder.append("exception=").append(throwable.getClass().getName()).append(": ").append(throwable.getMessage()).append("\n\n");
        builder.append(stack);
        return builder.toString();
    }

    private static void writeCrashFile(File dir, String fileName, String report, boolean append) {
        try {
            if (!dir.exists() && !dir.mkdirs()) return;
            try (FileWriter writer = new FileWriter(new File(dir, fileName), append)) {
                writer.write(report);
                writer.write("\n");
            }
        } catch (Exception ignored) {
        }
    }
}
