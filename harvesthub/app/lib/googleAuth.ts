import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
// Not re-exported from the package root — this deep import is the path
// Supabase's own Expo OAuth guide uses.
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from './supabase';

// Required once per app so the in-app browser session used below actually
// resolves its promise when the OAuth redirect comes back — without this,
// openAuthSessionAsync can hang after a successful login.
WebBrowser.maybeCompleteAuthSession();

// Sign in with Apple lives in lib/appleAuth.ts (native, no browser involved).
export async function signInWithGoogle() {
  const redirectTo = Linking.createURL('auth-callback');

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data.url) throw new Error('Could not start Google sign-in.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    // Customer backed out of the Google sheet — not an error, same
    // treatment as a cancelled Stripe PaymentSheet elsewhere in this app.
    return null;
  }
  if (result.type !== 'success' || !result.url) {
    throw new Error('Google sign-in did not complete.');
  }

  const { params, errorCode } = QueryParams.getQueryParams(result.url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) {
    throw new Error('Google sign-in did not return a session.');
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });
  if (sessionError) throw sessionError;
  return sessionData.session;
}

// Supabase's signInWithOAuth doesn't distinguish "log in" from "sign up" —
// it's the same call either way, and a Google identity that's never been
// seen before gets its auth.users row created automatically, right then
// (auto-linked to an existing account instead, if one already exists with
// this exact email AND that account's email is verified — Supabase's own
// default behavior, not something this app configures).
//
// The Login screen wants to reject the "never been seen before" case
// rather than silently creating an account from the Login screen. The
// robust way to detect that is comparing created_at to last_sign_in_at,
// NOT how long ago created_at was: on a genuinely first-ever sign-in,
// both timestamps come from the exact same authentication event, so
// they're identical (or a few ms apart from Postgres clock resolution).
// On any later sign-in — even a retry seconds after abandoning signup —
// last_sign_in_at moves forward to reflect *this* call while created_at
// stays pinned to the original event, so they diverge. A wall-clock "is
// created_at recent" check doesn't have that property: it would wrongly
// call a same-minute retry "brand new" too.
export function isFirstEverSignIn(session: {
  user: { created_at: string; last_sign_in_at?: string | null };
}): boolean {
  if (!session.user.last_sign_in_at) return true;
  const created = new Date(session.user.created_at).getTime();
  const lastSignIn = new Date(session.user.last_sign_in_at).getTime();
  return Math.abs(lastSignIn - created) < 2_000;
}
