import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import type { CustomerDealCard } from '../../types/deals';
import { FollowFarmButton } from './FollowFarmButton';

// A farm's page: follow it, and any group deals it has running.
export function FarmDealsRow({ farmerId }: { farmerId: string }) {
  const router = useRouter();
  const [deals, setDeals] = useState<CustomerDealCard[]>([]);

  useEffect(() => {
    let active = true;
    apiClient.get<{ deals: CustomerDealCard[] }>('/deals', { params: { farmer_id: farmerId } }).then(
      (res) => {
        if (active) setDeals(res.data.deals);
      },
      (err) => console.warn("Could not load this farm's deals:", err)
    );
    return () => {
      active = false;
    };
  }, [farmerId]);

  const open = () =>
    deals.length === 1
      ? router.push(`/(customer)/deals/${deals[0].id}` as Href)
      : router.push({ pathname: '/(customer)/deals', params: { farmer_id: farmerId } } as unknown as Href);

  return (
    <View style={styles.wrap}>
      <FollowFarmButton farmerId={farmerId} />
      {deals.length > 0 ? (
        <Pressable style={({ pressed }) => [styles.deals, pressed && styles.pressed]} onPress={open} accessibilityRole="button">
          <MaterialIcons name="groups" size={22} color={colors.primary} />
          <View style={styles.text}>
            <Text style={styles.title}>{deals.length === 1 ? `Group deal: ${deals[0].product_name}` : `${deals.length} group deals`}</Text>
            <Text style={styles.body}>A lower price if enough households join.</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={colors.primaryDark} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, marginTop: spacing.sm, gap: spacing.sm },
  deals: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.tint },
  pressed: { opacity: 0.8 },
  text: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 17, color: colors.primaryDark },
  body: { fontSize: 12.5, color: colors.text, marginTop: 1 },
});
