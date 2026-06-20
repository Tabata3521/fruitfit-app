package com.tagirfruit.fruitfit;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.WebView;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "FruitFitDiagnostics")
public class FruitFitDiagnosticsPlugin extends Plugin {
    private static final int MAX_DIAGNOSTIC_TEXT_BYTES = 24000;
    private static final List<String> DIAGNOSTIC_PACKAGES = Arrays.asList(
        "com.huawei.health",
        "com.huawei.hms",
        "com.huawei.hwid",
        "com.huawei.appmarket",
        "com.huawei.wearengine",
        "com.huawei.bone",
        "com.huawei.healthcloud",
        "com.google.android.apps.healthdata",
        "com.google.android.apps.fitness",
        "com.xiaomi.wearable",
        "com.mi.health",
        "com.xiaomi.hm.health",
        "com.huami.watch.hmwatchmanager",
        "com.zepp.z",
        "com.sec.android.app.shealth"
    );

    @PluginMethod
    public void getDeviceDiagnostics(PluginCall call) {
        JSObject result = new JSObject();
        result.put("platform", "android");
        result.put("packageName", getContext().getPackageName());
        result.put("manufacturer", Build.MANUFACTURER);
        result.put("brand", Build.BRAND);
        result.put("model", Build.MODEL);
        result.put("device", Build.DEVICE);
        result.put("product", Build.PRODUCT);
        result.put("hardware", Build.HARDWARE);
        result.put("sdkInt", Build.VERSION.SDK_INT);
        result.put("release", Build.VERSION.RELEASE);
        result.put("incremental", Build.VERSION.INCREMENTAL);
        result.put("fingerprint", Build.FINGERPRINT);
        result.put("emuiVersion", systemProperty("ro.build.version.emui"));
        result.put("magicUiVersion", systemProperty("ro.build.version.magic"));
        result.put("romDisplayVersion", systemProperty("ro.build.display.id"));
        result.put("isHuaweiDevice", isHuaweiDevice());
        result.put("webView", webViewDiagnostic());
        result.put("healthConnectFramework", healthConnectFrameworkDiagnostic());
        result.put("installedPackages", installedPackageDiagnostics());
        result.put("lastNativeCrash", readDiagnosticFile("fruitfit_last_native_crash.txt"));
        result.put("startupDiagnostic", readDiagnosticFile("fruitfit_native_startup.txt"));
        call.resolve(result);
    }

    private boolean isHuaweiDevice() {
        String raw = (Build.MANUFACTURER + " " + Build.BRAND + " " + Build.MODEL + " " + systemProperty("ro.build.version.emui")).toLowerCase();
        return raw.contains("huawei") || raw.contains("honor") || raw.contains("emui");
    }

    private JSObject healthConnectFrameworkDiagnostic() {
        JSObject object = new JSObject();
        object.put("sdkInt", Build.VERSION.SDK_INT);
        object.put("requiresSdkInt", 34);
        object.put("classesAvailable", false);
        object.put("bridgeRegistered", false);
        if (Build.VERSION.SDK_INT < 34) {
            object.put("reason", "sdk_below_34");
            return object;
        }
        try {
            Class.forName("android.health.connect.HealthConnectManager");
            Class.forName("android.health.connect.HealthPermissions");
            object.put("classesAvailable", true);
            object.put("bridgeRegistered", true);
            object.put("reason", "framework_available");
        } catch (Throwable throwable) {
            object.put("reason", "framework_classes_missing");
            object.put("error", throwable.getClass().getName() + ": " + throwable.getMessage());
        }
        return object;
    }

    private JSObject webViewDiagnostic() {
        JSObject object = new JSObject();
        try {
            PackageInfo webViewPackage = Build.VERSION.SDK_INT >= 26 ? WebView.getCurrentWebViewPackage() : null;
            if (webViewPackage == null) {
                object.put("available", false);
                return object;
            }
            object.put("available", true);
            object.put("packageName", webViewPackage.packageName);
            object.put("versionName", webViewPackage.versionName);
            object.put("versionCode", packageVersionCode(webViewPackage));
        } catch (Exception error) {
            object.put("available", false);
            object.put("error", error.getMessage());
        }
        return object;
    }

    private JSArray installedPackageDiagnostics() {
        JSArray items = new JSArray();
        PackageManager packageManager = getContext().getPackageManager();
        for (String packageName : DIAGNOSTIC_PACKAGES) {
            JSObject item = new JSObject();
            item.put("packageName", packageName);
            item.put("sourceName", sourceName(packageName));
            try {
                PackageInfo info = packageManager.getPackageInfo(packageName, 0);
                item.put("installed", true);
                item.put("versionName", info.versionName);
                item.put("versionCode", packageVersionCode(info));
                item.put("hasLaunchIntent", packageManager.getLaunchIntentForPackage(packageName) != null);
            } catch (PackageManager.NameNotFoundException error) {
                item.put("installed", false);
            } catch (Exception error) {
                item.put("installed", false);
                item.put("error", error.getMessage());
            }
            items.put(item);
        }
        return items;
    }

    private String sourceName(String packageName) {
        String value = String.valueOf(packageName).toLowerCase();
        if (value.contains("huawei")) return "Huawei Health";
        if (value.contains("healthdata") || value.contains("healthconnect")) return "Health Connect";
        if (value.contains("google.android.apps.fitness")) return "Google Fit";
        if (value.contains("xiaomi") || value.contains("mi.health")) return "Mi Fitness";
        if (value.contains("huami") || value.contains("zepp")) return "Zepp / Amazfit";
        if (value.contains("samsung") || value.contains("shealth")) return "Samsung Health";
        return packageName;
    }

    private long packageVersionCode(PackageInfo info) {
        if (info == null) return 0;
        if (Build.VERSION.SDK_INT >= 28) return info.getLongVersionCode();
        return info.versionCode;
    }

    private String systemProperty(String key) {
        try {
            Class<?> systemProperties = Class.forName("android.os.SystemProperties");
            Method get = systemProperties.getMethod("get", String.class);
            Object value = get.invoke(null, key);
            return value == null ? "" : String.valueOf(value);
        } catch (Exception error) {
            return "";
        }
    }

    private JSObject readDiagnosticFile(String fileName) {
        JSObject object = new JSObject();
        File file = findDiagnosticFile(fileName);
        object.put("fileName", fileName);
        if (file == null || !file.exists()) {
            object.put("exists", false);
            object.put("text", null);
            return object;
        }
        object.put("exists", true);
        object.put("pathHint", "app cache diagnostics/" + fileName);
        object.put("sizeBytes", file.length());
        try (FileInputStream stream = new FileInputStream(file)) {
            long skipped = 0;
            long length = file.length();
            if (length > MAX_DIAGNOSTIC_TEXT_BYTES) {
                skipped = length - MAX_DIAGNOSTIC_TEXT_BYTES;
                long remainingSkip = skipped;
                while (remainingSkip > 0) {
                    long nextSkipped = stream.skip(remainingSkip);
                    if (nextSkipped <= 0) break;
                    remainingSkip -= nextSkipped;
                }
            }
            byte[] buffer = new byte[(int) Math.min(MAX_DIAGNOSTIC_TEXT_BYTES, Math.max(0, length - skipped))];
            int read = stream.read(buffer);
            object.put("truncatedHeadBytes", skipped);
            object.put("text", read > 0 ? new String(buffer, 0, read, "UTF-8") : "");
        } catch (Exception error) {
            object.put("readError", error.getMessage());
            object.put("text", null);
        }
        return object;
    }

    private File findDiagnosticFile(String fileName) {
        File internal = new File(new File(getContext().getCacheDir(), "diagnostics"), fileName);
        if (internal.exists()) return internal;
        File externalCache = getContext().getExternalCacheDir();
        if (externalCache == null) return internal;
        File external = new File(new File(externalCache, "diagnostics"), fileName);
        return external.exists() ? external : internal;
    }
}
