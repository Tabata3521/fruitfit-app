import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const gradle = read("android/app/build.gradle");
assert.match(gradle, /versionCode 30/);
assert.match(gradle, /versionName "1\.9\.8"/);
assert.match(gradle, /io\.appmetrica\.analytics:analytics:8\.5\.1/);
assert.match(gradle, /fruitfitAppMetricaEnabled/);
assert.match(gradle, /fruitfitAppMetricaApiKey/);

const manifest = read("android/app/src/main/AndroidManifest.xml");
assert.match(manifest, /android:name="\.FruitFitApplication"/);
assert.match(manifest, /fruitfit\.appmetrica\.enabled/);
assert.match(manifest, /fruitfit\.appmetrica\.api_key/);
assert.doesNotMatch(manifest, /ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/);

const application = read("android/app/src/main/java/com/tagirfruit/fruitfit/FruitFitApplication.java");
assert.match(application, /AppMetricaConfig\.newConfigBuilder/);
assert.match(application, /withLocationTracking\(false\)/);
assert.match(application, /AppMetrica\.enableActivityAutoTracking/);

const plugin = read("android/app/src/main/java/com/tagirfruit/fruitfit/FruitFitAppMetricaPlugin.java");
assert.match(plugin, /@CapacitorPlugin\(name = "FruitFitAppMetrica"\)/);
assert.match(plugin, /AppMetrica\.reportEvent\("registration"/);
assert.match(plugin, /distribution_channel", "rustore"/);
assert.match(plugin, /SharedPreferences/);

const mainActivity = read("android/app/src/main/java/com/tagirfruit/fruitfit/MainActivity.java");
assert.match(mainActivity, /registerPlugin\(FruitFitAppMetricaPlugin\.class\)/);

const service = read("src/services/appMetrica.js");
assert.match(service, /DISTRIBUTION_CHANNEL === "rustore"/);
assert.match(service, /platform === "ios"/);

console.log("Android RuStore AppMetrica integration tests: PASS");
