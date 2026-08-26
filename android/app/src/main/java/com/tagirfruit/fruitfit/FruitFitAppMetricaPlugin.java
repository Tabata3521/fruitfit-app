package com.tagirfruit.fruitfit;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import io.appmetrica.analytics.AppMetrica;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "FruitFitAppMetrica")
public class FruitFitAppMetricaPlugin extends Plugin {
    private static final String PREFS = "fruitfit_appmetrica";
    private static final String REGISTRATION_PREFIX = "registration_v1_";

    @PluginMethod
    public void reportRegistration(PluginCall call) {
        String userId = call.getString("userId", "").trim();
        if (userId.isEmpty()) {
            call.resolve(result(false, false, "missing_user_id"));
            return;
        }
        if (!FruitFitApplication.isAppMetricaActivated()) {
            call.resolve(result(false, false, "appmetrica_not_configured"));
            return;
        }

        String marker = REGISTRATION_PREFIX + sha256(userId);
        SharedPreferences preferences = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (preferences.getBoolean(marker, false)) {
            call.resolve(result(false, true, ""));
            return;
        }

        preferences.edit().putBoolean(marker, true).apply();
        try {
            Map<String, Object> parameters = new HashMap<>();
            parameters.put("platform", "android");
            parameters.put("distribution_channel", "rustore");
            parameters.put("schema_version", 1);
            AppMetrica.reportEvent("registration", parameters);
            AppMetrica.sendEventsBuffer();
            call.resolve(result(true, false, ""));
        } catch (Exception exception) {
            preferences.edit().remove(marker).apply();
            call.resolve(result(false, false, "report_failed"));
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("activated", FruitFitApplication.isAppMetricaActivated());
        result.put("platform", "android");
        call.resolve(result);
    }

    private JSObject result(boolean reported, boolean duplicate, String reason) {
        JSObject result = new JSObject();
        result.put("reported", reported);
        result.put("duplicate", duplicate);
        result.put("reason", reason);
        return result;
    }

    private String sha256(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(bytes.length * 2);
            for (byte item : bytes) output.append(String.format("%02x", item));
            return output.toString();
        } catch (Exception exception) {
            return Integer.toHexString(value.hashCode());
        }
    }
}
