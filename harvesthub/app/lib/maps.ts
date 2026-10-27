import { Platform, Linking } from 'react-native';

// Deep-links out to the device's native maps app — no API key, no
// react-native-maps dependency, no embedded map view. Falls back to a
// plain Google Maps web URL (works everywhere, including simulators
// without a maps app installed) if the native scheme fails to open.
export function openDirections(lat: number, lng: number, label?: string) {
  const encodedLabel = encodeURIComponent(label ?? '');
  const webUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  const nativeUrl = Platform.select({
    ios: `maps:0,0?q=${encodedLabel}@${lat},${lng}`,
    android: `geo:0,0?q=${lat},${lng}(${encodedLabel})`,
    default: webUrl,
  });

  Linking.openURL(nativeUrl!).catch(() => {
    Linking.openURL(webUrl);
  });
}

// Turn-by-turn driving directions to a delivery stop, in Google Maps (the
// app if installed, else the website). Uses the coordinates when the API has
// them, the address otherwise.
export function openDrivingDirections(destination: { latitude: number | null; longitude: number | null; address: string }) {
  const target =
    destination.latitude !== null && destination.longitude !== null
      ? `${destination.latitude},${destination.longitude}`
      : encodeURIComponent(destination.address);
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${target}&travelmode=driving`);
}
