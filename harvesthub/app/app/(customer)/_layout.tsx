import { Stack } from 'expo-router';
import { CheckoutDraftProvider } from '../../contexts/CheckoutDraftContext';

export default function CustomerLayout() {
  return (
    <CheckoutDraftProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="farmer/[id]" />
        <Stack.Screen name="cart" />
        <Stack.Screen name="checkout" />
        <Stack.Screen name="orders/[id]" />
        <Stack.Screen name="edit-profile" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="help" />
        <Stack.Screen name="legal" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="referral" />
        <Stack.Screen name="harvest-pass" />
        <Stack.Screen name="pods/index" />
        <Stack.Screen name="pods/new" />
        <Stack.Screen name="pods/[id]" />
        <Stack.Screen name="invite/[code]" />
      </Stack>
    </CheckoutDraftProvider>
  );
}
