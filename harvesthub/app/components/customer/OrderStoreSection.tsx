import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { StoreOrder } from '../../types/orders';
import { RatingStars } from './RatingStars';
import { DeliveryTracker } from './DeliveryTracker';

type Props = {
  orderId: string;
  storeOrder: StoreOrder;
  paysAtPickup: boolean; // cash_on_pickup — the order's single payment covers every farm in it
  busy: boolean;
  onCancel: () => void;
  onMarkReceived: () => void;
  onRate: (rating: number) => void;
  ratingBusy: boolean;
  onDeliveryUpdate?: () => void; // the delivery moved on — reload the order
};

const STATUS_LABELS: Record<StoreOrder['status'], string> = {
  pending_payment: 'Awaiting payment',
  paid: 'Paid — preparing',
  ready_for_pickup: 'Ready for pickup',
  out_for_delivery: 'On the way',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_COLORS: Record<StoreOrder['status'], string> = {
  pending_payment: colors.accent,
  paid: colors.primaryMid,
  ready_for_pickup: colors.primary,
  out_for_delivery: colors.primary,
  completed: colors.primaryDark,
  cancelled: colors.danger,
};

export function OrderStoreSection({
  orderId,
  storeOrder,
  paysAtPickup,
  busy,
  onCancel,
  onMarkReceived,
  onRate,
  ratingBusy,
  onDeliveryUpdate,
}: Props) {
  const isDelivery = storeOrder.fulfillment_method === 'delivery';
  const addressLine =
    storeOrder.fulfillment_method === 'pickup'
      ? [storeOrder.pickup_address_street, storeOrder.pickup_address_city, storeOrder.pickup_address_state, storeOrder.pickup_address_zip]
          .filter(Boolean)
          .join(', ')
      : [
          storeOrder.delivery_address_street,
          storeOrder.delivery_address_city,
          storeOrder.delivery_address_state,
          storeOrder.delivery_address_zip,
        ]
          .filter(Boolean)
          .join(', ');

  // The farm marks an order ready once it's packed; only then can the
  // customer confirm pickup. A cash order is paid at pickup, so until then
  // it stays 'pending_payment' (shown as "Preparing", not "Awaiting payment").
  const preparing = !isDelivery && (storeOrder.status === 'paid' || (paysAtPickup && storeOrder.status === 'pending_payment'));
  const statusLabel =
    paysAtPickup && storeOrder.status === 'pending_payment'
      ? 'Preparing · pay at pickup'
      : paysAtPickup && storeOrder.status === 'ready_for_pickup'
        ? 'Ready · pay at pickup'
        : isDelivery && storeOrder.status === 'paid'
          ? 'Delivery scheduled'
          : isDelivery && storeOrder.status === 'completed'
            ? 'Delivered'
            : STATUS_LABELS[storeOrder.status];
  const canCancel =
    storeOrder.status === 'pending_payment' || storeOrder.status === 'paid' || storeOrder.status === 'ready_for_pickup';
  const canMarkReceived = storeOrder.status === 'ready_for_pickup';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.farmName} numberOfLines={1}>
          {storeOrder.farm_name}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: `${STATUS_COLORS[storeOrder.status]}1A` }]}>
          <Text style={[styles.statusText, { color: STATUS_COLORS[storeOrder.status] }]}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <View style={styles.fulfillmentRow}>
        <MaterialIcons
          name={storeOrder.fulfillment_method === 'pickup' ? 'storefront' : 'local-shipping'}
          size={15}
          color={colors.textMuted}
        />
        <Text style={styles.fulfillmentText} numberOfLines={2}>
          {storeOrder.fulfillment_method === 'pickup'
            ? `Pickup at ${addressLine}`
            : `Delivery ${storeOrder.delivery?.window_label ?? ''} to ${addressLine}`}
        </Text>
      </View>

      {isDelivery && storeOrder.delivery && storeOrder.status !== 'pending_payment' ? (
        <DeliveryTracker
          orderId={orderId}
          storeOrderId={storeOrder.id}
          farmName={storeOrder.farm_name}
          delivery={storeOrder.delivery}
          onStageChange={onDeliveryUpdate}
        />
      ) : null}

      <View style={styles.items}>
        {storeOrder.items.map((item) => (
          <View key={`${item.product_id}-${item.product_name}`} style={styles.itemRow}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.quantity} × {item.product_name}
            </Text>
            <Text style={styles.itemTotal}>${item.line_total.toFixed(2)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.breakdown}>
        <BreakdownLine label="Subtotal" value={storeOrder.subtotal} />
        {storeOrder.promo_discount > 0 ? (
          <BreakdownLine label={`Promo (${storeOrder.promo_code})`} value={-storeOrder.promo_discount} highlight />
        ) : null}
        {storeOrder.fulfillment_method === 'delivery' ? <BreakdownLine label="Delivery fee" value={storeOrder.delivery_fee} /> : null}
        {storeOrder.member_savings > 0 ? (
          <BreakdownLine label="Service fee · free with Harvest Pass" value={0} member />
        ) : (
          <BreakdownLine label="Service fee" value={storeOrder.service_fee} />
        )}
        <BreakdownLine label="Tax" value={storeOrder.tax} />
        <View style={styles.divider} />
        <BreakdownLine label="Total" value={storeOrder.total} bold />
        {storeOrder.refunded_amount > 0 ? <BreakdownLine label="Refunded" value={-storeOrder.refunded_amount} highlight /> : null}
      </View>

      {storeOrder.status === 'cancelled' && storeOrder.cancelled_by === 'farmer' ? (
        <Text style={styles.note}>
          Cancelled by the farm{storeOrder.cancellation_reason ? `: ${storeOrder.cancellation_reason}` : ''}.
          {storeOrder.refunded_amount > 0 ? ' Your refund goes back to your card.' : ''}
        </Text>
      ) : null}
      {preparing ? (
        <Text style={styles.hint}>The farm is packing your order — it&apos;ll show “Ready for pickup” here when it&apos;s ready.</Text>
      ) : null}

      {storeOrder.status === 'completed' ? (
        <View style={styles.ratingRow}>
          <Text style={styles.ratingLabel}>
            {storeOrder.my_rating ? 'Your rating' : 'Rate this farm'}
          </Text>
          {ratingBusy ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : (
            <RatingStars value={storeOrder.my_rating ?? 0} onSelect={onRate} size={20} />
          )}
        </View>
      ) : null}

      {canCancel || canMarkReceived ? (
        <View style={styles.actionsRow}>
          {canCancel ? (
            <Pressable style={styles.cancelButton} onPress={onCancel} disabled={busy}>
              {busy ? <ActivityIndicator size="small" color={colors.danger} /> : <Text style={styles.cancelText}>Cancel</Text>}
            </Pressable>
          ) : null}
          {canMarkReceived ? (
            <Pressable style={styles.receivedButton} onPress={onMarkReceived} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.receivedText}>Mark as Received</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function BreakdownLine({
  label,
  value,
  bold,
  highlight,
  member,
}: {
  label: string;
  value: number;
  bold?: boolean;
  highlight?: boolean;
  member?: boolean;
}) {
  const sign = value < 0 ? '-' : '';
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, bold && styles.breakdownLabelBold, member && styles.breakdownMember]}>{label}</Text>
      <Text
        style={[
          styles.breakdownValue,
          bold && styles.breakdownValueBold,
          highlight && styles.breakdownValueHighlight,
          member && styles.breakdownMember,
        ]}
      >
        {sign}${Math.abs(value).toFixed(2)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // One farm's part of the order straight on the page background, a line
  // between farms — no white card.
  container: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs, gap: spacing.sm },
  farmName: { flex: 1, fontFamily: fonts.headline, fontSize: 19, color: colors.text },
  statusPill: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: 10 },
  statusText: { fontSize: 11, fontWeight: '700' },
  fulfillmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  fulfillmentText: { flex: 1, fontSize: 12, color: colors.textMuted },
  items: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.xs },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemName: { flex: 1, fontSize: 13, color: colors.text, marginRight: spacing.sm },
  itemTotal: { fontSize: 13, fontWeight: '600', color: colors.text },
  breakdown: { marginTop: spacing.xs },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  breakdownLabel: { fontSize: 13, color: colors.textMuted },
  breakdownLabelBold: { fontSize: 14, fontWeight: '700', color: colors.text },
  breakdownValue: { fontSize: 13, color: colors.text },
  breakdownValueBold: { fontSize: 15, fontWeight: '700', color: colors.text },
  breakdownValueHighlight: { color: colors.danger },
  breakdownMember: { color: colors.primary, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  ratingLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  note: { fontSize: 12.5, lineHeight: 18, color: colors.danger, marginTop: spacing.sm },
  hint: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.sm },
  actionsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  receivedButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  receivedText: { color: colors.white, fontSize: 13, fontWeight: '700' },
});
