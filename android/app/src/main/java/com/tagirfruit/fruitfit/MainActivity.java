package com.tagirfruit.fruitfit;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(FruitFitHealthPlugin.class);
        registerPlugin(FruitFitAppIconPlugin.class);
        registerPlugin(FruitFitOrientationPlugin.class);
        registerPlugin(FruitFitTelegramPlugin.class);
        super.onCreate(savedInstanceState);
        FruitFitTelegramPlugin.handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        FruitFitTelegramPlugin.handleIntent(intent);
    }
}
