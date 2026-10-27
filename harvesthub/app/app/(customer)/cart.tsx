import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { useAuth } from '../../contexts/AuthContext';
import { useCheckoutDraft } from '../../contexts/CheckoutDraftContext';
import { CartFarmSection } from '../../components/customer/CartFarmSection';
import { isFulfillmentReady } from '../../types/checkout';
import type { CartActionResponse, CartSummary } from '../../types/database';
import type { FarmDeliveryOption } from '../../types/delivery';

export default function CartScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customerProfile } = useAuth();
  const { fulfillmentByFarm, ensureFarm, setMethod, setDeliverySlot } = useCheckoutDraft();

  const [cart, setCart] = useState<CartSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [deliveryByFarm, setDeliveryByFarm] = useState<Record<string, FarmDeliveryOption>>({});

  const loadCart = useCallback(() => {
    setLoading(true);
    apiClient
      .get<CartSummary>('/cart')
      .then((res) => {
        setCart(res.data);
        setError(null);
        // Seed a fulfillment draft for any farm we haven't seen yet — never
        // overwrites a choice the customer already made this session
        // (ensureFarm no-ops if one already exists).
        for (const farm of res.data.farms) {
          ensureFarm(farm.farmer_id);
        }
      })
      .catch((err) => {
        console.warn('Could not load cart:', err);
        setError("Couldn't load your cart. Pull down to try again.");
      })
      .finally(() => setLoading(false));
    // ensureFarm intentionally excluded — seeding only needs to happen once
    // per farm, not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Which farms deliver to this customer, and when. Re-asked when the farms
  // in the cart change, or the saved address does (Edit Profile).
  const farmIdsKey = (cart?.farms ?? []).map((f) => f.farmer_id).join(',');
  const addressKey = `${customerProfile?.address_street}|${customerProfile?.address_zip}`;
  useEffect(() => {
    if (!farmIdsKey) return;
    apiClient
      .get<{ farms: FarmDeliveryOption[] }>('/delivery/options', { params: { farmer_ids: farmIdsKey } })
      .then((res) => setDeliveryByFarm(Object.fromEntries(res.data.farms.map((f) => [f.farmer_id, f]))))
      .catch((err) => console.warn('Could not load delivery options:', err));
  }, [farmIdsKey, addressKey]);

  // A farm that can't deliver here anymore (address changed, window gone)
  // falls back to pickup rather than leaving a choice that can't be placed.
  useEffect(() => {
    for (const [farmerId, option] of Object.entries(deliveryByFarm)) {
      const draft = fulfillmentByFarm[farmerId];
      if (draft?.method !== 'delivery') continue;
      if (!option.available) setMethod(farmerId, 'pickup');
      else if (draft.deliverySlot && !option.slots.some((s) => s.starts_at === draft.deliverySlot)) setDeliverySlot(farmerId, null);
    }
  }, [deliveryByFarm, fulfillmentByFarm, setMethod, setDeliverySlot]);

  useFocusEffect(
    useCallback(() => {
      loadCart();
    }, [loadCart])
  );

  const applyCartAction = useCallback(
    async (
      productId: string,
      farmerId: string,
      request: () => Promise<{ data: CartActionResponse }>,
      optimisticQuantity: number
    ) => {
      if (pendingProductId) return;
      setPendingProductId(productId);
      setCart((prev) => optimisticUpdate(prev, farmerId, productId, optimisticQuantity));
      try {
        const res = await request();
        setCart((prev) => optimisticUpdate(prev, farmerId, productId, res.data.quantity));
      } catch (err) {
        console.warn('Cart update failed:', err);
        loadCart(); // reload from server truth on failure/conflict rather than guessing a rollback value
      } finally {
        setPendingProductId(null);
      }
    },
    [pendingProductId, loadCart]
  );

  const handleIncrement = (farmerId: string, productId: string, currentQty: number) =>
    applyCartAction(
      productId,
      farmerId,
      () => apiClient.post<CartActionResponse>(`/cart/items/${productId}/increment`),
      currentQty + 1
    );

  const handleDecrement = (farmerId: string, productId: string, currentQty: number) =>
    applyCartAction(
      productId,
      farmerId,
      () => apiClient.post<CartActionResponse>(`/cart/items/${productId}/decrement`),
      Math.max(0, currentQty - 1)
    );

  const handleRemove = (farmerId: string, productId: string) =>
    applyCartAction(productId, farmerId, () => apiClient.delete<CartActionResponse>(`/cart/items/${productId}`), 0);

  const readyForCheckout = useMemo(() => {
    if (!cart || cart.farms.length === 0) return false;
    return cart.farms.every((farm) => isFulfillmentReady(fulfillmentByFarm[farm.farmer_id]));
  }, [cart, fulfillmentByFarm]);

  const goToCheckout = (farmerIds: string[]) => {
    router.push({ pathname: '/(customer)/checkout', params: { farmerIds: JSON.stringify(farmerIds) } });
  };

  const handleCheckoutAtOnce = () => {
    if (!cart) return;
    goToCheckout(cart.farms.map((f) => f.farmer_id));
  };

  if (loading && !cart) {
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
        <Text style={styles.headerTitle}>Your Cart</Text>
        <View style={styles.back} />
      </View>

      <FlatList
        data={cart?.farms ?? []}
        keyExtractor={(farm) => farm.farmer_id}
        style={styles.list}
        contentContainerStyle={cart?.farms.length ? styles.listContent : styles.emptyContent}
        renderItem={({ item: farm }) => (
          <CartFarmSection
            group={farm}
            pendingProductId={pendingProductId}
            onIncrement={(productId) => {
              const item = farm.items.find((i) => i.product_id === productId);
              handleIncrement(farm.farmer_id, productId, item?.quantity ?? 0);
            }}
            onDecrement={(productId) => {
              const item = farm.items.find((i) => i.product_id === productId);
              handleDecrement(farm.farmer_id, productId, item?.quantity ?? 0);
            }}
            onRemove={(productId) => handleRemove(farm.farmer_id, productId)}
            method={fulfillmentByFarm[farm.farmer_id]?.method ?? null}
            onSelectMethod={(method) => setMethod(farm.farmer_id, method)}
            delivery={deliveryByFarm[farm.farmer_id] ?? null}
            deliverySlot={fulfillmentByFarm[farm.farmer_id]?.deliverySlot ?? null}
            onSelectDeliverySlot={(startsAt) => setDeliverySlot(farm.farmer_id, startsAt)}
            readyToPlaceSeparately={isFulfillmentReady(fulfillmentByFarm[farm.farmer_id])}
            onPlaceOrderSeparately={() => goToCheckout([farm.farmer_id])}
          />
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <MaterialIcons name="shopping-basket" size={40} color={colors.textMuted} />
            <Text style={styles.emptyText}>{error ?? 'Your cart is empty. Browse nearby farms to add items.'}</Text>
          </View>
        }
      />

      {cart && cart.farms.length > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.sm }]}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              {cart.item_count} item{cart.item_count === 1 ? '' : 's'} · {cart.farms.length} farm
              {cart.farms.length === 1 ? '' : 's'}
            </Text>
            <Text style={styles.totalValue}>${cart.total.toFixed(2)}</Text>
          </View>
          <Pressable
            style={[styles.checkoutButton, !readyForCheckout && styles.checkoutButtonDisabled]}
            onPress={handleCheckoutAtOnce}
            disabled={!readyForCheckout}
          >
            <Text style={styles.checkoutText}>
              {readyForCheckout ? 'Checkout at Once' : 'Choose pickup, or a delivery time, for each farm'}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function optimisticUpdate(cart: CartSummary | null, farmerId: string, productId: string, quantity: number): CartSummary | null {
  if (!cart) return cart;
  const farms = cart.farms
    .map((farm) => {
      if (farm.farmer_id !== farmerId) return farm;
      const items =
        quantity === 0
          ? farm.items.filter((i) => i.product_id !== productId)
          : farm.items.map((i) => (i.product_id === productId ? { ...i, quantity, line_total: round2(i.price * quantity) } : i));
      return { ...farm, items, subtotal: round2(items.reduce((sum, i) => sum + i.line_total, 0)) };
    })
    .filter((farm) => farm.items.length > 0);
  return {
    farms,
    total: round2(farms.reduce((sum, f) => sum + f.subtotal, 0)),
    item_count: farms.reduce((sum, f) => sum + f.items.reduce((s, i) => s + i.quantity, 0), 0),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
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
  listContent: { paddingTop: spacing.sm, paddingBottom: spacing.xl },
  emptyContent: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  footer: {
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  totalLabel: { fontSize: 13, color: colors.textMuted },
  totalValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  checkoutButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
  },
  checkoutButtonDisabled: { opacity: 0.4 },
  checkoutText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
