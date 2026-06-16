package com.tagirfruit.fruitfit;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FruitFitOrientation")
public class FruitFitOrientationPlugin extends Plugin {
    @PluginMethod
    public void lockPortrait(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT));
        }
        JSObject result = new JSObject();
        result.put("orientation", "portrait");
        call.resolve(result);
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        Activity activity = getActivity();
        if (activity != null) {
            activity.runOnUiThread(() -> activity.setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
        }
        JSObject result = new JSObject();
        result.put("orientation", "unspecified");
        call.resolve(result);
    }
}
