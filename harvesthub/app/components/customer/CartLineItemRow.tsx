import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import type { CartLineItem } from '../../types/database';

type Props = {
  item: CartLineItem;
  pending: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
};

export function CartLineItemRow({ item, pending, onIncrement, onDecrement, onRemove }: Props) {
  const atMax = item.quantity >= item.quantity_available;

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.priceLine}>
          ${item.price.toFixed(2)} / {item.unit} · qty {item.quantity}
        </Text>
        {item.quantity > item.quantity_available ? (
          <Text style={styles.warning}>Only {item.quantity_available} left — adjust quantity</Text>
        ) : null}
      </View>

      <Text style={styles.lineTotal}>${item.line_total.toFixed(2)}</Text>

      <View style={styles.stepper}>
        <Pressable
          style={styles.stepperButton}
          onPress={onDecrement}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={item.quantity === 1 ? `Remove ${item.name} from cart` : `Remove one ${item.name}`}
        >
          <MaterialIcons name="remove" size={16} color={colors.primary} />
        </Pressable>
        <Text style={styles.stepperValue} accessibilityLabel={`${item.quantity} ${item.name} in cart`}>
          {item.quantity}
        </Text>
        <Pressable
          style={[styles.stepperButton, atMax && styles.stepperButtonDisabled]}
          onPress={onIncrement}
          disabled={atMax}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Add one more ${item.name}`}
          accessibilityState={{ disabled: atMax }}
        >
          <MaterialIcons name="add" size={16} color={colors.primary} />
        </Pressable>
      </View>

      <Pressable
        style={styles.removeButton}
        onPress={onRemove}
        disabled={pending}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name} from cart`}
      >
        <MaterialIcons name="delete-outline" size={18} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  info: { flex: 1, marginRight: spacing.xs },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  priceLine: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  warning: { fontSize: 11, color: colors.danger, fontWeight: '600', marginTop: 2 },
  lineTotal: { fontSize: 14, fontWeight: '600', color: colors.primaryDark, minWidth: 56, textAlign: 'right' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepperButton: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  stepperButtonDisabled: { opacity: 0.35 },
  stepperValue: { fontSize: 13, fontWeight: '600', color: colors.text, minWidth: 16, textAlign: 'center' },
  removeButton: { padding: 4 },
});
