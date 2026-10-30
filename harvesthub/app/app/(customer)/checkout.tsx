import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable, Alert, Platform, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { useCheckoutDraft } from '../../contexts/CheckoutDraftContext';
import { CheckoutFarmSection } from '../../components/customer/CheckoutFarmSection';
import type { CheckoutPreviewResponse } from '../../types/checkout';
import type { CreateOrderRequest, CreateOrderResponse, OrderPaymentMethod } from '../../types/orders';

export default function CheckoutScreen() {
  const { farmerIds: farmerIdsParam } = useLocalSearchParams<{ farmerIds: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fulfillmentByFarm } = useCheckoutDraft();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

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
      }
    }, [loadPreview])
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

      if (paymentMethod === 'cash_on_pickup' || !client_secret) {
        router.replace({ pathname: '/(customer)/orders/[id]', params: { id: order.id, justPlaced: '1' } });
        return;
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'HarvestHub',
        paymentIntentClientSecret: client_secret,
        // Stripe only offers these on phones set up for them. Still a card
        // payment as far as the order is concerned.
        applePay: { merchantCountryCode: 'US' },
        googlePay: {
          merchantCountryCode: 'US',
          currencyCode: 'USD',
          testEnv: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_'),
        },
      });
      if (initError) {
        Alert.alert('Could not start payment', initError.message);
        return;
      }

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Payment not completed', presentError.message);
        }
        return;
      }

      // Immediate best-effort reconciliation for a snappy UI — the Stripe
      // webhook (app/webhooks/router.py) is the authoritative source and
      // will confirm this independently even if this call fails.
      try {
        await apiClient.post(`/orders/${order.id}/sync-payment-status`);
      } catch (err) {
        console.warn('Could not sync payment status immediately (webhook will still confirm it):', err);
      }

      router.replace({ pathname: '/(customer)/orders/[id]', params: { id: order.id, justPlaced: '1' } });
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

        {preview && preview.groups.length > 0 ? <HarvestPassNote preview={preview} onPress={openHarvestPass} /> : null}

        {preview && preview.groups.length > 0 ? (
          <View style={styles.paymentSection}>
            <Text style={styles.paymentTitle}>Payment method</Text>
            <PaymentOption
              icon="credit-card"
              label={Platform.OS === 'ios' ? 'Card or Apple Pay' : 'Card or Google Pay'}
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
              {preview.groups.length} order{preview.groups.length === 1 ? '' : 's'} · Grand total
            </Text>
            <Text style={styles.totalValue}>${preview.grand_total.toFixed(2)}</Text>
          </View>
          <ContactSharingNotice farmNames={preview.groups.map((g) => g.farm_name)} paymentMethod={paymentMethod} />
          <Pressable
            style={[styles.placeOrderButton, !canPlaceOrder && styles.placeOrderButtonDisabled]}
            onPress={handlePlaceOrder}
            disabled={!canPlaceOrder}
          >
            {placingOrder ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.placeOrderText}>
                {deliveryProblem ? 'Fix the delivery above' : paymentMethod ? 'Place Order' : 'Select a payment method'}
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
function ContactSharingNotice({ farmNames, paymentMethod }: { farmNames: string[]; paymentMethod: OrderPaymentMethod | null }) {
  const farms =
    farmNames.length <= 1
      ? farmNames[0] ?? 'the farm'
      : `${farmNames.slice(0, -1).join(', ')} and ${farmNames[farmNames.length - 1]}`;
  const when =
    paymentMethod === 'card'
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

// Members: what Harvest Pass saved here, or how much more to add to get the
// free service fee. Non-members: what Harvest Pass would save on this order.
function HarvestPassNote({ preview, onPress }: { preview: CheckoutPreviewResponse; onPress: () => void }) {
  const min = preview.member_min_subtotal;
  if (preview.is_member) {
    if (preview.member_savings > 0) {
      return (
        <View style={styles.passNote}>
          <Text style={styles.passEmoji}>🌾</Text>
          <Text style={styles.passText}>
            <Text style={styles.passBold}>Harvest Pass</Text> — no service fee on this order. You&apos;re saving $
            {preview.member_savings.toFixed(2)}.
          </Text>
        </View>
      );
    }
    const short = Math.max(min - preview.items_subtotal, 0);
    if (short <= 0) return null;
    return (
      <View style={styles.passNote}>
        <Text style={styles.passEmoji}>🌾</Text>
        <Text style={styles.passText}>
          Add <Text style={styles.passBold}>${short.toFixed(2)}</Text> more to skip the service fee with Harvest Pass (orders of $
          {min.toFixed(0)}+).
        </Text>
      </View>
    );
  }
  if (preview.member_potential_savings <= 0) return null;
  return (
    <Pressable style={({ pressed }) => [styles.passNote, styles.passNoteUpsell, pressed && styles.passPressed]} onPress={onPress}>
      <Text style={styles.passEmoji}>🌾</Text>
      <Text style={styles.passText}>
        Save <Text style={styles.passBold}>${preview.member_potential_savings.toFixed(2)}</Text> on this order with{' '}
        <Text style={styles.passBold}>Harvest Pass</Text> — no service fee on orders of ${min.toFixed(0)}+.
      </Text>
      <MaterialIcons name="chevron-right" size={20} color={colors.primaryDark} />
    </Pressable>
  );
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
  passNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.tint,
  },
  passNoteUpsell: { backgroundColor: `${colors.accent}2E` },
  passPressed: { opacity: 0.8 },
  passEmoji: { fontSize: 22 },
  passText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text },
  passBold: { fontWeight: '700', color: colors.primaryDark },
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
