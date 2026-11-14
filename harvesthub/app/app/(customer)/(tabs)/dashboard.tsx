import { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, chartColors } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { formatMoney } from '../../../lib/format';
import { HeroShell } from '../../../components/customer/HeroShell';
import { PeriodPicker } from '../../../components/customer/PeriodPicker';
import { StatTile } from '../../../components/customer/StatTile';
import { WeeklyActivityChart } from '../../../components/customer/WeeklyActivityChart';
import { DonutChart, type DonutSegment } from '../../../components/customer/DonutChart';
import { Section } from '../../../components/Section';
import type { CategorySpend, DashboardSummary } from '../../../types/dashboard';
import { canGoForward, currentPeriod, periodPhrase, shortName, type Period } from '../../../lib/period';
import type { OrderStatus } from '../../../types/orders';
import { requestOrdersTab } from '../../../lib/ordersTabRequest';

// "+2 vs Oct" / "-$5.00 vs Oct" / "Same as Oct", for the period before.
function versus(now: number, before: number, name: string, money = false): string {
  const diff = Math.round((now - before) * 100) / 100;
  if (diff === 0) return `Same as ${name}`;
  const amount = money ? formatMoney(Math.abs(diff)) : String(Math.abs(diff));
  return `${diff > 0 ? '+' : '-'}${amount} vs ${name}`;
}

// Donut segments: the customer's top categories in their fixed chart colors
// (color_slot comes from the backend, pinned to ALL-TIME rank so changing
// the period never repaints a category), everything else folded into one
// gray "Other".
function toDonutSegments(categories: CategorySpend[]): DonutSegment[] {
  const named = categories
    .filter((c) => c.color_slot !== null && c.color_slot < chartColors.categorical.length)
    .sort((a, b) => (a.color_slot ?? 0) - (b.color_slot ?? 0));
  const rest = categories.filter((c) => !named.includes(c));
  const segments: DonutSegment[] = named.map((c) => ({
    key: c.slug,
    label: c.name,
    value: c.amount,
    color: chartColors.categorical[c.color_slot!],
  }));
  if (rest.length > 0) {
    segments.push({
      key: 'other',
      label: 'Other',
      sublabel: rest.map((c) => c.name).join(', '),
      value: rest.reduce((sum, c) => sum + c.amount, 0),
      color: chartColors.other,
    });
  }
  return segments;
}

export default function CustomerDashboard() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>(() => currentPeriod('month'));
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Quick taps on the arrows: only the latest answer is shown.
  const latest = useRef(0);
  const load = useCallback((forPeriod: Period, isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    const request = ++latest.current;
    apiClient
      .get<DashboardSummary>('/customers/me/dashboard-summary', {
        params: { period: forPeriod.kind, start: forPeriod.kind === 'all' ? undefined : forPeriod.start },
      })
      .then((res) => {
        if (request !== latest.current) return;
        setSummary(res.data);
        setError(null);
      })
      .catch((err) => {
        console.warn('Could not load dashboard summary:', err);
        setError("Couldn't load your activity. Pull down to try again.");
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(period);
      // Reload only on focus + explicit period changes (handled by
      // handleChangePeriod below), not on every re-render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period])
  );

  const handleChangePeriod = (next: Period) => {
    setPeriod(next);
    load(next);
  };

  const phrase = periodPhrase(period);
  // "No orders in November yet" only while November is still going.
  const yet = period.kind === 'all' || !canGoForward(period) ? ' yet' : '';
  const before = summary?.previous && period.kind !== 'all' ? summary.previous : null;
  const beforeName = before ? shortName(before.start, period.kind) : '';

  const segments = useMemo(() => toDonutSegments(summary?.spending_by_category ?? []), [summary]);

  const openOrders = (tab: OrderStatus) => {
    requestOrdersTab(tab);
    router.push('/(customer)/(tabs)/orders');
  };

  const headline =
    summary && summary.orders_total > 0
      ? `You've saved ${formatMoney(summary.savings_all_time)} ${phrase}`
      : "See what you've saved";

  return (
    <View style={styles.container}>
      <HeroShell headline={headline} subheadline={`Spent ${formatMoney(summary?.spending_all_time ?? 0)} buying direct`}>
        <PeriodPicker value={period} onChange={handleChangePeriod} firstOrderOn={summary?.first_order_on ?? null} />
      </HeroShell>

      {loading && !summary ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(period, true)} tintColor={colors.primary} />}
        >
          {error && !summary ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : summary && summary.orders_total === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyEmoji}>🧺</Text>
              <Text style={styles.emptyText}>
                No orders {phrase}
                {yet}.
              </Text>
            </View>
          ) : summary ? (
            <>
              <View style={styles.grid}>
                <StatTile
                  icon="receipt-long"
                  label="Orders"
                  value={String(summary.orders_total)}
                  caption={
                    before
                      ? `${versus(summary.orders_total, before.orders_total, beforeName)} · ${summary.orders_active} active`
                      : `${summary.orders_active} active · ${summary.orders_completed} done · ${summary.orders_cancelled} cancelled`
                  }
                  onPress={() => openOrders(summary.orders_active > 0 ? 'active' : 'completed')}
                  accessibilityHint="Opens your orders"
                />
                <StatTile
                  icon="account-balance-wallet"
                  label="Spent"
                  value={formatMoney(summary.spending_all_time)}
                  caption={before ? versus(summary.spending_all_time, before.spending, beforeName, true) : undefined}
                />
                <StatTile icon="savings" label="Saved" value={formatMoney(summary.savings_all_time)} caption="promo codes and Harvest Pass" />
                <StatTile icon="trending-up" label="Avg order" value={formatMoney(summary.average_order_value)} />
              </View>

              <Section title="What you buy" caption={`By category ${phrase}: item totals, before fees and tax. Tap a slice for details.`}>
                {segments.length > 0 ? (
                  <DonutChart segments={segments} formatValue={formatMoney} centerCaption="on produce" />
                ) : (
                  <Text style={styles.muted}>
                    Nothing bought {phrase}
                    {yet}.
                  </Text>
                )}
              </Section>

              <Section title="Last 7 days" caption="What you spent each day.">
                <WeeklyActivityChart data={summary.activity_last_7_days} />
              </Section>

              <Section title="Insights">
                <InsightRow
                  icon="storefront"
                  label="Favorite farm"
                  value={
                    summary.favorite_farm
                      ? `${summary.favorite_farm.farm_name} (${summary.favorite_farm.order_count} order${summary.favorite_farm.order_count === 1 ? '' : 's'})`
                      : 'Not enough orders yet'
                  }
                />
                <InsightRow
                  icon="eco"
                  label="Most ordered"
                  value={
                    summary.most_ordered_product
                      ? `${summary.most_ordered_product.product_name} (×${summary.most_ordered_product.quantity})`
                      : 'Not enough orders yet'
                  }
                />
              </Section>
            </>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function InsightRow({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string; value: string }) {
  return (
    <View style={styles.insightRow}>
      <View style={styles.insightIcon}>
        <MaterialIcons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.insightTextWrap}>
        <Text style={styles.insightLabel}>{label}</Text>
        <Text style={styles.insightValue} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.xl * 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.xl * 2, gap: spacing.sm },
  emptyEmoji: { fontSize: 44 },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  muted: { fontSize: 13.5, color: colors.textMuted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  insightIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTextWrap: { flex: 1 },
  insightLabel: { fontSize: 12.5, color: colors.textMuted },
  insightValue: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 1 },
});
