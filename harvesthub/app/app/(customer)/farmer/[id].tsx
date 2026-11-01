import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { FarmerDetailHeader } from '../../../components/customer/FarmerDetailHeader';
import { FarmDealsRow } from '../../../components/customer/FarmDealsRow';
import { CategoryRail } from '../../../components/customer/CategoryRail';
import { SearchBar } from '../../../components/customer/SearchBar';
import { ProductCard } from '../../../components/customer/ProductCard';
import { ProductCardGrid } from '../../../components/customer/ProductCardGrid';
import { CartTotalBar } from '../../../components/customer/CartTotalBar';
import type { Category, CartActionResponse, FarmerDetail, ProductItem } from '../../../types/database';

type ViewMode = 'list' | 'grid';

export default function FarmerDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [farmer, setFarmer] = useState<FarmerDetail | null>(null);
  const [farmerError, setFarmerError] = useState<string | null>(null);
  const [loadingFarmer, setLoadingFarmer] = useState(true);

  const [allCategories, setAllCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(true);

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [pendingProductId, setPendingProductId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadingFarmer(true);
    apiClient
      .get<FarmerDetail>(`/farmers/${id}`)
      .then((res) => {
        if (cancelled) return;
        setFarmer(res.data);
        setFarmerError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Could not load farm details:', err);
        setFarmerError("Couldn't load this farm's details.");
      })
      .finally(() => {
        if (!cancelled) setLoadingFarmer(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    apiClient.get<Category[]>('/categories').then(
      (res) => setAllCategories(res.data),
      (err) => console.warn('Could not load categories:', err)
    );
  }, []);

  // Fetched once, unfiltered — the farm's product count is small enough
  // that category filtering and alphabetical sorting happen client-side
  // (see displayedProducts below). This also keeps the running total
  // correct while a category filter is active: it's derived from the full
  // `products` list, not whatever subset is currently displayed.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoadingProducts(true);
    apiClient
      .get<ProductItem[]>('/products', { params: { farmer_id: id } })
      .then((res) => {
        if (cancelled) return;
        setProducts(res.data);
        setProductsError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('Could not load products:', err);
        setProductsError("Couldn't load this farm's products.");
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const farmCategories = useMemo(() => {
    const carriedSlugs = new Set(products.map((p) => p.category_slug));
    return allCategories.filter((c) => carriedSlugs.has(c.slug));
  }, [allCategories, products]);

  const displayedProducts = useMemo(() => {
    let filtered = selectedCategory ? products.filter((p) => p.category_slug === selectedCategory) : products;
    const trimmedSearch = debouncedSearch.trim().toLowerCase();
    if (trimmedSearch) {
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(trimmedSearch));
    }
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  }, [products, selectedCategory, debouncedSearch]);

  const cartTotal = useMemo(() => products.reduce((sum, p) => sum + p.price * p.cart_quantity, 0), [products]);
  const cartCount = useMemo(() => products.reduce((sum, p) => sum + p.cart_quantity, 0), [products]);

  const setProductQuantity = useCallback((productId: string, quantity: number) => {
    setProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, cart_quantity: quantity } : p)));
  }, []);

  const handleIncrement = useCallback(
    async (product: ProductItem) => {
      if (pendingProductId || product.cart_quantity >= product.quantity_available) return;
      setPendingProductId(product.id);
      setProductQuantity(product.id, product.cart_quantity + 1); // optimistic
      try {
        const res = await apiClient.post<CartActionResponse>(`/cart/items/${product.id}/increment`);
        setProductQuantity(product.id, res.data.quantity);
      } catch (err) {
        console.warn('Could not add item to cart:', err);
        setProductQuantity(product.id, product.cart_quantity); // rollback
      } finally {
        setPendingProductId(null);
      }
    },
    [pendingProductId, setProductQuantity]
  );

  const handleDecrement = useCallback(
    async (product: ProductItem) => {
      if (pendingProductId || product.cart_quantity <= 0) return;
      setPendingProductId(product.id);
      setProductQuantity(product.id, product.cart_quantity - 1); // optimistic
      try {
        const res = await apiClient.post<CartActionResponse>(`/cart/items/${product.id}/decrement`);
        setProductQuantity(product.id, res.data.quantity);
      } catch (err) {
        console.warn('Could not update cart:', err);
        setProductQuantity(product.id, product.cart_quantity); // rollback
      } finally {
        setPendingProductId(null);
      }
    },
    [pendingProductId, setProductQuantity]
  );

  if (loadingFarmer) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (farmerError || !farmer) {
    return (
      <View style={styles.center}>
        <Text style={styles.messageText}>{farmerError ?? 'Farm not found.'}</Text>
      </View>
    );
  }

  const trimmedSearch = debouncedSearch.trim();
  const emptyMessage = productsError
    ? productsError
    : trimmedSearch
      ? `No products match "${trimmedSearch}".`
      : 'No products available right now.';

  return (
    <View style={styles.container}>
      <FlatList
        // Forces a remount when the column count changes — FlatList can't
        // change numColumns on a mounted instance (see React Native's own
        // warning on this); this is the standard workaround.
        key={viewMode}
        data={displayedProducts}
        keyExtractor={(item) => item.id}
        style={styles.list}
        numColumns={viewMode === 'grid' ? 2 : 1}
        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
        ListHeaderComponent={
          <>
            <FarmerDetailHeader farmer={farmer} />
            <FarmDealsRow farmerId={farmer.id} />
            <SearchBar value={searchText} onChangeText={setSearchText} placeholder="Search this farm's products" />
            <View style={styles.toolsRow}>
              <View style={styles.categoryRailWrap}>
                {farmCategories.length > 0 ? (
                  <CategoryRail categories={farmCategories} selectedSlug={selectedCategory} onSelect={setSelectedCategory} />
                ) : null}
              </View>
              <View style={styles.viewToggle}>
                <Pressable
                  style={[styles.viewToggleButton, viewMode === 'list' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('list')}
                  hitSlop={6}
                >
                  <MaterialIcons name="view-agenda" size={17} color={viewMode === 'list' ? colors.white : colors.textMuted} />
                </Pressable>
                <Pressable
                  style={[styles.viewToggleButton, viewMode === 'grid' && styles.viewToggleButtonActive]}
                  onPress={() => setViewMode('grid')}
                  hitSlop={6}
                >
                  <MaterialIcons name="grid-view" size={16} color={viewMode === 'grid' ? colors.white : colors.textMuted} />
                </Pressable>
              </View>
            </View>
          </>
        }
        renderItem={({ item }) =>
          viewMode === 'grid' ? (
            <ProductCardGrid
              product={item}
              pending={pendingProductId === item.id}
              onIncrement={() => handleIncrement(item)}
              onDecrement={() => handleDecrement(item)}
            />
          ) : (
            <ProductCard
              product={item}
              pending={pendingProductId === item.id}
              onIncrement={() => handleIncrement(item)}
              onDecrement={() => handleDecrement(item)}
            />
          )
        }
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          loadingProducts ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.center}>
              <Text style={styles.messageText}>{emptyMessage}</Text>
            </View>
          )
        }
      />
      <CartTotalBar itemCount={cartCount} total={cartTotal} onPress={() => router.push('/(customer)/cart')} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  messageText: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  toolsRow: { flexDirection: 'row', alignItems: 'center', paddingRight: spacing.lg, marginBottom: spacing.sm },
  categoryRailWrap: { flex: 1 },
  viewToggle: {
    flexDirection: 'row',
    gap: 2,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    padding: 3,
  },
  viewToggleButton: { width: 30, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  viewToggleButtonActive: { backgroundColor: colors.primary },
  gridRow: { paddingHorizontal: spacing.lg, gap: spacing.md },
});
