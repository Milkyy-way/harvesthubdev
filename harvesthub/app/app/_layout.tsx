import { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Slot, useGlobalSearchParams, useRouter, useSegments, type Href } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StripeProvider } from '@stripe/stripe-react-native';
import { StatusBar } from 'expo-status-bar';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import AntDesign from '@expo/vector-icons/AntDesign';
import { Newsreader_600SemiBold, Newsreader_700Bold } from '@expo-google-fonts/newsreader';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { resolveRedirect } from '../lib/routeGuard';
import { rememberPodInvite, takePodInvite } from '../lib/pendingPodInvite';
import { usePushNotifications } from '../lib/pushNotifications';
// Defines the background location task for live delivery tracking — it must
// exist as soon as the app's JS starts, so it's imported here.
import '../lib/liveLocation';
import { colors } from '../constants/theme';

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
if (!stripePublishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. Set it in .env to your Stripe test-mode publishable key (pk_test_...).'
  );
}

// Without this, the MaterialIcons font (used everywhere via IconSymbol /
// direct @expo/vector-icons/MaterialIcons imports — search bar, category
// rail, farmer cards, tab bar) can render as blank/garbled glyphs on the
// very first frame after a cold launch, because the font file hasn't
// finished loading into the native text renderer yet. Holding the splash
// screen until it's ready avoids that flash entirely.
SplashScreen.preventAutoHideAsync();

function RootNavigation() {
  const { session, profile, farmerVerification, loading, passwordRecovery } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const { code: inviteCode } = useGlobalSearchParams<{ code?: string }>();

  // A pod invite link opened before signing in: the guard below sends them to
  // sign in or sign up, and the invite opens once they're in the customer app.
  const inPodInvite = (segments as string[])[1] === 'invite';
  if (inPodInvite && inviteCode && !loading && (!session || !profile?.role)) rememberPodInvite(inviteCode);
  useEffect(() => {
    if (loading || profile?.role !== 'customer' || segments[0] !== '(customer)') return;
    const code = takePodInvite();
    if (code) router.push(`/(customer)/invite/${code}` as Href);
  }, [loading, profile?.role, segments, router]);

  // Once signed in to a real account (customer or farmer — farmers awaiting
  // approval too, so they hear about the decision), register this phone for
  // push notifications, and open the screen a tapped notification points at.
  usePushNotifications({
    userId: session?.user.id ?? null,
    ready: !loading && !!profile?.role && !passwordRecovery,
  });

  useEffect(() => {
    if (loading) return;
    // Screens that finish a step (signup, role setup, the farmer
    // application) don't navigate themselves — they refresh the profile and
    // this effect moves them on. See lib/routeGuard.ts for the rules.
    const target = resolveRedirect({
      hasSession: !!session,
      profile,
      applicationSubmitted: !!farmerVerification?.submitted_at,
      segments,
      passwordRecovery,
    });
    if (target) router.replace(target);
  }, [session, profile, farmerVerification, loading, segments, router, passwordRecovery]);

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return <Slot />;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    ...MaterialIcons.font,
    ...AntDesign.font,
    Newsreader_600SemiBold,
    Newsreader_700Bold,
    Manrope_800ExtraBold,
  });

  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync();
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <StripeProvider publishableKey={stripePublishableKey!} merchantIdentifier="merchant.com.harvesthubmarket.app">
      <AuthProvider>
        {/* Dark status-bar text everywhere: every screen now sits on the
            light cream background (the welcome screen sets its own). */}
        <StatusBar style="dark" />
        <RootNavigation />
      </AuthProvider>
    </StripeProvider>
  );
}
