package com.tagirfruit.fruitfit;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(FruitFitHealthPlugin.class);
        registerPlugin(FruitFitAppIconPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
