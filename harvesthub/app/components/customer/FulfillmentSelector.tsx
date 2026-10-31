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
  podId: string | null;
  onSelectPod: (podId: string | null) => void;
};

// Pickup, or — for farms that deliver — delivery in a window the farm offers,
// to the customer's saved address or a Neighborhood Pod they're in. The farm
// sets each fee and keeps it.
export function FulfillmentSelector({
  method,
  onSelectMethod,
  pickupAddressLine,
  onPressDirections,
  delivery,
  deliverySlot,
  onSelectDeliverySlot,
  podId,
  onSelectPod,
}: Props) {
  const router = useRouter();
  const offersDelivery = Boolean(delivery?.offers_delivery);
  const pods = delivery?.pods ?? [];
  const homeAvailable = Boolean(delivery?.available);
  const canDeliver = homeAvailable || pods.length > 0;
  const selectedPod = pods.find((p) => p.pod_id === podId) ?? null;
  const slots = selectedPod ? selectedPod.slots : (delivery?.slots ?? []);
  // The toggle shows the least it can be when a pod is an option.
  const shownFee = selectedPod?.delivery_fee ?? (homeAvailable ? delivery?.delivery_fee : pods[0]?.delivery_fee);

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
              Delivery{delivery && shownFee !== undefined ? ` · ${selectedPod || !homeAvailable ? 'from ' : ''}$${shownFee.toFixed(2)}` : ''}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {offersDelivery && !canDeliver && delivery?.reason ? <Text style={styles.reason}>{delivery.reason}</Text> : null}
      {method !== 'delivery' && pods.length > 0 ? (
        <Text style={styles.reason}>
          Your pod {pods[0].pod_name} can get delivery from ${pods[0].delivery_fee.toFixed(2)}.
        </Text>
      ) : null}

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
          {pods.length > 0 ? (
            <View style={styles.destinations}>
              {homeAvailable ? (
                <Destination
                  icon="home"
                  title={`Home · $${delivery.delivery_fee.toFixed(2)}`}
                  line={delivery.address_line}
                  selected={!selectedPod}
                  onPress={() => onSelectPod(null)}
                />
              ) : null}
              {pods.map((pod) => (
                <Destination
                  key={pod.pod_id}
                  icon="groups"
                  title={`${pod.pod_name} · $${pod.delivery_fee.toFixed(2)} to $${pod.total_fee.toFixed(2)}`}
                  line={`$${pod.total_fee.toFixed(2)} split among the members who order. ${pod.drop_address_line}`}
                  selected={selectedPod?.pod_id === pod.pod_id}
                  onPress={() => onSelectPod(pod.pod_id)}
                />
              ))}
            </View>
          ) : (
            <View style={styles.box}>
              <MaterialIcons name="home" size={16} color={colors.textMuted} />
              <Text style={styles.boxText} numberOfLines={2}>
                To {delivery.address_line}
              </Text>
              <Pressable style={styles.smallButton} onPress={() => router.push('/(customer)/edit-profile')} hitSlop={8}>
                <Text style={styles.smallButtonText}>Change</Text>
              </Pressable>
            </View>
          )}
          <Text style={styles.slotLabel}>Choose a delivery time</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.slots}>
            {slots.map((slot) => {
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
          <Text style={styles.fine}>
            {selectedPod
              ? 'Collect it at your drop point. Your card is charged once, when orders close.'
              : 'Left at your door if you\'re not home, with a photo from the farm.'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Destination({
  icon,
  title,
  line,
  selected,
  onPress,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  line: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.destination, selected && styles.destinationSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <MaterialIcons name={icon} size={17} color={selected ? colors.primary : colors.textMuted} />
      <View style={styles.destinationText}>
        <Text style={styles.destinationTitle}>{title}</Text>
        <Text style={styles.destinationLine} numberOfLines={2}>
          {line}
        </Text>
      </View>
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={19}
        color={selected ? colors.primary : colors.border}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: spacing.sm },
  destinations: { gap: spacing.xs, marginTop: spacing.sm },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  destinationSelected: { backgroundColor: colors.tint, borderColor: colors.primary },
  destinationText: { flex: 1 },
  destinationTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
  destinationLine: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
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
