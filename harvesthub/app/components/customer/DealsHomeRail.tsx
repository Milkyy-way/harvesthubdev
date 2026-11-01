import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { dealLine, timeLeft, type CustomerDealCard } from '../../types/deals';
import { DealProgressBar } from './DealProgressBar';
import { SectionTitle } from './SectionTitle';

// Home: group deals that are open near this customer, and the ones they've joined.
export function DealsHomeRail({ deals }: { deals: CustomerDealCard[] }) {
  const router = useRouter();
  if (deals.length === 0) return null;

  return (
    <View>
      <SectionTitle title="Group deals" actionLabel="See all" onAction={() => router.push('/(customer)/deals' as Href)} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {deals.map((deal) => (
          <Pressable
            key={deal.id}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
            onPress={() => router.push(`/(customer)/deals/${deal.id}` as Href)}
            accessibilityRole="button"
          >
            {deal.image_url ? (
              <Image source={{ uri: deal.image_url }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.photoEmpty]}>
                <MaterialIcons name="eco" size={28} color={colors.primary} />
              </View>
            )}
            <Text style={styles.name} numberOfLines={1}>
              {deal.product_name}
            </Text>
            <Text style={styles.price} numberOfLines={1}>
              ${deal.share_price.toFixed(2)} <Text style={styles.regular}>${deal.regular_share_price.toFixed(2)}</Text>
              <Text style={styles.size}> · {deal.share_label}</Text>
            </Text>
            <View style={styles.bar}>
              <DealProgressBar households={deal.households} goal={deal.goal} sharesClaimed={deal.shares_claimed} capacity={deal.capacity} />
            </View>
            <Text style={styles.note} numberOfLines={1}>
              {deal.joined ? "You're in · " : ''}
              {dealLine(deal)}
              {deal.status === 'live' || deal.status === 'early_access' || deal.status === 'goal_met' ? ` · ${timeLeft(deal.deadline_at)}` : ''}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingBottom: spacing.sm },
  card: { width: 232 },
  pressed: { opacity: 0.8 },
  photo: { width: '100%', height: 112, borderRadius: radius.md, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  name: { fontFamily: fonts.headline, fontSize: 16, color: colors.text, marginTop: spacing.sm },
  price: { fontSize: 14, fontWeight: '700', color: colors.primaryDark, marginTop: 1 },
  regular: { fontWeight: '400', color: colors.textMuted, textDecorationLine: 'line-through' },
  size: { fontWeight: '400', color: colors.textMuted },
  bar: { marginTop: spacing.sm },
  note: { fontSize: 12, fontWeight: '600', color: colors.text, marginTop: 2 },
});
