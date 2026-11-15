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
              onPress={() => setPaymentMethod('card')}
            />
            {/* Delivery orders are paid by card — cash only when everything is a pickup. */}
            {preview.groups.every((g) => g.fulfillment_method === 'pickup') ? (
              <PaymentOption
                icon="payments"
                label="Cash on Pickup"
                selected={paymentMethod === 'cash_on_pickup'}
                onPress={() => setPaymentMethod('cash_on_pickup')}
              />
            ) : null}
          </View>
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
          {podGroup?.charge_at ? (
            <View style={styles.notice}>
              <MaterialIcons name="schedule" size={16} color={colors.textMuted} />
              <Text style={styles.noticeText}>
                <Text style={styles.noticeBold}>Nothing is charged now.</Text> Orders close{' '}
                {new Date(podGroup.charge_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}. The
                delivery fee is then split among the members who ordered, and your saved card is charged once, for your exact total. You can
                cancel for free until then.
              </Text>
            </View>
          ) : null}
          <ContactSharingNotice farmNames={preview.groups.map((g) => g.farm_name)} paymentMethod={paymentMethod} chargedAtCutoff={Boolean(podGroup)} />
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
        </View>
      ) : null}
    </View>
  );
}

// Shown before the customer pays (decided with the user): exactly what is
// shared with the farm and when. The backend only releases it to the farmer
// once the order is fully placed — after a card payment succeeds, or at
// placement for cash on pickup (store_orders.released_to_farmer_at, 0025).
function ContactSharingNotice({
  farmNames,
  paymentMethod,
  chargedAtCutoff,
}: {
  farmNames: string[];
  paymentMethod: OrderPaymentMethod | null;
  chargedAtCutoff: boolean;
}) {
  const farms =
    farmNames.length <= 1
      ? farmNames[0] ?? 'the farm'
      : `${farmNames.slice(0, -1).join(', ')} and ${farmNames[farmNames.length - 1]}`;
  const when = chargedAtCutoff
    ? 'only after your card is charged, when orders close'
    : paymentMethod === 'card'
      ? 'only after your payment goes through'
      : paymentMethod === 'cash_on_pickup'
        ? 'as soon as you place the order'
        : 'only once your order is placed (after payment, for card orders)';
  return (
    <View style={styles.notice}>
      <MaterialIcons name="privacy-tip" size={16} color={colors.textMuted} />
      <Text style={styles.noticeText}>
        {farms} will receive your <Text style={styles.noticeBold}>full name and phone number</Text> (and, for delivery,
        your address) so they can reach you about your order — {when}. Nothing else is shared.
      </Text>
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
  notice: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginBottom: spacing.sm },
  noticeText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.textMuted },
  noticeBold: { fontWeight: '700', color: colors.text },
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
