import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { roundCents } from '../../lib/format';
import type { MembershipOverview } from '../../types/membership';
import type { CartSummary } from '../../types/database';

export type PassMessage = { text: string; upsell: boolean };

/** The service fee Harvest Pass would waive on this cart, the way checkout
 *  works it out: each farm's items (before promo codes) × the rate, rounded
 *  per farm. Null when the server didn't send the rate (older backend). */
export function cartServiceFee(cart: CartSummary, rate: number | undefined): number | null {
  if (!rate) return null;
  return Math.round(cart.farms.reduce((sum, f) => sum + roundCents(f.subtotal * rate), 0) * 100) / 100;
}

/** The one Harvest Pass line, worded the same in the cart and at checkout
 *  (2026-11-14). short: how much more to reach the minimum; fee: the service
 *  fee the Pass waives here (null if unknown); freeDays: when the free month
 *  is still on offer. Exported for the tests. */
export function passLine(p: { isMember: boolean; min: number; short: number; fee: number | null; freeDays: number | null }): PassMessage {
  const free = p.freeDays ? ` Free for ${p.freeDays} days.` : '';
  if (p.isMember) {
    if (p.short > 0) return { text: `Add $${p.short.toFixed(2)} more for no service fee with your Harvest Pass.`, upsell: false };
    return { text: p.fee ? `No service fee with your Harvest Pass: you save $${p.fee.toFixed(2)} here.` : 'No service fee on this order with your Harvest Pass.', upsell: false };
  }
  if (p.short > 0) return { text: `With Harvest Pass, orders of $${p.min.toFixed(0)}+ have no service fee.${free}`, upsell: true };
  if (!p.fee) return { text: `No service fee on this order with Harvest Pass.${free}`, upsell: true };
  return { text: `Save $${p.fee.toFixed(2)} on this order with Harvest Pass.${free}`, upsell: true };
}

/** The line for a cart. Exported for the tests. */
export function cartPassMessage(cart: CartSummary, pass: MembershipOverview): PassMessage | null {
  const min = pass.free_service_fee_min_subtotal;
  return passLine({
    isMember: pass.is_member,
    min,
    short: Math.round((min - cart.total) * 100) / 100,
    fee: cartServiceFee(cart, pass.service_fee_rate),
    freeDays: pass.free_period_available ? pass.free_days : null,
  });
}

/** The line itself: a tinted strip, tappable (to Harvest Pass) when it's an
 *  invitation to join. */
export function PassNote({ message, onPress, style }: { message: PassMessage; onPress: () => void; style?: object }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.note, message.upsell && styles.upsell, pressed && styles.pressed, style]}
      onPress={message.upsell ? onPress : undefined}
      disabled={!message.upsell}
      accessibilityRole={message.upsell ? 'button' : undefined}
    >
      <Text style={styles.emoji}>🌾</Text>
      <Text style={styles.text}>{message.text}</Text>
      {message.upsell ? <MaterialIcons name="chevron-right" size={18} color={colors.primaryDark} /> : null}
    </Pressable>
  );
}

// The cart's Harvest Pass line (2026-11-14), above the total: what the Pass
// saves here, or how much more to add. People decide at the moment they see a
// fee, so this is where the Pass is worth mentioning. Checkout shows the same
// line under the farm total, with its exact figures.
export function CartPassNote({ cart, pass }: { cart: CartSummary; pass: MembershipOverview | null }) {
  const router = useRouter();
  if (!pass) return null;
  return <PassNote message={cartPassMessage(cart, pass)!} onPress={() => router.push('/(customer)/harvest-pass')} />;
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
