package com.tagirfruit.fruitfit;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FruitFitInstallReferrer")
public class FruitFitInstallReferrerPlugin extends Plugin {
    private InstallReferrerClient client;

    @PluginMethod
    public void getInstallReferrer(PluginCall call) {
        if (client != null) {
            call.reject("INSTALL_REFERRER_BUSY");
            return;
        }
        client = InstallReferrerClient.newBuilder(getContext()).build();
        client.startConnection(new InstallReferrerStateListener() {
            @Override
            public void onInstallReferrerSetupFinished(int responseCode) {
                try {
                    if (responseCode != InstallReferrerClient.InstallReferrerResponse.OK) {
                        call.reject("INSTALL_REFERRER_UNAVAILABLE_" + responseCode);
                        return;
                    }
                    ReferrerDetails details = client.getInstallReferrer();
                    JSObject result = new JSObject();
                    result.put("installReferrer", details.getInstallReferrer());
                    result.put("referrerClickTimestamp", details.getReferrerClickTimestampSeconds());
                    result.put("installBeginTimestamp", details.getInstallBeginTimestampSeconds());
                    result.put("referrerClickTimestampServer", details.getReferrerClickTimestampServerSeconds());
                    result.put("installBeginTimestampServer", details.getInstallBeginTimestampServerSeconds());
                    result.put("googlePlayInstant", details.getGooglePlayInstantParam());
                    result.put("installVersion", details.getInstallVersion());
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("INSTALL_REFERRER_READ_FAILED", error);
                } finally {
                    closeClient();
                }
            }

            @Override
            public void onInstallReferrerServiceDisconnected() {
                closeClient();
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        closeClient();
        super.handleOnDestroy();
    }

    private void closeClient() {
        if (client == null) return;
        try {
            client.endConnection();
        } catch (Exception ignored) {
        }
        client = null;
    }
}
