import { useCallback, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { OrderStoreSection } from '../../../components/customer/OrderStoreSection';
import type { Order, StoreOrder } from '../../../types/orders';

export default function OrderDetailScreen() {
  const { id, justPlaced } = useLocalSearchParams<{ id: string; justPlaced?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyStoreOrderId, setBusyStoreOrderId] = useState<string | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const [ratingStoreOrderId, setRatingStoreOrderId] = useState<string | null>(null);

  const loadOrder = useCallback(() => {
    if (!id) return;
    setLoading(true);
    apiClient
      .get<Order>(`/orders/${id}`)
      .then((res) => {
        setOrder(res.data);
        setError(null);
      })
      .catch((err) => {
        console.warn('Could not load order:', err);
        setError("Couldn't load this order.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      loadOrder();
    }, [loadOrder])
  );

  const confirmCancelStore = (storeOrderId: string, farmName: string) => {
    Alert.alert('Cancel this farm’s order?', `${farmName} — if you already paid, this will be refunded.`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => cancelStore(storeOrderId) },
    ]);
  };

  const cancelStore = async (storeOrderId: string) => {
    if (!order) return;
    setBusyStoreOrderId(storeOrderId);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrderId}/cancel`, {});
      setOrder(res.data);
    } catch (err: any) {
      console.warn('Could not cancel store order:', err);
      Alert.alert('Could not cancel', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setBusyStoreOrderId(null);
    }
  };

  // Marking a cash order received also records that the cash changed hands
  // (it lands on the farmer's payout ledger), so confirm before doing it.
  const confirmMarkReceived = (storeOrder: StoreOrder) => {
    if (order?.payment?.payment_method !== 'cash_on_pickup') {
      markReceived(storeOrder.id);
      return;
    }
    Alert.alert(
      'Picked up and paid?',
      `Confirm you picked up your ${storeOrder.farm_name} order and paid $${storeOrder.total.toFixed(2)} in cash.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Yes, received', onPress: () => markReceived(storeOrder.id) },
      ]
    );
  };

  const markReceived = async (storeOrderId: string) => {
    if (!order) return;
    setBusyStoreOrderId(storeOrderId);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrderId}/complete`, {});
      setOrder(res.data);
    } catch (err: any) {
      console.warn('Could not mark order received:', err);
      Alert.alert('Could not update order', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setBusyStoreOrderId(null);
    }
  };

  const rateStore = async (storeOrderId: string, rating: number) => {
    if (!order) return;
    setRatingStoreOrderId(storeOrderId);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrderId}/rating`, { rating });
      setOrder(res.data);
    } catch (err: any) {
      console.warn('Could not submit rating:', err);
      Alert.alert('Could not submit rating', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setRatingStoreOrderId(null);
    }
  };

  const confirmCancelWholeOrder = () => {
    Alert.alert(
      'Cancel this whole order?',
      'Every farm still in progress on this order will be cancelled, and anything already paid will be refunded.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel everything', style: 'destructive', onPress: cancelWholeOrder },
      ]
    );
  };

  const cancelWholeOrder = async () => {
    if (!order) return;
    setCancellingOrder(true);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/cancel`, {});
      setOrder(res.data);
    } catch (err: any) {
      console.warn('Could not cancel order:', err);
      Alert.alert('Could not cancel', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setCancellingOrder(false);
    }
  };

  if (loading && !order) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Order not found.'}</Text>
      </View>
    );
  }

  const hasCancellableStore = order.store_orders.some(
    (so) => so.status === 'pending_payment' || so.status === 'paid' || so.status === 'ready_for_pickup'
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Order Details</Text>
        <View style={styles.back} />
      </View>

      <FlatList
        data={order.store_orders}
        keyExtractor={(so) => so.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <>
            {justPlaced === '1' ? (
              <View style={styles.successBanner}>
                <MaterialIcons name="check-circle" size={22} color={colors.primary} />
                <Text style={styles.successText}>Order placed! Here&apos;s your confirmation.</Text>
              </View>
            ) : null}
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>Placed {new Date(order.placed_at).toLocaleString()}</Text>
              <Text style={styles.summaryTotal}>
                {order.payment?.charged_at_cutoff && !paymentSettled(order.payment.status) ? 'Up to ' : ''}${order.grand_total.toFixed(2)}
              </Text>
              {order.payment ? (
                <Text style={styles.summaryPayment}>
                  {order.payment.charged_at_cutoff && !paymentSettled(order.payment.status)
                    ? 'Card charged when orders close'
                    : `${order.payment.payment_method === 'cash_on_pickup' ? 'Cash on pickup' : 'Paid by card'} · ${order.payment.status}`}
                </Text>
              ) : null}
            </View>
          </>
        }
        renderItem={({ item: storeOrder }) => (
          <OrderStoreSection
            orderId={order.id}
            storeOrder={storeOrder}
            paysAtPickup={order.payment?.payment_method === 'cash_on_pickup'}
            busy={busyStoreOrderId === storeOrder.id}
            onCancel={() => confirmCancelStore(storeOrder.id, storeOrder.farm_name)}
            onMarkReceived={() => confirmMarkReceived(storeOrder)}
            onRate={(rating) => rateStore(storeOrder.id, rating)}
            ratingBusy={ratingStoreOrderId === storeOrder.id}
            onDeliveryUpdate={loadOrder}
          />
        )}
        ListFooterComponent={
          hasCancellableStore && order.store_orders.length > 1 ? (
            <Pressable style={styles.cancelWholeButton} onPress={confirmCancelWholeOrder} disabled={cancellingOrder}>
              {cancellingOrder ? (
                <ActivityIndicator size="small" color={colors.danger} />
              ) : (
                <Text style={styles.cancelWholeText}>Cancel Whole Order</Text>
              )}
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

// A pod order that has been charged, or never will be, reads like any other.
function paymentSettled(status: string): boolean {
  return status === 'succeeded' || status === 'canceled';
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
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  successBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tint,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  successText: { color: colors.primaryDark, fontSize: 14, fontWeight: '600', flex: 1 },
  summary: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  summaryLabel: { fontSize: 13, color: colors.textMuted },
  summaryTotal: { fontFamily: fonts.headlineBold, fontSize: 32, color: colors.text, marginTop: 2 },
  summaryPayment: { fontSize: 12, color: colors.textMuted, marginTop: 2, textTransform: 'capitalize' },
  cancelWholeButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.xs,
  },
  cancelWholeText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
