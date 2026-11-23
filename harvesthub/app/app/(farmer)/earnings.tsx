import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '../../contexts/AuthContext';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { openWeeklyStatement } from '../../lib/statements';
import { formatDay, formatMoney, formatPeriod } from '../../lib/format';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { StatTile } from '../../components/customer/StatTile';
import type { EarningsBreakdown, FarmerEarnings, FarmerPayout, LedgerActivity, OpenPeriod } from '../../types/farmer';

// Farmer F4 — read-only view of the payout ledger: the open week(s), payout
// history, and how payouts work. All the math comes from the backend
// (GET /farmers/me/earnings); this screen only lays it out.
export default function FarmerEarningsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const approved = profile?.status === 'active';

  const [data, setData] = useState<FarmerEarnings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<FarmerEarnings>('/farmers/me/earnings');
      setData(res.data);
      setError(null);
    } catch (err) {
      console.warn('Could not load earnings:', err);
      setError("Couldn't load your earnings. Pull down to try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (approved) load();
    }, [approved, load])
  );

  const togglePayout = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const commissionPct = data ? Math.round(data.commission_rate * 100) : null;

  // Transactions and statements (2026-11-22).
  const openStatement = (storeOrderId: string) =>
    router.push({ pathname: '/(farmer)/statement/[id]', params: { id: storeOrderId } });
  const [openingWeek, setOpeningWeek] = useState<string | null>(null);
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

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Earnings</Text>
        <View style={styles.back} />
      </View>

      {!approved ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Earnings unlock once your farm is approved.</Text>
        </View>
      ) : !data ? (
        <View style={styles.center}>
          {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.primary}
            />
          }
        >
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.statsRow}>
            <StatTile icon="schedule" label="Waiting to be paid" value={formatMoney(data.awaiting_payout)} />
            <StatTile icon="account-balance" label="Paid out to you" value={formatMoney(data.lifetime_paid_out)} />
          </View>
          <View style={styles.statsRow}>
            <StatTile icon="trending-up" label="Lifetime earnings" value={formatMoney(data.lifetime_earnings)} />
            <StatTile
              icon="inventory-2"
              label="In progress"
              value={`~${formatMoney(data.in_progress.estimated_earnings)}`}
              caption={`${data.in_progress.order_count} order${data.in_progress.order_count === 1 ? '' : 's'} not picked up`}
            />
          </View>

          {data.owed_carrying < 0 ? (
            <View style={styles.owedBanner}>
              <MaterialIcons name="info-outline" size={18} color={colors.berry} />
              <Text style={styles.owedText}>
                You owe {formatMoney(-data.owed_carrying)} from cash orders. It comes off your next payout automatically.
              </Text>
            </View>
          ) : null}

          <Pressable style={styles.transactionsLink} onPress={() => router.push('/(farmer)/transactions')}>
            <MaterialIcons name="receipt-long" size={20} color={colors.primary} />
            <View style={styles.flex1}>
              <Text style={styles.transactionsTitle}>Transactions</Text>
              <Text style={styles.muted}>Every sale, refund, charge and payout, with statements to print or save</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
          </Pressable>

          {data.open_periods.map((period) => (
            <OpenPeriodCard
              key={period.period_start}
              period={period}
              commissionPct={commissionPct}
              onOpenEntry={openStatement}
              onOpenWeek={() => openWeek(period.period_start)}
              openingWeek={openingWeek === period.period_start}
            />
          ))}

          <Text style={styles.sectionTitle}>Payouts</Text>
          {data.payouts.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.muted}>Your first payout appears here the Friday after your first full week of sales.</Text>
            </View>
          ) : (
            data.payouts.map((payout) => (
              <PayoutRow
                key={payout.id}
                payout={payout}
                commissionPct={commissionPct}
                expanded={expanded.has(payout.id)}
                onToggle={() => togglePayout(payout.id)}
                onOpenWeek={() => openWeek(payout.period_start)}
                openingWeek={openingWeek === payout.period_start}
              />
            ))
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>How payouts work</Text>
            <Bullet text="Your sales are grouped into weeks that run Saturday to Friday." />
            <Bullet text="Each week's payout is prepared the following Friday and sent to you by bank transfer — that week in between leaves room for cancellations and refunds." />
            <Bullet text={`HarvestHub keeps a ${commissionPct}% commission on your sales, after any promo discounts you offer.`} />
            <Bullet text="Cash orders: you keep the cash at pickup, so HarvestHub's share (commission and tax) comes off your payout. If that makes a week negative, it's carried to your next payout." />
            <Bullet text="If you cancel an order a customer already paid for, they're refunded in full and the service fee comes off your payout. On a Harvest Pass order, which has no service fee, it's the 5% the fee would have been." />
            <Bullet text="If a card order isn't picked up in time, you're still paid for it, and its items go back on your products." />
            <Bullet text="If a customer reports a problem and we refund them, your share of the refunded items comes off your payout. HarvestHub gives back its commission on them." />
            <Bullet text="Transactions lists every sale, refund, charge and payout. Tap one for its statement, or open a week's statement to print, save as a PDF, or download as a spreadsheet for your records." />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function OpenPeriodCard({
  period,
  commissionPct,
  onOpenEntry,
  onOpenWeek,
  openingWeek,
}: {
  period: OpenPeriod;
  commissionPct: number | null;
  onOpenEntry: (storeOrderId: string) => void;
  onOpenWeek: () => void;
  openingWeek: boolean;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{period.is_current_week ? 'This week' : 'Last week'}</Text>
      <Text style={styles.muted}>
        {formatPeriod(period.period_start, period.period_end)} · payout prepared {formatDay(period.payout_prepared_on)}
      </Text>
      <Breakdown breakdown={period.breakdown} commissionPct={commissionPct} netLabel="Payout so far" />
      {period.entries.length === 0 ? (
        <Text style={[styles.muted, styles.emptyEntries]}>
          {period.is_current_week ? 'No picked-up orders yet this week.' : 'No activity.'}
        </Text>
      ) : (
        <View style={styles.entries}>
          {period.entries.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onPress={entry.store_order_id ? () => onOpenEntry(entry.store_order_id!) : undefined} />
          ))}
          <WeekStatementLink onPress={onOpenWeek} busy={openingWeek} />
        </View>
      )}
    </View>
  );
}

function WeekStatementLink({ onPress, busy }: { onPress: () => void; busy: boolean }) {
  return (
    <Pressable style={styles.weekLink} onPress={onPress} disabled={busy} hitSlop={6}>
      <MaterialIcons name="event-note" size={15} color={colors.primary} />
      <Text style={styles.weekLinkText}>Weekly statement</Text>
      {busy ? <ActivityIndicator size="small" color={colors.primary} /> : <MaterialIcons name="open-in-new" size={14} color={colors.primary} />}
    </Pressable>
  );
}

function EntryRow({ entry, onPress }: { entry: LedgerActivity; onPress?: () => void }) {
  const title =
    entry.entry_type === 'cancellation_fee'
      ? 'Cancellation fee'
      : entry.entry_type === 'refund_adjustment'
        ? 'Refund after payout'
        : `${entry.customer_name ?? 'Order'} · ${entry.item_count} item${entry.item_count === 1 ? '' : 's'}`;
  const placed = entry.order_placed_at ? new Date(entry.order_placed_at).toLocaleDateString() : null;
  const detail = [placed, entry.payment_method === 'cash_on_pickup' ? 'cash' : entry.payment_method === 'card' ? 'card' : null]
    .filter(Boolean)
    .join(' · ');
  const icon: React.ComponentProps<typeof MaterialIcons>['name'] =
    entry.entry_type === 'cancellation_fee' ? 'remove-circle-outline' : entry.entry_type === 'refund_adjustment' ? 'undo' : 'shopping-bag';

  return (
    <Pressable style={styles.entryRow} onPress={onPress} disabled={!onPress}>
      <MaterialIcons name={icon} size={18} color={colors.textMuted} />
      <View style={styles.flex1}>
        <Text style={styles.entryTitle} numberOfLines={1}>
          {title}
        </Text>
        {detail ? <Text style={styles.entryDetail}>{detail}</Text> : null}
      </View>
      <Text style={[styles.entryAmount, entry.net < 0 && styles.negative]}>{formatMoney(entry.net)}</Text>
      {onPress ? <MaterialIcons name="chevron-right" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

function PayoutRow({
  payout,
  commissionPct,
  expanded,
  onToggle,
  onOpenWeek,
  openingWeek,
}: {
  payout: FarmerPayout;
  commissionPct: number | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenWeek: () => void;
  openingWeek: boolean;
}) {
  const net = payout.breakdown.net;
  const status =
    payout.status === 'paid'
      ? {
          label: net < 0 ? 'Settled' : payout.disbursed_at ? `Paid ${new Date(payout.disbursed_at).toLocaleDateString()}` : 'Paid',
          color: colors.primary,
        }
      : payout.status === 'carried_forward'
        ? {
            label: payout.carried_into_period_end ? `Carried to week ending ${formatDay(payout.carried_into_period_end)}` : 'Carried forward',
            color: colors.berry,
          }
        : { label: net < 0 ? 'Owed · carries to next payout' : 'Processing', color: colors.accent };

  return (
    <Pressable style={styles.card} onPress={onToggle}>
      <View style={styles.payoutHeader}>
        <View style={styles.flex1}>
          <Text style={styles.payoutPeriod}>{formatPeriod(payout.period_start, payout.period_end)}</Text>
          <View style={[styles.pill, { backgroundColor: `${status.color}1A` }]}>
            <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
          </View>
        </View>
        <Text style={[styles.payoutAmount, net < 0 && styles.negative]}>{formatMoney(net)}</Text>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={22} color={colors.textMuted} />
      </View>
      {expanded ? (
        <>
          <Breakdown breakdown={payout.breakdown} commissionPct={commissionPct} netLabel="Payout" />
          <WeekStatementLink onPress={onOpenWeek} busy={openingWeek} />
        </>
      ) : null}
    </Pressable>
  );
}

function Breakdown({
  breakdown: b,
  commissionPct,
  netLabel,
}: {
  breakdown: EarningsBreakdown;
  commissionPct: number | null;
  netLabel: string;
}) {
  return (
    <View style={styles.breakdown}>
      <Line label="Sales" value={formatMoney(b.gross)} />
      <Line label={`HarvestHub commission${commissionPct != null ? ` (${commissionPct}%)` : ''}`} value={formatMoney(-b.commission)} />
      <Line label="Your earnings" value={formatMoney(b.earnings)} bold />
      {b.cash_collected > 0 ? <Line label="Cash you collected at pickup" value={formatMoney(-b.cash_collected)} /> : null}
      {b.fees > 0 ? <Line label="Cancellation fees" value={formatMoney(-b.fees)} /> : null}
      {b.carried_in < 0 ? <Line label="Owed from earlier weeks" value={formatMoney(b.carried_in)} /> : null}
      <View style={styles.divider} />
      <Line label={b.net < 0 ? 'You owe' : netLabel} value={formatMoney(Math.abs(b.net))} bold negative={b.net < 0} />
    </View>
  );
}

function Line({ label, value, bold, negative }: { label: string; value: string; bold?: boolean; negative?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineBold, negative && styles.negative]}>{value}</Text>
    </View>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bullet}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
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
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  owedBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: `${colors.berry}14`,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  owedText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.text },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  card: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cardTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: 2 },
  muted: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  emptyEntries: { marginTop: spacing.sm },
  breakdown: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  lineLabel: { fontSize: 13, color: colors.textMuted, flex: 1, marginRight: spacing.sm },
  lineValue: { fontSize: 13, color: colors.text },
  lineBold: { fontWeight: '700', color: colors.text },
  negative: { color: colors.danger },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 4 },
  entries: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  entryTitle: { fontSize: 13.5, color: colors.text, fontWeight: '600' },
  entryDetail: { fontSize: 11.5, color: colors.textMuted, marginTop: 1 },
  entryAmount: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  payoutHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  payoutPeriod: { fontSize: 15, fontWeight: '700', color: colors.text },
  pill: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8, marginTop: 4 },
  pillText: { fontSize: 11, fontWeight: '700' },
  payoutAmount: { fontSize: 16, fontWeight: '700', color: colors.text },
  bullet: { flexDirection: 'row', gap: 6, marginTop: 6 },
  transactionsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
  },
  transactionsTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  weekLink: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm, alignSelf: 'flex-start' },
  weekLinkText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  bulletDot: { fontSize: 13, color: colors.textMuted, lineHeight: 19 },
  bulletText: { flex: 1, fontSize: 13, lineHeight: 19, color: colors.text },
});
