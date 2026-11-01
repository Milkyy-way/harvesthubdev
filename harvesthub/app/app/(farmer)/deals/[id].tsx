import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { TextField } from '../../../components/TextField';
import { DealPayoutPanel } from '../../../components/farmer/DealPayoutPanel';
import { DEAL_STATUS_LABELS, OPEN_DEAL_STATUSES, type Deal } from '../../../types/deals';

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
  new Date(`${key}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// One deal: its terms, and what the farmer can still do with it. Once published,
// only changes in shoppers' favor (harvesthub-backend/app/deals/service.py).
export default function DealScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [deal, setDeal] = useState<Deal | null>(null);
  const [price, setPrice] = useState('');
  const [goal, setGoal] = useState('');
  const [capacity, setCapacity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const show = (d: Deal) => {
    setDeal(d);
    setPrice(d.deal_price.toFixed(2));
    setGoal(String(d.goal));
    setCapacity(String(d.capacity));
  };

  useFocusEffect(
    useCallback(() => {
      apiClient.get<Deal>(`/farmers/me/deals/${id}`).then(
        (res) => show(res.data),
        (err) => Alert.alert("Couldn't load this deal", apiErrorMessage(err, 'Please try again.'))
      );
    }, [id])
  );

  if (!deal) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const open = OPEN_DEAL_STATUSES.includes(deal.status);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (err) {
      Alert.alert(failure, apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = () =>
    run(async () => {
      const res = await apiClient.patch<Deal>(`/farmers/me/deals/${deal.id}`, {
        deal_price: Number(price),
        goal: Number(goal),
        capacity: Number(capacity),
      });
      show(res.data);
      Alert.alert('Saved', 'The deal is updated.');
    }, "Couldn't change the deal");

  const publish = () =>
    Alert.alert(
      'Publish this deal?',
      `${deal.payout.reserved_quantity} ${deal.unit} leave your regular stock. After this you can only lower the price, lower the goal or add shares.`,
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Publish',
          onPress: () =>
            run(async () => {
              const res = await apiClient.post<Deal>(`/farmers/me/deals/${deal.id}/publish`);
              show(res.data);
            }, "Couldn't publish the deal"),
        },
      ]
    );

  const removeDraft = () =>
    Alert.alert('Delete this draft?', undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            await apiClient.delete(`/farmers/me/deals/${deal.id}`);
            router.back();
          }, "Couldn't delete the draft"),
      },
    ]);

  const cancel = () =>
    Alert.alert('Cancel this deal?', 'Its stock goes back to your regular listing. This can\'t be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel deal',
        style: 'destructive',
        onPress: () =>
          run(async () => {
            const res = await apiClient.post<Deal>(`/farmers/me/deals/${deal.id}/cancel`, { reason: reason.trim() || null });
            show(res.data);
          }, "Couldn't cancel the deal"),
      },
    ]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Group deal</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.status}>{DEAL_STATUS_LABELS[deal.status]}</Text>
        <Text style={styles.title}>{deal.product_name}</Text>
        <Text style={styles.price}>
          {deal.share_label} for ${deal.payout.share_price.toFixed(2)}
          <Text style={styles.regular}>  regular ${deal.payout.regular_share_price.toFixed(2)}</Text>
        </Text>

        <Row label="Households to unlock" value={String(deal.goal)} />
        <Row label="Shares available" value={String(deal.capacity)} />
        <Row label="Each household may claim" value={String(deal.max_units)} />
        {deal.reserved_quantity > 0 ? <Row label="Set aside from stock" value={`${deal.reserved_quantity} ${deal.unit}`} /> : null}
        {deal.member_opens_at ? <Row label="Members from" value={when(deal.member_opens_at)} /> : null}
        {deal.public_opens_at ? <Row label="Everyone from" value={when(deal.public_opens_at)} /> : null}
        {deal.deadline_at ? <Row label="Closes" value={when(deal.deadline_at)} /> : null}
        {deal.fulfillment_date ? <Row label="Customers get it" value={dayLabel(deal.fulfillment_date)} /> : null}
        <Row label="Regular price offer if it misses" value={deal.subscriber_fallback ? 'Members, 24 hours' : 'Off'} />
        {deal.cancel_reason ? <Row label="Cancelled because" value={deal.cancel_reason} /> : null}

        <DealPayoutPanel payout={deal.payout} goal={deal.goal} capacity={deal.capacity} />

        {deal.status === 'draft' ? (
          <>
            <Pressable style={[styles.primary, busy && styles.disabled]} onPress={publish} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Publish deal</Text>}
            </Pressable>
            <Pressable
              style={styles.secondary}
              onPress={() => router.push({ pathname: '/(farmer)/deals/new', params: { id: deal.id } } as unknown as Href)}
            >
              <Text style={styles.secondaryText}>Edit draft</Text>
            </Pressable>
            <Pressable style={styles.secondary} onPress={removeDraft} disabled={busy}>
              <Text style={styles.dangerText}>Delete draft</Text>
            </Pressable>
          </>
        ) : null}

        {open ? (
          <>
            <Text style={styles.sectionTitle}>Change the deal</Text>
            <Text style={styles.caption}>You can lower the price, lower the goal or add shares. Nothing can go the other way.</Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Price ($ / {deal.unit})</Text>
                <TextField value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Goal</Text>
                <TextField value={goal} onChangeText={setGoal} keyboardType="number-pad" />
              </View>
              <View style={styles.flex1}>
                <Text style={styles.fieldLabel}>Shares</Text>
                <TextField value={capacity} onChangeText={setCapacity} keyboardType="number-pad" />
              </View>
            </View>
            <Pressable style={[styles.primary, busy && styles.disabled]} onPress={saveChanges} disabled={busy}>
              {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Save changes</Text>}
            </Pressable>

            <Text style={styles.sectionTitle}>Cancel the deal</Text>
            <TextField value={reason} onChangeText={setReason} placeholder="Why? For example, crop loss (optional)" maxLength={300} />
            <Pressable style={styles.secondary} onPress={cancel} disabled={busy}>
              <Text style={styles.dangerText}>Cancel deal</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  status: { fontSize: 12.5, fontWeight: '700', color: colors.primary },
  title: { fontFamily: fonts.headlineBold, fontSize: 26, lineHeight: 32, color: colors.text, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '700', color: colors.primaryDark, marginTop: 2, marginBottom: spacing.md },
  regular: { fontSize: 13, fontWeight: '400', color: colors.textMuted },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  infoLabel: { flex: 1, fontSize: 13.5, color: colors.textMuted },
  infoValue: { flex: 1, fontSize: 13.5, fontWeight: '600', color: colors.text, textAlign: 'right' },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  flex1: { flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  primary: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.md },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondary: { paddingVertical: 12, alignItems: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.primary, fontSize: 14.5, fontWeight: '700' },
  dangerText: { color: colors.danger, fontSize: 14.5, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
