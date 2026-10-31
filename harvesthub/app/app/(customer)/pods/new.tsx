import { useState } from 'react';
import { View, Text, ScrollView, Pressable, Switch, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { useAuth } from '../../../contexts/AuthContext';
import { AddressSearchField } from '../../../components/AddressSearchField';
import { TextField } from '../../../components/TextField';
import type { DropKind, DropOptions, DropPointInput, Pod } from '../../../types/pods';

// Starts a pod, or (with ?podId=) changes an existing pod's drop point. The
// drop point comes first because it decides which days a farm delivers there.
// Everything is checked again by the API: this screen only asks.
export default function PodFormScreen() {
  const { podId } = useLocalSearchParams<{ podId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { customerProfile } = useAuth();
  const changing = Boolean(podId);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<DropKind>('home');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [attested, setAttested] = useState(false);
  const [shelter, setShelter] = useState('');
  const [access, setAccess] = useState('');
  const [options, setOptions] = useState<DropOptions | null>(null);
  const [weekday, setWeekday] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);

  const homeLine = customerProfile
    ? `${customerProfile.address_street}, ${customerProfile.address_city}, ${customerProfile.address_state} ${customerProfile.address_zip}`
    : '';

  const dropPoint = (): DropPointInput => ({
    drop_kind: kind,
    address_street: kind === 'neutral' ? street.trim() : null,
    address_city: kind === 'neutral' ? city.trim() : null,
    address_state: kind === 'neutral' ? state.trim() : null,
    address_zip: kind === 'neutral' ? zip.trim() : null,
    permission_attested: kind === 'neutral' && attested,
    access_notes: access.trim() || null,
    shelter_note: shelter.trim() || null,
  });

  // A change to the drop point can change which days are on offer.
  const resetDays = () => {
    setOptions(null);
    setWeekday(null);
  };

  const checkDays = async () => {
    setChecking(true);
    try {
      const res = await apiClient.post<DropOptions>('/pods/drop-options', dropPoint());
      setOptions(res.data);
      setWeekday(null);
    } catch (err) {
      Alert.alert('Check the drop point', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setChecking(false);
    }
  };

  const create = async () => {
    if (weekday === null) return;
    setSaving(true);
    try {
      const res = await apiClient.post<Pod>('/pods', { ...dropPoint(), name: name.trim(), delivery_weekday: weekday });
      router.replace(`/(customer)/pods/${res.data.id}` as Href);
    } catch (err) {
      Alert.alert("Couldn't start your pod", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const change = async () => {
    setSaving(true);
    try {
      await apiClient.put<Pod>(`/pods/${podId}/drop-point`, dropPoint());
      router.back();
    } catch (err) {
      Alert.alert("Couldn't change the drop point", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const chosenDay = options?.days.find((d) => d.weekday === weekday) ?? null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{changing ? 'Change drop point' : 'Start a pod'}</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {changing ? (
          <Text style={styles.caption}>
            Your members will be asked to approve the new drop point. Anyone who doesn&apos;t by the end of the delivery cycle
            leaves the pod. Orders that haven&apos;t left the farm move to the new one, so it must be within those farms&apos;
            delivery range.
          </Text>
        ) : (
          <>
            <Text style={styles.label}>Pod name</Text>
            <TextField value={name} onChangeText={setName} placeholder="Elm Street neighbors" maxLength={40} />
          </>
        )}

        <Text style={styles.sectionTitle}>Drop point</Text>
        <View style={styles.choices}>
          <Choice
            label="My home"
            selected={kind === 'home'}
            onPress={() => {
              setKind('home');
              resetDays();
            }}
          />
          <Choice
            label="Somewhere else"
            selected={kind === 'neutral'}
            onPress={() => {
              setKind('neutral');
              resetDays();
            }}
          />
        </View>

        {kind === 'home' ? (
          <View style={styles.notice}>
            <MaterialIcons name="info-outline" size={18} color={colors.primary} />
            <Text style={styles.noticeText}>
              {homeLine}. Your pod&apos;s members and the farm will see this address, because it&apos;s where they collect and
              deliver.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.caption}>A lobby, porch or community space, within half a mile of your home.</Text>
            <AddressSearchField
              value={street}
              onChangeText={(text) => {
                setStreet(text);
                resetDays();
              }}
              onSelectAddress={(a) => {
                setStreet(a.street);
                setCity(a.city);
                setState(a.state);
                setZip(a.zip);
                resetDays();
              }}
              placeholder="Street address"
            />
            <TextField value={city} onChangeText={setCity} placeholder="City" />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <TextField value={state} onChangeText={setState} placeholder="State" autoCapitalize="characters" maxLength={2} />
              </View>
              <View style={styles.flex1}>
                <TextField value={zip} onChangeText={setZip} placeholder="ZIP" keyboardType="number-pad" maxLength={5} />
              </View>
            </View>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>I have permission to use this location as a drop point.</Text>
              <Switch
                value={attested}
                onValueChange={setAttested}
                trackColor={{ false: colors.border, true: colors.primaryMid }}
                thumbColor={colors.white}
                accessibilityLabel="I have permission to use this location"
              />
            </View>
          </>
        )}

        <Text style={styles.label}>{kind === 'home' ? 'Covered or shaded spot (recommended)' : 'Covered or shaded spot'}</Text>
        <TextField value={shelter} onChangeText={setShelter} placeholder="Under the side porch" maxLength={200} />
        <Text style={styles.label}>Notes for the driver (optional)</Text>
        <TextField value={access} onChangeText={setAccess} placeholder="Gate code, which door" maxLength={300} />
        <Text style={styles.fine}>Only you and the farm&apos;s driver see these notes.</Text>

        {changing ? (
          <Pressable style={[styles.primaryButton, saving && styles.disabled]} onPress={change} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Save new drop point</Text>}
          </Pressable>
        ) : !options ? (
          <Pressable style={[styles.primaryButton, checking && styles.disabled]} onPress={checkDays} disabled={checking}>
            {checking ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>See delivery days</Text>}
          </Pressable>
        ) : options.days.length === 0 ? (
          <View style={styles.notice}>
            <MaterialIcons name="info-outline" size={18} color={colors.primary} />
            <Text style={styles.noticeText}>
              No farm delivers to pods at this location yet, so a pod can&apos;t start here for now.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Delivery day</Text>
            <Text style={styles.caption}>Days a farm delivers to this drop point. Your pod shares one.</Text>
            <View style={styles.choices}>
              {options.days.map((d) => (
                <Choice key={d.weekday} label={d.label} selected={weekday === d.weekday} onPress={() => setWeekday(d.weekday)} />
              ))}
            </View>
            {chosenDay?.farms.map((farm) => (
              <View key={farm.farmer_id} style={styles.farmRow}>
                <Text style={styles.farmName}>{farm.farm_name}</Text>
                <Text style={styles.farmFee}>
                  ${farm.pod_delivery_fee.toFixed(2)} split among those who order · ${farm.share.toFixed(2)} each if all 3 members do
                </Text>
              </View>
            ))}
            <Pressable
              style={[styles.primaryButton, (saving || weekday === null || !name.trim()) && styles.disabled]}
              onPress={create}
              disabled={saving || weekday === null || !name.trim()}
            >
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Start pod</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.choice, selected && styles.choiceSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{label}</Text>
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
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: spacing.sm },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.md, marginBottom: spacing.sm },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginBottom: spacing.sm },
  fine: { fontSize: 12, color: colors.textMuted, marginTop: -spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  choice: {
    borderRadius: radius.pill,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 13, fontWeight: '600', color: colors.text },
  choiceTextSelected: { color: colors.white },
  notice: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginBottom: spacing.md,
    marginTop: spacing.xs,
  },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  switchLabel: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
  farmRow: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  farmName: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  farmFee: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
