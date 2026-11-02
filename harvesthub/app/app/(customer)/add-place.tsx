import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { TextField } from '../../components/TextField';
import { AddressSearchField } from '../../components/AddressSearchField';
import { zipSchema } from '../../lib/validation/schemas';
import type { PlacesOverview } from '../../types/places';

const NAMES = ['Work', 'Family'];

// Save a place, like Work, to see nearby farms from.
export default function AddPlaceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [chosenName, setChosenName] = useState<string | null>('Work');
  const [customName, setCustomName] = useState('');
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [saving, setSaving] = useState(false);

  const name = (chosenName ?? customName).trim();

  const save = async () => {
    if (!name) {
      Alert.alert('Name this place', 'For example, Gym or Mom.');
      return;
    }
    if (!street.trim() || !city.trim() || !state.trim()) {
      Alert.alert('Enter the full address', 'We need the street, city and state to find farms near it.');
      return;
    }
    if (!zipSchema.safeParse(zip).success) {
      Alert.alert('Check the ZIP code', 'Enter a 5-digit ZIP code.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.post<PlacesOverview>('/customers/me/places', {
        name,
        address_street: street.trim(),
        address_city: city.trim(),
        address_state: state.trim(),
        address_zip: zip.trim(),
      });
      router.back();
    } catch (err) {
      Alert.alert("Couldn't save this place", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Add a place</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.sectionTitle}>What is it?</Text>
        <View style={styles.chips}>
          {NAMES.map((n) => (
            <Chip key={n} label={n} selected={chosenName === n} onPress={() => setChosenName(n)} />
          ))}
          <Chip label="Other" selected={chosenName === null} onPress={() => setChosenName(null)} />
        </View>
        {chosenName === null ? (
          <View style={styles.spaced}>
            <TextField placeholder="Name, like Gym" value={customName} onChangeText={setCustomName} maxLength={30} />
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Address</Text>
        <AddressSearchField
          value={street}
          onChangeText={setStreet}
          onSelectAddress={(a) => {
            setStreet(a.street);
            setCity(a.city);
            setState(a.state);
            setZip(a.zip);
          }}
        />
        <TextField placeholder="City" value={city} onChangeText={setCity} />
        <View style={styles.row}>
          <View style={styles.flex1}>
            <TextField placeholder="State" value={state} onChangeText={setState} />
          </View>
          <View style={styles.flex1}>
            <TextField placeholder="ZIP code" keyboardType="number-pad" value={zip} onChangeText={setZip} />
          </View>
        </View>

        <Text style={styles.fine}>We&apos;ll show farms near here. Deliveries still go to the address in your profile.</Text>

        <Pressable style={[styles.saveButton, saving && styles.disabled]} onPress={save} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.saveText}>Save place</Text>}
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
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  spaced: { marginTop: spacing.sm },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
  chipTextSelected: { color: colors.white },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  fine: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.lg },
  saveText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
