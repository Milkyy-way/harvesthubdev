import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { openDirections } from '../../lib/maps';
import { CartLineItemRow } from './CartLineItemRow';
import { FulfillmentSelector } from './FulfillmentSelector';
import type { CartFarmGroup } from '../../types/database';
import type { FulfillmentMethod } from '../../types/checkout';
import type { FarmDeliveryOption } from '../../types/delivery';

type Props = {
  group: CartFarmGroup;
  pendingProductId: string | null;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  method: FulfillmentMethod | null;
  onSelectMethod: (method: FulfillmentMethod) => void;
  delivery: FarmDeliveryOption | null;
  deliverySlot: string | null;
  onSelectDeliverySlot: (startsAt: string) => void;
  readyToPlaceSeparately: boolean;
  onPlaceOrderSeparately: () => void;
};

export function CartFarmSection({
  group,
  pendingProductId,
  onIncrement,
  onDecrement,
  onRemove,
  method,
  onSelectMethod,
  delivery,
  deliverySlot,
  onSelectDeliverySlot,
  readyToPlaceSeparately,
  onPlaceOrderSeparately,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const showPhoto = Boolean(group.photo_url) && !imageFailed;

  const pickupAddressLine = [group.address_street, group.address_city, group.address_state, group.address_zip]
    .filter(Boolean)
    .join(', ') || null;

  const handleDirections = () => {
    if (group.latitude !== null && group.longitude !== null) {
      openDirections(group.latitude, group.longitude, group.farm_name);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        {showPhoto ? (
          <Image
            source={{ uri: group.photo_url! }}
            style={styles.photo}
            contentFit="cover"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <MaterialIcons name="storefront" size={20} color={colors.primaryMid} />
          </View>
        )}
        <Text style={styles.farmName} numberOfLines={1}>
          {group.farm_name}
        </Text>
      </View>

      <View style={styles.items}>
        {group.items.map((item) => (
          <CartLineItemRow
            key={item.product_id}
            item={item}
            pending={pendingProductId === item.product_id}
            onIncrement={() => onIncrement(item.product_id)}
            onDecrement={() => onDecrement(item.product_id)}
            onRemove={() => onRemove(item.product_id)}
          />
        ))}
      </View>

      <View style={styles.subtotalRow}>
        <Text style={styles.subtotalLabel}>Farm subtotal</Text>
        <Text style={styles.subtotalValue}>${group.subtotal.toFixed(2)}</Text>
      </View>

      <FulfillmentSelector
        method={method}
        onSelectMethod={onSelectMethod}
        pickupAddressLine={pickupAddressLine}
        onPressDirections={handleDirections}
        delivery={delivery}
        deliverySlot={deliverySlot}
        onSelectDeliverySlot={onSelectDeliverySlot}
      />

      {readyToPlaceSeparately ? (
        <Pressable style={styles.placeSeparatelyButton} onPress={onPlaceOrderSeparately}>
          <MaterialIcons name="receipt-long" size={16} color={colors.primary} />
          <Text style={styles.placeSeparatelyText}>Place Order Separately</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // One farm's group straight on the page background, separated from the
  // next farm by a line — no white card.
  container: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  photo: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.tint },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  farmName: { flex: 1, fontFamily: fonts.headline, fontSize: 19, color: colors.text },
  items: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: spacing.sm },
  subtotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  subtotalLabel: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  subtotalValue: { fontSize: 14, fontWeight: '700', color: colors.text },
  placeSeparatelyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    marginTop: spacing.sm,
  },
  placeSeparatelyText: { fontSize: 13, fontWeight: '700', color: colors.primary },
});
