import * as AppleAuthentication from 'expo-apple-authentication';
import { supabase } from './supabase';

// Native Sign in with Apple (iPhone only; components/AppleSignInButton.tsx
// hides itself elsewhere). Like signInWithGoogle, it's the same call for
// logging in and signing up. Returns null if the customer backed out.
export async function signInWithApple() {
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err: any) {
    if (err?.code === 'ERR_REQUEST_CANCELED') return null;
    throw err;
  }
  if (!credential.identityToken) throw new Error('Apple sign-in did not return a session.');

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });
  if (error) throw error;

  // Apple only gives the name on the very first sign-in, and not inside the
  // token, so keep it now — app/(role-setup)/details.tsx fills it in from here.
  const fullName = [credential.fullName?.givenName, credential.fullName?.familyName].filter(Boolean).join(' ');
  if (fullName) {
    const { error: nameError } = await supabase.auth.updateUser({ data: { full_name: fullName } });
    if (nameError) console.warn('Could not save the name from Apple:', nameError);
  }

  return data.session;
}
