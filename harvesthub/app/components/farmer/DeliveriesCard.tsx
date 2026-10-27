import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import type { RunsResponse } from '../../types/delivery';

type Props = {
  runs: RunsResponse | null; // null while loading
  onPress: () => void;
};

// The farmer Home tab's delivery summary: the next run (or the one under
// way), or an invitation to set delivery up — tap for Deliveries.
export function DeliveriesCard({ runs, onPress }: Props) {
  const live = runs?.upcoming.find((r) => r.status === 'in_progress');
  const next = live ?? runs?.upcoming[0];

  const title = live ? 'Out delivering' : next ? 'Next delivery' : 'Deliveries';
  const body = live
    ? `${live.delivered_count} of ${live.stop_count} stops delivered`
    : next
      ? `${next.label} · ${next.stop_count} stop${next.stop_count === 1 ? '' : 's'}${next.can_start ? ' · ready to start' : ''}`
      : runs
        ? 'Deliver to customers nearby — set your fee and delivery times.'
        : 'Loading…';

  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.icon}>
        <MaterialIcons name="local-shipping" size={20} color={colors.primary} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body} numberOfLines={2}>
          {body}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  pressed: { opacity: 0.8 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  body: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
});
