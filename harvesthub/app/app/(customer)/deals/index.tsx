import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { DealProgressBar } from '../../../components/customer/DealProgressBar';
import { dealLine, timeLeft, type CustomerDealCard } from '../../../types/deals';

// Group deals near this customer, or one farm's (?farmer_id=). Yours come first.
export default function CustomerDealsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { farmer_id: farmerId } = useLocalSearchParams<{ farmer_id?: string }>();
  const [deals, setDeals] = useState<CustomerDealCard[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<{ deals: CustomerDealCard[] }>('/deals', { params: farmerId ? { farmer_id: farmerId } : undefined });
      setDeals(res.data.deals);
      setError(null);
    } catch (err) {
      setError(apiErrorMessage(err, "Couldn't load group deals. Pull down to try again."));
    } finally {
      setRefreshing(false);
    }
  }, [farmerId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Group deals</Text>
        <View style={styles.back} />
      </View>
      <FlatList
        data={deals ?? []}
        keyExtractor={(d) => d.id}
        contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + spacing.xl }]}
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
          <>
            <Text style={styles.intro}>Join with your neighbors. If enough households join, everyone gets the lower price. If not, nobody pays.</Text>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        }
        ListEmptyComponent={
          deals === null && !error ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : deals?.length === 0 ? (
            <Text style={styles.empty}>No group deals right now. Check back soon.</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            onPress={() => router.push(`/(customer)/deals/${item.id}` as Href)}
            accessibilityRole="button"
          >
            <View style={styles.rowTop}>
              {item.image_url ? (
                <Image source={{ uri: item.image_url }} style={styles.photo} contentFit="cover" />
              ) : (
                <View style={[styles.photo, styles.photoEmpty]}>
                  <MaterialIcons name="eco" size={22} color={colors.primary} />
                </View>
              )}
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {item.product_name}
                </Text>
                <Text style={styles.farm} numberOfLines={1}>
                  {item.farm_name}
                </Text>
                <Text style={styles.price}>
                  ${item.share_price.toFixed(2)} <Text style={styles.regular}>${item.regular_share_price.toFixed(2)}</Text>
                  <Text style={styles.size}> · {item.share_label}</Text>
                </Text>
              </View>
            </View>
            <DealProgressBar households={item.households} goal={item.goal} sharesClaimed={item.shares_claimed} capacity={item.capacity} />
            <Text style={styles.note}>
              {item.joined ? "You're in · " : ''}
              {dealLine(item)}
              {item.status === 'live' || item.status === 'early_access' || item.status === 'goal_met' ? ` · ${timeLeft(item.deadline_at)}` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  list: { paddingHorizontal: spacing.lg },
  intro: { fontSize: 14, lineHeight: 20, color: colors.text, marginBottom: spacing.sm },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
  loading: { marginTop: spacing.xl },
  empty: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  rowTop: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  pressed: { opacity: 0.75 },
  photo: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1 },
  name: { fontFamily: fonts.headline, fontSize: 16, color: colors.text },
  farm: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  price: { fontSize: 14, fontWeight: '700', color: colors.primaryDark, marginTop: 2 },
  regular: { fontWeight: '400', color: colors.textMuted, textDecorationLine: 'line-through' },
  size: { fontWeight: '400', color: colors.textMuted },
  note: { fontSize: 12.5, fontWeight: '600', color: colors.text },
});
