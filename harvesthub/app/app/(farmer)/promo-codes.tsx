import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { TextField } from '../../components/TextField';
import type { FarmerPromoCode, FarmerPromoCodeInput, FarmerPromoStatus } from '../../types/farmer';

const DURATIONS: { days: number | null; label: string }[] = [
  { days: null, label: 'No end date' },
  { days: 7, label: '1 week' },
  { days: 14, label: '2 weeks' },
  { days: 30, label: '1 month' },
  { days: 90, label: '3 months' },
];

const STATUS_LABEL: Record<FarmerPromoStatus, string> = {
  active: 'Live',
  paused: 'Paused',
  scheduled: 'Starts later',
  ended: 'Ended',
  used_up: 'Used up',
};

// Blank means "not set"; anything else must be a number.
function optionalNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace('$', ''));
  return Number.isFinite(value) ? value : undefined;
}

// The farm's own promo codes: the discount comes off its sales, and
// HarvestHub's commission is on what's left. A code can be shown on the farm
// page. See harvesthub-backend/app/promotions/service.py.
export default function PromoCodesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [codes, setCodes] = useState<FarmerPromoCode[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed'>('percentage');
  const [amount, setAmount] = useState('');
  const [maxOff, setMaxOff] = useState('');
  const [minOrder, setMinOrder] = useState('');
  const [usageLimit, setUsageLimit] = useState('');
  const [oncePerCustomer, setOncePerCustomer] = useState(false);
  const [durationDays, setDurationDays] = useState<number | null>(null);
  const [showOnFarmPage, setShowOnFarmPage] = useState(true);

  const load = useCallback(() => {
    apiClient.get<FarmerPromoCode[]>('/farmers/me/promo-codes').then(
      (res) => setCodes(res.data),
      (err) => Alert.alert("Couldn't load your promo codes", apiErrorMessage(err, 'Please try again.'))
    );
  }, []);
  useFocusEffect(load);

  const resetForm = () => {
    setCode('');
    setDiscountType('percentage');
    setAmount('');
    setMaxOff('');
    setMinOrder('');
    setUsageLimit('');
    setOncePerCustomer(false);
    setDurationDays(null);
    setShowOnFarmPage(true);
  };

  const create = async () => {
    const value = optionalNumber(amount);
    const max = optionalNumber(maxOff);
    const min = optionalNumber(minOrder);
    const uses = optionalNumber(usageLimit);
    if (!code.trim()) {
      Alert.alert('Add a code', 'Pick the word customers will type at checkout, like SPRING10.');
      return;
    }
    if (value == null) {
      Alert.alert('Add the discount', discountType === 'percentage' ? 'How many percent off?' : 'How many dollars off?');
      return;
    }
    if (max === undefined || min === undefined || uses === undefined || (uses !== null && !Number.isInteger(uses))) {
      Alert.alert('Check the numbers', 'Leave a box empty if you don\'t need it.');
      return;
    }
    const payload: FarmerPromoCodeInput = {
      code: code.trim(),
      discount_type: discountType,
      discount_value: value,
      min_order_amount: min,
      max_discount_amount: discountType === 'percentage' ? max : null,
      usage_limit: uses,
      once_per_customer: oncePerCustomer,
      show_on_farm_page: showOnFarmPage,
      duration_days: durationDays,
    };
    setSaving(true);
    try {
      const res = await apiClient.post<FarmerPromoCode>('/farmers/me/promo-codes', payload);
      setCodes((prev) => [res.data, ...(prev ?? [])]);
      setCreating(false);
      resetForm();
    } catch (err) {
      Alert.alert("Couldn't create the code", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const update = async (promo: FarmerPromoCode, patch: { is_active?: boolean; show_on_farm_page?: boolean }) => {
    setBusyId(promo.id);
    try {
      const res = await apiClient.patch<FarmerPromoCode>(`/farmers/me/promo-codes/${promo.id}`, patch);
      setCodes((prev) => (prev ?? []).map((c) => (c.id === promo.id ? res.data : c)));
    } catch (err) {
      Alert.alert("Couldn't save", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const remove = (promo: FarmerPromoCode) => {
    Alert.alert(`Delete ${promo.code}?`, "Customers won't be able to use it. Orders that already used it keep their discount.", [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusyId(promo.id);
          try {
            await apiClient.delete(`/farmers/me/promo-codes/${promo.id}`);
            setCodes((prev) => (prev ?? []).filter((c) => c.id !== promo.id));
          } catch (err) {
            Alert.alert("Couldn't delete it", apiErrorMessage(err, 'Please try again.'));
          } finally {
            setBusyId(null);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Promo codes</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.intro}>
          Give customers a discount on your products. It comes off your sales, and HarvestHub&apos;s commission is on what&apos;s
          left. Customers type the code at checkout, under your farm&apos;s items.
        </Text>

        {creating ? (
          <View style={styles.form}>
            <Text style={styles.sectionTitle}>New promo code</Text>
            <TextField
              label="Code"
              value={code}
              onChangeText={setCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="e.g. SPRING10"
            />
            <Text style={styles.hint}>3 to 20 letters and numbers, no spaces.</Text>

            <Text style={styles.fieldLabel}>Discount</Text>
            <View style={styles.chips}>
              <Chip label="% off" selected={discountType === 'percentage'} onPress={() => setDiscountType('percentage')} />
              <Chip label="$ off" selected={discountType === 'fixed'} onPress={() => setDiscountType('fixed')} />
            </View>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <TextField
                  label={discountType === 'percentage' ? 'Percent off (1 to 90)' : 'Dollars off'}
                  value={amount}
                  onChangeText={setAmount}
                  keyboardType="decimal-pad"
                  placeholder={discountType === 'percentage' ? 'e.g. 10' : 'e.g. 5.00'}
                />
              </View>
              {discountType === 'percentage' ? (
                <View style={styles.flex1}>
                  <TextField label="Most off, $ (optional)" value={maxOff} onChangeText={setMaxOff} keyboardType="decimal-pad" placeholder="No limit" />
                </View>
              ) : null}
            </View>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <TextField label="Minimum order, $ (optional)" value={minOrder} onChangeText={setMinOrder} keyboardType="decimal-pad" placeholder="None" />
              </View>
              <View style={styles.flex1}>
                <TextField label="Total uses (optional)" value={usageLimit} onChangeText={setUsageLimit} keyboardType="number-pad" placeholder="No limit" />
              </View>
            </View>

            <Text style={styles.fieldLabel}>How long it lasts</Text>
            <View style={styles.chips}>
              {DURATIONS.map((d) => (
                <Chip key={d.label} label={d.label} selected={durationDays === d.days} onPress={() => setDurationDays(d.days)} />
              ))}
            </View>

            <ToggleRow label="One use per customer" value={oncePerCustomer} onChange={setOncePerCustomer} />
            <ToggleRow
              label="Show on my farm page"
              caption="Otherwise only people you give the code to will know it."
              value={showOnFarmPage}
              onChange={setShowOnFarmPage}
            />

            <View style={styles.formActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  setCreating(false);
                  resetForm();
                }}
                disabled={saving}
              >
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, saving && styles.disabled]} onPress={create} disabled={saving}>
                {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryText}>Create code</Text>}
              </Pressable>
            </View>
          </View>
        ) : (
          <Pressable style={styles.newButton} onPress={() => setCreating(true)}>
            <MaterialIcons name="add" size={18} color={colors.primary} />
            <Text style={styles.newButtonText}>New promo code</Text>
          </Pressable>
        )}

        {codes === null ? (
          <ActivityIndicator color={colors.primary} style={styles.loading} />
        ) : codes.length === 0 ? (
          !creating ? <Text style={styles.empty}>No promo codes yet.</Text> : null
        ) : (
          <>
            <Text style={styles.sectionTitle}>Your codes</Text>
            {codes.map((promo) => (
              <PromoRow
                key={promo.id}
                promo={promo}
                busy={busyId === promo.id}
                onTogglePage={(v) => update(promo, { show_on_farm_page: v })}
                onTogglePaused={() => update(promo, { is_active: promo.status === 'paused' })}
                onDelete={() => remove(promo)}
              />
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PromoRow({
  promo,
  busy,
  onTogglePage,
  onTogglePaused,
  onDelete,
}: {
  promo: FarmerPromoCode;
  busy: boolean;
  onTogglePage: (value: boolean) => void;
  onTogglePaused: () => void;
  onDelete: () => void;
}) {
  const live = promo.status === 'active';
  const used =
    promo.usage_limit != null
      ? `${promo.times_used} of ${promo.usage_limit} used`
      : `Used ${promo.times_used} time${promo.times_used === 1 ? '' : 's'}`;
  return (
    <View style={styles.promo}>
      <View style={styles.promoTop}>
        <Text style={styles.promoCode}>{promo.code}</Text>
        <View style={[styles.status, live ? styles.statusLive : styles.statusOff]}>
          <Text style={[styles.statusText, live && styles.statusTextLive]}>{STATUS_LABEL[promo.status]}</Text>
        </View>
      </View>
      <Text style={styles.promoHeadline}>{promo.headline}</Text>
      <Text style={styles.promoDetails}>{[...promo.details, used].join(' · ')}</Text>
      <ToggleRow label="On my farm page" value={promo.show_on_farm_page} onChange={onTogglePage} disabled={busy} compact />
      <View style={styles.promoActions}>
        <Pressable onPress={onTogglePaused} disabled={busy} hitSlop={8}>
          <Text style={styles.link}>{promo.status === 'paused' ? 'Turn back on' : 'Pause'}</Text>
        </Pressable>
        <Pressable onPress={onDelete} disabled={busy} hitSlop={8}>
          <Text style={[styles.link, styles.linkDanger]}>Delete</Text>
        </Pressable>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
    </View>
  );
}

function ToggleRow({
  label,
  caption,
  value,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  caption?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, compact && styles.toggleRowCompact]}>
      <View style={styles.flex1}>
        <Text style={compact ? styles.toggleLabelCompact : styles.toggleLabel}>{label}</Text>
        {caption ? <Text style={styles.toggleCaption}>{caption}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primaryMid }}
        thumbColor={colors.white}
        accessibilityLabel={label}
      />
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
  intro: { fontSize: 13, lineHeight: 19, color: colors.textMuted, marginBottom: spacing.md },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  form: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, paddingTop: 0 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs, marginTop: spacing.xs },
  hint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs },
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
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleRowCompact: { paddingVertical: spacing.xs },
  toggleLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  toggleCaption: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: 2 },
  toggleLabelCompact: { fontSize: 13.5, fontWeight: '600', color: colors.text },
  formActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  primaryButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondaryButton: {
    flex: 1,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.primary, fontSize: 15, fontWeight: '700' },
  newButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  newButtonText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  loading: { marginTop: spacing.xl },
  empty: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  promo: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  promoTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  promoCode: { fontFamily: fonts.headlineBold, fontSize: 18, letterSpacing: 1, color: colors.text },
  status: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 10 },
  statusLive: { backgroundColor: colors.tint },
  statusOff: { backgroundColor: colors.border },
  statusText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  statusTextLive: { color: colors.primaryDark },
  promoHeadline: { fontSize: 14.5, fontWeight: '700', color: colors.primaryDark, marginTop: 2 },
  promoDetails: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 2 },
  promoActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.xs },
  link: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  linkDanger: { color: colors.danger },
  disabled: { opacity: 0.45 },
});
