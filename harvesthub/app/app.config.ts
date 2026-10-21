import fs from 'fs';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Android push notifications go through Firebase Cloud Messaging, which needs
// google-services.json (Firebase console -> your project -> Android apps; one
// file covers both package names). Optional, so builds still work before it
// exists — Android just can't get a push token without it. On EAS it can come
// from a "file" environment variable instead of the repo.
const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const hasGoogleServices = fs.existsSync(googleServicesFile);

// app.json holds the real (production) app: "HarvestHub",
// com.harvesthubmarket.app, harvesthub:// links. The development build is
// a separate app — "HarvestHub Dev", its own package id and link scheme —
// so it can sit next to the Google Play version on the same phone.
//
// APP_VARIANT picks which one: eas.json sets it per build profile, and
// `npm start` (scripts/start.js) sets it to "development" for the dev
// server. Anything else (eas submit, a production build) gets production.
const variant = process.env.APP_VARIANT === 'development' ? 'development' : 'production';

export default ({ config: baseConfig }: ConfigContext): ExpoConfig => {
  const config = hasGoogleServices
    ? { ...baseConfig, android: { ...baseConfig.android, googleServicesFile } }
    : baseConfig;

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
