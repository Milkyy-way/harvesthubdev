import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { addHours, clock, dayAndClock, LATE_CONFIRM_HOURS } from '../../lib/pickupTime';
import type { StoreOrder } from '../../types/orders';

type Props = {
  storeOrder: StoreOrder;
  paysAtPickup: boolean;
  busy: boolean;
  onExtend: () => void;
};

// The pickup code and window (2026-11-20). The farm taps Ready; the customer
// has 3 hours (plus one extra hour on request) and shows this code at the
// farm, which enters it to hand the order over. After the window ends the
// farm can still hand it over for a day, so the code stays up until then.
export function PickupCodeCard({ storeOrder, paysAtPickup, busy, onExtend }: Props) {
  const pickup = storeOrder.pickup;
  if (!pickup?.code) return null;
  const ended = storeOrder.status === 'not_picked';
  const notOpenYet = !ended && pickup.starts_at !== null && new Date(pickup.starts_at).getTime() > Date.now();

  let when = '';
  if (ended && pickup.not_picked_at) {
    when = `Your pickup time ended. If you're on your way, the farm can still hand it over until ${dayAndClock(
      addHours(pickup.not_picked_at, LATE_CONFIRM_HOURS)
    )}.`;
  } else if (notOpenYet && pickup.starts_at && pickup.ends_at) {
    when = `Pick up from ${dayAndClock(pickup.starts_at)} until ${clock(pickup.ends_at)}.`;
  } else if (pickup.ends_at) {
    when = `Pick up by ${clock(pickup.ends_at)}${pickup.extended ? ' (with your extra hour)' : ''}.`;
  }

  return (
    <View style={[styles.card, ended && styles.cardEnded]}>
      <Text style={styles.label}>Your pickup code</Text>
      <Text style={styles.code} accessibilityLabel={`Pickup code ${pickup.code.split('').join(' ')}`}>
        {pickup.code}
      </Text>
      <Text style={styles.when}>{when}</Text>
      {paysAtPickup ? <Text style={styles.line}>Bring ${storeOrder.total.toFixed(2)} in cash.</Text> : null}
      <Text style={styles.hint}>
        Show this code at the farm and they&apos;ll hand over your order. Only share it once the order is in your hands.
      </Text>
      {pickup.can_extend ? (
        <Pressable style={styles.extendButton} onPress={onExtend} disabled={busy} accessibilityRole="button">
          {busy ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <MaterialIcons name="more-time" size={16} color={colors.primary} />
              <Text style={styles.extendText}>Running late? Add 1 hour</Text>
            </>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  cardEnded: { backgroundColor: '#F6E7E5' },
  label: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  code: { fontFamily: fonts.headlineBold, fontSize: 44, letterSpacing: 10, color: colors.primaryDark, marginVertical: 2 },
  when: { fontSize: 14, fontWeight: '600', color: colors.text, textAlign: 'center' },
  line: { fontSize: 13, color: colors.text, marginTop: 4 },
  hint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  extendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 16,
    marginTop: spacing.sm,
    minWidth: 180,
    justifyContent: 'center',
  },
  extendText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
