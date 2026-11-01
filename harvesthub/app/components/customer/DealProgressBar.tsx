import { useEffect, useRef } from 'react';
import { View, Text, Animated, AccessibilityInfo, StyleSheet } from 'react-native';
import { colors, spacing, radius } from '../../constants/theme';

export const ALMOST_THERE = 0.8;

// Households toward the goal, then shares claimed toward the cap. It can move
// backward when someone withdraws: the spec wants that shown honestly.
export function DealProgressBar({
  households,
  goal,
  sharesClaimed,
  capacity,
  ended,
}: {
  households: number;
  goal: number;
  sharesClaimed: number;
  capacity: number;
  ended?: 'missed' | 'muted';
}) {
  const metGoal = households >= goal;
  const fraction = Math.min(metGoal ? sharesClaimed / Math.max(capacity, 1) : households / Math.max(goal, 1), 1);
  const almost = !metGoal && !ended && households / Math.max(goal, 1) >= ALMOST_THERE;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!almost) return;
    let loop: Animated.CompositeAnimation | null = null;
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced || !active) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      );
      loop.start();
    });
    return () => {
      active = false;
      loop?.stop();
      pulse.setValue(1);
    };
  }, [almost, pulse]);

  const fill = ended === 'muted' ? colors.textMuted : metGoal || almost ? colors.accent : colors.primary;
  const label = metGoal ? `${sharesClaimed} / ${capacity} shares claimed` : `${households} / ${goal} households`;

  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ now: Math.round(fraction * 100), min: 0, max: 100 }}>
      <View style={[styles.track, ended === 'missed' && styles.trackMissed]}>
        <Animated.View style={[styles.fill, { width: `${fraction * 100}%`, backgroundColor: ended === 'missed' ? colors.berry : fill, opacity: pulse }]} />
        {!metGoal ? <View style={styles.tick} /> : null}
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.label}>{metGoal ? 'Goal reached' : 'Goal unlocks price'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  trackMissed: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.berry },
  fill: { height: '100%', borderRadius: radius.pill },
  // The halfway mark.
  tick: { position: 'absolute', left: '50%', top: 0, bottom: 0, width: 2, backgroundColor: colors.background },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, marginTop: spacing.xs },
  label: { fontSize: 12, color: colors.textMuted },
});
