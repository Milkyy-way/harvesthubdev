import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { openDirections } from '../../lib/maps';
import { TextField } from '../TextField';
import type { CheckoutGroup } from '../../types/checkout';

type Props = {
  group: CheckoutGroup;
  promoCodeInput: string;
  onChangePromoCodeInput: (value: string) => void;
  onApplyPromo: () => void;
  applyingPromo: boolean;
};

export function CheckoutFarmSection({
  group,
  promoCodeInput,
  onChangePromoCodeInput,
  onApplyPromo,
  applyingPromo,
}: Props) {
  const pickupAddressLine = [group.address_street, group.address_city, group.address_state, group.address_zip]
    .filter(Boolean)
    .join(', ');

  const handleDirections = () => {
    if (group.latitude !== null && group.longitude !== null) {
      openDirections(group.latitude, group.longitude, group.farm_name);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.farmName}>{group.farm_name}</Text>

      <View style={styles.fulfillmentRow}>
        <MaterialIcons
          name={group.fulfillment_method === 'pickup' ? 'storefront' : 'local-shipping'}
          size={15}
          color={colors.textMuted}
        />
        <Text style={styles.fulfillmentText} numberOfLines={2}>
          {group.fulfillment_method === 'pickup'
            ? `Pickup at ${pickupAddressLine || group.farm_name}`
            : group.pod_name
              ? `Delivery ${group.delivery_window_label ?? ''} to ${group.pod_name}'s drop point: ${group.delivery_address_line ?? ''}`
              : `Delivery ${group.delivery_window_label ?? ''} to ${group.delivery_address_line || 'your address'}`}
        </Text>
        {group.fulfillment_method === 'pickup' && group.latitude !== null ? (
          <Pressable onPress={handleDirections} hitSlop={8}>
            <Text style={styles.directionsLink}>Directions</Text>
          </Pressable>
        ) : null}
      </View>

      {group.delivery_error ? (
        <View style={styles.deliveryError}>
          <MaterialIcons name="error-outline" size={16} color={colors.danger} />
          <Text style={styles.deliveryErrorText}>{group.delivery_error} Go back to your cart to choose again.</Text>
        </View>
      ) : null}

      <View style={styles.items}>
        {group.items.map((item) => (
          <View key={item.product_id} style={styles.itemRow}>
            <Text style={styles.itemName} numberOfLines={1}>
              {item.quantity} × {item.name}
            </Text>
            <Text style={styles.itemTotal}>${item.line_total.toFixed(2)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.promoRow}>
        <View style={styles.promoInput}>
          <TextField
            placeholder="Promo code for this farm"
            value={promoCodeInput}
            onChangeText={onChangePromoCodeInput}
            autoCapitalize="characters"
          />
        </View>
        <Pressable style={styles.promoButton} onPress={onApplyPromo} disabled={applyingPromo || !promoCodeInput.trim()}>
          {applyingPromo ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.promoButtonText}>Apply</Text>
          )}
        </Pressable>
      </View>
      {group.promo_error ? <Text style={styles.promoError}>{group.promo_error}</Text> : null}
      {group.promo_code && group.promo_discount > 0 ? (
        <Text style={styles.promoSuccess}>&ldquo;{group.promo_code}&rdquo; applied</Text>
      ) : null}

      <View style={styles.breakdown}>
        <BreakdownLine label="Subtotal" value={group.subtotal} />
        {group.promo_discount > 0 ? <BreakdownLine label="Promo discount" value={-group.promo_discount} highlight /> : null}
        {group.fulfillment_method === 'delivery' ? (
          <BreakdownLine label={group.pod_name ? 'Your delivery share, at most' : 'Delivery fee'} value={group.delivery_fee} />
        ) : null}
        {group.pod_fee_low !== null ? (
          <Text style={styles.podSavings}>
            As little as ${group.pod_fee_low.toFixed(2)} if every member orders. It&apos;s split among those who do.
          </Text>
        ) : null}
        {group.member_savings > 0 ? (
          <BreakdownLine label="Service fee · free with Harvest Pass" value={0} member />
        ) : (
          <BreakdownLine label="Service fee" value={group.service_fee} />
        )}
        <BreakdownLine label="Tax" value={group.tax} />
        <View style={styles.divider} />
        <BreakdownLine label={group.pod_name ? 'The most you\'d pay' : 'Farm total'} value={group.farm_total} bold />
      </View>
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
  // One farm's order straight on the page background, a line between farms.
  container: {
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  farmName: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginBottom: spacing.xs },
  fulfillmentRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  fulfillmentText: { flex: 1, fontSize: 12.5, color: colors.textMuted },
  directionsLink: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  deliveryError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#F6E7E5',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  deliveryErrorText: { flex: 1, fontSize: 12.5, color: colors.danger },
  items: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.xs },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  itemName: { flex: 1, fontSize: 13, color: colors.text, marginRight: spacing.sm },
  itemTotal: { fontSize: 13, fontWeight: '600', color: colors.text },
  promoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginTop: spacing.sm },
  promoInput: { flex: 1 },
  promoButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoButtonText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  promoError: { fontSize: 12, color: colors.danger, marginTop: -spacing.sm, marginBottom: spacing.sm },
  promoSuccess: { fontSize: 12, color: colors.primaryDark, fontWeight: '600', marginTop: -spacing.sm, marginBottom: spacing.sm },
  breakdown: { marginTop: spacing.xs },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  breakdownLabel: { fontSize: 13, color: colors.textMuted },
  breakdownLabelBold: { fontSize: 14, fontWeight: '700', color: colors.text },
  breakdownValue: { fontSize: 13, color: colors.text },
  breakdownValueBold: { fontSize: 15, fontWeight: '700', color: colors.text },
  breakdownValueHighlight: { color: colors.danger },
  breakdownMember: { color: colors.primary, fontWeight: '700' },
  podSavings: { fontSize: 12, fontWeight: '600', color: colors.primary, marginBottom: 3 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xs },
});
