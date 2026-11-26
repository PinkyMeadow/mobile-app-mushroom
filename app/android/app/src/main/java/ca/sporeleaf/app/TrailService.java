package ca.sporeleaf.app;

import android.annotation.SuppressLint;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.io.File;
import java.io.FileWriter;

/**
 * Records the hike route while the screen is off. GPS is asked for one fix per interval,
 * and the system keeps the GPS chip asleep in between, which saves battery.
 * Fixes are appended to a file so nothing is lost if the web view is paused.
 */
public class TrailService extends Service implements LocationListener {
    static final String CHANNEL = "trail";
    static volatile boolean running = false;
    static volatile long intervalMs = 120000;
    private LocationManager lm;

    static File store(android.content.Context c) { return new File(c.getFilesDir(), "trail-points.jsonl"); }

    @Override public IBinder onBind(Intent intent) { return null; }

    @SuppressLint("MissingPermission")
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) intervalMs = intent.getLongExtra("interval", 120000);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Hike tracking", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a hike is being recorded");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        long mins = Math.max(1, intervalMs / 60000);
        String every = intervalMs < 60000 ? "every " + (intervalMs / 1000) + " seconds" : mins == 1 ? "every minute" : "every " + mins + " minutes";
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentTitle("Recording your hike")
                .setContentText("GPS checks in " + every + ". Open the app to stop.")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setContentIntent(pi)
                .build();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        ServiceCompat.startForeground(this, 1, n, type);

        if (lm == null) lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        try { lm.removeUpdates(this); } catch (Exception ignored) {}
        try {
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, 0f, this, Looper.getMainLooper());
            running = true;
        } catch (Exception e) {
            running = false;
            stopSelf();
        }
        return START_STICKY;
    }

    @Override
    public void onLocationChanged(@NonNull Location l) {
        synchronized (TrailPlugin.class) { try (FileWriter w = new FileWriter(store(this), true)) {
            w.write("{\"lat\":" + l.getLatitude() + ",\"lng\":" + l.getLongitude() + ",\"t\":" + l.getTime()
                    + ",\"acc\":" + (l.hasAccuracy() ? l.getAccuracy() : 999)
                    + ",\"alt\":" + (l.hasAltitude() ? String.valueOf(l.getAltitude()) : "null") + "}\n");
        } catch (Exception ignored) {} }
    }

    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onProviderEnabled(@NonNull String provider) {}
    @Override public void onProviderDisabled(@NonNull String provider) {}

    @Override
    public void onDestroy() {
        running = false;
        try { if (lm != null) lm.removeUpdates(this); } catch (Exception ignored) {}
        super.onDestroy();
    }
}
