import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { useAuth } from '../../contexts/AuthContext';
import { formatLongDate } from '../../lib/harvestPass';
import type { MembershipOverview } from '../../types/membership';

// Once per session: when the app has been fully closed and reopened, or after
// signing in. In memory on purpose, so a new session means it shows again.
let shownForUser: string | null = null;

// What Harvest Pass gives this customer, and where they stand: decided with
// the user 2026-10-31 to show on every new session, dismissible with one tap.
export function HarvestPassWelcome({
  overview,
  onChanged,
}: {
  overview: MembershipOverview | null;
  onChanged: (overview: MembershipOverview) => void;
}) {
  const { session } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const [starting, setStarting] = useState(false);
  const userId = session?.user.id ?? null;

  useEffect(() => {
    if (!overview || !userId || shownForUser === userId) return;
    shownForUser = userId;
    setVisible(true);
  }, [overview, userId]);

  if (!overview) return null;
  const min = `$${overview.free_service_fee_min_subtotal.toFixed(0)}`;
  const hasIt = overview.is_member;
  const canStart = overview.free_period_available;

  const title = canStart
    ? `Your first ${overview.free_days} days of Harvest Pass are free`
    : overview.membership?.has_benefits
      ? 'Your Harvest Pass is active'
      : overview.free_period_active && overview.free_period_ends_at
        ? `Harvest Pass: free until ${formatLongDate(overview.free_period_ends_at)}`
        : 'Get Harvest Pass';

  const start = async () => {
    setStarting(true);
    try {
      const res = await apiClient.post<MembershipOverview>('/membership/start-free');
      onChanged(res.data);
      setVisible(false);
    } catch (err) {
      Alert.alert("Couldn't start your free month", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setStarting(false);
    }
  };

  const go = (href: Href) => {
    setVisible(false);
    router.push(href);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => setVisible(false)}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismissArea} onPress={() => setVisible(false)} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{hasIt ? 'Your special access:' : 'Members get:'}</Text>

          <Benefit icon="money-off" title={`No service fee on orders of ${min}+`} body="Taken off automatically at checkout." />
          <Benefit
            icon="groups"
            title="Neighborhood Pods"
            body="Share a drop point with neighbors and split the delivery fee. Members only."
          />
          {overview.total_savings > 0 ? (
            <Benefit icon="savings" title={`$${overview.total_savings.toFixed(2)} saved so far`} body="With Harvest Pass." />
          ) : null}

          {canStart ? (
            <>
              <Pressable style={[styles.primary, starting && styles.disabled]} onPress={start} disabled={starting}>
                {starting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Start free month</Text>}
              </Pressable>
              <Text style={styles.fine}>No card needed. Nothing is charged, and it doesn&apos;t renew by itself.</Text>
            </>
          ) : hasIt ? (
            <Pressable style={styles.primary} onPress={() => go('/(customer)/pods' as Href)}>
              <Text style={styles.primaryText}>See Neighborhood Pods</Text>
            </Pressable>
          ) : (
            <Pressable style={styles.primary} onPress={() => go('/(customer)/harvest-pass')}>
              <Text style={styles.primaryText}>See plans</Text>
            </Pressable>
          )}
          <Pressable style={styles.secondary} onPress={() => setVisible(false)}>
            <Text style={styles.secondaryText}>{hasIt ? 'Start shopping' : 'Not now'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Benefit({ icon, title, body }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; title: string; body: string }) {
  return (
    <View style={styles.benefit}>
      <View style={styles.iconWrap}>
        <MaterialIcons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.benefitText}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, lineHeight: 30, color: colors.text },
  subtitle: { fontSize: 13.5, fontWeight: '600', color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  benefit: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs + 2 },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1 },
  benefitTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  benefitBody: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 1 },
  primary: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  fine: { fontSize: 12, textAlign: 'center', color: colors.textMuted, marginTop: spacing.xs },
  secondary: { paddingVertical: 12, alignItems: 'center' },
  secondaryText: { color: colors.textMuted, fontSize: 14.5, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
