import { View, Text, Pressable, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { FarmerOrder } from '../../types/farmer';

type Props = {
  order: FarmerOrder;
  busy: boolean;
  onMarkReady: () => void;
  onCancel: () => void;
};

const STATUS: Record<FarmerOrder['status'], { label: string; color: string }> = {
  pending_payment: { label: 'To prepare', color: colors.accent }, // a cash order, paid at pickup
  paid: { label: 'To prepare', color: colors.accent },
  ready_for_pickup: { label: 'Ready for pickup', color: colors.primary },
  out_for_delivery: { label: 'Out for delivery', color: colors.primary },
  completed: { label: 'Picked up', color: colors.primaryDark },
  cancelled: { label: 'Cancelled', color: colors.danger },
};

// One customer's order with this farm, as the farmer sees it (Farmer F3).
// The customer's phone is only present while the order is active — the
// backend stops sending it once the order is picked up or cancelled.
export function FarmerOrderCard({ order, busy, onMarkReady, onCancel }: Props) {
  const router = useRouter();
  const isDelivery = order.fulfillment_method === 'delivery';
  const status =
    isDelivery && order.status === 'completed'
      ? { label: 'Delivered', color: colors.primaryDark }
      : isDelivery && order.status === 'paid'
        ? { label: 'To pack for delivery', color: colors.accent }
        : STATUS[order.status];
  const isCash = order.payment_method === 'cash_on_pickup';
  const toPrepare = order.status === 'paid' || order.status === 'pending_payment';
  const ready = order.status === 'ready_for_pickup';
  const onItsWay = order.status === 'out_for_delivery';
  const placed = new Date(order.placed_at);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.flex1}>
          <Text style={styles.customer} numberOfLines={1}>
            {order.customer_name ?? 'Customer'}
          </Text>
          <Text style={styles.meta}>
            {placed.toLocaleDateString()} · {placed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </Text>
        </View>
        <View style={[styles.pill, { backgroundColor: `${status.color}1A` }]}>
          <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.paymentRow}>
        <MaterialIcons name={isCash ? 'payments' : 'credit-card'} size={16} color={colors.textMuted} />
        <Text style={styles.paymentText}>
          {isCash
            ? order.amount_to_collect > 0
              ? `Cash on pickup — collect $${order.amount_to_collect.toFixed(2)}`
              : 'Cash on pickup'
            : 'Paid by card'}
        </Text>
      </View>

      {isDelivery && order.delivery_window_label ? (
        <View style={styles.paymentRow}>
          <MaterialIcons name="local-shipping" size={16} color={colors.textMuted} />
          <Text style={styles.paymentText}>
            Deliver {order.delivery_window_label}
            {order.delivery_address_line ? ` · ${order.delivery_address_line}` : ''}
          </Text>
        </View>
      ) : null}

      {order.customer_phone ? (
        <Pressable style={styles.phoneRow} onPress={() => Linking.openURL(`tel:${order.customer_phone}`)} hitSlop={6}>
          <MaterialIcons name="phone" size={16} color={colors.primary} />
          <Text style={styles.phoneText}>{order.customer_phone}</Text>
        </Pressable>
      ) : null}

      <View style={styles.items}>
        {order.items.map((item, index) => (
          <View key={`${item.product_name}-${index}`} style={styles.itemRow}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.quantity} × {item.product_name} <Text style={styles.itemUnit}>({item.unit})</Text>
            </Text>
            <Text style={styles.itemTotal}>${item.line_total.toFixed(2)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.totals}>
        <Line label="Items" value={`$${order.subtotal.toFixed(2)}`} />
        {order.promo_discount > 0 ? (
          <Line label={`Your promo (${order.promo_code})`} value={`-$${order.promo_discount.toFixed(2)}`} />
        ) : null}
        {isDelivery && order.delivery_fee > 0 ? (
          <Line label="Delivery fee (all yours)" value={`$${order.delivery_fee.toFixed(2)}`} />
        ) : null}
        {order.status === 'cancelled' ? (
          order.refunded_amount > 0 ? <Line label="Refunded to customer" value={`$${order.refunded_amount.toFixed(2)}`} /> : null
        ) : (
          <Line label="Your earnings (est.)" value={`$${order.estimated_earnings.toFixed(2)}`} bold />
        )}
      </View>

      {order.status === 'cancelled' && order.cancellation_reason ? (
        <Text style={styles.cancelNote}>
          Cancelled by {order.cancelled_by === 'farmer' ? 'you' : order.cancelled_by === 'customer' ? 'the customer' : 'HarvestHub'}
          : {order.cancellation_reason}
        </Text>
      ) : null}

      {ready ? <Text style={styles.waiting}>Waiting for the customer to pick up.</Text> : null}

      {toPrepare || ready || onItsWay ? (
        <View style={styles.actions}>
          <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          {isDelivery ? (
            <Pressable style={styles.readyButton} onPress={() => router.push('/(farmer)/deliveries')}>
              <Text style={styles.readyText}>{onItsWay ? 'Open delivery run' : 'See in Deliveries'}</Text>
            </Pressable>
          ) : toPrepare ? (
            <Pressable style={styles.readyButton} onPress={onMarkReady} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.readyText}>Mark ready for pickup</Text>}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineLabel, bold && styles.lineBold]}>{label}</Text>
      <Text style={[styles.lineValue, bold && styles.lineBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  card: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  customer: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  meta: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  pill: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  pillText: { fontSize: 11, fontWeight: '700' },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  paymentText: { fontSize: 13, color: colors.text, fontWeight: '600' },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4, alignSelf: 'flex-start' },
  phoneText: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  items: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  itemName: { flex: 1, fontSize: 13.5, color: colors.text, marginRight: spacing.sm },
  itemUnit: { color: colors.textMuted },
  itemTotal: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  totals: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.xs, paddingTop: spacing.xs },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  lineLabel: { fontSize: 13, color: colors.textMuted },
  lineValue: { fontSize: 13, color: colors.text },
  lineBold: { fontWeight: '700', color: colors.text },
  cancelNote: { fontSize: 12.5, color: colors.danger, marginTop: spacing.sm },
  waiting: { fontSize: 12.5, color: colors.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  cancelButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  cancelText: { color: colors.danger, fontSize: 13.5, fontWeight: '700' },
  readyButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  readyText: { color: colors.white, fontSize: 13.5, fontWeight: '700' },
});
