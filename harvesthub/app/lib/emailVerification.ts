import { supabase } from './supabase';

// Email verification at sign-up uses a CODE, for the same reasons as the
// password reset (lib/passwordReset.ts): a link only works on the phone with
// the app installed. Supabase's "Confirm signup" email template must show
// {{ .Token }} — see LAUNCH_ANDROID.md. With "Confirm email" switched off in
// Supabase, signUp() signs the user straight in and none of this runs.
export function resendSignupCode(email: string) {
  return supabase.auth.resend({ type: 'signup', email });
}

export function verifySignupCode(email: string, token: string) {
  return supabase.auth.verifyOtp({ email, token, type: 'signup' });
}
