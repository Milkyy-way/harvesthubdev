import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { canGoBack, canGoForward, periodTitle, stepPeriod, switchKind, type Period, type PeriodKind } from '../../lib/period';

const KINDS: { key: PeriodKind; label: string }[] = [
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'all', label: 'All time' },
];

type Props = {
  value: Period;
  onChange: (next: Period) => void;
  /** The customer's first order day ('YYYY-MM-DD'): the arrows stop there. */
  firstOrderOn: string | null;
};

// The Dashboard's date control: Month / Year / All time, then arrows to step
// through calendar months or years ("‹ November 2026 ›"). Replaces the row of
// rolling-window chips (fix requested 2026-11-14).
export function PeriodPicker({ value, onChange, firstOrderOn }: Props) {
  const back = canGoBack(value, firstOrderOn);
  const forward = canGoForward(value);

  return (
    <View style={styles.wrap}>
      <View style={styles.segments} accessibilityRole="tablist">
        {KINDS.map((k) => {
          const active = k.key === value.kind;
          return (
            <Pressable
              key={k.key}
              style={[styles.segment, active && styles.segmentActive]}
              onPress={() => !active && onChange(switchKind(value, k.key))}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {value.kind !== 'all' ? (
        <View style={styles.stepper}>
          <ArrowButton icon="chevron-left" enabled={back} label={`Previous ${value.kind}`} onPress={() => onChange(stepPeriod(value, -1))} />
          <Text style={styles.title} accessibilityRole="header">
            {periodTitle(value)}
          </Text>
          <ArrowButton icon="chevron-right" enabled={forward} label={`Next ${value.kind}`} onPress={() => onChange(stepPeriod(value, 1))} />
        </View>
      ) : null}
    </View>
  );
}

function ArrowButton({ icon, enabled, label, onPress }: { icon: 'chevron-left' | 'chevron-right'; enabled: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.arrow, !enabled && styles.arrowDisabled, pressed && enabled && styles.arrowPressed]}
      onPress={enabled ? onPress : undefined}
      disabled={!enabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
    >
      <MaterialIcons name={icon} size={24} color={enabled ? colors.primaryDark : colors.border} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  segments: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 3,
    alignSelf: 'flex-start',
  },
  segment: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.text },
  segmentTextActive: { color: colors.white },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.headlineBold, fontSize: 19, color: colors.text },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowDisabled: { backgroundColor: 'transparent' },
  arrowPressed: { opacity: 0.7 },
});
