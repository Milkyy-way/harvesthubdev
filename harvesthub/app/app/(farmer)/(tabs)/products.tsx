import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { HeroShell } from '../../../components/customer/HeroShell';
import { LockedTabNotice, TabNotice } from '../../../components/farmer/TabNotice';
import type { FarmerProduct } from '../../../types/farmer';

// Mirrors the customer app's ProductCard LOW_STOCK_THRESHOLD.
const LOW_STOCK_THRESHOLD = 11;

// The farmer's own products (Farmer F2) — visible ones first, hidden ones
// after. Locked until the farmer is approved (the backend refuses too).
export default function FarmerProducts() {
  const { profile } = useAuth();
  const router = useRouter();
  const approved = profile?.status === 'active';

  const [products, setProducts] = useState<FarmerProduct[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<FarmerProduct[]>('/farmers/me/products');
      setProducts(res.data);
      setError(null);
    } catch (err) {
      console.warn('Could not load products:', err);
      setError("Couldn't load your products. Pull down to try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Refetched on focus — the editor screen changes this list.
  useFocusEffect(
    useCallback(() => {
      if (approved) load();
    }, [approved, load])
  );

  const openEditor = (id: string) => router.push({ pathname: '/(farmer)/product/[id]', params: { id } });

  if (!approved) {
    return (
      <View style={styles.container}>
        <HeroShell headline="Products" subheadline="What customers can buy from your farm." />
        <LockedTabNotice status={profile?.status} feature="Products" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={products ?? []}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <HeroShell headline="Products" subheadline="What customers can buy from your farm.">
              <Pressable style={styles.addButton} onPress={() => openEditor('new')}>
                <MaterialIcons name="add" size={18} color={colors.primaryDark} />
                <Text style={styles.addButtonText}>Add product</Text>
              </Pressable>
            </HeroShell>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={({ pressed }) => [styles.dealsLink, pressed && styles.pressed]}
              onPress={() => router.push('/(farmer)/deals' as Href)}
              accessibilityRole="button"
            >
              <MaterialIcons name="groups" size={22} color={colors.primary} />
              <View style={styles.rowText}>
                <Text style={styles.dealsTitle}>Group deals</Text>
                <Text style={styles.dealsBody}>Offer a lower price if enough households join.</Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={colors.primaryDark} />
            </Pressable>
          </View>
        }
        ListEmptyComponent={
          products === null ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <View style={styles.empty}>
              <TabNotice
                icon="eco"
                title="Add your first product"
                body="List what you're selling — price, unit, how many you have, and a photo. Customers see it on your farm page right away."
              />
            </View>
          )
        }
        renderItem={({ item }) => <ProductRow product={item} onPress={() => openEditor(item.id)} />}
      />
    </View>
  );
}

function ProductRow({ product, onPress }: { product: FarmerProduct; onPress: () => void }) {
  const outOfStock = product.quantity_available === 0;
  const lowStock = !outOfStock && product.quantity_available < LOW_STOCK_THRESHOLD;
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed, !product.is_active && styles.rowHidden]} onPress={onPress}>
      {product.image_url ? (
        <Image source={{ uri: product.image_url }} style={styles.photo} contentFit="cover" />
      ) : (
        <View style={[styles.photo, styles.photoEmpty]}>
          <MaterialIcons name="photo-camera" size={20} color={colors.textMuted} />
        </View>
      )}
      <View style={styles.rowText}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.price}>
          ${product.price.toFixed(2)} / {product.unit}
          <Text style={styles.category}>  ·  {product.category_name}</Text>
        </Text>
        <View style={styles.badges}>
          {!product.is_active ? <Badge label="Hidden" color={colors.textMuted} /> : null}
          {outOfStock ? (
            <Badge label="Out of stock" color={colors.danger} />
          ) : (
            <Badge label={`${product.quantity_available} in stock`} color={lowStock ? colors.accent : colors.primary} />
          )}
        </View>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}1A` }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: spacing.xl },
  headerWrap: { marginBottom: spacing.md },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.accent,
    borderRadius: radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  addButtonText: { color: colors.primaryDark, fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 13, marginHorizontal: spacing.lg, marginTop: spacing.md },
  loading: { marginTop: spacing.xl },
  dealsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.tint,
  },
  dealsTitle: { fontFamily: fonts.headlineBold, fontSize: 17, color: colors.primaryDark },
  dealsBody: { fontSize: 12.5, color: colors.text, marginTop: 1 },
  empty: { minHeight: 320 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowHidden: { opacity: 0.6 },
  pressed: { opacity: 0.75 },
  photo: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { fontFamily: fonts.headline, fontSize: 16, color: colors.text },
  price: { fontSize: 13.5, fontWeight: '600', color: colors.text, marginTop: 2 },
  category: { fontWeight: '400', color: colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: 8 },
  badgeText: { fontSize: 11, fontWeight: '700' },
});
