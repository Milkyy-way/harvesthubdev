import { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { discardCheckout, useOrderPayment } from '../../../lib/orderPayment';
import { OrderStoreSection } from '../../../components/customer/OrderStoreSection';
import { OrderPassNote } from '../../../components/customer/OrderPassNote';
import { ReportProblemSheet, type ProblemSubmission } from '../../../components/customer/ReportProblemSheet';
import type { MembershipOverview } from '../../../types/membership';
import type { Order, ResumePaymentResponse, StoreOrder } from '../../../types/orders';

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
  const [reporting, setReporting] = useState<StoreOrder | null>(null);
  const [sendingReport, setSendingReport] = useState(false);
  const payForOrder = useOrderPayment();
  const [paying, setPaying] = useState(false);

  // Right after ordering: Harvest Pass status, for the "saved you" line.
  const [pass, setPass] = useState<MembershipOverview | null>(null);
  useEffect(() => {
    if (justPlaced !== '1') return;
    apiClient.get<MembershipOverview>('/membership').then(
      (res) => setPass(res.data),
      (err) => console.warn('Could not load Harvest Pass status:', err)
    );
  }, [justPlaced]);

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
    // What comes back is the server's sum (2026-11-20): everything except the
    // service fee, or all of it when the farm didn't pack it within a day.
    const refund = storeOrder.cancel_refund ?? 0;
    const money =
      refund > 0
        ? `You'll get $${refund.toFixed(2)} back on your card${
            storeOrder.cancel_keeps_service_fee ? `. The $${storeOrder.service_fee.toFixed(2)} service fee isn't refunded` : ''
          }. Refunds usually show in 5–10 business days.`
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

  // The farm hands the order over with the customer's code (2026-11-20), so
  // there's no "Mark as received" any more. One extra hour, once.
  const extendPickup = (storeOrder: StoreOrder) => {
    Alert.alert('Add 1 hour?', "You can do this once. The farm will see you're coming a little later.", [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Add 1 hour',
        onPress: async () => {
          if (!order) return;
          setBusyStoreOrderId(storeOrder.id);
          try {
            const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrder.id}/extend-pickup`, {});
            setOrder(res.data);
          } catch (err) {
            Alert.alert("Couldn't add the hour", apiErrorMessage(err, 'Please try again.'));
          } finally {
            setBusyStoreOrderId(null);
          }
        },
      },
    ]);
  };

  // A cash order the app marked "not picked": did they collect it after all?
  const answerCollected = async (storeOrder: StoreOrder, collected: boolean) => {
    if (!order) return;
    setBusyStoreOrderId(storeOrder.id);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${storeOrder.id}/collected`, { collected });
      setOrder(res.data);
      if (collected) Alert.alert('Thanks for telling us', "We'll check with the farm. This won't count as a missed pickup.");
    } catch (err) {
      Alert.alert("Couldn't send that", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusyStoreOrderId(null);
    }
  };

  const sendReport = async (report: ProblemSubmission) => {
    if (!order || !reporting) return;
    setSendingReport(true);
    try {
      const res = await apiClient.post<Order>(`/orders/${order.id}/store/${reporting.id}/problem`, report);
      setOrder(res.data);
      setReporting(null);
      Alert.alert('Report sent', "Thanks for telling us. We'll get back to you within 2 business days.");
    } catch (err) {
      Alert.alert("Couldn't send your report", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSendingReport(false);
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

  // A checkout left at the payment sheet (2026-11-14): pay for it now, as at
  // checkout, or remove it. It isn't an order until it's paid.
  const payNow = async () => {
    if (!order || paying) return;
    setPaying(true);
    try {
      const res = await apiClient.post<ResumePaymentResponse>(`/orders/${order.id}/resume-payment`);
      const { client_secret, card_setup } = res.data;
      const result = client_secret ? await payForOrder(order.id, client_secret, card_setup) : 'paid';
      if (result === 'paid') {
        router.replace({ pathname: '/(customer)/orders/[id]', params: { id: order.id, justPlaced: '1' } });
        return;
      }
      loadOrder();
    } catch (err) {
      Alert.alert("Can't pay for this one", apiErrorMessage(err, 'Please try again.'));
      loadOrder();
    } finally {
      setPaying(false);
    }
  };

  const confirmRemove = () => {
    Alert.alert('Remove this order?', "You haven't paid for it, so nothing is charged. What you picked stays in your cart.", [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          if (!order) return;
          setPaying(true);
          const placed = await discardCheckout(order.id);
          setPaying(false);
          if (placed) setOrder(placed);
          else router.back();
        },
      },
    ]);
  };

  const confirmCancelWholeOrder = () => {
    const refund = order ? order.store_orders.reduce((sum, so) => sum + (so.can_cancel ? so.cancel_refund ?? 0 : 0), 0) : 0;
    Alert.alert(
      'Cancel this whole order?',
      refund > 0
        ? `Every farm on this order will be cancelled. You'll get $${refund.toFixed(2)} back on your card; service fees aren't refunded.`
        : 'Every farm on this order will be cancelled. Nothing has been charged.',
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

  const unfinished = Boolean(order.checkout_unfinished);
  const processing = order.payment?.status === 'processing';
  // The whole order can go only when every farm still open can be cancelled.
  const openStores = order.store_orders.filter((so) => !['completed', 'not_picked', 'cancelled'].includes(so.status));
  const hasCancellableStore =
    !unfinished &&
    !processing &&
    openStores.length > 1 &&
    openStores.every((so) => so.can_cancel ?? (so.status === 'pending_payment' || so.status === 'paid'));

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
            {justPlaced === '1' ? <OrderPassNote order={order} pass={pass} /> : null}
            {unfinished ? (
              <UnpaidCard order={order} paying={paying} onPay={payNow} onRemove={confirmRemove} />
            ) : null}
            {order.removed ? (
              <View style={styles.unpaidCard}>
                <Text style={styles.unpaidTitle}>Removed</Text>
                <Text style={styles.unpaidText}>This order wasn&apos;t paid for, so it was removed. Nothing was charged.</Text>
              </View>
            ) : null}
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>
                {unfinished ? 'Checkout started' : 'Placed'} {new Date(order.placed_at).toLocaleString()}
              </Text>
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
            checkoutUnfinished={unfinished}
            busy={busyStoreOrderId === storeOrder.id}
            onCancel={() => confirmCancelStore(storeOrder)}
            onExtendPickup={() => extendPickup(storeOrder)}
            onReportProblem={() => setReporting(storeOrder)}
            onAnswerCollected={(collected) => answerCollected(storeOrder, collected)}
            onRate={(rating, comment) => rateStore(storeOrder.id, rating, comment)}
            ratingBusy={ratingStoreOrderId === storeOrder.id}
            onDeliveryUpdate={loadOrder}
          />
        )}
        ListFooterComponent={
          hasCancellableStore ? (
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
      <ReportProblemSheet storeOrder={reporting} submitting={sendingReport} onClose={() => setReporting(null)} onSubmit={sendReport} />
    </View>
  );
}

// Not paid for: the farm hasn't seen it and nothing was charged. Pay now, as at
// checkout, or remove it; after pay_by it's removed for you.
function UnpaidCard({ order, paying, onPay, onRemove }: { order: Order; paying: boolean; onPay: () => void; onRemove: () => void }) {
  const podOrder = Boolean(order.payment?.charged_at_cutoff);
  const by = order.pay_by ? new Date(order.pay_by).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const farms = order.store_orders.filter((so) => so.status === 'pending_payment').map((so) => so.farm_name);
  return (
    <View style={styles.unpaidCard}>
      <Text style={styles.unpaidTitle}>{podOrder ? 'Card not saved yet' : 'Not paid yet'}</Text>
      <Text style={styles.unpaidText}>
        {podOrder ? 'Save a card to place this order' : 'Your payment wasn\'t finished, so this order isn\'t placed'}.{' '}
        {farms.join(' and ') || 'The farm'} can&apos;t see it yet, and nothing has been charged.
        {by ? ` Finish by ${by}, or it's removed.` : ''}
      </Text>
      <Pressable style={[styles.payButton, paying && styles.payButtonBusy]} onPress={onPay} disabled={paying}>
        {paying ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Text style={styles.payButtonText}>{podOrder ? 'Save card and place order' : `Pay $${order.grand_total.toFixed(2)}`}</Text>
        )}
      </Pressable>
      <Pressable style={styles.removeButton} onPress={onRemove} disabled={paying} hitSlop={8}>
        <Text style={styles.removeText}>Remove it</Text>
      </Pressable>
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
  unpaidCard: {
    backgroundColor: colors.tint,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
  },
  unpaidTitle: { fontFamily: fonts.headlineBold, fontSize: 18, color: colors.text },
  unpaidText: { fontSize: 13, lineHeight: 19, color: colors.text, marginTop: 4 },
  payButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  payButtonBusy: { opacity: 0.6 },
  payButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  removeButton: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  removeText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
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
