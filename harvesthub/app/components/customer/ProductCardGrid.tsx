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

// Same threshold as ProductCard.tsx (list view) — keep in sync.
const LOW_STOCK_THRESHOLD = 11;

// Grid counterpart to ProductCard — same data/behavior as a 2-column tile:
// rounded photo with the add/quantity control on it, text underneath on the
// page background (no card box).
export function ProductCardGrid({ product, onIncrement, onDecrement }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const outOfStock = product.quantity_available <= 0;
  const lowStock = !outOfStock && product.quantity_available < LOW_STOCK_THRESHOLD;
  const atMax = product.cart_quantity >= product.quantity_available;
  const showPhoto = Boolean(product.image_url) && !imageFailed;

  return (
    <View style={styles.container}>
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
              <MaterialIcons name="eco" size={32} color={colors.primaryMid} />
            </View>
          )}
        </View>
        {outOfStock ? (
          <View style={styles.soldOut}>
            <Text style={styles.soldOutText}>Out of stock</Text>
          </View>
        ) : (
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
        )}
      </View>

      <View style={outOfStock && styles.dimmed}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.price}>
          ${product.price.toFixed(2)} <Text style={styles.unit}>/ {product.unit}</Text>
        </Text>
        {lowStock ? <Text style={styles.lowStockText}>Only {product.quantity_available} left</Text> : null}
      </View>
    </View>
  );
}

const PHOTO_HEIGHT = 140;

const styles = StyleSheet.create({
  container: { flex: 1, marginBottom: spacing.lg },
  dimmed: { opacity: 0.45 },
  photo: { width: '100%', height: PHOTO_HEIGHT, borderRadius: radius.lg, backgroundColor: '#EAF2EC' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  stepper: { position: 'absolute', right: 8, bottom: 8 },
  soldOut: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    backgroundColor: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  soldOutText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  price: { fontSize: 14, fontWeight: '700', color: colors.primaryDark, marginTop: 2 },
  unit: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  lowStockText: { fontSize: 12, color: colors.berry, fontWeight: '700', marginTop: 2 },
});
