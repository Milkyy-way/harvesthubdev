import { useMemo, useState } from 'react';
import { Modal, View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { clock, dayAndClock } from '../../lib/pickupTime';
import type { FarmerOrder } from '../../types/farmer';

type Props = {
  order: FarmerOrder | null; // null = closed
  submitting: boolean;
  onClose: () => void;
  // null = ready now
  onConfirm: (readyFrom: Date | null) => void;
};

const PICKUP_HOURS = 3;
const DAYS_AHEAD = 3; // the server allows up to 3 days
const FIRST_HOUR = 6; // 6 AM
const LAST_HOUR = 20; // 8 PM

function startOfDay(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

// Packed: ready now, or from a later time (2026-11-20) — packed in the evening
// for the next morning, so the customer's 3 hours don't run through the night.
// The customer gets a 4-digit code to show when they come.
export function ReadySheet({ order, submitting, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [later, setLater] = useState(false);
  const [day, setDay] = useState(1);
  const [hour, setHour] = useState<number | null>(9);

  const days = useMemo(
    () =>
      Array.from({ length: DAYS_AHEAD }, (_, i) => ({
        offset: i,
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : startOfDay(i).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
      })),
    []
  );
  const now = Date.now();
  const hours = Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => FIRST_HOUR + i).filter((h) => {
    const d = startOfDay(day);
    d.setHours(h);
    return d.getTime() > now;
  });
  const chosen = (() => {
    if (!later || hour === null || !hours.includes(hour)) return null;
    const d = startOfDay(day);
    d.setHours(hour);
    return d;
  })();

  const nowEnds = new Date(now + PICKUP_HOURS * 3600 * 1000).toISOString();
  const close = () => {
    setLater(false);
    onClose();
  };

  return (
    <Modal visible={!!order} transparent animationType="slide" onRequestClose={close}>
      <View style={styles.backdrop}>
        <Pressable style={styles.flex1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <ScrollView>
            <Text style={styles.title}>Ready for pickup?</Text>
            <Text style={styles.body}>
              {order?.customer_name ?? 'The customer'} gets a 4-digit code and {PICKUP_HOURS} hours to pick up. When they arrive,
              enter their code to hand the order over.
            </Text>

            <Pressable style={[styles.option, !later && styles.optionOn]} onPress={() => setLater(false)} accessibilityRole="radio">
              <Text style={[styles.optionTitle, !later && styles.optionTitleOn]}>Ready now</Text>
              <Text style={[styles.optionText, !later && styles.optionTextOn]}>Pickup until {clock(nowEnds)}</Text>
            </Pressable>
            <Pressable style={[styles.option, later && styles.optionOn]} onPress={() => setLater(true)} accessibilityRole="radio">
              <Text style={[styles.optionTitle, later && styles.optionTitleOn]}>Ready from a later time</Text>
              <Text style={[styles.optionText, later && styles.optionTextOn]}>For example, packed tonight for tomorrow morning</Text>
            </Pressable>

            {later ? (
              <>
                <Text style={styles.label}>Day</Text>
                <View style={styles.chips}>
                  {days.map((d) => (
                    <Pressable key={d.offset} style={[styles.chip, day === d.offset && styles.chipOn]} onPress={() => setDay(d.offset)}>
                      <Text style={[styles.chipText, day === d.offset && styles.chipTextOn]}>{d.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.label}>From</Text>
                <View style={styles.chips}>
                  {hours.map((h) => {
                    const d = startOfDay(day);
                    d.setHours(h);
                    return (
                      <Pressable key={h} style={[styles.chip, hour === h && styles.chipOn]} onPress={() => setHour(h)}>
                        <Text style={[styles.chipText, hour === h && styles.chipTextOn]}>{clock(d.toISOString())}</Text>
                      </Pressable>
                    );
                  })}
                  {hours.length === 0 ? <Text style={styles.optionText}>No times left today. Pick another day.</Text> : null}
                </View>
                {chosen ? (
                  <Text style={styles.summary}>
                    Pickup from {dayAndClock(chosen.toISOString())} until{' '}
                    {clock(new Date(chosen.getTime() + PICKUP_HOURS * 3600 * 1000).toISOString())}.
                  </Text>
                ) : null}
              </>
            ) : null}

            <View style={styles.actions}>
              <Pressable style={styles.keepButton} onPress={close} disabled={submitting}>
                <Text style={styles.keepText}>Not yet</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, later && !chosen && styles.disabled]}
                onPress={() => onConfirm(later ? chosen : null)}
                disabled={submitting || (later && !chosen)}
              >
                {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmText}>Mark ready</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: 13.5, lineHeight: 20, color: colors.text, marginBottom: spacing.md },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  optionOn: { borderColor: colors.primary, backgroundColor: colors.tint },
  optionTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  optionTitleOn: { color: colors.primaryDark },
  optionText: { fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  optionTextOn: { color: colors.text },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  chipTextOn: { color: colors.white },
  summary: { fontSize: 13.5, fontWeight: '600', color: colors.primaryDark, marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  keepButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  keepText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  confirmButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  confirmText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.4 },
});
