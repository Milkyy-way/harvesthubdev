import { supabase } from './supabase';
import { unregisterPushNotifications } from './pushNotifications';
import { stopSharingLocation } from './liveLocation';

// Use this, not supabase.auth.signOut() directly: it first tells the API to
// stop sending this account's notifications to this phone, and stops any
// delivery-run location sharing.
export async function signOut(options?: Parameters<typeof supabase.auth.signOut>[0]) {
  await Promise.all([unregisterPushNotifications(), stopSharingLocation()]);
  return supabase.auth.signOut(options);
}
