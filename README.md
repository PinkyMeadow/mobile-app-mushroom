# Shroom Log

A field log for mushrooms and plants that works with no signal. You can photograph a find, record where you found it (by GPS, or by pinning it on an offline map), note its size, colour, spore print, habitat and the weather, and browse your finds by type, month or distance.

**Safety:** this is a log, not an identification guide. Never eat a wild mushroom or plant based on this app or any other.

- `web/`: the source of the web app. Run `sh web/build.sh` to rebuild the hostable site.
- `docs/`: the built site, served by GitHub Pages.

- `app/`: the Android app. It wraps the web app with Capacitor and adds native hike tracking (a foreground service that records GPS with the screen off), saving files to Downloads, and an update check.
- `.github/workflows/android.yml`: builds and signs the APK on every push to `main` and publishes it as a GitHub release.

**Install on Android:** open https://pinkymeadow.github.io/mobile-app-mushroom/android.html on the phone, or download [the latest APK](https://github.com/PinkyMeadow/mobile-app-mushroom/releases/latest/download/shroom-log.apk).

The signing key in `app/signing/` is committed on purpose so every build can install over the last one. Anyone could use it to sign an APK that claims to be this app, so only install builds from this repository's releases.
