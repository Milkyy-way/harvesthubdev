import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { TextField } from '../../../components/TextField';
import { DealPayoutPanel } from '../../../components/farmer/DealPayoutPanel';
import type { Deal, DealForm, DealPreview, DealSetup } from '../../../types/deals';

const LENGTHS = [3, 5, 7];
const DISCOUNTS = [15, 20, 25];
const SHARES_PER_HOUSEHOLD = [1, 2, 3];

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dayKey(d);
};
const dayLabel = (key: string) =>
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text) : NaN);

// Create a group deal, or finish a draft (?id=). One screen in three steps, with
// the rules and the earnings checked by the API as the farmer types.
export default function NewDealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();

  const [setup, setSetup] = useState<DealSetup | null>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [shareSize, setShareSize] = useState('1');
  const [dealPrice, setDealPrice] = useState('');
  const [goal, setGoal] = useState('');
  const [capacity, setCapacity] = useState('');
  const [capacityEdited, setCapacityEdited] = useState(false);
  const [maxUnits, setMaxUnits] = useState(1);
  const [startDate, setStartDate] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(5);
  const [fulfillment, setFulfillment] = useState<string | null>(null);
  const [fallback, setFallback] = useState(true);
  const [preview, setPreview] = useState<DealPreview | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await apiClient.get<DealSetup>('/farmers/me/deals/setup');
        if (!active) return;
        setSetup(res.data);
        if (id) {
          const { data: d } = await apiClient.get<Deal>(`/farmers/me/deals/${id}`);
          if (!active) return;
          setProductId(d.product_id);
          setShareSize(String(d.share_size));
          setDealPrice(d.deal_price.toFixed(2));
          setGoal(String(d.goal));
          setCapacity(String(d.capacity));
          setCapacityEdited(true);
          setMaxUnits(d.max_units);
          setStartDate(d.public_start_date);
          setWindowDays(d.window_days);
          setFulfillment(d.fulfillment_date);
          setFallback(d.subscriber_fallback);
        } else {
          setGoal(String(res.data.suggested_goal));
          setCapacity(String(Math.ceil(res.data.suggested_goal * 1.5)));
        }
      } catch (err) {
        Alert.alert("Couldn't open the deal form", apiErrorMessage(err, 'Please try again.'));
      }
    })();
    return () => {
      active = false;
    };
  }, [id]);

  const listing = setup?.listings.find((l) => l.id === productId) ?? null;

  const form: DealForm | null = useMemo(() => {
    const size = Number(shareSize);
    const price = Number(dealPrice);
    const goalValue = whole(goal);
    const capacityValue = whole(capacity);
    if (!productId || !(size > 0) || !(price > 0) || !(goalValue > 0) || !(capacityValue > 0)) return null;
    return {
      product_id: productId,
      share_size: size,
      deal_price: price,
      goal: goalValue,
      capacity: capacityValue,
      max_units: maxUnits,
      public_start_date: startDate,
      window_days: windowDays,
      fulfillment_date: fulfillment,
      subscriber_fallback: fallback,
    };
  }, [productId, shareSize, dealPrice, goal, capacity, maxUnits, startDate, windowDays, fulfillment, fallback]);

  useEffect(() => {
    if (!form) {
      setPreview(null);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      apiClient.post<DealPreview>('/farmers/me/deals/preview', form).then(
        (res) => {
          if (active) setPreview(res.data);
        },
        (err) => console.warn('Could not check the deal:', err)
      );
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [form]);

  const pickProduct = (nextId: string) => {
    setProductId(nextId);
    setFulfillment(null);
    const next = setup?.listings.find((l) => l.id === nextId);
    if (next) setDealPrice((next.price * 0.8).toFixed(2));
  };

  const changeGoal = (text: string) => {
    setGoal(text);
    const value = whole(text);
    if (!capacityEdited && value > 0) setCapacity(String(Math.ceil(value * 1.5)));
  };

  const saveDraft = async (): Promise<string | null> => {
    if (!form) return null;
    const res = id
      ? await apiClient.put<Deal>(`/farmers/me/deals/${id}`, form)
      : await apiClient.post<Deal>('/farmers/me/deals', form);
    return res.data.id;
  };

  const onSaveDraft = async () => {
    setSaving(true);
    try {
      await saveDraft();
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save the draft", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    setSaving(true);
    try {
      const dealId = await saveDraft();
      if (!dealId) return;
      await apiClient.post(`/farmers/me/deals/${dealId}/publish`);
      router.replace(`/(farmer)/deals/${dealId}` as Href);
    } catch (err) {
      Alert.alert("Couldn't publish the deal", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const confirmPublish = () => {
    if (!preview) return;
    Alert.alert(
      'Publish this deal?',
      `${preview.payout.reserved_quantity} ${listing?.unit ?? ''} leave your regular stock. After this you can only lower the price, lower the goal or add shares.`,
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Publish', onPress: publish },
      ]
    );
  };

  if (!setup) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const today = dayKey(new Date());
  const startChoices = Array.from({ length: 14 }, (_, i) => addDays(today, i + 2));
  const deadlineDay = preview ? new Date(preview.deadline_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null;
  const fulfillmentChoices = deadlineDay ? Array.from({ length: 10 }, (_, i) => addDays(deadlineDay, i + 1)) : [];
  const canPublish = !!form && !!preview && preview.errors.length === 0 && !saving;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{id ? 'Edit draft' : 'New group deal'}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>1. What</Text>
        {setup.listings.length === 0 ? (
          <Text style={styles.caption}>Group deals are for vegetables, fruits and herbs. Add one to your products first.</Text>
        ) : (
          <View style={styles.chips}>
            {setup.listings.map((l) => (
              <Chip key={l.id} label={l.name} selected={productId === l.id} onPress={() => pickProduct(l.id)} />
            ))}
          </View>
        )}

        {listing ? (
          <>
            <Text style={styles.caption}>
              Regular price ${listing.price.toFixed(2)} / {listing.unit} · {listing.quantity_available} in stock
            </Text>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>One share ({listing.unit})</Text>
                <TextField value={shareSize} onChangeText={setShareSize} keyboardType="decimal-pad" placeholder="1" />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Deal price ($ / {listing.unit})</Text>
                <TextField value={dealPrice} onChangeText={setDealPrice} keyboardType="decimal-pad" placeholder="0.00" />
              </View>
            </View>
            <Text style={styles.captionTight}>
              Sold by the lb? Enter 2.5 for a 2.5 lb bag. Otherwise leave it at 1.
            </Text>
            <View style={[styles.chips, styles.chipsSpaced]}>
              {DISCOUNTS.map((pct) => (
                <Chip
                  key={pct}
                  label={`${pct}% off`}
                  selected={dealPrice === (listing.price * (1 - pct / 100)).toFixed(2)}
                  onPress={() => setDealPrice((listing.price * (1 - pct / 100)).toFixed(2))}
                />
              ))}
            </View>
            {preview ? (
              <Text style={styles.summary}>
                Customers pay ${preview.payout.share_price.toFixed(2)} a share instead of ${preview.payout.regular_share_price.toFixed(2)}{' '}
                ({preview.payout.discount_percent.toFixed(0)}% off).
              </Text>
            ) : null}

            <Text style={styles.sectionTitle}>2. How many</Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Households to unlock</Text>
                <TextField value={goal} onChangeText={changeGoal} keyboardType="number-pad" placeholder="20" />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Most shares you can supply</Text>
                <TextField
                  value={capacity}
                  onChangeText={(text) => {
                    setCapacity(text);
                    setCapacityEdited(true);
                  }}
                  keyboardType="number-pad"
                  placeholder="30"
                />
              </View>
            </View>
            <Text style={styles.captionTight}>
              {setup.avg_weekly_households > 0
                ? `You averaged ${setup.avg_weekly_households} households a week; a goal of ${setup.suggested_goal} is reachable.`
                : 'No recent orders to go on yet, so a smaller goal is safer.'}
            </Text>
            <Text style={[styles.fieldLabel, styles.spaced]}>Shares one household may claim</Text>
            <View style={styles.chips}>
              {SHARES_PER_HOUSEHOLD.map((n) => (
                <Chip key={n} label={String(n)} selected={maxUnits === n} onPress={() => setMaxUnits(n)} />
              ))}
            </View>

            <Text style={styles.sectionTitle}>3. When</Text>
            <Text style={styles.fieldLabel}>Start</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsLine}>
              <Chip
                label="Right away"
                selected={startDate === null}
                onPress={() => {
                  setStartDate(null);
                  setFulfillment(null);
                }}
              />
              {startChoices.map((d) => (
                <Chip
                  key={d}
                  label={dayLabel(d)}
                  selected={startDate === d}
                  onPress={() => {
                    setStartDate(d);
                    setFulfillment(null);
                  }}
                />
              ))}
            </ScrollView>
            <Text style={styles.captionTight}>Harvest Pass members get the first 24 hours. Everyone else can join after that.</Text>

            <Text style={[styles.fieldLabel, styles.spaced]}>Open to everyone for</Text>
            <View style={styles.chips}>
              {LENGTHS.map((n) => (
                <Chip
                  key={n}
                  label={`${n} days`}
                  selected={windowDays === n}
                  onPress={() => {
                    setWindowDays(n);
                    setFulfillment(null);
                  }}
                />
              ))}
            </View>
            {preview ? (
              <Text style={styles.captionTight}>
                Closes{' '}
                {new Date(preview.deadline_at).toLocaleString('en-US', {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  timeZone: 'America/New_York',
                })}{' '}
                ET
              </Text>
            ) : null}

            {preview ? (
              <>
                <Text style={[styles.fieldLabel, styles.spaced]}>Customers get it on</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsLine}>
                  {fulfillmentChoices.map((d) => (
                    <Chip key={d} label={dayLabel(d)} selected={preview.fulfillment_date === d} onPress={() => setFulfillment(d)} />
                  ))}
                </ScrollView>
              </>
            ) : null}

            <View style={styles.toggleRow}>
              <View style={styles.flex1}>
                <Text style={styles.toggleLabel}>Offer the regular price if it misses</Text>
                <Text style={styles.captionPlain}>Harvest Pass members who joined get 24 hours to buy at your regular price.</Text>
              </View>
              <Switch
                value={fallback}
                onValueChange={setFallback}
                trackColor={{ false: colors.border, true: colors.primaryMid }}
                thumbColor={colors.white}
                accessibilityLabel="Offer the regular price if the deal misses"
              />
            </View>

            {preview ? <DealPayoutPanel payout={preview.payout} goal={Number(goal)} capacity={Number(capacity)} /> : null}

            {preview?.errors.map((e) => (
              <View key={e} style={styles.problem}>
                <MaterialIcons name="error-outline" size={17} color={colors.danger} />
                <Text style={styles.problemText}>{e}</Text>
              </View>
            ))}
            {preview?.warnings.map((w) => (
              <View key={w} style={styles.notice}>
                <MaterialIcons name="info-outline" size={17} color={colors.berry} />
                <Text style={styles.noticeText}>{w}</Text>
              </View>
            ))}

            <Pressable style={[styles.primary, !canPublish && styles.disabled]} onPress={confirmPublish} disabled={!canPublish}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Publish deal</Text>}
            </Pressable>
            <Pressable style={[styles.secondary, (!form || saving) && styles.disabled]} onPress={onSaveDraft} disabled={!form || saving}>
              <Text style={styles.secondaryText}>Save draft</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex1: { flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  spaced: { marginTop: spacing.md },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.sm },
  captionTight: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.xs },
  captionPlain: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 2 },
  summary: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.primaryDark, marginTop: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chipsSpaced: { marginTop: spacing.sm },
  chipsLine: { gap: spacing.xs, paddingRight: spacing.md },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 12.5, fontWeight: '600', color: colors.text },
  chipTextSelected: { color: colors.white },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  toggleLabel: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  problem: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  problemText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.danger },
  notice: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.berry },
  primary: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondary: { paddingVertical: 12, alignItems: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.primary, fontSize: 14.5, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
