import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { useCheckoutDraft } from '../../contexts/CheckoutDraftContext';
import { CheckoutFarmSection } from '../../components/customer/CheckoutFarmSection';
import { PassNote, passLine } from '../../components/customer/CartPassNote';
import { discardCheckout, useOrderPayment } from '../../lib/orderPayment';
import type { CheckoutPreviewResponse } from '../../types/checkout';
import type { MembershipOverview } from '../../types/membership';
import type { CreateOrderRequest, CreateOrderResponse, OrderPaymentMethod } from '../../types/orders';

export default function CheckoutScreen() {
  const { farmerIds: farmerIdsParam } = useLocalSearchParams<{ farmerIds: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fulfillmentByFarm } = useCheckoutDraft();
  const payForOrder = useOrderPayment();

  const farmerIds = useMemo<string[]>(() => {
    try {
      const parsed = JSON.parse(farmerIdsParam ?? '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [farmerIdsParam]);

  const [preview, setPreview] = useState<CheckoutPreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [promoInputs, setPromoInputs] = useState<Record<string, string>>({});
  const [appliedPromoCodes, setAppliedPromoCodes] = useState<Record<string, string>>({});
  const [applyingPromoFor, setApplyingPromoFor] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod | null>(null);
  // Paying at the farm takes the service fee off (2026-11-20): the totals
  // are priced for the chosen payment method.
  const paymentMethodRef = useRef<OrderPaymentMethod | null>(null);
  paymentMethodRef.current = paymentMethod;
  const [placingOrder, setPlacingOrder] = useState(false);
  const deliveryProblem = preview?.groups.find((g) => g.delivery_error)?.delivery_error ?? null;
  const canPlaceOrder = Boolean(paymentMethod) && !placingOrder && !deliveryProblem;
  // A pod order saves a card, and is charged once at the farm's cutoff.
  const podGroup = preview?.groups.find((g) => g.pod_id) ?? null;

  const loadPreview = useCallback(
    (promoOverrides: Record<string, string> = appliedPromoCodes) => {
      if (farmerIds.length === 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      apiClient
        .post<CheckoutPreviewResponse>('/checkout/preview', {
          groups: farmerIds.map((farmerId) => ({
            farmer_id: farmerId,
            fulfillment_method: fulfillmentByFarm[farmerId]?.method ?? 'pickup',
            promo_code: promoOverrides[farmerId] ?? null,
            delivery_starts_at: fulfillmentByFarm[farmerId]?.deliverySlot ?? null,
            pod_id: fulfillmentByFarm[farmerId]?.method === 'delivery' ? (fulfillmentByFarm[farmerId]?.podId ?? null) : null,
          })),
          payment_method: paymentMethodRef.current ?? 'card',
        })
        .then((res) => {
          setPreview(res.data);
          setError(null);
        })
        .catch((err) => {
          console.warn('Could not load checkout preview:', err);
          setError("Couldn't load your order summary. Pull to try again.");
        })
        .finally(() => {
          setLoading(false);
          setApplyingPromoFor(null);
        });
    },
    // farmerIds/fulfillmentByFarm intentionally excluded from deps beyond
    // the initial load — re-running this only happens explicitly (promo
    // apply), not on every context render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    loadPreview({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether the free month is still on offer, for the Harvest Pass line.
  const [pass, setPass] = useState<MembershipOverview | null>(null);
  const loadPass = useCallback(() => {
    apiClient.get<MembershipOverview>('/membership').then(
      (res) => setPass(res.data),
      (err) => console.warn('Could not load Harvest Pass status:', err)
    );
  }, []);
  useEffect(loadPass, [loadPass]);

  // Joining Harvest Pass from the checkout upsell changes the fees — reprice
  // when the customer comes back (keeping any promo codes they applied).
  const appliedPromoCodesRef = useRef(appliedPromoCodes);
  appliedPromoCodesRef.current = appliedPromoCodes;
  const repriceOnFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (repriceOnFocus.current) {
        repriceOnFocus.current = false;
        loadPreview(appliedPromoCodesRef.current);
        loadPass();
      }
    }, [loadPreview, loadPass])
  );
  const openHarvestPass = () => {
    repriceOnFocus.current = true;
    router.push('/(customer)/harvest-pass');
  };

  const choosePaymentMethod = (method: OrderPaymentMethod) => {
    if (method === paymentMethod) return;
    paymentMethodRef.current = method;
    setPaymentMethod(method);
    loadPreview(appliedPromoCodes);
  };

  const handleApplyPromo = (farmerId: string) => {
    const code = (promoInputs[farmerId] ?? '').trim();
    if (!code) return;
    setApplyingPromoFor(farmerId);
    const nextCodes = { ...appliedPromoCodes, [farmerId]: code };
    setAppliedPromoCodes(nextCodes);
    loadPreview(nextCodes);
  };

  const buildOrderRequest = (): CreateOrderRequest => ({
    payment_method: paymentMethod!,
    groups: farmerIds.map((farmerId) => {
      const fulfillment = fulfillmentByFarm[farmerId];
      return {
        farmer_id: farmerId,
        fulfillment_method: fulfillment?.method ?? 'pickup',
        delivery_starts_at: fulfillment?.method === 'delivery' ? fulfillment.deliverySlot : null,
        pod_id: fulfillment?.method === 'delivery' ? fulfillment.podId : null,
        promo_code: appliedPromoCodes[farmerId] ?? null,
      };
    }),
  });

  const handlePlaceOrder = async () => {
    if (!paymentMethod || placingOrder) return;
    setPlacingOrder(true);
    try {
      const res = await apiClient.post<CreateOrderResponse>('/orders', buildOrderRequest());
      const { order, client_secret } = res.data;

      const showOrder = (id: string) => router.replace({ pathname: '/(customer)/orders/[id]', params: { id, justPlaced: '1' } });
      if (paymentMethod === 'cash_on_pickup' || !client_secret) {
        showOrder(order.id);
        return;
      }

      const result = await payForOrder(order.id, client_secret, Boolean(order.payment?.charged_at_cutoff));
      if (result === 'paid') {
        showOrder(order.id);
        return;
      }
      if (result === 'not_paid') {
        // Closed without paying: no order (2026-11-14). It's removed, so it
        // isn't counted as an order or a cancellation, and the cart is as it
        // was. Unless it turns out it was paid after all.
        const placed = await discardCheckout(order.id);
        if (placed) showOrder(placed.id);
      }
    } catch (err: any) {
      console.warn('Could not place order:', err);
      Alert.alert('Could not place order', err?.response?.data?.detail ?? 'Please try again.');
    } finally {
      setPlacingOrder(false);
    }
  };

  if (loading && !preview) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Checkout</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          preview?.groups.map((group) => (
            <CheckoutFarmSection
              key={group.farmer_id}
              group={group}
              promoCodeInput={promoInputs[group.farmer_id] ?? ''}
              onChangePromoCodeInput={(value) => setPromoInputs((prev) => ({ ...prev, [group.farmer_id]: value }))}
              onApplyPromo={() => handleApplyPromo(group.farmer_id)}
              applyingPromo={applyingPromoFor === group.farmer_id}
            />
          ))
        )}

        {preview && preview.groups.length > 0 ? (
          <PassNote message={checkoutPassMessage(preview, pass)} onPress={openHarvestPass} style={styles.passNote} />
        ) : null}

        {preview && preview.groups.length > 0 ? (
          <View style={styles.paymentSection}>
            <Text style={styles.paymentTitle}>Payment method</Text>
            <PaymentOption
              icon="credit-card"
              label={podGroup ? 'Card, charged when orders close' : Platform.OS === 'ios' ? 'Card or Apple Pay' : 'Card or Google Pay'}
              selected={paymentMethod === 'card'}
              onPress={() => choosePaymentMethod('card')}
            />
            {/* Delivery orders are paid by card — cash only when everything is a pickup. */}
            {preview.groups.every((g) => g.fulfillment_method === 'pickup') ? (
              preview.cash_allowed === false ? (
                <View style={[styles.paymentOption, styles.paymentOptionOff]}>
                  <MaterialIcons name="payments" size={20} color={colors.textMuted} />
                  <Text style={[styles.paymentOptionLabel, styles.paymentOptionOffText]}>
                    Cash at pickup isn&apos;t available. {preview.cash_blocked_reason}
                  </Text>
                </View>
              ) : (
                <PaymentOption
                  icon="payments"
                  label="Cash at pickup · no service fee"
                  selected={paymentMethod === 'cash_on_pickup'}
                  onPress={() => choosePaymentMethod('cash_on_pickup')}
                />
              )
            ) : null}
          </View>
        ) : null}

        {preview && preview.groups.length > 0 ? (
          <GoodToKnow
            farmNames={preview.groups.map((g) => g.farm_name)}
            pickup={preview.groups.some((g) => g.fulfillment_method === 'pickup')}
            delivery={preview.groups.some((g) => g.fulfillment_method === 'delivery')}
            cash={paymentMethod === 'cash_on_pickup'}
            serviceFee={preview.groups.reduce((sum, g) => sum + g.service_fee, 0)}
            podChargeAt={podGroup?.charge_at ?? null}
          />
        ) : null}
      </ScrollView>

      {preview && preview.groups.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {podGroup ? 'The most you\'d pay' : `${preview.groups.length} order${preview.groups.length === 1 ? '' : 's'} · Grand total`}
            </Text>
            <Text style={styles.totalValue}>${preview.grand_total.toFixed(2)}</Text>
          </View>
          <Pressable
            style={[styles.placeOrderButton, !canPlaceOrder && styles.placeOrderButtonDisabled]}
            onPress={handlePlaceOrder}
            disabled={!canPlaceOrder}
          >
            {placingOrder ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.placeOrderText}>
                {deliveryProblem ? 'Fix the delivery above' : !paymentMethod ? 'Select a payment method' : podGroup ? 'Place Order, Pay Later' : 'Place Order'}
              </Text>
            )}
          </Pressable>
          <Text style={styles.agree}>
            By ordering, you agree to the rules above and our{' '}
            <Text style={styles.agreeLink} onPress={() => router.push('/(customer)/legal')}>
              Terms
            </Text>
            .
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// "Good to know" (2026-11-21, replacing two long notices in the fixed footer
// that took a third of the screen): only what matters before paying, one short
// line each, in the page rather than the footer. Agreed to by the line under
// the button; it's what HarvestHub relies on if a payment is disputed:
// - pickup within 3 hours of "ready" (the extra hour is offered later, when
//   it's needed, not promised here);
// - a missed card pickup isn't refunded, nor the service fee on a cancel;
// - what the farm gets, and when. The backend only releases it once the
//   order is placed: after a card payment succeeds, at placement for cash
//   (store_orders.released_to_farmer_at, 0025).
function GoodToKnow({
  farmNames,
  pickup,
  delivery,
  cash,
  serviceFee,
  podChargeAt,
}: {
  farmNames: string[];
  pickup: boolean;
  delivery: boolean;
  cash: boolean;
  serviceFee: number;
  podChargeAt: string | null;
}) {
  const farms =
    farmNames.length <= 1 ? farmNames[0] ?? 'The farm' : `${farmNames.slice(0, -1).join(', ')} and ${farmNames[farmNames.length - 1]}`;
  const shared = delivery ? 'your name, phone and address' : 'your name and phone';
  const when = podChargeAt ? 'when your card is charged' : cash ? 'when you place the order' : 'after you pay';
  const noRefund = [
    pickup && !cash ? "missed pickups aren't refunded" : null,
    !cash && serviceFee > 0 ? "the service fee isn't refunded if you cancel" : null,
  ].filter(Boolean) as string[];
  const rows: { icon: React.ComponentProps<typeof MaterialIcons>['name']; text: string }[] = [
    ...(podChargeAt
      ? [
          {
            icon: 'schedule' as const,
            text: `Nothing is charged now. When orders close (${new Date(podChargeAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}), the delivery fee is shared and your card is charged once. Free to cancel until then.`,
          },
        ]
      : []),
    ...(pickup ? [{ icon: 'storefront' as const, text: "Pick up within 3 hours once the farm says it's ready." }] : []),
    ...(noRefund.length > 0
      ? [{ icon: 'undo' as const, text: `${noRefund.join(', and ').replace(/^./, (c) => c.toUpperCase())}.` }]
      : []),
    { icon: 'person-outline' as const, text: `${farms} gets ${shared} ${when}.` },
  ];
  return (
    <View style={styles.goodToKnow}>
      <Text style={styles.goodToKnowTitle}>Good to know</Text>
      {rows.map((row) => (
        <View key={row.text} style={styles.goodToKnowRow}>
          <MaterialIcons name={row.icon} size={16} color={colors.primary} />
          <Text style={styles.goodToKnowText}>{row.text}</Text>
        </View>
      ))}
    </View>
  );
}

// The same Harvest Pass line as the cart's (2026-11-14), right under the farm
// total, with this checkout's exact figures: what the Pass saves here, or how
// much more to add for it.
function checkoutPassMessage(preview: CheckoutPreviewResponse, pass: MembershipOverview | null) {
  const min = preview.member_min_subtotal;
  return passLine({
    isMember: preview.is_member,
    min,
    short: Math.round((min - preview.items_subtotal) * 100) / 100,
    fee: preview.is_member ? preview.member_savings : preview.member_potential_savings,
    freeDays: pass?.free_period_available ? pass.free_days : null,
  });
}

function PaymentOption({
  icon,
  label,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={[styles.paymentOption, selected && styles.paymentOptionSelected]} onPress={onPress}>
      <MaterialIcons name={icon} size={20} color={selected ? colors.primary : colors.textMuted} />
      <Text style={[styles.paymentOptionLabel, selected && styles.paymentOptionLabelSelected]}>{label}</Text>
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={20}
        color={selected ? colors.primary : colors.border}
      />
    </Pressable>
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
  scrollContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  paymentSection: { marginHorizontal: spacing.lg, marginTop: spacing.lg },
  passNote: { marginHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: 0 },
  paymentTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginBottom: spacing.sm },
  paymentOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  paymentOptionSelected: { borderColor: colors.primary, backgroundColor: colors.tint },
  paymentOptionLabel: { flex: 1, fontSize: 14, color: colors.text },
  paymentOptionOff: { opacity: 0.7 },
  paymentOptionOffText: { fontSize: 12.5, color: colors.textMuted },
  paymentOptionLabelSelected: { fontWeight: '700' },
  footer: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  totalLabel: { fontSize: 13, color: colors.textMuted },
  goodToKnow: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: 6,
  },
  goodToKnowTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  goodToKnowRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  goodToKnowText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.text },
  agree: { fontSize: 11.5, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  agreeLink: { color: colors.primary, fontWeight: '600', textDecorationLine: 'underline' },
  totalValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  placeOrderButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  placeOrderButtonDisabled: { opacity: 0.4 },
  placeOrderText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
