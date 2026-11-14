import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { formatMoney } from '../../lib/format';
import type { MembershipOverview } from '../../types/membership';

const DAY = 24 * 60 * 60 * 1000;

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type State = { status: string; action: string; startFree?: boolean };

// What the card says, by where the customer is with Harvest Pass.
function describe(o: MembershipOverview): State {
  const m = o.membership;
  if (o.free_period_available) return { status: `Free for ${o.free_days} days. No card needed.`, action: 'Start free month', startFree: true };
  if (m && (!m.has_benefits || m.status === 'past_due')) return { status: 'Payment problem: update your card to keep your perks.', action: 'Update card' };
  if (o.free_period_active && o.free_period_ends_at) {
    const left = Math.max(1, Math.ceil((Date.parse(o.free_period_ends_at) - Date.now()) / DAY));
    const ends = shortDate(o.free_period_ends_at);
    if (m && m.status === 'trialing' && !m.cancel_at_period_end) return { status: `Free until ${ends}, then your plan starts.`, action: 'Details' };
    return { status: `${left} day${left === 1 ? '' : 's'} left of your free month.`, action: `Keep it after ${ends}` };
  }
  if (m?.has_benefits) {
    if (m.cancel_at_period_end && m.ends_at) return { status: `Your perks end ${shortDate(m.ends_at)}.`, action: 'Details' };
    return { status: 'Member. Your perks are on.', action: 'Details' };
  }
  return { status: `Join for $${o.monthly_price.toFixed(0)} a month, less on a longer plan.`, action: 'Join' };
}

type Props = {
  overview: MembershipOverview | null;
  /** The new overview after Start free month, so Home updates at once. */
  onChanged: (next: MembershipOverview) => void;
};

// Home's Harvest Pass card (2026-11-14): one membership with its three perks,
// like Prime or DashPass, instead of two thin strips. Pods need the Pass and
// members see group deals a day early, so they're shown as its perks. It
// changes with the customer: free to start, days left, savings, or a payment
// problem.
export function HarvestPassCard({ overview, onChanged }: Props) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  if (!overview) return null;

  const state = describe(overview);
  const min = overview.free_service_fee_min_subtotal.toFixed(0);
  const saved = overview.total_savings;
  const openPass = () => router.push('/(customer)/harvest-pass');

  const startFree = async () => {
    setStarting(true);
    try {
      onChanged((await apiClient.post<MembershipOverview>('/membership/start-free')).data);
    } catch (err) {
      Alert.alert("Couldn't start your free month", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable onPress={openPass} accessibilityRole="button" accessibilityHint="Opens Harvest Pass">
        <View style={styles.titleRow}>
          <Text style={styles.emoji}>🌾</Text>
          <Text style={styles.title}>Harvest Pass</Text>
        </View>
        <Text style={styles.status}>{state.status}</Text>
        {saved > 0 ? <Text style={styles.saved}>{formatMoney(saved)} saved so far</Text> : null}
      </Pressable>

      <View style={styles.perks}>
        <Perk icon="receipt-long" title="No service fee" detail={`on $${min}+ orders`} onPress={openPass} />
        <Perk icon="groups" title="Pods" detail="split delivery" onPress={() => router.push('/(customer)/pods' as Href)} />
        <Perk icon="bolt" title="Group deals" detail="24h early" onPress={() => router.push('/(customer)/deals' as Href)} />
      </View>

      {state.startFree ? (
        <Pressable
          style={({ pressed }) => [styles.primary, (pressed || starting) && styles.pressed]}
          onPress={startFree}
          disabled={starting}
          accessibilityRole="button"
        >
          {starting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>{state.action}</Text>}
        </Pressable>
      ) : (
        <Pressable style={styles.link} onPress={openPass} accessibilityRole="button" hitSlop={8}>
          <Text style={styles.linkText}>{state.action}</Text>
          <MaterialIcons name="chevron-right" size={18} color={colors.primaryDark} />
        </Pressable>
      )}
    </View>
  );
}

function Perk({ icon, title, detail, onPress }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; title: string; detail: string; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.perk, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${detail}`}
    >
      <MaterialIcons name={icon} size={20} color={colors.primary} />
      <Text style={styles.perkTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.perkDetail} numberOfLines={1}>
        {detail}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  emoji: { fontSize: 24 },
  title: { fontFamily: fonts.headlineBold, fontSize: 21, color: colors.primaryDark },
  status: { fontSize: 13.5, lineHeight: 19, color: colors.text, marginTop: 4 },
  saved: { fontSize: 13.5, fontWeight: '700', color: colors.primary, marginTop: 2 },
  perks: { flexDirection: 'row', gap: spacing.sm },
  perk: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 2,
  },
  perkTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginTop: 2 },
  perkDetail: { fontSize: 11.5, color: colors.textMuted },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 2,
  },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.8 },
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.primaryDark },
});
