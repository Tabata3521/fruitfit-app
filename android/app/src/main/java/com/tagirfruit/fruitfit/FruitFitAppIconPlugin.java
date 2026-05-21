package com.tagirfruit.fruitfit;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FruitFitAppIcon")
public class FruitFitAppIconPlugin extends Plugin {
    private static final String[] ALIASES = {
        ".MainActivityOrange",
        ".MainActivityPear",
        ".MainActivityApple",
        ".MainActivityStrawberry"
    };

    @PluginMethod
    public void setAlternateIcon(PluginCall call) {
        String alias = call.getString("androidAlias", "orange");
        String targetAlias = aliasToComponent(alias);
        PackageManager manager = getContext().getPackageManager();
        String packageName = getContext().getPackageName();

        try {
            setState(manager, new ComponentName(packageName, packageName + ".MainActivity"), PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            setState(manager, new ComponentName(packageName, packageName + targetAlias), PackageManager.COMPONENT_ENABLED_STATE_ENABLED);
            for (String item : ALIASES) {
                if (!item.equals(targetAlias)) {
                    setState(manager, new ComponentName(packageName, packageName + item), PackageManager.COMPONENT_ENABLED_STATE_DISABLED);
                }
            }

            JSObject result = new JSObject();
            result.put("status", "native_applied");
            result.put("message", "Ярлык приложения обновлён. На некоторых лаунчерах Xiaomi изменение видно через несколько секунд.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Не удалось поменять ярлык: " + error.getMessage());
        }
    }

    private String aliasToComponent(String alias) {
        if ("orange".equals(alias)) return ".MainActivityOrange";
        if ("pear".equals(alias)) return ".MainActivityPear";
        if ("apple".equals(alias)) return ".MainActivityApple";
        if ("strawberry".equals(alias)) return ".MainActivityStrawberry";
        return ".MainActivityOrange";
    }

    private void setState(PackageManager manager, ComponentName component, int state) {
        manager.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP);
    }
}
