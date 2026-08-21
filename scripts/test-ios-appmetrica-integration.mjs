import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

const plist = read("ios/App/App/Info.plist");
assert.match(plist, /<key>FruitFitAppMetricaAPIKey<\/key>\s*<string>87dff7a7-e1b8-4d99-a1c6-5b741f4f5fa1<\/string>/);
assert.match(plist, /<key>NSUserTrackingUsageDescription<\/key>\s*<string>[^<]{20,}<\/string>/);

const project = read("ios/App/App.xcodeproj/project.pbxproj");
assert.match(project, /repositoryURL = "https:\/\/github\.com\/appmetrica\/appmetrica-sdk-ios"/);
assert.match(project, /minimumVersion = 6\.6\.0/);
assert.match(project, /AppMetricaCore in Frameworks/);
assert.match(project, /AppMetricaAdSupport in Frameworks/);
assert.match(project, /FruitFitAppMetricaPlugin\.swift in Sources/);
assert.match(project, /PrivacyInfo\.xcprivacy in Resources/);
assert.match(project, /"-ObjC"/);
assert.equal((project.match(/CURRENT_PROJECT_VERSION = 15;/g) || []).length, 2);
assert.equal((project.match(/MARKETING_VERSION = 1\.0\.6;/g) || []).length, 2);

const appDelegate = read("ios/App/App/AppDelegate.swift");
assert.match(appDelegate, /applicationDidBecomeActive[\s\S]*FruitFitAppMetricaService\.shared\.applicationDidBecomeActive\(\)/);

const bridge = read("ios/App/App/FruitFitBridgeViewController.swift");
assert.match(bridge, /registerPluginInstance\(FruitFitAppMetricaPlugin\(\)\)/);

const nativePlugin = read("ios/App/App/FruitFitAppMetricaPlugin.swift");
assert.match(nativePlugin, /ATTrackingManager\.requestTrackingAuthorization/);
assert.match(nativePlugin, /trackingAuthorizationStatus == \.notDetermined/);
assert.match(nativePlugin, /queued_until_att_decision/);
assert.match(nativePlugin, /pendingRegistrations\.v1/);
assert.match(nativePlugin, /registrationMarkerPrefix/);
assert.match(nativePlugin, /AppMetrica\.reportEvent\(name: "registration"/);
assert.match(nativePlugin, /configuration\.locationTracking = false/);
assert.match(nativePlugin, /configuration\.accurateLocationTracking = false/);
assert.doesNotMatch(nativePlugin, /"user[_-]?[Ii][Dd]"\s*:/);

const privacyManifest = read("ios/App/App/PrivacyInfo.xcprivacy");
assert.match(privacyManifest, /NSPrivacyAccessedAPICategoryUserDefaults/);
assert.match(privacyManifest, /CA92\.1/);

const appMetricaService = read("src/services/appMetrica.js");
assert.match(appMetricaService, /Capacitor\.getPlatform\(\) === "ios"/);
assert.match(appMetricaService, /FruitFitAppMetrica\.reportRegistration/);
assert.match(appMetricaService, /responseHeaders/);
assert.match(appMetricaService, /createdAt >= Number\(pending\.createdAfter\)/);
assert.match(appMetricaService, /createdAt <= Number\(pending\.createdBefore\)/);
assert.match(appMetricaService, /reason: "not_new_registration"/);

const authPrompt = read("src/screens/AuthPrompt.jsx");
assert.match(authPrompt, /if \(result\.token && result\.user\) \{\s*await reportAppMetricaRegistration\(result\.user\.id\)/);
assert.match(authPrompt, /if \(result\?\.emailVerified && result\?\.user\?\.id\) \{\s*await reportAppMetricaRegistration\(result\.user\.id\)/);
assert.match(authPrompt, /rememberPendingAppMetricaRegistration\(\{ email, responseHeaders: response\.headers \}\)/);
assert.match(authPrompt, /await reportProvenPendingAppMetricaRegistration\(result\?\.user\)/);
const genericRegisterBranch = authPrompt.match(/const \{ result, response \} = await request\("\/api\/auth\/email\/register"[\s\S]*?navigate\(AUTH_FLOW_STATES\.VERIFICATION_PENDING/);
assert.ok(genericRegisterBranch, "generic email registration branch not found");
assert.doesNotMatch(
  genericRegisterBranch[0].replace(/if \(result\.token && result\.user\) \{[\s\S]*?\n\s*\}/, ""),
  /reportAppMetricaRegistration/,
  "generic HTTP 202 must not be counted as a proven registration",
);

const codemagic = read("codemagic.yaml");
assert.doesNotMatch(codemagic, /^\s*publishing:/m, "build-only workflow must not upload to App Store Connect");
assert.doesNotMatch(codemagic, /submit_to_(testflight|app_store)/);

console.log("iOS AppMetrica integration tests: PASS");
