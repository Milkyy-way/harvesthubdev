import { Stack } from 'expo-router';

// (tabs) is the farmer app; application is the signup application (and,
// for a rejected farmer, the fix-and-resubmit form); product/[id] is the
// product editor ('new' to add); earnings, deliveries (and a run, and
// delivery settings), farm-profile, documents and ratings open from
// Home/Account, as do notifications, legal and delete-account. Which one a farmer may be on is decided
// by lib/routeGuard.ts, not here.
export default function FarmerLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="application" />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="earnings" />
      <Stack.Screen name="deliveries" />
      <Stack.Screen name="delivery-run/[id]" />
      <Stack.Screen name="delivery-settings" />
      <Stack.Screen name="farm-profile" />
      <Stack.Screen name="documents" />
      <Stack.Screen name="ratings" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
