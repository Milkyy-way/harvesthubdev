import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import * as TaskManager from 'expo-task-manager';
import { isAxiosError } from 'axios';
import { apiClient } from './apiClient';

// Live delivery tracking, the farmer's side: while a delivery run is in
// progress the phone reports its position to the API (POST
// /farmers/me/delivery/runs/{id}/location) every ~15 s — also while the
// farmer is in Google Maps, through an Android foreground service with a
// visible notification. The customer who's next sees it on a map (see
// harvesthub-backend/app/delivery/service.py::tracking_for).
//
// The task below must be defined when the app's JS starts (app/_layout.tsx
// imports this file), so the OS can deliver positions even after a reload.

const TASK = 'harvesthub-delivery-location';
const ACTIVE_RUN_KEY = 'harvesthub.activeDeliveryRun';

type LocationTaskData = { locations: Location.LocationObject[] };

async function report(runId: string, location: Location.LocationObject): Promise<'ok' | 'over'> {
  const { latitude, longitude, heading } = location.coords;
  try {
    await apiClient.post(`/farmers/me/delivery/runs/${runId}/location`, {
      latitude,
      longitude,
      heading: heading !== null && heading >= 0 ? heading : null,
    });
    return 'ok';
  } catch (err) {
    // 409: the run is over; 404: not this farmer's run any more.
    if (isAxiosError(err) && (err.response?.status === 409 || err.response?.status === 404)) return 'over';
    console.warn('Could not share delivery location:', err);
    return 'ok'; // a dropped ping — the next one will try again
  }
}

TaskManager.defineTask<LocationTaskData>(TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const runId = await SecureStore.getItemAsync(ACTIVE_RUN_KEY);
  if (!runId) {
    await stopSharingLocation();
    return;
  }
  const latest = data.locations[data.locations.length - 1];
  if ((await report(runId, latest)) === 'over') await stopSharingLocation();
});

export type SharingMode = 'background' | 'foreground_only' | 'denied';

// Asks for location permission and starts sharing for this run. Callers show
// the prominent disclosure (what's shared, with whom, also in the
// background) BEFORE calling this — Google Play requires it.
export async function startSharingLocation(runId: string): Promise<SharingMode> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) return 'denied';
  await SecureStore.setItemAsync(ACTIVE_RUN_KEY, runId);

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) return 'foreground_only'; // the run screen watches while it's open

  if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  await Location.startLocationUpdatesAsync(TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 15000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Delivering for HarvestHub',
      notificationBody: 'Sharing your location with the customer you’re heading to. Stops when the run ends.',
      notificationColor: '#2F4F3B',
    },
  });
  return 'background';
}

export async function stopSharingLocation(): Promise<void> {
  await SecureStore.deleteItemAsync(ACTIVE_RUN_KEY).catch(() => undefined);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch (err) {
    console.warn('Could not stop location sharing:', err);
  }
}

// Whether this run's location is being shared in the background right now.
export async function isSharingLocation(runId: string): Promise<boolean> {
  const active = await SecureStore.getItemAsync(ACTIVE_RUN_KEY);
  return active === runId && (await Location.hasStartedLocationUpdatesAsync(TASK).catch(() => false));
}

// Without "allow all the time": share only while the run screen is open.
// Returns a function that stops it.
export async function watchWhileOpen(runId: string, onRunOver: () => void): Promise<() => void> {
  const subscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 15000, distanceInterval: 25 },
    (location) => {
      report(runId, location).then((result) => {
        if (result === 'over') onRunOver();
      });
    }
  );
  return () => subscription.remove();
}
