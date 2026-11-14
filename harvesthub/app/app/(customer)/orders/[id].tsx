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

  const confirmCancelStore = (storeOrder: StoreOrder) => {
    const payment = order?.payment;
    const paidByCard =
      payment?.payment_method === 'card' && ['paid', 'ready_for_pickup'].includes(storeOrder.status) && payment.status === 'succeeded';
    const money = paidByCard
      ? `You'll get $${storeOrder.total.toFixed(2)} back on your card. Refunds usually show in 5–10 business days.`
      : payment?.payment_method === 'cash_on_pickup'
        ? "Nothing has been charged: you'd have paid in cash at pickup."
        : "You haven't been charged for it.";
    Alert.alert(`Cancel your ${storeOrder.farm_name} order?`, money, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel order', style: 'destructive', onPress: () => cancelStore(storeOrder.id) },
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
      Alert.alert(
        'Picked up your order?',
        `Only confirm once you have your ${storeOrder.farm_name} order. It can't be cancelled after this.`,
        [
          { text: 'Not yet', style: 'cancel' },
          { text: 'Yes, I have it', onPress: () => markReceived(storeOrder.id) },
        ]
      );
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

  const rateStore = async (storeOrderId: string, rating: number, comment?: string): Promise<boolean> => {
    if (!order) return false;
    setRatingStoreOrderId(storeOrderId);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrderId}/rating`, { rating, comment: comment || undefined });
      setOrder(res.data);
      return true;
    } catch (err: any) {
      console.warn('Could not submit rating:', err);
      Alert.alert('Could not submit rating', err?.response?.data?.detail ?? 'Please try again.');
      return false;
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
                    : paymentLine(order)}
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
            paymentStatus={order.payment?.status}
            paymentFailure={order.payment?.failure_reason}
            busy={busyStoreOrderId === storeOrder.id}
            onCancel={() => confirmCancelStore(storeOrder)}
            onMarkReceived={() => confirmMarkReceived(storeOrder)}
            onRate={(rating, comment) => rateStore(storeOrder.id, rating, comment)}
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
// "Paid by card", "Refunded $3.68 to your card", "Paid by card · $5.00 refunded"...
function paymentLine(order: Order): string {
  const payment = order.payment!;
  if (payment.payment_method === 'cash_on_pickup') {
    return payment.status === 'succeeded' ? 'Paid in cash at pickup' : payment.status === 'canceled' ? 'Cancelled' : 'Cash on pickup';
  }
  const refunded = order.store_orders.reduce((sum, so) => sum + so.refunded_amount, 0);
  if (refunded > 0) {
    return refunded >= payment.amount - 0.005
      ? `Refunded $${refunded.toFixed(2)} to your card`
      : `Paid by card · $${refunded.toFixed(2)} refunded`;
  }
  switch (payment.status) {
    case 'succeeded':
      return 'Paid by card';
    case 'processing':
      return 'Card payment processing';
    case 'canceled':
      return 'Payment cancelled';
    case 'charge_failed':
      return 'Card declined';
    default:
      return 'Not paid yet';
  }
}

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
  summaryPayment: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
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
