import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import type { FulfillmentMethod } from '../../types/checkout';
import type { FarmDeliveryOption } from '../../types/delivery';

type Props = {
  method: FulfillmentMethod | null;
  onSelectMethod: (method: FulfillmentMethod) => void;
  pickupAddressLine: string | null;
  onPressDirections: () => void;
  // This farm's delivery offer for this customer (GET /delivery/options);
  // null while loading or if the farm doesn't deliver.
  delivery: FarmDeliveryOption | null;
  deliverySlot: string | null;
  onSelectDeliverySlot: (startsAt: string) => void;
};

// Pickup, or — for farms that deliver — delivery to the customer's saved
// address in a window the farm offers. The farm sets the fee and keeps it.
export function FulfillmentSelector({
  method,
  onSelectMethod,
  pickupAddressLine,
  onPressDirections,
  delivery,
  deliverySlot,
  onSelectDeliverySlot,
}: Props) {
  const router = useRouter();
  const offersDelivery = Boolean(delivery?.offers_delivery);
  const canDeliver = Boolean(delivery?.available);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>How would you like to get this order?</Text>

      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggle, method === 'pickup' && styles.toggleActive]}
          onPress={() => onSelectMethod('pickup')}
          accessibilityRole="button"
          accessibilityState={{ selected: method === 'pickup' }}
        >
          <MaterialIcons name="storefront" size={16} color={method === 'pickup' ? colors.white : colors.textMuted} />
          <Text style={[styles.toggleText, method === 'pickup' && styles.toggleTextActive]}>Pickup</Text>
        </Pressable>
        {offersDelivery ? (
          <Pressable
            style={[styles.toggle, method === 'delivery' && styles.toggleActive, !canDeliver && styles.toggleDisabled]}
            onPress={() => canDeliver && onSelectMethod('delivery')}
            disabled={!canDeliver}
            accessibilityRole="button"
            accessibilityState={{ selected: method === 'delivery', disabled: !canDeliver }}
          >
            <MaterialIcons name="local-shipping" size={16} color={method === 'delivery' ? colors.white : colors.textMuted} />
            <Text style={[styles.toggleText, method === 'delivery' && styles.toggleTextActive]}>
              Delivery{delivery ? ` · $${delivery.delivery_fee.toFixed(2)}` : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {offersDelivery && !canDeliver && delivery?.reason ? <Text style={styles.reason}>{delivery.reason}</Text> : null}

      {method === 'pickup' ? (
        <View style={styles.box}>
          <MaterialIcons name="place" size={16} color={colors.textMuted} />
          <Text style={styles.boxText} numberOfLines={2}>
            {pickupAddressLine ?? 'Pickup address not available yet'}
          </Text>
          <Pressable style={styles.smallButton} onPress={onPressDirections} hitSlop={8}>
            <Text style={styles.smallButtonText}>Get Directions</Text>
          </Pressable>
        </View>
      ) : method === 'delivery' && delivery ? (
        <View>
          <View style={styles.box}>
            <MaterialIcons name="home" size={16} color={colors.textMuted} />
            <Text style={styles.boxText} numberOfLines={2}>
              To {delivery.address_line}
            </Text>
            <Pressable style={styles.smallButton} onPress={() => router.push('/(customer)/edit-profile')} hitSlop={8}>
              <Text style={styles.smallButtonText}>Change</Text>
            </Pressable>
          </View>
          <Text style={styles.slotLabel}>Choose a delivery time</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>
            {delivery.slots.map((slot) => {
              const selected = slot.starts_at === deliverySlot;
              return (
                <Pressable
                  key={slot.starts_at}
                  style={[styles.slot, selected && styles.slotSelected]}
                  onPress={() => onSelectDeliverySlot(slot.starts_at)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.slotDay, selected && styles.slotTextSelected]}>{slot.label.split(' · ')[0]}</Text>
                  <Text style={[styles.slotTime, selected && styles.slotTextSelected]}>{slot.label.split(' · ')[1]}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text style={styles.fine}>Left at your door if you&apos;re not home, with a photo from the farm.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.sm },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  toggleRow: { flexDirection: 'row', gap: spacing.xs },
  toggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: radius.pill,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  },
  toggleActive: { backgroundColor: colors.primary },
  toggleDisabled: { opacity: 0.45 },
  toggleText: { fontSize: 13, fontWeight: '600', color: colors.text },
  toggleTextActive: { color: colors.white },
  reason: { fontSize: 12, color: colors.textMuted, marginTop: spacing.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.sm + 2,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
  },
  boxText: { flex: 1, fontSize: 12, color: colors.text, minWidth: 120 },
  smallButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  smallButtonText: { fontSize: 12, fontWeight: '600', color: colors.primary },
  slotLabel: { fontSize: 12.5, fontWeight: '600', color: colors.text, marginTop: spacing.sm, marginBottom: spacing.xs },
  slots: { gap: spacing.xs, paddingRight: spacing.md },
  slot: {
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  slotSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  slotDay: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  slotTime: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  slotTextSelected: { color: colors.white },
  fine: { fontSize: 11.5, color: colors.textMuted, marginTop: spacing.xs },
});
