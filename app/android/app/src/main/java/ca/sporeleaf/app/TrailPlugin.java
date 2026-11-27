package ca.sporeleaf.app;

import android.Manifest;
import android.app.Activity;
import android.provider.Settings;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.annotation.ActivityCallback;
import java.util.ArrayList;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import org.json.JSONObject;

@CapacitorPlugin(
    name = "TrailGPS",
    permissions = {
        @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
        @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
    }
)
public class TrailPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAliases(new String[] { "location", "notifications" }, call, "afterPermissions");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    private void afterPermissions(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) begin(call);
        else call.reject("Location permission was not allowed");
    }

    private void begin(PluginCall call) {
        double sec = call.getDouble("interval", 120.0);
        Intent i = new Intent(getContext(), TrailService.class);
        i.putExtra("interval", (long) (sec * 1000));
        try {
            ContextCompat.startForegroundService(getContext(), i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't start hike tracking: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TrailService.class));
        call.resolve();
    }

    /** Returns the fixes recorded since the last call, and clears them. */
    @PluginMethod
    public void drain(PluginCall call) {
        JSArray out = new JSArray();
        File f = TrailService.store(getContext());
        synchronized (TrailPlugin.class) {
            if (f.exists()) {
                try (BufferedReader r = new BufferedReader(new FileReader(f))) {
                    String line;
                    while ((line = r.readLine()) != null) {
                        line = line.trim();
                        if (!line.isEmpty()) { try { out.put(new JSONObject(line)); } catch (Exception ignored) {} }
                    }
                } catch (Exception ignored) {}
                f.delete();
            }
        }
        JSObject res = new JSObject();
        res.put("points", out);
        res.put("running", TrailService.running);
        call.resolve(res);
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("Bad link"); return; }
        Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try { getContext().startActivity(i); call.resolve(); } catch (Exception e) { call.reject("No browser found"); }
    }

    /** Saves a text file (backup, CSV, share file) into Downloads. */
    @PluginMethod
    public void saveText(PluginCall call) {
        String name = call.getString("filename", "shroom-log.txt").replaceAll("[^A-Za-z0-9._-]", "_");
        String type = call.getString("type", "text/plain");
        String data = call.getString("data", "");
        byte[] bytes = data.getBytes(java.nio.charset.StandardCharsets.UTF_8);
        try {
            JSObject res = new JSObject();
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                android.content.ContentValues v = new android.content.ContentValues();
                v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(android.provider.MediaStore.Downloads.MIME_TYPE, type);
                v.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                Uri uri = getContext().getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new Exception("no space in Downloads");
                try (java.io.OutputStream o = getContext().getContentResolver().openOutputStream(uri)) { o.write(bytes); }
                res.put("where", "Downloads/" + name);
            } else {
                File dir = getContext().getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS);
                File f = new File(dir, name);
                try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write(bytes); }
                res.put("where", f.getAbsolutePath());
            }
            call.resolve(res);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    /** Asks for permission to show notifications (Android 13 and later). */
    @PluginMethod
    public void notifyPermission(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterNotifyPermission");
            return;
        }
        call.resolve();
    }

    @PermissionCallback
    private void afterNotifyPermission(PluginCall call) { call.resolve(); }

    /** Shows a notification, such as a fruiting alert. */
    @PluginMethod
    public void showAlert(PluginCall call) {
        android.content.Context c = getContext();
        android.app.NotificationManager nm = (android.app.NotificationManager) c.getSystemService(android.content.Context.NOTIFICATION_SERVICE);
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(new android.app.NotificationChannel("alerts", "Fruiting alerts", android.app.NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        android.app.PendingIntent pi = android.app.PendingIntent.getActivity(c, 2, open, android.app.PendingIntent.FLAG_IMMUTABLE | android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        String body = call.getString("body", "");
        android.app.Notification n = new androidx.core.app.NotificationCompat.Builder(c, "alerts")
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(call.getString("title", "Shroom Log"))
            .setContentText(body)
            .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build();
        try { nm.notify((int) (System.currentTimeMillis() % 100000) + 10, n); call.resolve(); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }

    /** Prints a page of HTML (specimen labels) with Android's print dialog, which can also save a PDF. */
    @PluginMethod
    public void printHTML(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "Shroom Log");
        getActivity().runOnUiThread(() -> {
            try {
                final android.webkit.WebView wv = new android.webkit.WebView(getActivity());
                wv.setWebViewClient(new android.webkit.WebViewClient() {
                    @Override
                    public void onPageFinished(android.webkit.WebView view, String url) {
                        android.print.PrintManager pm = (android.print.PrintManager) getActivity().getSystemService(android.content.Context.PRINT_SERVICE);
                        pm.print(name, view.createPrintDocumentAdapter(name), new android.print.PrintAttributes.Builder().build());
                        call.resolve();
                    }
                });
                wv.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
                printViews.add(wv); // keep it alive until printing is done
            } catch (Exception e) {
                call.reject(e.getMessage());
            }
        });
    }
    private final java.util.List<android.webkit.WebView> printViews = new java.util.ArrayList<>();

    @PluginMethod
    public void info(PluginCall call) {
        JSObject res = new JSObject();
        try {
            android.content.pm.PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            res.put("versionName", p.versionName);
            res.put("versionCode", android.os.Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode);
        } catch (Exception ignored) {}
        res.put("running", TrailService.running);
        call.resolve(res);
    }

    // Dictation through the phone's own speech recogniser (the WebView has no Web Speech support).
    @PluginMethod
    public void dictate(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        String lang = call.getString("lang");
        if (lang != null) i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your note");
        try {
            startActivityForResult(call, i, "dictateResult");
        } catch (Exception e) {
            call.reject("Speech recognition is not available on this phone");
        }
    }

    @ActivityCallback
    private void dictateResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) { call.reject("cancelled"); return; }
        ArrayList<String> list = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        JSObject ret = new JSObject();
        ret.put("text", list != null && !list.isEmpty() ? list.get(0) : "");
        call.resolve(ret);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }
}
