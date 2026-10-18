import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import { colors, spacing, fonts } from '../../../constants/theme';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { Header } from '../../../components/customer/Header';
import { SavingsTicker } from '../../../components/customer/SavingsTicker';
import { HarvestPassBanner } from '../../../components/customer/HarvestPassBanner';
import { FarmerSpotlightRail } from '../../../components/customer/FarmerSpotlightRail';
import { HarvestPicksRail } from '../../../components/customer/HarvestPicksRail';
import { CategoryRail } from '../../../components/customer/CategoryRail';
import { FarmerFeedList } from '../../../components/customer/FarmerFeedList';
import { SectionTitle } from '../../../components/customer/SectionTitle';
import type {
  Category,
  CartSummary,
  FarmerFeedResponse,
  FarmerSpotlightResponse,
  HarvestPicksResponse,
} from '../../../types/database';
import type { DashboardSummary } from '../../../types/dashboard';
import type { MembershipOverview } from '../../../types/membership';

const PAGE_SIZE = 20;

export default function CustomerHome() {
  const { customerProfile, profile } = useAuth();
  const router = useRouter();

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText, 300);

  const [items, setItems] = useState<FarmerFeedResponse['items']>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartItemCount, setCartItemCount] = useState(0);

  const [spotlight, setSpotlight] = useState<FarmerSpotlightResponse['items']>([]);
  const [harvestPicks, setHarvestPicks] = useState<HarvestPicksResponse['items']>([]);
  const [savingsAmount, setSavingsAmount] = useState<number | null>(null);
  const [membership, setMembership] = useState<MembershipOverview | null>(null);

  const avatarInitial = (profile?.full_name?.trim()?.[0] ?? 'H').toUpperCase();

  useEffect(() => {
    apiClient.get<Category[]>('/categories').then(
      (res) => setCategories(res.data),
      (err) => console.warn('Could not load categories:', err)
    );
  }, []);

  // These three power the hero/spotlight/harvest sections and don't
  // depend on search or category filters — fetched once, refreshed on
  // pull-to-refresh alongside the main feed (see handleRefresh below).
  const loadExtras = useCallback(() => {
    apiClient.get<FarmerSpotlightResponse>('/farmers/spotlight').then(
      (res) => setSpotlight(res.data.items),
      (err) => console.warn('Could not load farmer spotlight:', err)
    );
    apiClient.get<HarvestPicksResponse>('/products/harvest').then(
      (res) => setHarvestPicks(res.data.items),
      (err) => console.warn('Could not load harvest picks:', err)
    );
    apiClient.get<DashboardSummary>('/customers/me/dashboard-summary').then(
      (res) => setSavingsAmount(res.data.savings_all_time),
      (err) => console.warn('Could not load savings summary:', err)
    );
  }, []);

  useEffect(() => {
    loadExtras();
  }, [loadExtras]);

  // Refetched on focus (not just mount) — the cart can change on the farm
  // detail or cart screens, and this badge should reflect that the moment
  // the customer comes back to Home, not just on first load.
  useFocusEffect(
    useCallback(() => {
      apiClient.get<CartSummary>('/cart').then(
        (res) => setCartItemCount(res.data.item_count),
        (err) => console.warn('Could not load cart count:', err)
      );
      // Also on focus: joining Harvest Pass elsewhere should hide the banner.
      apiClient.get<MembershipOverview>('/membership').then(
        (res) => setMembership(res.data),
        (err) => console.warn('Could not load Harvest Pass status:', err)
      );
    }, [])
  );

  const fetchPage = useCallback(
    async (nextOffset: number, replace: boolean) => {
      setError(null);
      if (replace) setLoading(true);
      try {
        const res = await apiClient.get<FarmerFeedResponse>('/farmers/feed', {
          params: {
            category: selectedCategory ?? undefined,
            search: debouncedSearch.trim() || undefined,
            limit: PAGE_SIZE,
            offset: nextOffset,
          },
        });
        setItems((prev) => (replace ? res.data.items : [...prev, ...res.data.items]));
        setTotal(res.data.total);
        setOffset(nextOffset);
      } catch (err) {
        console.warn('Could not load farmer feed:', err);
        setError("Couldn't load nearby farms. Pull down to try again.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedCategory, debouncedSearch]
  );

  useEffect(() => {
    fetchPage(0, true);
    // fetchPage is recreated when selectedCategory/debouncedSearch change —
    // this effect intentionally re-runs on those, not on fetchPage itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory, debouncedSearch]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchPage(0, true);
    loadExtras();
  };

  const handleEndReached = () => {
    if (loading || refreshing || items.length >= total) return;
    fetchPage(offset + PAGE_SIZE, false);
  };

  const trimmedSearch = debouncedSearch.trim();
  const selectedCategoryName = categories.find((c) => c.slug === selectedCategory)?.name ?? selectedCategory;
  // A category or search narrows Home down to just the matching farms — the
  // browse sections (savings, spotlights, harvest) step aside so the results
  // sit right under the search.
  const filtering = Boolean(selectedCategory || trimmedSearch);
  const city = customerProfile?.address_city;

  const emptyMessage = error
    ? error
    : selectedCategory
      ? `No farms currently carry ${selectedCategoryName?.toLowerCase()} near you.`
      : trimmedSearch
        ? `No results for "${trimmedSearch}".`
        : 'No farms nearby yet.';

  const listTitle = selectedCategory
    ? `Farms with ${selectedCategoryName?.toLowerCase()}`
    : trimmedSearch
      ? `Results for “${trimmedSearch}”`
      : total
        ? `${total} farm${total === 1 ? '' : 's'} near you`
        : 'Farms near you';

  const openFarm = (id: string) => router.push({ pathname: '/(customer)/farmer/[id]', params: { id } });
  const clearFilters = () => {
    setSelectedCategory(null);
    setSearchText('');
  };

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <Header
        addressCity={city ?? null}
        searchValue={searchText}
        onSearchChange={setSearchText}
        cartItemCount={cartItemCount}
        onPressCart={() => router.push('/(customer)/cart')}
        avatarInitial={avatarInitial}
      />
      <FarmerFeedList
        items={items}
        loading={loading}
        refreshing={refreshing}
        onRefresh={handleRefresh}
        onEndReached={handleEndReached}
        onPressFarmer={openFarm}
        emptyMessage={emptyMessage}
        header={
          <View>
            {!filtering ? (
              <View style={styles.greeting}>
                <Text style={styles.headline}>What&apos;s fresh {city ? `near ${city}` : 'near you'}</Text>
                <Text style={styles.subheadline}>Straight from local farms, picked this week.</Text>
              </View>
            ) : null}
            <CategoryRail
              variant="icons"
              categories={categories}
              selectedSlug={selectedCategory}
              onSelect={setSelectedCategory}
            />
            {!filtering ? (
              <>
                {savingsAmount != null && savingsAmount > 0 ? <SavingsTicker amount={savingsAmount} /> : null}
                {membership && !membership.membership ? (
                  <HarvestPassBanner trialDays={membership.trial_days} minSubtotal={membership.free_service_fee_min_subtotal} />
                ) : null}
                <FarmerSpotlightRail items={spotlight} onPressFarmer={openFarm} />
                <HarvestPicksRail items={harvestPicks} />
              </>
            ) : null}
            <SectionTitle title={listTitle} actionLabel={filtering ? 'Clear' : undefined} onAction={clearFilters} />
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  greeting: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md },
  headline: { fontFamily: fonts.headline, fontSize: 27, lineHeight: 33, color: colors.text },
  subheadline: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
});
