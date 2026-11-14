import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { roundCents } from '../../lib/format';
import type { MembershipOverview } from '../../types/membership';
import type { CartSummary } from '../../types/database';

/** The service fee Harvest Pass would waive on this cart, the way checkout
 *  works it out: each farm's items (before promo codes) × the rate, rounded
 *  per farm. Null when the server didn't send the rate (older backend). */
export function cartServiceFee(cart: CartSummary, rate: number | undefined): number | null {
  if (!rate) return null;
  return Math.round(cart.farms.reduce((sum, f) => sum + roundCents(f.subtotal * rate), 0) * 100) / 100;
}

/** The line itself, or null for nothing to say. Exported for the tests. */
export function cartPassMessage(cart: CartSummary, pass: MembershipOverview): { text: string; upsell: boolean } | null {
  const min = pass.free_service_fee_min_subtotal;
  const fee = cartServiceFee(cart, pass.service_fee_rate);
  const short = Math.round((min - cart.total) * 100) / 100;
  const free = pass.free_period_available ? ` Free for ${pass.free_days} days.` : '';
  if (pass.is_member) {
    if (short > 0) return { text: `Add $${short.toFixed(2)} more for no service fee with your Harvest Pass.`, upsell: false };
    return { text: fee ? `No service fee with your Harvest Pass: you save $${fee.toFixed(2)} here.` : 'No service fee on this order with your Harvest Pass.', upsell: false };
  }
  if (short > 0) return { text: `With Harvest Pass, orders of $${min.toFixed(0)}+ have no service fee.${free}`, upsell: true };
  if (!fee) return { text: `No service fee on this order with Harvest Pass.${free}`, upsell: true };
  return { text: `Save $${fee.toFixed(2)} on this order with Harvest Pass.${free}`, upsell: true };
}

// The cart's Harvest Pass line (2026-11-14), above the total: what the Pass
// saves here, or how much more to add. People decide at the moment they see a
// fee, so this is where the Pass is worth mentioning. Checkout shows the exact
// figure again.
export function CartPassNote({ cart, pass }: { cart: CartSummary; pass: MembershipOverview | null }) {
  const router = useRouter();
  if (!pass) return null;
  const message = cartPassMessage(cart, pass);
  if (!message) return null;
  return (
    <Pressable
      style={({ pressed }) => [styles.note, message.upsell && styles.upsell, pressed && styles.pressed]}
      onPress={message.upsell ? () => router.push('/(customer)/harvest-pass') : undefined}
      disabled={!message.upsell}
      accessibilityRole={message.upsell ? 'button' : undefined}
    >
      <Text style={styles.emoji}>🌾</Text>
      <Text style={styles.text}>{message.text}</Text>
      {message.upsell ? <MaterialIcons name="chevron-right" size={18} color={colors.primaryDark} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  upsell: { backgroundColor: `${colors.accent}2E` },
  pressed: { opacity: 0.8 },
  emoji: { fontSize: 16 },
  text: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.primaryDark },
});
