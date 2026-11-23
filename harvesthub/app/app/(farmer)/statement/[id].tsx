import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { formatMoney, formatPeriod } from '../../../lib/format';
import { openWeeklyStatement } from '../../../lib/statements';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import type { OrderStatement } from '../../../types/farmer';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// One order's statement (2026-11-22): what was sold, the farm's promo, the
// commission, the delivery fee the farm keeps, any cash collected, refunds or
// charges, and which weekly payout it's in. HarvestHub's own fees and the
// customer's card aren't shown; the tax is shown as HarvestHub's.
export default function OrderStatementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [s, setS] = useState<OrderStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingWeek, setOpeningWeek] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      apiClient
        .get<OrderStatement>(`/farmers/me/earnings/orders/${id}`)
        .then((res) => {
          setS(res.data);
          setError(null);
        })
        .catch((err) => {
          console.warn('Could not load the statement:', err);
          setError(apiErrorMessage(err, "Couldn't load this statement."));
        });
    }, [id])
  );

  const openWeek = async (periodStart: string) => {
    setOpeningWeek(periodStart);
    try {
      await openWeeklyStatement(periodStart);
    } catch (err) {
      Alert.alert("Couldn't open the statement", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setOpeningWeek(null);
    }
  };

  const cash = s?.payment_method === 'cash_on_pickup';
  const salesAfterPromo = s ? Math.round((s.items_total - s.promo_discount) * 100) / 100 : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{s ? `Order #${s.order_ref}` : 'Statement'}</Text>
        <View style={styles.back} />
      </View>

      {!s ? (
        <View style={styles.center}>
          {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{s.customer}</Text>
          <Text style={styles.muted}>
            {[
              s.placed_at ? `Ordered ${dateTime(s.placed_at)}` : null,
              s.finished_at ? `${s.what_happened} ${dateTime(s.finished_at)}` : s.what_happened,
              cash ? 'Cash at pickup' : 'Paid by card',
              s.fulfillment_method === 'delivery' ? 'Delivery' : 'Pickup',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          <Text style={styles.section}>What was sold</Text>
          <View style={styles.card}>
            {s.items.map((item, i) => (
              <View key={`${item.name}-${i}`} style={styles.line}>
                <Text style={styles.lineLabel}>
                  {item.quantity} × {item.name}
                  <Text style={styles.small}>  {formatMoney(item.unit_price)} / {item.unit}</Text>
                </Text>
                <Text style={styles.lineValue}>{formatMoney(item.line_total)}</Text>
              </View>
            ))}
            <View style={styles.divider} />
            <Line label="Items" value={s.items_total} />
            {s.promo_discount > 0 ? <Line label={`Your promo${s.promo_code ? ` ${s.promo_code}` : ''}`} value={-s.promo_discount} /> : null}
            <Line label="Sales, after your promo" value={salesAfterPromo} bold />
            {s.delivery_fee > 0 ? <Line label="Delivery fee (yours to keep)" value={s.delivery_fee} /> : null}
          </View>

          <Text style={styles.section}>Your money</Text>
          {s.entries.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>{s.note}</Text>
            </View>
          ) : (
            <View style={styles.card}>
              {s.entries.map((entry, i) => (
                <View key={i} style={i > 0 ? styles.entryGap : undefined}>
                  {entry.lines.map((line, j) => (
                    <Line key={j} label={line.label} value={line.amount} />
                  ))}
                  <Pressable style={styles.week} onPress={() => openWeek(entry.period_start)} disabled={openingWeek !== null}>
                    <MaterialIcons name="event-note" size={14} color={colors.primary} />
                    <Text style={styles.weekText}>
                      Week of {formatPeriod(entry.period_start, entry.period_end)} · {entry.payout.label}
                    </Text>
                    {openingWeek === entry.period_start ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <MaterialIcons name="open-in-new" size={14} color={colors.primary} />
                    )}
                  </Pressable>
                </View>
              ))}
              <View style={styles.divider} />
              <Line label={s.net < 0 ? 'You owe HarvestHub' : 'You get for this order'} value={Math.abs(s.net)} bold negative={s.net < 0} />
            </View>
          )}

          <View style={styles.note}>
            <MaterialIcons name="info-outline" size={16} color={colors.textMuted} />
            <Text style={styles.noteText}>
              {cash && s.cash_total != null
                ? `The customer paid you ${formatMoney(s.cash_total)} in cash${s.tax > 0 ? `, including ${formatMoney(s.tax)} sales tax` : ''}. HarvestHub's commission${s.tax > 0 ? ' and the tax' : ''} come off your payout.`
                : s.tax > 0
                  ? `Sales tax on this order (${formatMoney(s.tax)}) is collected by HarvestHub. It isn't part of your sales or your payout.`
                  : 'No sales tax on this order.'}{' '}
              The commission is on your sales after your promo; delivery fees aren&apos;t charged commission.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function Line({ label, value, bold, negative }: { label: string; value: number; bold?: boolean; negative?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.bold, (negative || value < 0) && styles.negative]}>{formatMoney(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.headline, fontSize: 22, color: colors.text },
  muted: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 2 },
  section: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  card: { backgroundColor: colors.tint, borderRadius: radius.lg, padding: spacing.md },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 3, gap: spacing.sm },
  lineLabel: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
  lineValue: { fontSize: 13.5, color: colors.text, fontVariant: ['tabular-nums'] },
  small: { fontSize: 11.5, color: colors.textMuted },
  bold: { fontWeight: '700' },
  negative: { color: colors.danger },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 6 },
  entryGap: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  week: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingVertical: 4 },
  weekText: { flex: 1, fontSize: 12, color: colors.primary, fontWeight: '600' },
  note: { flexDirection: 'row', gap: 6, marginTop: spacing.md },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.textMuted },
});
