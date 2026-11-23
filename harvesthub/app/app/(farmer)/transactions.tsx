import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { formatMoney } from '../../lib/format';
import { openWeeklyStatement } from '../../lib/statements';
import { colors, spacing, radius } from '../../constants/theme';
import type { FarmerTransaction, FarmerTransactions, TransactionFilter, TransactionKind } from '../../types/farmer';

const FILTERS: { value: TransactionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'sales', label: 'Sales' },
  { value: 'adjustments', label: 'Refunds & charges' },
  { value: 'payouts', label: 'Payouts' },
];

const ICONS: Record<TransactionKind, React.ComponentProps<typeof MaterialIcons>['name']> = {
  sale: 'shopping-bag',
  refund: 'undo',
  charge: 'remove-circle-outline',
  payout: 'account-balance',
};

// Transactions (2026-11-22): every sale, refund, charge and payout, newest
// first, like a delivery app's merchant statement. A sale, refund or charge
// opens that order's statement; a payout opens the week's statement in the
// browser (print, PDF or spreadsheet).
export default function FarmerTransactionsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [items, setItems] = useState<FarmerTransaction[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [openingWeek, setOpeningWeek] = useState<string | null>(null);

  const load = useCallback(async (kind: TransactionFilter) => {
    try {
      const res = await apiClient.get<FarmerTransactions>('/farmers/me/earnings/transactions', { params: { kind } });
      setItems(res.data.items);
      setNextBefore(res.data.next_before);
      setError(null);
    } catch (err) {
      console.warn('Could not load transactions:', err);
      setError("Couldn't load your transactions. Pull down to try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(filter);
    }, [filter, load])
  );

  const chooseFilter = (next: TransactionFilter) => {
    if (next === filter) return;
    setItems(null);
    setFilter(next);
  };

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await apiClient.get<FarmerTransactions>('/farmers/me/earnings/transactions', {
        params: { kind: filter, before: nextBefore },
      });
      setItems((prev) => [...(prev ?? []), ...res.data.items]);
      setNextBefore(res.data.next_before);
    } catch (err) {
      console.warn('Could not load more transactions:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  const openRow = async (row: FarmerTransaction) => {
    if (row.store_order_id) {
      router.push({ pathname: '/(farmer)/statement/[id]', params: { id: row.store_order_id } });
      return;
    }
    setOpeningWeek(row.period_start);
    try {
      await openWeeklyStatement(row.period_start);
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
        <Text style={styles.headerTitle}>Transactions</Text>
        <View style={styles.back} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.filter, filter === f.value && styles.filterOn]}
            onPress={() => chooseFilter(f.value)}
            accessibilityState={{ selected: filter === f.value }}
          >
            <Text style={[styles.filterText, filter === f.value && styles.filterTextOn]}>{f.label}</Text>
          </Pressable>
        ))}
      </View>

      {items === null ? (
        <View style={styles.center}>
          {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={colors.primary} />}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(row) => `${row.kind}-${row.id}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(filter);
              }}
              tintColor={colors.primary}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            error ? (
              <Text style={styles.error}>{error}</Text>
            ) : (
              <Text style={styles.hint}>Tap a line to see its statement. Payouts open the week&apos;s statement, to print or save.</Text>
            )
          }
          ListEmptyComponent={
            <Text style={[styles.muted, styles.empty]}>
              {filter === 'payouts'
                ? 'No payouts yet. Your first one is prepared the Friday after your first full week of sales.'
                : 'Nothing here yet. Sales show up once orders are handed over.'}
            </Text>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.more} color={colors.primary} /> : null}
          renderItem={({ item }) => <TransactionRow row={item} busy={openingWeek === item.period_start && !item.store_order_id} onPress={() => openRow(item)} />}
        />
      )}
    </View>
  );
}

function TransactionRow({ row, busy, onPress }: { row: FarmerTransaction; busy: boolean; onPress: () => void }) {
  const when = row.at ? new Date(row.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  return (
    <Pressable style={styles.row} onPress={onPress} disabled={busy}>
      <View style={[styles.icon, row.kind === 'payout' && styles.iconPayout]}>
        <MaterialIcons name={ICONS[row.kind]} size={18} color={row.kind === 'payout' ? colors.white : colors.primary} />
      </View>
      <View style={styles.flex1}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.detail} numberOfLines={2}>
          {[when, row.order_ref ? `#${row.order_ref}` : null, row.detail].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={[styles.amount, row.amount < 0 && styles.negative]}>{formatMoney(row.amount)}</Text>
      )}
    </Pressable>
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
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filter: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.text },
  filterTextOn: { color: colors.white },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  list: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl * 2 },
  hint: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginBottom: spacing.sm },
  muted: { fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: 'center' },
  empty: { marginTop: spacing.xl },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  more: { marginVertical: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center' },
  iconPayout: { backgroundColor: colors.primary },
  title: { fontSize: 14, fontWeight: '600', color: colors.text },
  detail: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 1 },
  amount: { fontSize: 14, fontWeight: '700', color: colors.text },
  negative: { color: colors.danger },
});
