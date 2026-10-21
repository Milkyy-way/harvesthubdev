import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useRouter, type Href } from 'expo-router';
import { apiClient } from './apiClient';

// Push notifications: after sign-in the app asks for permission, gets this
// phone's Expo push token and gives it to the API (POST /notifications/
// devices); on sign-out it takes it back (lib/signOut.ts). The API decides
// what to send — see harvesthub-backend/app/notifications/.
//
// Needs a development or store build (not Expo Go), and on Android the
// Firebase config file — see app.config.ts.

// Must match ANDROID_CHANNEL_ID in harvesthub-backend/app/notifications/channels.py.
const ANDROID_CHANNEL_ID = 'default';

// Show notifications that arrive while the app is open, like any other app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let registeredToken: string | null = null;

export type PushPermission = 'granted' | 'denied' | 'unavailable';

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Orders and account',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#2F4F3B',
  });
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  const { status } = await Notifications.getPermissionsAsync();
  return status === 'granted' ? 'granted' : 'denied';
}

// Asks for permission (only if the system still allows asking), then
// registers this phone with the API. Safe to call on every sign-in.
export async function registerForPushNotifications(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable'; // simulators can't receive pushes
  await ensureAndroidChannel();

  let { status, canAskAgain } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && canAskAgain) {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return 'denied';

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await apiClient.post('/notifications/devices', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
  registeredToken = token;
  return 'granted';
}

// Called just before signing out, while the session can still authenticate
// the request — so a shared phone stops getting the previous user's
// notifications. Never throws, and gives up after a few seconds.
export async function unregisterPushNotifications(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  const request = apiClient.post('/notifications/devices/unregister', { token }).then(
    () => undefined,
    (err) => console.warn('Could not unregister push token:', err)
  );
  await Promise.race([request, timeout]);
}

// Registers once per signed-in account, and opens the screen a tapped
// notification points at (data.url, set by the API) — whether the tap
// launched the app or arrived while it was open.
export function usePushNotifications({ userId, ready }: { userId: string | null; ready: boolean }) {
  const router = useRouter();
  const registeredFor = useRef<string | null>(null);
  const handledResponse = useRef<string | null>(null);
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!ready || !userId || registeredFor.current === userId) return;
    registeredFor.current = userId;
    registerForPushNotifications().catch((err) => console.warn('Could not register for push notifications:', err));
  }, [ready, userId]);

  useEffect(() => {
    if (!userId) registeredFor.current = null;
  }, [userId]);

  useEffect(() => {
    if (!ready || !lastResponse) return;
    const id = lastResponse.notification.request.identifier;
    if (handledResponse.current === id) return;
    handledResponse.current = id;
    const url = lastResponse.notification.request.content.data?.url;
    if (typeof url === 'string' && url.startsWith('/')) router.push(url as Href);
  }, [ready, lastResponse, router]);
}
