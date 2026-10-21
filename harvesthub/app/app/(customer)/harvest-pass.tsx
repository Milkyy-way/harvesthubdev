import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  RefreshControl,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import {
  HARVEST_PASS_NAME,
  billingLine,
  cardLine,
  formatLongDate,
  planLabel,
  useCardSetupSheet,
} from '../../lib/harvestPass';
import type {
  HarvestPassPlan,
  Membership,
  MembershipOverview,
  PlanOption,
  PrepareCardUpdateResponse,
  PrepareJoinResponse,
} from '../../types/membership';

// Harvest Pass — every new customer gets it free for their first month (no
// card); then they join (plans) or, as members, manage it (status, savings,
// next charge, card, cancel/resume). Joining saves a card first
// (PaymentSheet, setup mode), then the backend starts the subscription —
// nothing is charged until the free month is over. See
// harvesthub-backend/app/membership/service.py.
export default function HarvestPassScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [overview, setOverview] = useState<MembershipOverview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback((sync: boolean) => {
    const request = sync
      ? apiClient.post<MembershipOverview>('/membership/sync')
      : apiClient.get<MembershipOverview>('/membership');
    return request.then(
      (res) => {
        setOverview(res.data);
        setLoadError(null);
      },
      (err) => {
        console.warn('Could not load Harvest Pass:', err);
        setLoadError("Couldn't load Harvest Pass. Pull down to try again.");
      }
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    load(true).finally(() => setRefreshing(false));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{HARVEST_PASS_NAME}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
      >
        <View style={styles.hero}>
          <Text style={styles.heroEmoji}>🌾</Text>
          <Text style={styles.heroTitle}>{HARVEST_PASS_NAME}</Text>
          <Text style={styles.heroSubtitle}>Fresh from local farms, for less — every order.</Text>
        </View>

        {!overview ? (
          loadError ? (
            <Text style={styles.errorText}>{loadError}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : overview.membership ? (
          <MemberView overview={overview} membership={overview.membership} onChange={setOverview} />
        ) : (
          <JoinView overview={overview} onJoined={setOverview} />
        )}
      </ScrollView>
    </View>
  );
}

// --- Not a member yet ---------------------------------------------------------

function JoinView({
  overview,
  onJoined,
}: {
  overview: MembershipOverview;
  onJoined: (overview: MembershipOverview) => void;
}) {
  const presentCardSheet = useCardSetupSheet();
  const [plan, setPlan] = useState<HarvestPassPlan>('monthly');
  const [joining, setJoining] = useState(false);

  const selected = overview.plans.find((p) => p.plan === plan) ?? overview.plans[0];
  const minSubtotal = `$${overview.free_service_fee_min_subtotal.toFixed(0)}`;
  // Still in the free month: joining now charges nothing until it ends.
  const freeUntil = overview.free_period_active ? overview.free_period_ends_at : null;
  const freeEnded = !overview.free_period_active ? overview.free_period_ends_at : null;

  const handleJoin = async () => {
    if (joining || !selected) return;
    setJoining(true);
    try {
      const prep = await apiClient.post<PrepareJoinResponse>('/membership/prepare', { plan });
      const { setup_intent_id, setup_intent_client_secret, free_until, due_today } = prep.data;
      const saved = await presentCardSheet(
        setup_intent_client_secret,
        free_until ? 'Save card' : `Pay $${due_today.toFixed(2)}`
      );
      if (!saved) return;

      const res = await apiClient.post<MembershipOverview>('/membership/subscribe', { plan, setup_intent_id });
      onJoined(res.data);
      Alert.alert(
        free_until ? "You're all set" : `Welcome to ${HARVEST_PASS_NAME}!`,
        free_until
          ? `Your plan starts ${formatLongDate(free_until)} — nothing is charged until then. Your free month carries on as usual.`
          : `You're a member. No service fee on orders of ${minSubtotal} or more.`
      );
    } catch (err) {
      console.warn('Could not join Harvest Pass:', err);
      Alert.alert("Couldn't start Harvest Pass", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <View>
      {freeUntil ? (
        <View style={styles.freeBanner}>
          <MaterialIcons name="redeem" size={20} color={colors.primaryDark} />
          <Text style={styles.freeBannerText}>
            Your free month is on — <Text style={styles.bold}>no service fee on orders of {minSubtotal}+</Text> until{' '}
            {formatLongDate(freeUntil)}.
          </Text>
        </View>
      ) : freeEnded ? (
        <View style={styles.freeBanner}>
          <MaterialIcons name="event-available" size={20} color={colors.primaryDark} />
          <Text style={styles.freeBannerText}>
            Your free month ended {formatLongDate(freeEnded)}. Join to keep skipping the service fee.
          </Text>
        </View>
      ) : null}

      <Text style={styles.sectionTitle}>What you get</Text>
      <Benefit
        icon="money-off"
        title={`No service fee on orders of ${minSubtotal}+`}
        body="Saved automatically at checkout, on every farm in your order."
      />
      <Benefit icon="savings" title="See what you save" body="Your Harvest Pass savings add up in the app." />
      <Benefit icon="auto-awesome" title="More member perks on the way" body="New benefits are added as they launch." />

      <Text style={styles.sectionTitle}>{freeUntil ? 'Keep it after your free month' : 'Choose your plan'}</Text>
      {overview.plans.map((option) => (
        <PlanRow key={option.plan} option={option} selected={option.plan === plan} onPress={() => setPlan(option.plan)} />
      ))}

      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {freeUntil ? (
            <>
              <Text style={styles.bold}>Nothing to pay today.</Text> Your plan starts {formatLongDate(freeUntil)}, then{' '}
              {billingLine(selected)}. Cancel before then and you won&apos;t be charged.
            </>
          ) : (
            <>
              <Text style={styles.bold}>${selected.billed_amount.toFixed(2)} today</Text>, then {billingLine(selected)}.
            </>
          )}
        </Text>
      </View>

      <Pressable style={[styles.primaryButton, joining && styles.buttonDisabled]} onPress={handleJoin} disabled={joining}>
        {joining ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <Text style={styles.primaryButtonText}>
            {freeUntil ? `Keep it after ${formatLongDate(freeUntil)}` : `Join for $${selected.billed_amount.toFixed(2)}`}
          </Text>
        )}
      </Pressable>
      <Text style={styles.finePrint}>
        Renews automatically until you cancel. Cancel anytime in the app — you keep your benefits until the end of the
        period you paid for.
      </Text>
    </View>
  );
}

function PlanRow({ option, selected, onPress }: { option: PlanOption; selected: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.planRow, selected && styles.planRowSelected]} onPress={onPress}>
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={22}
        color={selected ? colors.primary : colors.border}
      />
      <View style={styles.planText}>
        <View style={styles.planTitleRow}>
          <Text style={styles.planTitle}>{planLabel(option.plan)}</Text>
          {option.discount_percent > 0 ? (
            <View style={styles.saveBadge}>
              <Text style={styles.saveBadgeText}>Save {option.discount_percent}%</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.planCaption}>
          {option.interval_months === 1 ? 'Billed monthly' : `Billed ${billingLine(option)}`}
        </Text>
      </View>
      <Text style={styles.planPrice}>
        ${option.price_per_month.toFixed(2)}
        <Text style={styles.planPer}>/mo</Text>
      </Text>
    </Pressable>
  );
}

function Benefit({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  body: string;
}) {
  return (
    <View style={styles.benefit}>
      <View style={styles.benefitIcon}>
        <MaterialIcons name={icon} size={19} color={colors.primary} />
      </View>
      <View style={styles.benefitText}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitBody}>{body}</Text>
      </View>
    </View>
  );
}

// --- Member -----------------------------------------------------------------------

function MemberView({
  overview,
  membership,
  onChange,
}: {
  overview: MembershipOverview;
  membership: Membership;
  onChange: (overview: MembershipOverview) => void;
}) {
  const presentCardSheet = useCardSetupSheet();
  const [busy, setBusy] = useState<null | 'cancel' | 'resume' | 'card'>(null);

  const minSubtotal = `$${overview.free_service_fee_min_subtotal.toFixed(0)}`;
  const card = cardLine(membership.card_brand, membership.card_last4);
  const paymentProblem = !membership.has_benefits || membership.status === 'past_due';

  const status = (() => {
    if (!membership.has_benefits) {
      return { icon: 'error-outline' as const, tone: 'danger' as const, text: 'Paused — your last payment didn’t go through' };
    }
    if (membership.status === 'past_due') {
      return { icon: 'error-outline' as const, tone: 'danger' as const, text: 'Payment failed — please update your card' };
    }
    if (membership.cancel_at_period_end && membership.ends_at) {
      return { icon: 'event-busy' as const, tone: 'muted' as const, text: `Canceled — benefits until ${formatLongDate(membership.ends_at)}` };
    }
    if (membership.status === 'trialing' && membership.trial_end) {
      return { icon: 'hourglass-top' as const, tone: 'good' as const, text: `Free month — plan starts ${formatLongDate(membership.trial_end)}` };
    }
    return { icon: 'verified' as const, tone: 'good' as const, text: "You're a member" };
  })();

  const run = async (kind: 'cancel' | 'resume', path: string) => {
    setBusy(kind);
    try {
      const res = await apiClient.post<MembershipOverview>(path);
      onChange(res.data);
    } catch (err) {
      Alert.alert('Something went wrong', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const confirmCancel = () => {
    const until = membership.status === 'trialing' ? membership.trial_end : membership.current_period_end;
    Alert.alert(
      `Cancel ${HARVEST_PASS_NAME}?`,
      until
        ? `You'll keep your benefits until ${formatLongDate(until)} and won't be charged again.`
        : "You won't be charged again.",
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Cancel membership', style: 'destructive', onPress: () => run('cancel', '/membership/cancel') },
      ]
    );
  };

  const updateCard = async () => {
    setBusy('card');
    try {
      const prep = await apiClient.post<PrepareCardUpdateResponse>('/membership/payment-method/prepare');
      const saved = await presentCardSheet(prep.data.setup_intent_client_secret, 'Save card');
      if (!saved) return;
      const res = await apiClient.post<MembershipOverview>('/membership/payment-method', {
        setup_intent_id: prep.data.setup_intent_id,
      });
      onChange(res.data);
      Alert.alert('Card updated', 'Your Harvest Pass will renew on this card.');
    } catch (err) {
      Alert.alert("Couldn't update your card", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const nextChargeValue = membership.cancel_at_period_end
    ? 'None — canceled'
    : membership.renews_at
      ? `$${membership.price_amount.toFixed(2)} on ${formatLongDate(membership.renews_at)}`
      : '—';

  return (
    <View>
      <View
        style={[
          styles.statusPill,
          status.tone === 'danger' && styles.statusPillDanger,
          status.tone === 'muted' && styles.statusPillMuted,
        ]}
      >
        <MaterialIcons
          name={status.icon}
          size={18}
          color={status.tone === 'danger' ? colors.danger : status.tone === 'muted' ? colors.textMuted : colors.primary}
        />
        <Text style={[styles.statusText, status.tone === 'danger' && styles.statusTextDanger]}>{status.text}</Text>
      </View>

      <View style={styles.savingsBlock}>
        <Text style={styles.savingsAmount}>${overview.total_savings.toFixed(2)}</Text>
        <Text style={styles.savingsLabel}>saved with {HARVEST_PASS_NAME}</Text>
        <Text style={styles.savingsHint}>No service fee on orders of {minSubtotal} or more.</Text>
      </View>

      <Text style={styles.sectionTitle}>Your plan</Text>
      <DetailRow label="Plan" value={`${planLabel(membership.plan)} · $${membership.price_per_month.toFixed(2)}/mo`} />
      <DetailRow label="Next charge" value={nextChargeValue} />
      <DetailRow label="Card" value={card ?? 'On file'} />

      <Pressable
        style={[paymentProblem ? styles.primaryButton : styles.secondaryButton, busy === 'card' && styles.buttonDisabled]}
        onPress={updateCard}
        disabled={busy !== null}
      >
        {busy === 'card' ? (
          <ActivityIndicator size="small" color={paymentProblem ? colors.white : colors.primary} />
        ) : (
          <Text style={paymentProblem ? styles.primaryButtonText : styles.secondaryButtonText}>Update card</Text>
        )}
      </Pressable>

      {membership.cancel_at_period_end ? (
        <Pressable
          style={[styles.primaryButton, busy === 'resume' && styles.buttonDisabled]}
          onPress={() => run('resume', '/membership/resume')}
          disabled={busy !== null}
        >
          {busy === 'resume' ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.primaryButtonText}>Keep {HARVEST_PASS_NAME}</Text>
          )}
        </Pressable>
      ) : (
        <Pressable style={styles.cancelLink} onPress={confirmCancel} disabled={busy !== null} hitSlop={8}>
          {busy === 'cancel' ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text style={styles.cancelLinkText}>Cancel membership</Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
  content: { paddingHorizontal: spacing.lg },
  loading: { marginTop: spacing.xl },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  bold: { fontWeight: '700', color: colors.text },

  hero: {
    backgroundColor: `${colors.accent}2E`,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  heroEmoji: { fontSize: 36 },
  heroTitle: { fontFamily: fonts.headlineBold, fontSize: 28, color: colors.primaryDark, marginTop: spacing.xs },
  heroSubtitle: { fontSize: 13.5, color: colors.text, marginTop: 2, textAlign: 'center' },

  sectionTitle: { fontFamily: fonts.headline, fontSize: 20, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },

  freeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  freeBannerText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },

  benefit: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitText: { flex: 1 },
  benefitTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  benefitBody: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },

  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  planRowSelected: { borderColor: colors.primary, backgroundColor: colors.tint },
  planText: { flex: 1 },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  planTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  planCaption: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  planPrice: { fontSize: 17, fontWeight: '700', color: colors.text },
  planPer: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  saveBadge: { backgroundColor: `${colors.accent}40`, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  saveBadgeText: { fontSize: 11, fontWeight: '700', color: colors.primaryDark },

  summary: { marginTop: spacing.lg, marginBottom: spacing.md },
  summaryText: { fontSize: 13.5, lineHeight: 20, color: colors.textMuted },

  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  secondaryButtonText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  finePrint: { fontSize: 11.5, lineHeight: 16, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'center',
    backgroundColor: colors.tint,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  statusPillDanger: { backgroundColor: '#F6E7E5' },
  statusPillMuted: { backgroundColor: colors.border },
  statusText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  statusTextDanger: { color: colors.danger },

  savingsBlock: { alignItems: 'center', marginTop: spacing.lg },
  savingsAmount: { fontFamily: fonts.headlineBold, fontSize: 40, color: colors.primaryDark },
  savingsLabel: { fontSize: 14, color: colors.text },
  savingsHint: { fontSize: 12.5, color: colors.textMuted, marginTop: spacing.xs },

  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  detailLabel: { fontSize: 14, color: colors.textMuted },
  detailValue: { fontSize: 14, fontWeight: '600', color: colors.text, flexShrink: 1, textAlign: 'right', marginLeft: spacing.md },

  cancelLink: { alignItems: 'center', paddingVertical: spacing.lg },
  cancelLinkText: { fontSize: 14, fontWeight: '600', color: colors.danger },
});
