import { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import type { ProductItem } from '../../types/database';
import { QuantityStepper } from './QuantityStepper';

type Props = {
  product: ProductItem;
  pending?: boolean; // no longer locks the buttons: taps queue up (lib/useCartStepper.ts)
  onIncrement: () => void;
  onDecrement: () => void;
};

// "Low Stock Warning: If available quantity is less than 11..."
const LOW_STOCK_THRESHOLD = 11;

// List view: a menu-style row straight on the page background — details on
// the left, the photo on the right with the add/quantity control floating on
// it, and a hairline divider instead of a card box.
export function ProductCard({ product, onIncrement, onDecrement }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const outOfStock = product.quantity_available <= 0;
  const lowStock = !outOfStock && product.quantity_available < LOW_STOCK_THRESHOLD;
  const atMax = product.cart_quantity >= product.quantity_available;
  const showPhoto = Boolean(product.image_url) && !imageFailed;

  return (
    <View style={styles.container}>
      <View style={[styles.info, outOfStock && styles.dimmed]}>
        <Text style={styles.name} numberOfLines={2}>
          {product.name}
        </Text>
        {product.description ? (
          <Text style={styles.description} numberOfLines={2}>
            {product.description}
          </Text>
        ) : null}
        <Text style={styles.price}>
          ${product.price.toFixed(2)} <Text style={styles.unit}>/ {product.unit}</Text>
        </Text>
        {outOfStock ? (
          <Text style={styles.outOfStockText}>Out of stock</Text>
        ) : lowStock ? (
          <Text style={styles.lowStockText}>Only {product.quantity_available} left</Text>
        ) : null}
      </View>

      <View>
        <View style={outOfStock && styles.dimmed}>
          {showPhoto ? (
            <Image
              source={{ uri: product.image_url! }}
              style={styles.photo}
              contentFit="cover"
              transition={150}
              onError={() => setImageFailed(true)}
            />
          ) : (
            <View style={[styles.photo, styles.photoFallback]}>
              <MaterialIcons name="eco" size={30} color={colors.primaryMid} />
            </View>
          )}
        </View>
        {!outOfStock ? (
          <View style={styles.stepper}>
            <QuantityStepper
              name={product.name}
              quantity={product.cart_quantity}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              canIncrement={!atMax}
              canDecrement={product.cart_quantity > 0}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const PHOTO_SIZE = 104;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  // "Out of Stock: Reduce UI opacity/transparency for out-of-stock items
  // and disable interaction." — the add control is hidden entirely.
  dimmed: { opacity: 0.45 },
  info: { flex: 1, paddingTop: 2 },
  name: { fontSize: 16, fontWeight: '700', color: colors.text },
  description: { fontSize: 13, lineHeight: 18, color: colors.textMuted, marginTop: 3 },
  price: { fontSize: 15, fontWeight: '700', color: colors.primaryDark, marginTop: 6 },
  unit: { fontSize: 12.5, fontWeight: '400', color: colors.textMuted },
  outOfStockText: { fontSize: 12.5, color: colors.danger, fontWeight: '700', marginTop: 4 },
  lowStockText: { fontSize: 12.5, color: colors.berry, fontWeight: '700', marginTop: 4 },
  photo: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: radius.lg, backgroundColor: '#EAF2EC' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  stepper: { position: 'absolute', right: 6, bottom: 6 },
});
