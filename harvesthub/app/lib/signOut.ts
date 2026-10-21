import { supabase } from './supabase';
import { unregisterPushNotifications } from './pushNotifications';

// Use this, not supabase.auth.signOut() directly: it first tells the API to
// stop sending this account's notifications to this phone.
export async function signOut(options?: Parameters<typeof supabase.auth.signOut>[0]) {
  await unregisterPushNotifications();
  return supabase.auth.signOut(options);
}
