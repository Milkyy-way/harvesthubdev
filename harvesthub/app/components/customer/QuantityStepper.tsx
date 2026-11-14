import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, radius } from '../../constants/theme';

type Props = {
  name: string; // the product, for screen readers: "Add Kale"
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  canIncrement: boolean;
  canDecrement: boolean;
};

// The add-to-cart control that floats on a product photo: a white "+"
// button while nothing's in the cart, growing into "− 2 +" once something is.
export function QuantityStepper({ name, quantity, onIncrement, onDecrement, canIncrement, canDecrement }: Props) {
  if (quantity === 0) {
    return (
      <Pressable
        style={[styles.addButton, !canIncrement && styles.disabled]}
        onPress={onIncrement}
        disabled={!canIncrement}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Add ${name}`}
        accessibilityState={{ disabled: !canIncrement }}
      >
        <MaterialIcons name="add" size={22} color={colors.primary} />
      </Pressable>
    );
  }

  return (
    <View style={styles.pill}>
      <Pressable
        onPress={onDecrement}
        disabled={!canDecrement}
        hitSlop={8}
        style={[styles.pillButton, !canDecrement && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={quantity === 1 ? `Remove ${name} from cart` : `Remove one ${name}`}
      >
        <MaterialIcons name={quantity === 1 ? 'delete-outline' : 'remove'} size={18} color={colors.primary} />
      </Pressable>
      <Text style={styles.value} accessibilityLabel={`${quantity} ${name} in cart`}>
        {quantity}
      </Text>
      <Pressable
        onPress={onIncrement}
        disabled={!canIncrement}
        hitSlop={8}
        style={[styles.pillButton, !canIncrement && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel={`Add one more ${name}`}
        accessibilityState={{ disabled: !canIncrement }}
      >
        <MaterialIcons name="add" size={18} color={colors.primary} />
      </Pressable>
    </View>
  );
}

const SIZE = 36;

const shadow = {
  shadowColor: colors.primaryDark,
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.16,
  shadowRadius: 6,
  elevation: 4,
};

const styles = StyleSheet.create({
  addButton: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    height: SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    ...shadow,
  },
  pillButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 22, textAlign: 'center', fontSize: 15, fontWeight: '800', color: colors.text },
  disabled: { opacity: 0.35 },
});
