import { View, Text, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { FarmPromo } from '../../types/database';

// The promo codes a farm chose to show on its page (the farmer's Promo codes
// screen). The customer types the code at checkout, under this farm's items.
export function FarmPromoBanner({ promotions }: { promotions: FarmPromo[] | undefined }) {
  if (!promotions?.length) return null;
  return (
    <View style={styles.wrap}>
      {promotions.map((promo) => (
        <View key={promo.code} style={styles.promo}>
          <MaterialIcons name="local-offer" size={22} color={colors.accent} />
          <View style={styles.text}>
            <Text style={styles.title}>
              {promo.headline} with code <Text style={styles.code}>{promo.code}</Text>
            </Text>
            <Text style={styles.body}>{[...promo.details, 'Enter it at checkout'].join(' · ')}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm, gap: spacing.sm },
  promo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: `${colors.accent}2E`,
  },
  text: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 16, color: colors.primaryDark },
  code: { letterSpacing: 1 },
  body: { fontSize: 12.5, color: colors.text, marginTop: 1 },
});
