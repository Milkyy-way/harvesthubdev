import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { Order } from '../../types/orders';

type Props = {
  order: Order;
  onPress: () => void;
  // Rebook is only offered for Completed/Cancelled — an Active order is
  // still in progress, "reorder" doesn't make sense for it yet.
  showRebook?: boolean;
  onRebook?: () => void;
  rebooking?: boolean;
};

type Tone = 'ready' | 'active' | 'waiting' | 'done' | 'cancelled';

// One word for where the whole order stands, the thing a customer opens the
// list to find out. The most urgent farm wins: ready beats preparing.
export function orderStatus(order: Order): { label: string; tone: Tone } {
  const statuses = order.store_orders.map((so) => so.status);
  const payment = order.payment;
  if (statuses.includes('ready_for_pickup')) return { label: 'Ready for pickup', tone: 'ready' };
  if (statuses.includes('out_for_delivery')) return { label: 'On its way', tone: 'ready' };
  if (statuses.includes('paid')) return { label: 'Preparing', tone: 'active' };
  if (statuses.includes('pending_payment')) {
    if (payment?.payment_method === 'cash_on_pickup') return { label: 'Preparing · pay at pickup', tone: 'active' };
    if (payment?.charged_at_cutoff || payment?.status === 'awaiting_cutoff') return { label: 'Scheduled', tone: 'waiting' };
    if (payment?.status === 'charge_failed') return { label: 'Card declined', tone: 'cancelled' };
    return { label: 'Awaiting payment', tone: 'waiting' };
  }
  if (statuses.length > 0 && statuses.every((s) => s === 'cancelled')) return { label: 'Cancelled', tone: 'cancelled' };
  return { label: 'Completed', tone: 'done' };
}

// "2 × Kale, 1 × Strawberry Jam and 3 more"
function itemSummary(order: Order): string {
  const items = order.store_orders.flatMap((so) => so.items);
  const shown = items.slice(0, 2).map((i) => `${i.quantity} × ${i.product_name}`);
  return items.length > 2 ? `${shown.join(', ')} and ${items.length - 2} more` : shown.join(', ');
}

export function OrderCard({ order, onPress, showRebook, onRebook, rebooking }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const firstFarm = order.store_orders[0];
  const showPhoto = Boolean(firstFarm?.photo_url) && !imageFailed;

  const farmNames = order.store_orders.map((so) => so.farm_name).join(' · ');
  const placedDate = new Date(order.placed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const status = orderStatus(order);
  const isDeal = order.store_orders.some((so) => so.group_deal_id);

  return (
    <Pressable style={({ pressed }) => [styles.container, pressed && styles.pressed]} onPress={onPress}>
      {showPhoto ? (
        <Image
          source={{ uri: firstFarm!.photo_url! }}
          style={styles.photo}
          contentFit="cover"
          transition={150}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.photo, styles.photoFallback]}>
          <MaterialIcons name="storefront" size={22} color={colors.primaryMid} />
        </View>
      )}

      <View style={styles.info}>
        <Text style={styles.farmNames} numberOfLines={1}>
          {farmNames}
        </Text>
        <Text style={styles.items} numberOfLines={1}>
          {isDeal ? 'Group deal · ' : ''}
          {itemSummary(order)}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.status, styles[status.tone]]}>
            <Text style={[styles.statusText, styles[`${status.tone}Text`]]}>{status.label}</Text>
          </View>
          <Text style={styles.meta}>
            {placedDate} · ${order.grand_total.toFixed(2)}
          </Text>
        </View>
      </View>

      {showRebook ? (
        <Pressable style={styles.rebookButton} onPress={onRebook} disabled={rebooking} hitSlop={6}>
          {rebooking ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <>
              <MaterialIcons name="replay" size={14} color={colors.primary} />
              <Text style={styles.rebookText}>Rebook</Text>
            </>
          )}
        </Pressable>
      ) : (
        <MaterialIcons name="chevron-right" size={20} color={colors.textMuted} />
      )}
    </Pressable>
  );
}

const PHOTO_SIZE = 52;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: { opacity: 0.7 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: radius.md, backgroundColor: colors.tint },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  farmNames: { fontFamily: fonts.headline, fontSize: 15, color: colors.text },
  items: { fontSize: 12.5, color: colors.text, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 5 },
  meta: { fontSize: 12, color: colors.textMuted },
  status: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
  statusText: { fontSize: 11.5, fontWeight: '700' },
  ready: { backgroundColor: `${colors.accent}40` },
  readyText: { color: colors.primaryDark },
  active: { backgroundColor: colors.tint },
  activeText: { color: colors.primaryDark },
  waiting: { backgroundColor: colors.border },
  waitingText: { color: colors.text },
  done: { backgroundColor: colors.border },
  doneText: { color: colors.textMuted },
  cancelled: { backgroundColor: '#F6E7E5' },
  cancelledText: { color: colors.danger },
  rebookButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minWidth: 78,
    justifyContent: 'center',
  },
  rebookText: { fontSize: 12, fontWeight: '700', color: colors.primary },
});
