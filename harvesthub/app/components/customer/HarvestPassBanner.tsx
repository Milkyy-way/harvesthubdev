import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { formatLongDate } from '../../lib/harvestPass';

type Props = {
  freeUntil: string | null; // still in their free month: when it ends
  minSubtotal: number;
};

// Home's Harvest Pass strip for customers without a paid plan — during their
// free month it says how long it lasts, after that it invites them to join.
// Same warm tinted strip as SavingsTicker, so it reads as part of the page,
// not an ad.
export function HarvestPassBanner({ freeUntil, minSubtotal }: Props) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push('/(customer)/harvest-pass')}
    >
      <Text style={styles.emoji}>🌾</Text>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Harvest Pass</Text>
        <Text style={styles.label}>
          {freeUntil
            ? `Free until ${formatLongDate(freeUntil)} · no service fee on $${minSubtotal.toFixed(0)}+`
            : `No service fee on orders of $${minSubtotal.toFixed(0)}+`}
        </Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{freeUntil ? 'Details' : 'Join'}</Text>
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
