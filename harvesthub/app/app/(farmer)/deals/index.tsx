import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { DEAL_STATUS_LABELS, OPEN_DEAL_STATUSES, type Deal, type DealRecord } from '../../../types/deals';

// A farm's group deals, newest first. See harvesthub-backend/app/deals/service.py.
export default function DealsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [deals, setDeals] = useState<Deal[] | null>(null);
  const [record, setRecord] = useState<DealRecord | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ deals: Deal[] }>('/farmers/me/deals');
      setDeals(res.data.deals);
      setError(null);
      apiClient.get<DealRecord>('/farmers/me/deals/record').then(
        (rec) => setRecord(rec.data),
        (err) => console.warn('Could not load your deal record:', err)
      );
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't load your deals. Pull down to try again."));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Group deals</Text>
        <View style={styles.back} />
      </View>
      <FlatList
        data={deals ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
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
        ListHeaderComponent={
          <>
            <Text style={styles.intro}>
              Set a lower price that unlocks only if enough households join by a deadline. Nobody pays unless the goal is reached.
            </Text>
            <Pressable style={styles.newButton} onPress={() => router.push('/(farmer)/deals/new' as Href)}>
              <MaterialIcons name="add" size={18} color={colors.white} />
              <Text style={styles.newText}>New deal</Text>
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {record && record.deals_finished > 0 ? (
              <View style={styles.record}>
                <Text style={styles.recordTitle}>Your record</Text>
                <Text style={styles.recordLine}>
                  {record.deals_unlocked} unlocked · {record.deals_expired} missed · {record.deals_cancelled} cancelled
                  {record.orders_not_filled > 0 ? ` · ${record.orders_not_filled} orders not filled` : ''}
                </Text>
                {record.tip ? <Text style={styles.recordTip}>{record.tip}</Text> : null}
              </View>
            ) : null}
          </>
        }
        ListEmptyComponent={
          deals === null && !error ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : deals?.length === 0 ? (
            <Text style={styles.empty}>No deals yet.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const open = OPEN_DEAL_STATUSES.includes(item.status);
          return (
            <Pressable
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              onPress={() => router.push(`/(farmer)/deals/${item.id}` as Href)}
              accessibilityRole="button"
            >
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.product_name}
                </Text>
                <Text style={styles.detail}>
                  {item.share_label} · ${item.payout.share_price.toFixed(2)} · {item.households} of {item.goal} households
                </Text>
                <Text style={[styles.status, open && styles.statusOpen]}>{DEAL_STATUS_LABELS[item.status]}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
            </Pressable>
          );
        }}
      />
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
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  list: { paddingHorizontal: spacing.lg },
  intro: { fontSize: 14, lineHeight: 20, color: colors.text },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 13,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  newText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.sm },
  record: { backgroundColor: colors.tint, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.sm },
  recordTitle: { fontFamily: fonts.headlineBold, fontSize: 17, color: colors.primaryDark },
  recordLine: { fontSize: 13, lineHeight: 19, color: colors.text, marginTop: 2 },
  recordTip: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: colors.primaryDark, marginTop: spacing.xs },
  loading: { marginTop: spacing.xl },
  empty: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.75 },
  rowText: { flex: 1 },
  name: { fontFamily: fonts.headline, fontSize: 16, color: colors.text },
  detail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  status: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 4 },
  statusOpen: { color: colors.primary },
});
