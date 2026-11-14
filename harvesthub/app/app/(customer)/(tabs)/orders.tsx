import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, SectionList, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { HeroShell } from '../../../components/customer/HeroShell';
import { OrderCard } from '../../../components/customer/OrderCard';
import { takeOrdersTabRequest } from '../../../lib/ordersTabRequest';
import { groupByDate } from '../../../lib/orderGroups';
import type { Order, OrderStatus, ReorderResponse } from '../../../types/orders';

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
  const [ordersByTab, setOrdersByTab] = useState<Record<OrderStatus, Order[]>>({
    active: [],
    completed: [],
    cancelled: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  // Every order in that list, newest first, under date headings (no date
  // filter: replaced 2026-11-14).
  const loadOrders = useCallback((tab: OrderStatus) => {
    setLoading(true);
    apiClient
      .get<Order[]>('/orders', { params: { status: tab } })
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

  // The list in view, for the focus reload below (it doesn't re-run when it
  // changes: switching lists loads on its own).
  const tabRef = useRef(activeTab);

  useFocusEffect(
    useCallback(() => {
      // Sent here from an order tile (Dashboard, Account): open that list.
      const requested = takeOrdersTabRequest();
      if (requested) {
        tabRef.current = requested;
        setActiveTab(requested);
      }
      loadOrders(tabRef.current);
    }, [loadOrders])
  );

  const handleSelectTab = (tab: OrderStatus) => {
    tabRef.current = tab;
    setActiveTab(tab);
    loadOrders(tab);
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
  const sections = groupByDate(orders);

  return (
    <View style={styles.container}>
      <HeroShell headline="Your orders" />

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
        <SectionList
          sections={sections}
          keyExtractor={(order) => order.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={orders.length === 0 ? styles.emptyContent : styles.listContent}
          ItemSeparatorComponent={() => <View style={styles.divider} />}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeading} accessibilityRole="header">
              {section.title}
            </Text>
          )}
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
  sectionHeading: {
    fontFamily: fonts.headlineBold,
    fontSize: 17,
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  emptyContent: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
});
