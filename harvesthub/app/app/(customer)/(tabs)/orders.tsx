import { useCallback, useState } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { HeroShell } from '../../../components/customer/HeroShell';
import { DateRangeFilter } from '../../../components/customer/DateRangeFilter';
import { OrderCard } from '../../../components/customer/OrderCard';
import type { Order, OrderStatus, ReorderResponse } from '../../../types/orders';
import type { DashboardRangeKey } from '../../../types/dashboard';

const TABS: { key: OrderStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

const EMPTY_MESSAGES: Record<OrderStatus, string> = {
  active: 'No active orders. Browse nearby farms to place one.',
  completed: 'No completed orders yet.',
  cancelled: 'No cancelled orders.',
};

export default function CustomerOrders() {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<OrderStatus>('active');
  const [range, setRange] = useState<DashboardRangeKey>('all');
  const [ordersByTab, setOrdersByTab] = useState<Record<OrderStatus, Order[]>>({
    active: [],
    completed: [],
    cancelled: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  const loadOrders = useCallback((tab: OrderStatus, forRange: DashboardRangeKey) => {
    setLoading(true);
    apiClient
      .get<Order[]>('/orders', { params: { status: tab, range: forRange } })
      .then((res) => {
        setOrdersByTab((prev) => ({ ...prev, [tab]: res.data }));
        setError(null);
      })
      .catch((err) => {
        console.warn('Could not load orders:', err);
        setError("Couldn't load your orders. Pull down to try again.");
      })
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders(activeTab, range);
      // Reload only the tab/range currently in view on each focus —
      // switching either triggers its own load below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadOrders])
  );

  const handleSelectTab = (tab: OrderStatus) => {
    setActiveTab(tab);
    loadOrders(tab, range);
  };

  const handleChangeRange = (next: DashboardRangeKey) => {
    setRange(next);
    loadOrders(activeTab, next);
  };

  const handleRebook = async (order: Order) => {
    setReorderingId(order.id);
    try {
      const res = await apiClient.post<ReorderResponse>(`/orders/${order.id}/reorder`);
      const { added_count, skipped_count } = res.data;
      if (added_count === 0) {
        Alert.alert('Nothing to add', "None of this order's items are available right now.");
        return;
      }
      const message =
        skipped_count > 0
          ? `Added what's still available to your cart — ${skipped_count} item${skipped_count === 1 ? '' : 's'} couldn't be fully added (out of stock or no longer offered).`
          : 'Added to your cart.';
      Alert.alert('Rebooked', message, [{ text: 'View Cart', onPress: () => router.push('/(customer)/cart') }]);
    } catch (err: any) {
      console.warn('Could not rebook order:', err);
      Alert.alert('Could not rebook', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setReorderingId(null);
    }
  };

  const orders = ordersByTab[activeTab];

  return (
    <View style={styles.container}>
      <HeroShell headline="Your orders">
        <DateRangeFilter value={range} onChange={handleChangeRange} />
      </HeroShell>

      <View style={styles.tabRow}>
        {TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          return (
            <Pressable
              key={tab.key}
              style={[styles.tab, isActive && styles.tabActive]}
              onPress={() => handleSelectTab(tab.key)}
            >
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {loading && orders.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(order) => order.id}
          contentContainerStyle={orders.length === 0 ? styles.emptyContent : styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() => router.push({ pathname: '/(customer)/orders/[id]', params: { id: item.id } })}
              showRebook={activeTab !== 'active'}
              onRebook={() => handleRebook(item)}
              rebooking={reorderingId === item.id}
            />
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyText}>{error ?? EMPTY_MESSAGES[activeTab]}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.sm },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  tabLabelActive: { color: colors.white },
  listContent: { paddingBottom: spacing.xl },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: spacing.lg },
  emptyContent: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
});
