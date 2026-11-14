import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { PodSummary } from '../../types/pods';

function closes(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long' });
}

// Home's Neighborhood Pods card: what's happening in their pod, or, when
// they're in none, the two ways in side by side: start one, or join with the
// code a neighbor sent (2026-11-14: joining used to be hidden behind "Start").
export function PodsHomeCard({ pods, isMember }: { pods: PodSummary[] | null; isMember: boolean }) {
  const router = useRouter();
  if (!pods) return null;
  const pod = pods.find((p) => p.next_orders) ?? pods[0] ?? null;
  if (!pod) return <JoinOrStart isMember={isMember} />;

  const title = pod.name;
  const action = 'Open';
  const body = pod.needs_pass
    ? 'Join Harvest Pass to order to your pod.'
    : pod.next_orders
      ? `${pod.next_orders.ordered} of ${pod.next_orders.total} members have ordered from ${pod.next_orders.farm_name}. Orders close ${closes(pod.next_orders.closes_at)}.`
      : pod.status === 'active'
        ? `Active. Order for ${pod.delivery_day} and split the delivery fee.`
        : pod.status === 'paused'
          ? 'Paused. It needs attention to take orders again.'
          : 'Invite neighbors to get your pod going.';

  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={() => router.push(`/(customer)/pods/${pod.id}` as Href)}
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

// Not in a pod: what a pod is, then Start a pod / Join with a code.
// Starting needs Harvest Pass, so non-members go to the pods screen, which
// explains that and offers the free month.
function JoinOrStart({ isMember }: { isMember: boolean }) {
  const router = useRouter();
  return (
    <View style={[styles.container, styles.column]}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <MaterialIcons name="groups" size={24} color={colors.primary} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Share delivery with neighbors</Text>
          <Text style={styles.label}>One drop point near you, and the delivery fee split between the neighbors who order.</Text>
        </View>
      </View>
      <View style={styles.buttons}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && styles.pressed]}
          onPress={() => router.push((isMember ? '/(customer)/pods/new' : '/(customer)/pods') as Href)}
          accessibilityRole="button"
        >
          <Text style={styles.buttonPrimaryText}>Start a pod</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.button, styles.buttonOutline, pressed && styles.pressed]}
          onPress={() => router.push({ pathname: '/(customer)/pods', params: { join: '1' } } as Href)}
          accessibilityRole="button"
          accessibilityHint="Enter the invite code a neighbor sent you"
        >
          <Text style={styles.buttonOutlineText}>Join with a code</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  button: { flex: 1, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonPrimaryText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  buttonOutline: { borderWidth: 1.5, borderColor: colors.primary },
  buttonOutlineText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
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
