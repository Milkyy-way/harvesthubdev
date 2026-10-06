import type { Href } from 'expo-router';
import type { Profile } from '../types/database';

export type RouteGuardInput = {
  hasSession: boolean;
  profile: Pick<Profile, 'role' | 'status'> | null;
  // farmer_verification.submitted_at is set — the farmer application has
  // been sent in at least once (only meaningful for farmers).
  applicationSubmitted: boolean;
  // useSegments() — the current route's path segments, groups included.
  segments: string[];
  // A password reset is in progress — the emailed code may already have
  // signed the user in, but the new password isn't saved yet (AuthContext).
  passwordRecovery?: boolean;
};

// The one place that decides which part of the app a user belongs in.
// Returns where to redirect, or null if they're already somewhere allowed.
// Kept free of React/Expo runtime imports so it can be tested on its own.
//
// Farmers (Farmer F0): sign up -> fill in the application -> use the farmer
// app. The app itself is always reachable once the application has been
// submitted; Products/Orders lock themselves until profiles.status is
// 'active' (see app/(farmer)/(tabs)/). Only a REJECTED farmer may reopen the
// application, to fix it and resubmit.
export function resolveRedirect({ hasSession, profile, applicationSubmitted, segments, passwordRecovery }: RouteGuardInput): Href | null {
  const group = segments[0];
  const inAuth = group === '(auth)';

  // Checked first: the reset code has signed the user in, but they must set
  // a new password before going anywhere else (customer or farmer).
  if (passwordRecovery) {
    return inAuth && segments[1] === 'reset-password' ? null : '/(auth)/reset-password';
  }

  if (!hasSession) return inAuth ? null : '/(auth)';
  if (!profile) return null; // profile still loading

  if (!profile.role) {
    // Signed in with Google but hasn't finished setting up (status
    // 'pending_role_selection', see 0018). Google sign-ups are customer-only.
    return group === '(role-setup)' ? null : '/(role-setup)/details';
  }

  if (profile.role === 'farmer') {
    const inFarmerApp = group === '(farmer)';
    const inApplication = inFarmerApp && segments[1] === 'application';
    // Open before the application is sent in, too: every account must be
    // deletable in-app (Google Play), and the legal pages it links to.
    const inAccountPages = inFarmerApp && (segments[1] === 'delete-account' || segments[1] === 'legal');

    if (!applicationSubmitted) return inApplication || inAccountPages ? null : '/(farmer)/application';
    if (inApplication) return profile.status === 'rejected' ? null : '/(farmer)/(tabs)';
    return inFarmerApp ? null : '/(farmer)/(tabs)';
  }

  // Customers (and admins, who have no app of their own yet).
  return group === '(customer)' ? null : '/(customer)/(tabs)';
}
