import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { DealPayout } from '../../types/deals';

const money = (n: number) => `$${n.toFixed(2)}`;

// What a deal earns, in dollars: the decision a farmer is really making.
export function DealPayoutPanel({ payout, goal, capacity }: { payout: DealPayout; goal: number; capacity: number }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>What you&apos;d earn</Text>
      <Row label={`Each share, after our ${Math.round(payout.commission_rate * 100)}%`} value={money(payout.net_per_share)} />
      <Row label={`At the goal (${goal} shares)`} value={money(payout.net_at_goal)} strong />
      <Row label={`If all ${capacity} shares go`} value={money(payout.net_at_capacity)} strong />
      <Row label={`The same ${goal} shares at the regular price`} value={money(payout.regular_net_at_goal)} />
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, strong && styles.strong]}>{label}</Text>
      <Text style={[styles.value, strong && styles.strong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: colors.tint, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg },
  title: { fontFamily: fonts.headlineBold, fontSize: 18, color: colors.primaryDark, marginBottom: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 4 },
  label: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
  value: { fontSize: 13.5, lineHeight: 19, color: colors.text, fontVariant: ['tabular-nums'] },
  strong: { fontWeight: '700', color: colors.primaryDark },
});
