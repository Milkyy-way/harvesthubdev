import fs from 'fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Android push notifications go through Firebase Cloud Messaging, which needs
// google-services.json (Firebase console -> your project -> Android apps; one
// file covers both package names). Optional, so builds still work before it
// exists — Android just can't get a push token without it. On EAS it can come
// from a "file" environment variable instead of the repo.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const hasGoogleServices = fs.existsSync(googleServicesFile);

// The live delivery map (react-native-maps) uses Google Maps on Android, which
// needs a "Maps SDK for Android" key in the app. It's restricted to this
// app's package and signing certificate in Google Cloud, so it's fine to ship.
// Without it the app shows the arrival estimate as text instead of a map
// (components/customer/LiveDeliveryMap.tsx). iPhones use Apple Maps — no key.
const googleMapsAndroidKey = process.env.GOOGLE_MAPS_ANDROID_API_KEY;

// app.json holds the real (production) app: "HarvestHub",
// com.harvesthubmarket.app, harvesthub:// links. The development build is
// a separate app — "HarvestHub Dev", its own package id and link scheme —
// so it can sit next to the Google Play version on the same phone.
//
// APP_VARIANT picks which one: eas.json sets it per build profile, and
// `npm start` (scripts/start.js) sets it to "development" for the dev
// server. Anything else (eas submit, a production build) gets production.
const variant = process.env.APP_VARIANT === 'development' ? 'development' : 'production';

// iOS Universal Links: a tapped pod invite link (https://<host>/invite/CODE)
// opens the app directly. Same host the app builds those links from
// (constants/legal.ts); that host serves the file Apple checks
// (harvesthub-backend/app/legal/router.py). A plain-http LAN address can't be
// used, so a local build simply goes without.
function inviteLinkDomains(): string[] {
  const base = process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL;
  return base?.startsWith('https://') ? [`applinks:${new URL(base).host}`] : [];
}

export default ({ config: baseConfig }: ConfigContext): ExpoConfig => {
  const config = {
    ...baseConfig,
    ios: { ...baseConfig.ios, associatedDomains: inviteLinkDomains() },
    android: {
      ...baseConfig.android,
      ...(hasGoogleServices ? { googleServicesFile } : {}),
      ...(googleMapsAndroidKey ? { config: { ...baseConfig.android?.config, googleMaps: { apiKey: googleMapsAndroidKey } } } : {}),
    },
  };

  if (variant === 'production') {
    // On an EAS build server (EAS_BUILD is set there), fail the build rather
    // than ship an app that can't reach the API: release builds can't make
    // plain-http requests, and a LAN address only works on your own Wi-Fi.
    const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
    if (process.env.EAS_BUILD && !apiUrl?.startsWith('https://')) {
      throw new Error(
        `Production builds need an https:// EXPO_PUBLIC_API_BASE_URL in the EAS "production" environment (got ${apiUrl ?? 'nothing'}).`
      );
    }
    return config as ExpoConfig;
  }

  return {
    ...config,
    name: 'HarvestHub Dev',
    scheme: 'harvesthub-dev',
    ios: { ...config.ios, bundleIdentifier: 'com.harvesthubmarket.app.dev' },
    android: { ...config.android, package: 'com.harvesthubmarket.app.dev' },
  } as ExpoConfig;
};
