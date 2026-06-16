package com.tagirfruit.fruitfit;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.util.Base64;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStreamWriter;
import java.lang.ref.WeakReference;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.List;
import java.util.Locale;
import org.json.JSONObject;

@CapacitorPlugin(name = "FruitFitTelegram")
public class FruitFitTelegramPlugin extends Plugin {
    private static final String TAG = "FruitFitTelegram";
    private static final String DEFAULT_CLIENT_ID = "8800719097";
    private static final String DEFAULT_REDIRECT_URI = "https://app3329121288-login.tg.dev/tglogin";
    private static final String DEFAULT_OAUTH_BASE = "https://oauth.telegram.org";
    private static WeakReference<FruitFitTelegramPlugin> instanceRef = new WeakReference<>(null);

    private String clientId = DEFAULT_CLIENT_ID;
    private String redirectUri = DEFAULT_REDIRECT_URI;
    private String oauthBase = DEFAULT_OAUTH_BASE;
    private String codeVerifier = "";

    @Override
    public void load() {
        instanceRef = new WeakReference<>(this);
    }

    @PluginMethod
    public void startLogin(PluginCall call) {
        clientId = call.getString("clientId", DEFAULT_CLIENT_ID);
        redirectUri = call.getString("redirectUri", DEFAULT_REDIRECT_URI);
        oauthBase = call.getString("oauthBaseUrl", DEFAULT_OAUTH_BASE);
        codeVerifier = generateCodeVerifier();
        String challenge = generateCodeChallenge(codeVerifier);

        new Thread(() -> {
            boolean launched = false;
            String error = "";
            try {
                String tgUrl = fetchInAppUrl(clientId, redirectUri, challenge);
                if (tgUrl != null && !tgUrl.isEmpty()) {
                    launched = tryOpenTelegramIntent(getContext(), Uri.parse(tgUrl));
                }
            } catch (Exception exception) {
                error = exception.getMessage() == null ? "Telegram login failed" : exception.getMessage();
            }

            JSObject result = new JSObject();
            result.put("launched", launched);
            result.put("native", true);
            if (!error.isEmpty()) result.put("fallbackReason", error);
            call.resolve(result);
            if (!launched) {
                emitError(error.isEmpty()
                    ? "Telegram app is not installed or cannot handle Native Login. Use Yandex ID."
                    : error);
            }
        }).start();
    }

    public static boolean handleIntent(Intent intent) {
        FruitFitTelegramPlugin plugin = instanceRef.get();
        if (plugin == null || intent == null || intent.getData() == null) return false;
        Uri uri = intent.getData();
        if (!"app3329121288-login.tg.dev".equalsIgnoreCase(uri.getHost())) return false;
        plugin.handleLoginResponse(uri);
        return true;
    }

    private void handleLoginResponse(Uri uri) {
        String error = uri.getQueryParameter("error");
        if (error != null) {
            emitError(uri.getQueryParameter("error_description") == null ? error : uri.getQueryParameter("error_description"));
            return;
        }

        String code = uri.getQueryParameter("code");
        if (code == null || code.trim().isEmpty()) {
            emitError("Telegram did not return authorization code");
            return;
        }
        if (codeVerifier == null || codeVerifier.isEmpty()) {
            emitError("Telegram login session expired. Try again.");
            return;
        }

        final String verifier = codeVerifier;
        new Thread(() -> {
            try {
                String idToken = exchangeCode(code, clientId, redirectUri, verifier);
                codeVerifier = "";
                JSObject payload = new JSObject();
                payload.put("ok", true);
                payload.put("idToken", idToken);
                payload.put("source", "telegram_native_oidc");
                notifyListeners("telegramNativeLoginResult", payload, true);
            } catch (Exception exception) {
                emitError(exception.getMessage() == null ? "Telegram token exchange failed" : exception.getMessage());
            }
        }).start();
    }

    private void emitError(String message) {
        JSObject payload = new JSObject();
        payload.put("ok", false);
        payload.put("error", message == null || message.isEmpty() ? "Telegram login failed" : message);
        payload.put("source", "telegram_native_oidc");
        notifyListeners("telegramNativeLoginResult", payload, true);
    }

    private String fetchInAppUrl(String clientId, String redirectUri, String codeChallenge) throws Exception {
        Uri url = Uri.parse(oauthBase + "/crossapp").buildUpon()
            .appendQueryParameter("client_id", clientId)
            .appendQueryParameter("response_type", "code")
            .appendQueryParameter("scope", "openid profile")
            .appendQueryParameter("redirect_uri", redirectUri)
            .appendQueryParameter("android_sdk", "1")
            .appendQueryParameter("code_challenge", codeChallenge)
            .appendQueryParameter("code_challenge_method", "S256")
            .build();

        HttpURLConnection connection = (HttpURLConnection) new URL(url.toString()).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        try {
            int status = connection.getResponseCode();
            String body = readResponse(connection, status);
            if (status != HttpURLConnection.HTTP_OK) {
                throw new Exception(String.format(Locale.US, "Telegram crossapp HTTP %d", status));
            }
            JSONObject json = new JSONObject(body);
            String direct = json.optString("url", "");
            if (!direct.isEmpty()) return direct;
            JSONObject result = json.optJSONObject("result");
            return result == null ? "" : result.optString("url", "");
        } finally {
            connection.disconnect();
        }
    }

    private String exchangeCode(String code, String clientId, String redirectUri, String verifier) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(oauthBase + "/token").openConnection();
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setRequestProperty("Accept", "application/json");
        String postBody =
            "grant_type=authorization_code" +
            "&client_id=" + URLEncoder.encode(clientId, "UTF-8") +
            "&code=" + URLEncoder.encode(code, "UTF-8") +
            "&redirect_uri=" + URLEncoder.encode(redirectUri, "UTF-8") +
            "&code_verifier=" + URLEncoder.encode(verifier, "UTF-8");
        try {
            OutputStreamWriter writer = new OutputStreamWriter(connection.getOutputStream());
            writer.write(postBody);
            writer.close();
            int status = connection.getResponseCode();
            String body = readResponse(connection, status);
            if (status != HttpURLConnection.HTTP_OK) {
                throw new Exception(String.format(Locale.US, "Telegram token HTTP %d: %s", status, body));
            }
            JSONObject json = new JSONObject(body);
            String idToken = json.optString("id_token", "");
            if (idToken.isEmpty()) idToken = json.optString("result", "");
            if (idToken.isEmpty()) throw new Exception("Telegram token response has no id_token");
            return idToken;
        } finally {
            connection.disconnect();
        }
    }

    private String readResponse(HttpURLConnection connection, int status) throws Exception {
        java.io.InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        if (stream == null) return "";
        java.util.Scanner scanner = new java.util.Scanner(stream, "UTF-8").useDelimiter("\\A");
        return scanner.hasNext() ? scanner.next() : "";
    }

    private boolean tryOpenIntent(Context context, Intent intent) {
        try {
            Activity activity = getActivity();
            if (activity == null && context != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } else if (activity != null) {
                activity.startActivity(intent);
            }
            return true;
        } catch (ActivityNotFoundException exception) {
            return false;
        } catch (Exception exception) {
            Log.w(TAG, "Cannot open Telegram login intent", exception);
            return false;
        }
    }

    private boolean tryOpenTelegramIntent(Context context, Uri uri) {
        if (context == null || uri == null) return false;
        String[] telegramPackages = {
            "org.telegram.messenger",
            "org.telegram.messenger.web",
            "org.thunderdog.challegram"
        };

        for (String packageName : telegramPackages) {
            Intent packageIntent = new Intent(Intent.ACTION_VIEW, uri);
            packageIntent.setPackage(packageName);
            if (packageIntent.resolveActivity(context.getPackageManager()) != null && tryOpenIntent(context, packageIntent)) {
                return true;
            }
        }

        Intent genericIntent = new Intent(Intent.ACTION_VIEW, uri);
        List<ResolveInfo> handlers = context.getPackageManager().queryIntentActivities(genericIntent, 0);
        for (ResolveInfo handler : handlers) {
            String packageName = handler.activityInfo == null ? "" : handler.activityInfo.packageName;
            String normalized = packageName == null ? "" : packageName.toLowerCase(Locale.US);
            if (normalized.contains("telegram") || normalized.contains("challegram")) {
                genericIntent.setPackage(packageName);
                return tryOpenIntent(context, genericIntent);
            }
        }
        return false;
    }

    private String generateCodeVerifier() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.encodeToString(bytes, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private String generateCodeChallenge(String verifier) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes("US-ASCII"));
            return Base64.encodeToString(digest, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (Exception exception) {
            return verifier;
        }
    }
}
