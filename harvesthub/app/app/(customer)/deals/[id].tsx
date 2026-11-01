import { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Share, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { useCardSetupSheet } from '../../../lib/harvestPass';
import { APP_SHARE_URL } from '../../../constants/legal';
import { ALMOST_THERE, DealProgressBar } from '../../../components/customer/DealProgressBar';
import { FollowFarmButton } from '../../../components/customer/FollowFarmButton';
import { timeLeft, type CustomerDeal, type DealQuote } from '../../../types/deals';

const when = (iso: string) =>
  `${new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  })} ET`;
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
const money = (n: number) => `$${n.toFixed(2)}`;

// One group deal: how it stands, what it would cost this customer, and joining
// with a saved card that's charged only if the deal unlocks. Nothing is charged
// here. See harvesthub-backend/app/deals/customer.py and closing.py.
export default function CustomerDealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const saveCard = useCardSetupSheet();

  const [deal, setDeal] = useState<CustomerDeal | null>(null);
  const [units, setUnits] = useState(1);
  const [method, setMethod] = useState<'pickup' | 'delivery' | 'pod'>('pickup');
  const [podId, setPodId] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [quote, setQuote] = useState<DealQuote | null>(null);
  const [showWhy, setShowWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  // Re-renders the countdown.
  const [, setTick] = useState(0);

  const load = useCallback(() => {
    apiClient.get<CustomerDeal>(`/deals/${id}`).then(
      (res) => setDeal(res.data),
      (err) => Alert.alert("Couldn't load this deal", apiErrorMessage(err, 'Please try again.'))
    );
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(() => setTick((t) => t + 1), 60000);
      return () => clearInterval(timer);
    }, [load])
  );

  const canJoin = deal?.can_join ?? false;

  useEffect(() => {
    if (!canJoin) return;
    let active = true;
    apiClient.post<DealQuote>(`/deals/${id}/quote`, {
      units,
      fulfillment_method: method === 'pickup' ? 'pickup' : 'delivery',
      pod_id: method === 'pod' ? podId : null,
    }).then(
      (res) => {
        if (active) setQuote(res.data);
      },
      (err) => {
        if (active) setQuote(null);
        console.warn('Could not price the deal:', err);
      }
    );
    return () => {
      active = false;
    };
  }, [id, canJoin, units, method, podId]);

  if (!deal) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const commit = deal.my_commit;
  const running = deal.status === 'early_access' || deal.status === 'live' || deal.status === 'goal_met' || deal.status === 'full';
  const left = Math.max(deal.goal - deal.households, 0);
  const almost = deal.status !== 'goal_met' && deal.households / deal.goal >= ALMOST_THERE;
  const sharesLeft = Math.max(deal.capacity - deal.shares_claimed, 0);
  const inEarlyAccess = deal.status === 'early_access';
  const needsPass = inEarlyAccess && !deal.is_member;
  const chosenPod = method === 'pod' ? (deal.pods.find((p) => p.pod_id === podId) ?? null) : null;
  const heldForMe = deal.waitlist?.status === 'offered' ? deal.waitlist : null;

  const headline = deal.filled_by_members
    ? 'Filled by members'
    : deal.status === 'full'
      ? `All ${deal.capacity} shares claimed`
      : deal.status === 'goal_met'
        ? `Unlocked · ${money(deal.share_price)}`
        : deal.status === 'unlocked'
          ? 'It unlocked!'
          : deal.status === 'expired'
            ? `Didn't reach ${deal.goal} households`
            : deal.status === 'cancelled'
              ? 'The farm cancelled this deal'
              : deal.status === 'closing'
                ? 'Closing now'
                : almost
                  ? `Just ${left} more to unlock`
                  : `${deal.households} of ${deal.goal} households`;
  const subline = inEarlyAccess
    ? `Members joining now · open to everyone in ${timeLeft(deal.public_opens_at, true)}`
    : deal.status === 'goal_met'
      ? `${sharesLeft} of ${deal.capacity} shares left · charged at close`
      : deal.status === 'expired'
        ? 'The deal expired. No one was charged.'
        : deal.status === 'live' && !almost
          ? `${left} more to unlock ${money(deal.share_price)}`
          : deal.status === 'live'
            ? `${deal.households} of ${deal.goal} households have joined`
            : null;

  const shareDeal = () => {
    Share.share({
      message: `Join me on this group deal: ${deal.product_name} from ${deal.farm_name}, ${money(deal.share_price)} instead of ${money(
        deal.regular_share_price
      )} if ${deal.goal} households join. Find it in the HarvestHub app.\n\n${APP_SHARE_URL}`,
    }).catch((err) => console.warn('Share failed:', err));
  };

  const joinDeal = async () => {
    if (method !== 'pickup' && !slot) {
      Alert.alert('Pick a delivery time', 'Choose when you want it delivered.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<{ setup_intent_client_secret: string }>(`/deals/${id}/join`, {
        units,
        fulfillment_method: method === 'pickup' ? 'pickup' : 'delivery',
        delivery_starts_at: method === 'pickup' ? null : slot,
        pod_id: method === 'pod' ? podId : null,
      });
      if (await saveCard(res.data.setup_intent_client_secret, 'Save card and join')) {
        const joined = await apiClient.post<CustomerDeal>(`/deals/${id}/join/confirm`);
        setDeal(joined.data);
      }
    } catch (err) {
      Alert.alert("Couldn't join this deal", apiErrorMessage(err, 'Please try again.'));
      load();
    } finally {
      setBusy(false);
    }
  };

  const withdraw = () =>
    Alert.alert('Withdraw from this deal?', "You won't be charged, and the count goes down by one.", [
      { text: 'Stay in', style: 'cancel' },
      {
        text: 'Withdraw',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await apiClient.post<CustomerDeal>(`/deals/${id}/withdraw`);
            setDeal(res.data);
          } catch (err) {
            Alert.alert("Couldn't withdraw", apiErrorMessage(err, 'Please try again.'));
            load();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const startFreeMonth = async () => {
    setBusy(true);
    try {
      await apiClient.post('/membership/start-free');
      load();
    } catch (err) {
      Alert.alert("Couldn't start your free month", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const joinWaitlist = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<CustomerDeal>(`/deals/${id}/waitlist`);
      setDeal(res.data);
    } catch (err) {
      Alert.alert("Couldn't join the waitlist", apiErrorMessage(err, 'Please try again.'));
      load();
    } finally {
      setBusy(false);
    }
  };

  const leaveWaitlist = async () => {
    setBusy(true);
    try {
      const res = await apiClient.delete<CustomerDeal>(`/deals/${id}/waitlist`);
      setDeal(res.data);
    } catch (err) {
      Alert.alert("Couldn't leave the waitlist", apiErrorMessage(err, 'Please try again.'));
      load();
    } finally {
      setBusy(false);
    }
  };

  const buyRegular = () => {
    if (!deal.fallback) return;
    Alert.alert('Buy at the regular price?', `We'll charge ${money(deal.fallback.total)} to the card you saved for this deal.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Buy',
        onPress: async () => {
          setBusy(true);
          try {
            const res = await apiClient.post<CustomerDeal>(`/deals/${id}/regular-price`);
            setDeal(res.data);
            if (res.data.my_commit?.order_id) router.push(`/(customer)/orders/${res.data.my_commit.order_id}` as Href);
          } catch (err) {
            Alert.alert("Couldn't buy this", apiErrorMessage(err, 'Please try again.'));
            load();
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Group deal</Text>
        <Pressable style={styles.back} onPress={shareDeal} hitSlop={12} accessibilityLabel="Share this deal">
          <MaterialIcons name="ios-share" size={21} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {deal.image_url ? (
          <Image source={{ uri: deal.image_url }} style={styles.photo} contentFit="cover" accessibilityLabel={deal.product_name} />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <MaterialIcons name="eco" size={40} color={colors.primary} />
          </View>
        )}

        {inEarlyAccess ? <Text style={styles.eyebrow}>Members only · 24 h head start</Text> : <Text style={styles.eyebrow}>Group deal</Text>}
        <Text style={styles.title}>{deal.product_name}</Text>
        <Pressable onPress={() => router.push({ pathname: '/(customer)/farmer/[id]', params: { id: deal.farmer_id } })}>
          <Text style={styles.farm}>
            {deal.share_label} · {deal.farm_name}
            {deal.farm_city ? `, ${deal.farm_city} ${deal.farm_state ?? ''}` : ''}
          </Text>
        </Pressable>
        <View style={styles.followRow}>
          <FollowFarmButton farmerId={deal.farmer_id} initial={deal.following_farm} />
        </View>

        <Text style={styles.priceLine}>
          <Text style={styles.price}>{money(deal.share_price)}</Text>
          <Text style={styles.regular}>  {money(deal.regular_share_price)}</Text>
          <Text style={styles.save}>  Save {deal.discount_percent.toFixed(0)}%</Text>
        </Text>
        <Text style={styles.perUnit}>
          ${deal.deal_price.toFixed(2)}/{deal.unit} · regular ${deal.regular_price.toFixed(2)}/{deal.unit}
        </Text>

        <View style={styles.statusRow}>
          <Text style={styles.headline}>{headline}</Text>
          {running && deal.status !== 'full' ? <Text style={styles.countdown}>{timeLeft(deal.deadline_at)}</Text> : null}
        </View>
        {subline ? <Text style={styles.subline}>{subline}</Text> : null}
        <View style={styles.bar}>
          <DealProgressBar
            households={deal.households}
            goal={deal.goal}
            sharesClaimed={deal.shares_claimed}
            capacity={deal.capacity}
            ended={deal.status === 'expired' ? 'missed' : deal.status === 'cancelled' || deal.status === 'full' ? 'muted' : undefined}
            podHouseholds={deal.my_pod?.households}
          />
        </View>
        {deal.my_pod ? (
          <View style={styles.podRow}>
            <MaterialIcons name="groups" size={16} color={colors.primaryDark} />
            <Text style={styles.podText}>
              Your Pod: {deal.my_pod.households} {deal.my_pod.households === 1 ? 'household' : 'households'} · {deal.my_pod.pod_name}
            </Text>
          </View>
        ) : null}

        <Pressable onPress={() => setShowWhy(!showWhy)} accessibilityRole="button" style={styles.whyButton}>
          <Text style={styles.whyLink}>Why this price</Text>
        </Pressable>
        {showWhy ? (
          <View style={styles.whyBox}>
            <Text style={styles.whyText}>
              {deal.farm_name} normally sells {deal.share_label} for {money(deal.regular_share_price)}. Knowing {deal.goal} households will buy
              before harvest means less waste, so they can charge {money(deal.share_price)}. Your household saves{' '}
              {money(deal.regular_share_price - deal.share_price)}.
            </Text>
          </View>
        ) : null}

        {commit && commit.status === 'active' ? (
          <View style={styles.inBox}>
            <Text style={styles.inTitle}>You&apos;re in</Text>
            <Text style={styles.inBody}>
              Charged only if the goal holds at the deadline, {when(deal.deadline_at)}.{' '}
              {commit.pod_name
                ? `Delivery ${commit.delivery_label} to ${commit.pod_name}'s drop point.`
                : commit.fulfillment_method === 'delivery'
                  ? `Delivery ${commit.delivery_label}.`
                  : `Pickup at the farm.`}
            </Text>
            {commit.pod_share_now !== null ? (
              <Text style={styles.inBody}>
                Delivery is {money(commit.pod_share_now)} right now, split with neighbors in this deal. It won&apos;t be more than{' '}
                {money(commit.delivery_fee)}.
              </Text>
            ) : null}
            {commit.can_withdraw ? (
              <>
                <Text style={styles.inFine}>You can withdraw until {when(deal.withdraw_locks_at)}.</Text>
                <Pressable style={styles.secondary} onPress={withdraw} disabled={busy}>
                  <Text style={styles.dangerText}>Withdraw</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.inFine}>The deal closes soon, so you can no longer withdraw.</Text>
            )}
            <Pressable style={styles.shareButton} onPress={shareDeal}>
              <MaterialIcons name="ios-share" size={17} color={colors.primary} />
              <Text style={styles.shareText}>Share with neighbors</Text>
            </Pressable>
          </View>
        ) : null}

        {commit && commit.status === 'ordered' && commit.order_id ? (
          <View style={styles.inBox}>
            <Text style={styles.inTitle}>Your order</Text>
            <Text style={styles.inBody}>
              {deal.fulfillment_date ? `For ${dayLabel(deal.fulfillment_date)}. ` : ''}
              This is a regular order now, with its receipt and status in Orders.
            </Text>
            <Pressable style={styles.primary} onPress={() => router.push(`/(customer)/orders/${commit.order_id}` as Href)}>
              <Text style={styles.primaryText}>See your order</Text>
            </Pressable>
          </View>
        ) : null}

        {commit && commit.status === 'not_charged' && !deal.fallback ? (
          <Text style={styles.notCharged}>You weren&apos;t charged.</Text>
        ) : null}

        {deal.fallback ? (
          <View style={styles.offerBox}>
            <Text style={styles.offerEyebrow}>MEMBER OFFER · ends {when(deal.fallback.ends_at)}</Text>
            <Text style={styles.inTitle}>
              Still want {deal.product_name.toLowerCase()}? {money(deal.fallback.share_price)}
            </Text>
            <Text style={styles.inBody}>The regular price. Your total would be {money(deal.fallback.total)}. It&apos;s your choice: nothing happens unless you buy.</Text>
            <Pressable style={[styles.primary, busy && styles.disabled]} onPress={buyRegular} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Buy</Text>}
            </Pressable>
          </View>
        ) : null}

        {needsPass && !commit ? (
          <View style={styles.inBox}>
            <Text style={styles.inTitle}>Harvest Pass members join first</Text>
            <Text style={styles.inBody}>Everyone else can join on {when(deal.public_opens_at)}, if there are shares left.</Text>
            {deal.free_month_available ? (
              <>
                <Pressable style={[styles.primary, busy && styles.disabled]} onPress={startFreeMonth} disabled={busy}>
                  {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Start free month</Text>}
                </Pressable>
                <Text style={styles.inFine}>No card needed for your free month.</Text>
              </>
            ) : (
              <Pressable style={styles.primary} onPress={() => router.push('/(customer)/harvest-pass')}>
                <Text style={styles.primaryText}>Subscribe to join early</Text>
              </Pressable>
            )}
          </View>
        ) : null}

        {deal.can_waitlist ? (
          <View style={styles.inBox}>
            <Text style={styles.inTitle}>Join the waitlist</Text>
            <Text style={styles.inBody}>
              If someone withdraws, the next household in line gets 2 hours to claim the share. No card is needed for this.
            </Text>
            <Pressable style={[styles.primary, busy && styles.disabled]} onPress={joinWaitlist} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Join waitlist</Text>}
            </Pressable>
          </View>
        ) : null}

        {deal.waitlist && !heldForMe ? (
          <View style={styles.inBox}>
            <Text style={styles.inTitle}>You&apos;re number {deal.waitlist.position} on the waitlist</Text>
            <Text style={styles.inBody}>We&apos;ll tell you if a share opens up. You&apos;d have 2 hours to claim it.</Text>
            <Pressable style={styles.secondary} onPress={leaveWaitlist} disabled={busy}>
              <Text style={styles.dangerText}>Leave the waitlist</Text>
            </Pressable>
          </View>
        ) : null}

        {heldForMe?.offer_expires_at ? (
          <View style={styles.offerBox}>
            <Text style={styles.offerEyebrow}>HELD FOR YOU · until {when(heldForMe.offer_expires_at)}</Text>
            <Text style={styles.inTitle}>A share opened up</Text>
            <Text style={styles.inBody}>Commit below to claim it. After that time it goes to the next household.</Text>
            <Pressable style={styles.secondary} onPress={leaveWaitlist} disabled={busy}>
              <Text style={styles.dangerText}>No thanks</Text>
            </Pressable>
          </View>
        ) : null}

        {canJoin ? (
          <>
            <Text style={styles.sectionTitle}>How do you want it?</Text>
            {deal.max_units > 1 ? (
              <>
                <Text style={styles.fieldLabel}>How many</Text>
                <View style={styles.chips}>
                  {Array.from({ length: deal.max_units }, (_, i) => i + 1).map((n) => (
                    <Chip key={n} label={`${n} × ${deal.share_label}`} selected={units === n} onPress={() => setUnits(n)} />
                  ))}
                </View>
              </>
            ) : null}
            <View style={styles.chips}>
              <Chip label="Pickup at the farm" selected={method === 'pickup'} onPress={() => setMethod('pickup')} />
              {deal.delivery.available ? (
                <Chip
                  label={`Home delivery · ${money(deal.delivery.fee)}`}
                  selected={method === 'delivery'}
                  onPress={() => {
                    setMethod('delivery');
                    setSlot(null);
                  }}
                />
              ) : null}
              {deal.pods.map((p) => (
                <Chip
                  key={p.pod_id}
                  label={`${p.pod_name} drop point · ${money(p.share_now)}${p.share_now < p.full_fee ? ' now' : ''}`}
                  selected={method === 'pod' && podId === p.pod_id}
                  onPress={() => {
                    setMethod('pod');
                    setPodId(p.pod_id);
                    setSlot(null);
                  }}
                />
              ))}
            </View>
            {method === 'pickup' ? (
              <Text style={styles.caption}>
                {deal.fulfillment_date ? `${dayLabel(deal.fulfillment_date)} at ` : 'At '}
                {deal.pickup_address}
              </Text>
            ) : (
              <>
                <Text style={styles.caption}>
                  {deal.fulfillment_date ? `${dayLabel(deal.fulfillment_date)}, to ` : 'To '}
                  {chosenPod ? chosenPod.drop_address_line : deal.delivery.address_line}
                </Text>
                {chosenPod ? (
                  <Text style={styles.caption}>
                    The fee is split evenly among your pod members in this deal who choose the drop point, so it falls as neighbors join.
                    You&apos;ll never pay more than {money(chosenPod.full_fee)} for delivery.
                  </Text>
                ) : null}
                <View style={[styles.chips, styles.chipsSpaced]}>
                  {(chosenPod ? chosenPod.slots : deal.delivery.slots).map((s) => (
                    <Chip key={s.starts_at} label={s.label} selected={slot === s.starts_at} onPress={() => setSlot(s.starts_at)} />
                  ))}
                </View>
              </>
            )}
            {!deal.delivery.available && deal.delivery.reason ? <Text style={styles.caption}>{deal.delivery.reason}</Text> : null}
            {deal.pod_note ? <Text style={styles.caption}>{deal.pod_note}</Text> : null}

            {quote ? (
              <View style={styles.costBox}>
                <Cost label={`${units} × ${deal.share_label}`} value={money(quote.subtotal)} />
                <Cost label="Service fee" value={money(quote.service_fee)} />
                {quote.member_savings > 0 ? <Cost label="Harvest Pass took off" value={`-${money(quote.member_savings)}`} /> : null}
                {method === 'delivery' ? <Cost label="Delivery" value={money(quote.delivery_fee)} /> : null}
                {method === 'pod' ? <Cost label="Delivery, at most" value={money(quote.delivery_fee)} /> : null}
                {quote.tax > 0 ? <Cost label="Tax" value={money(quote.tax)} /> : null}
                <Cost label={method === 'pod' ? 'If it unlocks, you pay at most' : 'If it unlocks, you pay'} value={money(quote.total)} strong />
              </View>
            ) : null}

            <Pressable style={[styles.primary, (busy || !quote) && styles.disabled]} onPress={joinDeal} disabled={busy || !quote}>
              {busy ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.primaryText}>
                  {almost ? 'Commit · share with neighbors' : `Commit to this deal${quote ? ` · ${money(quote.total)}` : ''}`}
                </Text>
              )}
            </Pressable>
            <Text style={styles.fine}>
              You won&apos;t be charged unless the deal unlocks. We save your card now and charge it once at the deadline, {when(deal.deadline_at)}, without
              asking again. You can withdraw until {when(deal.withdraw_locks_at)}. After the deal closes, your order can&apos;t be cancelled.
            </Text>
          </>
        ) : null}

        {!canJoin && !commit && running && !needsPass && !deal.can_waitlist && !deal.waitlist && deal.join_blocked_reason ? (
          <Text style={styles.blocked}>{deal.join_blocked_reason}</Text>
        ) : null}

        {deal.status === 'expired' || deal.status === 'cancelled' ? (
          <Pressable
            style={styles.secondary}
            onPress={() => router.push({ pathname: '/(customer)/deals', params: { farmer_id: deal.farmer_id } } as unknown as Href)}
          >
            <Text style={styles.secondaryText}>See other deals from this farm</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Cost({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.costRow}>
      <Text style={[styles.costLabel, strong && styles.costStrong]}>{label}</Text>
      <Text style={[styles.costValue, strong && styles.costStrong]}>{value}</Text>
    </View>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  photo: { width: '100%', height: 190, borderRadius: radius.lg, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontSize: 12.5, fontWeight: '700', color: colors.primary, marginTop: spacing.md },
  title: { fontFamily: fonts.headlineBold, fontSize: 28, lineHeight: 34, color: colors.text, marginTop: 2 },
  farm: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
  followRow: { marginTop: spacing.sm },
  podRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: spacing.xs },
  podText: { fontSize: 13, fontWeight: '700', color: colors.primaryDark },
  priceLine: { marginTop: spacing.sm },
  price: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.primaryDark },
  regular: { fontSize: 15, color: colors.textMuted, textDecorationLine: 'line-through' },
  save: { fontSize: 14, fontWeight: '700', color: colors.berry },
  perUnit: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.sm, marginTop: spacing.lg },
  headline: { flex: 1, fontFamily: fonts.headline, fontSize: 20, color: colors.text },
  countdown: { fontSize: 13, fontWeight: '700', color: colors.primary },
  subline: { fontSize: 13.5, color: colors.text, marginTop: 2 },
  bar: { marginTop: spacing.sm },
  whyButton: { alignSelf: 'flex-start', paddingVertical: spacing.sm },
  whyLink: { fontSize: 13, fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  whyBox: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md },
  whyText: { fontSize: 13.5, lineHeight: 19, color: colors.text },
  inBox: { backgroundColor: colors.tint, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  offerBox: { borderWidth: 1, borderColor: colors.accent, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.md },
  offerEyebrow: { fontSize: 11.5, fontWeight: '700', color: colors.berry, marginBottom: 2 },
  inTitle: { fontFamily: fonts.headlineBold, fontSize: 19, color: colors.primaryDark },
  inBody: { fontSize: 13.5, lineHeight: 19, color: colors.text, marginTop: 2 },
  inFine: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.xs },
  notCharged: { fontSize: 14, fontWeight: '600', color: colors.text, marginTop: spacing.md },
  shareButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  shareText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
  chipsSpaced: { marginTop: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextSelected: { color: colors.white },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 2 },
  costBox: { marginTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: spacing.sm },
  costRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 3 },
  costLabel: { flex: 1, fontSize: 13.5, color: colors.text },
  costValue: { fontSize: 13.5, color: colors.text, fontVariant: ['tabular-nums'] },
  costStrong: { fontWeight: '700', color: colors.primaryDark, fontSize: 15 },
  primary: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondary: { paddingVertical: 11, alignItems: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.primary, fontSize: 14.5, fontWeight: '700' },
  dangerText: { color: colors.danger, fontSize: 14.5, fontWeight: '700' },
  fine: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: spacing.sm },
  blocked: { fontSize: 13.5, lineHeight: 19, color: colors.text, marginTop: spacing.md },
  disabled: { opacity: 0.45 },
});
