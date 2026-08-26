package com.tagirfruit.fruitfit;

import android.app.Application;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Bundle;
import io.appmetrica.analytics.AppMetrica;
import io.appmetrica.analytics.AppMetricaConfig;

public class FruitFitApplication extends Application {
    private static volatile boolean appMetricaActivated = false;

    @Override
    public void onCreate() {
        super.onCreate();
        initializeAppMetrica();
    }

    public static boolean isAppMetricaActivated() {
        return appMetricaActivated;
    }

    private void initializeAppMetrica() {
        try {
            ApplicationInfo info = getPackageManager().getApplicationInfo(
                getPackageName(),
                PackageManager.GET_META_DATA
            );
            Bundle metadata = info.metaData;
            if (metadata == null || !metadata.getBoolean("fruitfit.appmetrica.enabled", false)) return;

            String apiKey = metadata.getString("fruitfit.appmetrica.api_key", "").trim();
            if (apiKey.isEmpty()) return;

            AppMetricaConfig config = AppMetricaConfig.newConfigBuilder(apiKey)
                .withLocationTracking(false)
                .build();
            AppMetrica.activate(getApplicationContext(), config);
            AppMetrica.enableActivityAutoTracking(this);
            appMetricaActivated = true;
        } catch (Exception exception) {
            appMetricaActivated = false;
        }
    }
}
