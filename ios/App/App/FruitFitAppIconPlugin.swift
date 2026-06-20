import UIKit
import Capacitor

@objc(FruitFitAppIconPlugin)
public class FruitFitAppIconPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FruitFitAppIconPlugin"
    public let jsName = "FruitFitAppIcon"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setAlternateIcon", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAlternateIcon", returnType: CAPPluginReturnPromise)
    ]

    private let supportedIconNames = Set(["orange", "pear", "apple", "strawberry"])

    @objc func setAlternateIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard UIApplication.shared.supportsAlternateIcons else {
                call.reject("iOS не поддерживает смену иконки на этом устройстве.")
                return
            }

            let rawName = (call.getString("iosAlternateName") ?? call.getString("name") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let iconName = self.normalizedIconName(rawName)
            if let iconName, !self.supportedIconNames.contains(iconName) {
                call.reject("Неизвестная иконка приложения: \(iconName).")
                return
            }

            UIApplication.shared.setAlternateIconName(iconName) { error in
                if let error {
                    call.reject("Не удалось поменять иконку: \(error.localizedDescription)", nil, error)
                    return
                }

                call.resolve([
                    "status": "applied",
                    "iosAlternateName": iconName ?? "",
                    "message": "Иконка приложения обновлена."
                ])
            }
        }
    }

    @objc func getAlternateIcon(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            call.resolve([
                "iosAlternateName": UIApplication.shared.alternateIconName ?? "",
                "supportsAlternateIcons": UIApplication.shared.supportsAlternateIcons
            ])
        }
    }

    private func normalizedIconName(_ value: String) -> String? {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if normalized.isEmpty || normalized == "default" || normalized == "primary" {
            return nil
        }
        return normalized
    }
}
