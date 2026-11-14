import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, fonts } from '../../constants/theme';
import { Logo } from '../Logo';

type Props = {
  headline: string;
  subheadline?: string;
  // Optional right-side content in the brand row.
  right?: ReactNode;
  // Bottom slot below the headline — a PeriodPicker, segment pills, an
  // action button, or nothing.
  children?: ReactNode;
};

// The page header for the tab screens (customer Dashboard/Orders/Account,
// the farmer tabs): brand row, big serif headline, optional controls — on
// the same cream page background as the content below, so every screen
// reads as one continuous surface (no colored hero block).
export function HeroShell({ headline, subheadline, right, children }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <Logo size={30} />
          <Text style={styles.brandText}>HarvestHub</Text>
        </View>
        {right ? <View style={styles.topRowRight}>{right}</View> : null}
      </View>

      <Text style={styles.headline}>{headline}</Text>
      {subheadline ? <Text style={styles.subheadline}>{subheadline}</Text> : null}

      {children ? <View style={styles.bottomSlot}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md, backgroundColor: colors.background },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandText: { fontFamily: fonts.brand, fontSize: 15, color: colors.primaryDark, letterSpacing: 0.2 },
  topRowRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headline: { fontFamily: fonts.headline, fontSize: 27, lineHeight: 33, color: colors.text, marginTop: spacing.md },
  subheadline: { fontSize: 13.5, lineHeight: 19, color: colors.textMuted, marginTop: 2 },
  bottomSlot: { marginTop: spacing.md },
});
