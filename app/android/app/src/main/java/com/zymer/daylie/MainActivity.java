package com.zymer.daylie;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins (src/lib/installReferrer.ts).
        registerPlugin(InstallReferrerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
