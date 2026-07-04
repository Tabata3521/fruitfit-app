import UIKit
import Capacitor

@objc(FruitFitSystemSettingsPlugin)
public class FruitFitSystemSettingsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FruitFitSystemSettingsPlugin"
    public let jsName = "FruitFitSystemSettings"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString), UIApplication.shared.canOpenURL(url) else {
                call.reject("Настройки приложения недоступны.")
                return
            }

            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve(["opened": true])
                } else {
                    call.reject("Не удалось открыть настройки приложения.")
                }
            }
        }
    }
}
