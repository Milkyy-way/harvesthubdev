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
        <Stack.Screen name="help" />
        <Stack.Screen name="legal" />
        <Stack.Screen name="delete-account" />
        <Stack.Screen name="referral" />
      </Stack>
    </CheckoutDraftProvider>
  );
}
