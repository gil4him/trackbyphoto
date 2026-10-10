package com.zymer.daylie;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The Play install referrer: what the store link the app was installed from
 * carried after &referrer= (the /pair page puts "c=CODE" there), so a parent
 * who installs from the family's link is connected on the first launch.
 * Always resolves; "" when there is none (sideloaded, or Play unavailable).
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getReferrer(PluginCall call) {
        final InstallReferrerClient client = InstallReferrerClient.newBuilder(getContext()).build();
        final boolean[] answered = { false };
        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    String referrer = "";
                    if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                        try {
                            referrer = client.getInstallReferrer().getInstallReferrer();
                        } catch (Exception ignored) {
                            // Leave it empty.
                        }
                    }
                    try {
                        client.endConnection();
                    } catch (Exception ignored) {
                        // Already closed.
                    }
                    answer(call, answered, referrer);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    answer(call, answered, "");
                }
            });
        } catch (Exception e) {
            answer(call, answered, "");
        }
    }

    private static void answer(PluginCall call, boolean[] answered, String referrer) {
        synchronized (answered) {
            if (answered[0]) return;
            answered[0] = true;
        }
        JSObject ret = new JSObject();
        ret.put("referrer", referrer == null ? "" : referrer);
        call.resolve(ret);
    }
}
