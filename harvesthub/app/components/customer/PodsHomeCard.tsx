import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { PodSummary } from '../../types/pods';

function closes(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long' });
}

// Home's Neighborhood Pods card: what's happening in their pod, or an
// invitation to start one. Tinted, like the Harvest Pass strip above it.
export function PodsHomeCard({ pods }: { pods: PodSummary[] | null }) {
  const router = useRouter();
  if (!pods) return null;
  const pod = pods.find((p) => p.next_orders) ?? pods[0] ?? null;

  let title = 'Share delivery with neighbors';
  let body = 'Start a Neighborhood Pod: one drop point, and the delivery fee split evenly.';
  let action = 'Start a pod';
  if (pod) {
    title = pod.name;
    action = 'Open';
    body = pod.needs_pass
      ? 'Join Harvest Pass to order to your pod.'
      : pod.next_orders
        ? `${pod.next_orders.ordered} of ${pod.next_orders.total} members have ordered from ${pod.next_orders.farm_name}. Orders close ${closes(pod.next_orders.closes_at)}.`
        : pod.status === 'active'
          ? `Active. Order for ${pod.delivery_day} and split the delivery fee.`
          : pod.status === 'paused'
            ? 'Paused. It needs attention to take orders again.'
            : 'Invite neighbors to get your pod going.';
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push((pod ? `/(customer)/pods/${pod.id}` : '/(customer)/pods') as Href)}
      accessibilityRole="button"
    >
      <View style={styles.iconWrap}>
        <MaterialIcons name="groups" size={24} color={colors.primary} />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.label}>{body}</Text>
      </View>
      <View style={styles.cta}>
        <Text style={styles.ctaText}>{action}</Text>
        <MaterialIcons name="chevron-right" size={16} color={colors.primaryDark} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  pressed: { opacity: 0.8 },
  iconWrap: { width: 30, alignItems: 'center' },
  textWrap: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 18, color: colors.primaryDark },
  label: { fontSize: 12.5, lineHeight: 17, color: colors.text, marginTop: 1 },
  cta: { flexDirection: 'row', alignItems: 'center' },
  ctaText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
});
