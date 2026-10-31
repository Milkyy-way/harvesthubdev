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
import type { DeliverySettings, DeliveryWindow } from '../../types/delivery';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 17 }, (_, i) => i + 6); // 6 AM … 10 PM
const CUTOFFS = [12, 24, 48];

function hourLabel(hour: number): string {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

function windowLabel(w: DeliveryWindow): string {
  const start = Number(w.start_time.slice(0, 2));
  const end = Number(w.end_time.slice(0, 2));
  return `${DAYS[w.weekday]} · ${hourLabel(start)}–${hourLabel(end)}`;
}

const pad = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

// Whether the farm delivers, and on what terms: its fee (the farm keeps all
// of it), how far it goes, its weekly windows and when orders close. See
// harvesthub-backend/app/delivery/service.py.
export default function DeliverySettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = useState<DeliverySettings | null>(null);
  const [fee, setFee] = useState('');
  const [radiusText, setRadiusText] = useState('');
  const [podFee, setPodFee] = useState('');
  const [saving, setSaving] = useState(false);
  const [newDay, setNewDay] = useState<number | null>(null);
  const [newStart, setNewStart] = useState<number | null>(null);
  const [newEnd, setNewEnd] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      apiClient.get<DeliverySettings>('/farmers/me/delivery/settings').then(
        (res) => {
          setSettings(res.data);
          setFee(res.data.delivery_fee.toFixed(2));
          setRadiusText(String(res.data.radius_miles));
          setPodFee(res.data.pod_delivery_fee.toFixed(2));
        },
        (err) => Alert.alert("Couldn't load delivery settings", apiErrorMessage(err, 'Please try again.'))
      );
    }, [])
  );

  if (!settings) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const update = (patch: Partial<DeliverySettings>) => setSettings({ ...settings, ...patch });

  const addWindow = () => {
    if (newDay === null || newStart === null || newEnd === null) return;
    const next = [...settings.windows, { weekday: newDay, start_time: pad(newStart), end_time: pad(newEnd) }].sort(
      (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time)
    );
    update({ windows: next });
    setNewDay(null);
    setNewStart(null);
    setNewEnd(null);
  };

  const save = async () => {
    const feeValue = Number(fee);
    const radiusValue = Number(radiusText);
    if (!Number.isFinite(feeValue) || feeValue < 0 || feeValue > 50) {
      Alert.alert('Check the delivery fee', 'Enter an amount from $0 to $50.');
      return;
    }
    if (!Number.isFinite(radiusValue) || radiusValue <= 0 || radiusValue > 50) {
      Alert.alert('Check the distance', 'Enter a distance from 1 to 50 miles.');
      return;
    }
    const podFeeValue = Number(podFee);
    if (!Number.isFinite(podFeeValue) || podFeeValue < 0 || podFeeValue > 50) {
      Alert.alert('Check the pod delivery fee', 'Enter an amount from $0 to $50.');
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.put<DeliverySettings>('/farmers/me/delivery/settings', {
        offers_delivery: settings.offers_delivery,
        delivery_fee: feeValue,
        radius_miles: radiusValue,
        cutoff_hours: settings.cutoff_hours,
        windows: settings.windows,
        offers_pod_delivery: settings.offers_delivery && settings.offers_pod_delivery,
        pod_delivery_fee: podFeeValue,
      });
      setSettings(res.data);
      Alert.alert('Saved', res.data.offers_delivery ? 'Customers nearby can now choose delivery.' : 'Delivery is off.');
    } catch (err) {
      Alert.alert("Couldn't save", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Delivery settings</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.toggleRow}>
          <View style={styles.flex1}>
            <Text style={styles.toggleLabel}>Offer delivery</Text>
            <Text style={styles.caption}>You drive the orders to customers in your delivery windows.</Text>
          </View>
          <Switch
            value={settings.offers_delivery}
            onValueChange={(v) => update({ offers_delivery: v })}
            trackColor={{ false: colors.border, true: colors.primaryMid }}
            thumbColor={colors.white}
            accessibilityLabel="Offer delivery"
          />
        </View>

        {!settings.farm_located ? (
          <View style={styles.warning}>
            <MaterialIcons name="error-outline" size={18} color={colors.danger} />
            <Text style={styles.warningText}>
              We couldn&apos;t place your farm on the map yet, and delivery distance is measured from it. Check your address
              in Edit farm profile.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Fee and distance</Text>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <Text style={styles.fieldLabel}>Delivery fee ($)</Text>
            <TextField value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="5.00" />
          </View>
          <View style={styles.flex1}>
            <Text style={styles.fieldLabel}>How far (miles)</Text>
            <TextField value={radiusText} onChangeText={setRadiusText} keyboardType="decimal-pad" placeholder="10" />
          </View>
        </View>
        <Text style={styles.caption}>You keep the whole delivery fee — no commission is taken from it.</Text>

        <Text style={styles.sectionTitle}>Neighborhood Pods</Text>
        <View style={styles.toggleRow}>
          <View style={styles.flex1}>
            <Text style={styles.toggleLabel}>Deliver to pods</Text>
            <Text style={styles.caption}>
              Several customers near each other, one drop point: one stop for you, with all their orders. Off until you turn it on.
            </Text>
          </View>
          <Switch
            value={settings.offers_delivery && settings.offers_pod_delivery}
            onValueChange={(v) => update({ offers_pod_delivery: v })}
            disabled={!settings.offers_delivery}
            trackColor={{ false: colors.border, true: colors.primaryMid }}
            thumbColor={colors.white}
            accessibilityLabel="Deliver to pods"
          />
        </View>
        {settings.offers_delivery && settings.offers_pod_delivery ? (
          <>
            <Text style={styles.fieldLabel}>Fee for a pod&apos;s drop point ($)</Text>
            <TextField value={podFee} onChangeText={setPodFee} keyboardType="decimal-pad" placeholder="5.00" />
            <Text style={styles.caption}>
              Split evenly among the members who order, and you keep all of it. They&apos;re charged when your orders close, and
              their orders reach you then. It can&apos;t be more than your regular delivery fee.
            </Text>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Orders close</Text>
        <View style={styles.chips}>
          {CUTOFFS.map((h) => (
            <Chip key={h} label={`${h} hours before`} selected={settings.cutoff_hours === h} onPress={() => update({ cutoff_hours: h })} />
          ))}
        </View>
        <Text style={styles.caption}>Before each delivery window, so you know what to pack.</Text>

        <Text style={styles.sectionTitle}>Delivery windows</Text>
        {settings.windows.length === 0 ? <Text style={styles.caption}>No windows yet — add the times you can deliver.</Text> : null}
        {settings.windows.map((w, i) => (
          <View key={`${w.weekday}-${w.start_time}`} style={styles.windowRow}>
            <MaterialIcons name="schedule" size={18} color={colors.primary} />
            <Text style={styles.windowText}>{windowLabel(w)}</Text>
            <Pressable
              onPress={() => update({ windows: settings.windows.filter((_, j) => j !== i) })}
              hitSlop={10}
              accessibilityLabel={`Remove ${windowLabel(w)}`}
            >
              <MaterialIcons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}

        <View style={styles.addBox}>
          <Text style={styles.fieldLabel}>Add a window</Text>
          <View style={styles.chips}>
            {DAYS.map((d, i) => (
              <Chip key={d} label={d} selected={newDay === i} onPress={() => setNewDay(i)} />
            ))}
          </View>
          <Text style={styles.subLabel}>From</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsLine}>
            {HOURS.slice(0, -1).map((h) => (
              <Chip
                key={h}
                label={hourLabel(h)}
                selected={newStart === h}
                onPress={() => {
                  setNewStart(h);
                  if (newEnd !== null && newEnd <= h) setNewEnd(null);
                }}
              />
            ))}
          </ScrollView>
          <Text style={styles.subLabel}>Until</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsLine}>
            {HOURS.filter((h) => newStart === null || h > newStart).map((h) => (
              <Chip key={h} label={hourLabel(h)} selected={newEnd === h} onPress={() => setNewEnd(h)} />
            ))}
          </ScrollView>
          <Pressable
            style={[styles.addButton, (newDay === null || newStart === null || newEnd === null) && styles.disabled]}
            onPress={addWindow}
            disabled={newDay === null || newStart === null || newEnd === null}
          >
            <MaterialIcons name="add" size={18} color={colors.primary} />
            <Text style={styles.addButtonText}>Add window</Text>
          </Pressable>
        </View>

        <Text style={styles.fine}>
          Customers within your distance choose a window at checkout and pay by card. If nobody&apos;s home, leave the order at
          the door and take a photo — they&apos;ll see it in the app.
        </Text>

        <Pressable style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
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
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  toggleLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 2 },
  warning: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: '#F6E7E5',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  warningText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: colors.danger },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  subLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
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
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  windowText: { flex: 1, fontSize: 14.5, fontWeight: '600', color: colors.text },
  addBox: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  addButtonText: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  fine: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: spacing.lg },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
