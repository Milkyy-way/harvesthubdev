import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';
import { chunkedStorage } from './chunkedSecureStore';

// Session tokens live in the device's Keychain / Keystore, split into pieces
// SecureStore can hold — see lib/chunkedSecureStore.ts.
const authStorage = chunkedStorage(SecureStore);

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Copy .env.example to .env, fill in your project URL and anon key, and restart the dev server.'
  );
}

// This is the "anon" key — it is safe to ship inside the app because every
// table it can touch is protected by row-level security policies. The
// service_role key (which bypasses RLS) must never go in this project.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // Explicit, not left to the library default: lib/googleAuth.ts parses
    // access_token/refresh_token straight out of the OAuth redirect URL,
    // which is what the implicit flow returns. PKCE would return a `code`
    // param needing a separate exchangeCodeForSession() call instead.
    flowType: 'implicit',
  },
});

// Supabase's token auto-refresh only runs while something is actively
// listening. Tying it to app foreground/background state avoids silently
// burning refresh cycles while the app is backgrounded, and makes sure a
// session that expired overnight refreshes as soon as the user reopens it.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
