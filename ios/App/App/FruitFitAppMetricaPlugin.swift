import UIKit
import AppTrackingTransparency
import AppMetricaCore
import Capacitor
import CryptoKit

final class FruitFitAppMetricaService {
    static let shared = FruitFitAppMetricaService()

    private let registrationMarkerPrefix = "fruitfit.appmetrica.registration.v1."
    private let pendingRegistrationHashesKey = "fruitfit.appmetrica.pendingRegistrations.v1"
    private var trackingRequestInFlight = false

    private init() {}

    func applicationDidBecomeActive() {
        if AppMetrica.isActivated {
            flushPendingRegistrations()
            return
        }

        if #available(iOS 14, *) {
            switch ATTrackingManager.trackingAuthorizationStatus {
            case .notDetermined:
                requestTrackingAuthorizationOnce()
            case .authorized, .denied, .restricted:
                activateIfConfigured()
            @unknown default:
                activateIfConfigured()
            }
        } else {
            activateIfConfigured()
        }
    }

    func reportRegistration(userID: String) -> (reported: Bool, duplicate: Bool, reason: String?) {
        let normalizedUserID = userID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedUserID.isEmpty else {
            return (false, false, "missing_user_id")
        }

        let userHash = SHA256.hash(data: Data(normalizedUserID.utf8))
            .map { String(format: "%02x", $0) }
            .joined()
        let marker = registrationMarkerPrefix + userHash
        if UserDefaults.standard.bool(forKey: marker) || pendingRegistrationHashes().contains(userHash) {
            return (false, true, nil)
        }

        var pending = pendingRegistrationHashes()
        pending.append(userHash)
        savePendingRegistrationHashes(pending)

        // Never activate the advertising attribution module before the ATT decision.
        // If registration happens unusually quickly, the anonymous event stays in a
        // restart-safe local queue and is flushed after the user responds.
        if #available(iOS 14, *), ATTrackingManager.trackingAuthorizationStatus == .notDetermined {
            requestTrackingAuthorizationOnce()
            return (false, false, "queued_until_att_decision")
        }

        activateIfConfigured()
        let activated = AppMetrica.isActivated
        return (activated, false, activated ? nil : "appmetrica_not_configured")
    }

    func statusPayload() -> [String: Any] {
        var payload: [String: Any] = [
            "activated": AppMetrica.isActivated,
            "trackingAuthorization": "unavailable"
        ]
        if #available(iOS 14, *) {
            payload["trackingAuthorization"] = trackingStatusName(ATTrackingManager.trackingAuthorizationStatus)
        }
        return payload
    }

    private func requestTrackingAuthorizationOnce() {
        guard !trackingRequestInFlight else { return }
        trackingRequestInFlight = true

        // Wait until the first screen is visible. iOS itself guarantees that the system
        // prompt is shown at most once per installation.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
            guard UIApplication.shared.applicationState == .active else {
                self.trackingRequestInFlight = false
                return
            }
            guard ATTrackingManager.trackingAuthorizationStatus == .notDetermined else {
                self.trackingRequestInFlight = false
                self.activateIfConfigured()
                return
            }
            ATTrackingManager.requestTrackingAuthorization { _ in
                DispatchQueue.main.async {
                    self.trackingRequestInFlight = false
                    self.activateIfConfigured()
                }
            }
        }
    }

    private func activateIfConfigured() {
        guard !AppMetrica.isActivated else { return }
        guard let apiKey = Bundle.main.object(forInfoDictionaryKey: "FruitFitAppMetricaAPIKey") as? String,
              !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let configuration = AppMetricaConfiguration(apiKey: apiKey) else {
            NSLog("[FruitFit AppMetrica] API key is missing; SDK activation skipped")
            return
        }

        configuration.locationTracking = false
        configuration.accurateLocationTracking = false
        configuration.revenueAutoTrackingEnabled = false
#if DEBUG
        configuration.areLogsEnabled = true
#endif
        AppMetrica.activate(with: configuration)
        flushPendingRegistrations()
    }

    private func pendingRegistrationHashes() -> [String] {
        UserDefaults.standard.stringArray(forKey: pendingRegistrationHashesKey) ?? []
    }

    private func savePendingRegistrationHashes(_ hashes: [String]) {
        UserDefaults.standard.set(Array(Set(hashes)).sorted(), forKey: pendingRegistrationHashesKey)
    }

    private func flushPendingRegistrations() {
        guard AppMetrica.isActivated else { return }
        let pending = pendingRegistrationHashes()
        guard !pending.isEmpty else { return }

        // Remove a hash from the pending queue before handing the event to the SDK.
        // If AppMetrica rejects it synchronously, the failure callback puts it back.
        savePendingRegistrationHashes([])
        for userHash in pending {
            let marker = registrationMarkerPrefix + userHash
            if UserDefaults.standard.bool(forKey: marker) { continue }
            UserDefaults.standard.set(true, forKey: marker)
            AppMetrica.reportEvent(name: "registration", parameters: [
                "platform": "ios",
                "schema_version": 1
            ]) { error in
                UserDefaults.standard.removeObject(forKey: marker)
                var retryQueue = self.pendingRegistrationHashes()
                retryQueue.append(userHash)
                self.savePendingRegistrationHashes(retryQueue)
                NSLog("[FruitFit AppMetrica] registration event rejected: %@", error.localizedDescription)
            }
        }
        AppMetrica.sendEventsBuffer()
    }

    @available(iOS 14, *)
    private func trackingStatusName(_ status: ATTrackingManager.AuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "not_determined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorized: return "authorized"
        @unknown default: return "unknown"
        }
    }
}

@objc(FruitFitAppMetricaPlugin)
public class FruitFitAppMetricaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FruitFitAppMetricaPlugin"
    public let jsName = "FruitFitAppMetrica"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "reportRegistration", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise)
    ]

    @objc func reportRegistration(_ call: CAPPluginCall) {
        let result = FruitFitAppMetricaService.shared.reportRegistration(
            userID: call.getString("userId") ?? ""
        )
        call.resolve([
            "reported": result.reported,
            "duplicate": result.duplicate,
            "reason": result.reason ?? ""
        ])
    }

    @objc func getStatus(_ call: CAPPluginCall) {
        call.resolve(FruitFitAppMetricaService.shared.statusPayload())
    }
}
