import Capacitor

@objc(FruitFitBridgeViewController)
class FruitFitBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(FruitFitAppIconPlugin())
        bridge?.registerPluginInstance(FruitFitSystemSettingsPlugin())
        bridge?.registerPluginInstance(FruitFitAppMetricaPlugin())
    }
}
