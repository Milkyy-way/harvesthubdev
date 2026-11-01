import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { formatLongDate } from '../../lib/harvestPass';
import type { MembershipOverview } from '../../types/membership';

// Home's Harvest Pass strip, for every customer: what they have, or what they
// could. Same warm tinted strip as SavingsTicker, so it reads as part of the
// page, not an ad.
export function HarvestPassBanner({ overview }: { overview: MembershipOverview }) {
  const router = useRouter();
  const min = overview.free_service_fee_min_subtotal.toFixed(0);
  const access = `no service fee on $${min}+ · Neighborhood Pods`;
  const label = overview.free_period_available
    ? `${overview.free_days} days free, no card needed · ${access}`
    : overview.membership?.has_benefits
      ? `Active · ${access}`
      : overview.free_period_active && overview.free_period_ends_at
        ? `Free until ${formatLongDate(overview.free_period_ends_at)} · ${access}`
        : `Join for ${access}`;
  const action = overview.free_period_available ? 'Start' : overview.is_member ? 'Details' : 'Join';

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push('/(customer)/harvest-pass')}
    >
      <Text style={styles.emoji}>🌾</Text>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Harvest Pass</Text>
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{action}</Text>
        <MaterialIcons name="chevron-right" size={16} color={colors.primaryDark} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { opacity: 0.8 },
  emoji: { fontSize: 30 },
  textWrap: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 20, color: colors.primaryDark },
  label: { fontSize: 12.5, color: colors.text, marginTop: 1 },
  cta: { flexDirection: 'row', alignItems: 'center' },
  ctaText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
});
