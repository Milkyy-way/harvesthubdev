import { Pressable, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import type { MembershipOverview } from '../../types/membership';
import type { Order } from '../../types/orders';

/** What to say under "Order placed!", from the order's own numbers; null for
 *  nothing. Exported for the tests. */
export function orderPassMessage(order: Order, pass: MembershipOverview | null): { text: string; upsell: boolean } | null {
  const kept = order.store_orders.filter((so) => so.status !== 'cancelled');
  const saved = Math.round(kept.reduce((sum, so) => sum + (so.member_savings ?? 0), 0) * 100) / 100;
  if (saved > 0) return { text: `Harvest Pass saved you $${saved.toFixed(2)} on this order.`, upsell: false };
  if (!pass || pass.is_member) return null;
  // The Pass waives the service fee when the items come to the minimum or more.
  const items = kept.reduce((sum, so) => sum + so.subtotal, 0);
  const fee = Math.round(kept.reduce((sum, so) => sum + so.service_fee, 0) * 100) / 100;
  if (fee <= 0 || items < pass.free_service_fee_min_subtotal) return null;
  const free = pass.free_period_available ? ` Try it free for ${pass.free_days} days.` : '';
  return { text: `With Harvest Pass you'd have saved $${fee.toFixed(2)} on this order.${free}`, upsell: true };
}

// Under the order confirmation (2026-11-14): what Harvest Pass saved, or would
// have saved, using this order's own fees.
export function OrderPassNote({ order, pass }: { order: Order; pass: MembershipOverview | null }) {
  const router = useRouter();
  const message = orderPassMessage(order, pass);
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
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  upsell: { backgroundColor: `${colors.accent}2E` },
  pressed: { opacity: 0.8 },
  emoji: { fontSize: 16 },
  text: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: colors.primaryDark },
});
