import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { TextField } from '../../components/TextField';
import { AddressSearchField } from '../../components/AddressSearchField';
import { TagSelector } from '../../components/TagSelector';
import { StorePhotoCard } from '../../components/farmer/StorePhotoCard';
import { FARM_BIO_MAX, FARM_TYPE_OPTIONS, farmerProfileEditSchema, flattenFieldErrors } from '../../lib/validation/schemas';
import type { FarmType } from '../../types/database';

// Farmer F6 — an approved farmer edits their own farm profile: what
// customers see (photo, farm name, bio, farm types, years), the pickup
// address, and their contact details. Same pattern as the customer
// edit-profile screen: direct supabase-js updates, allowed by 0004's
// self-update policy on farmer_profiles and 0002's full_name/phone grant on
// profiles. Tax ID and verification documents aren't editable here.
export default function FarmProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile, farmerProfile, refreshProfile } = useAuth();
  const approved = profile?.status === 'active';

  const [farmName, setFarmName] = useState(farmerProfile?.farm_name ?? '');
  const [bio, setBio] = useState(farmerProfile?.bio ?? '');
  const [farmTypes, setFarmTypes] = useState<FarmType[]>(farmerProfile?.farm_types ?? []);
  const [yearsInOperation, setYearsInOperation] = useState(
    farmerProfile?.years_in_operation != null ? String(farmerProfile.years_in_operation) : ''
  );
  const [addressStreet, setAddressStreet] = useState(farmerProfile?.address_street ?? '');
  const [addressCity, setAddressCity] = useState(farmerProfile?.address_city ?? '');
  const [addressState, setAddressState] = useState(farmerProfile?.address_state ?? '');
  const [addressZip, setAddressZip] = useState(farmerProfile?.address_zip ?? '');
  const [ownerName, setOwnerName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const userId = session?.user.id;
    if (saving || !userId) return;
    const result = farmerProfileEditSchema.safeParse({
      farmName,
      bio,
      farmTypes,
      yearsInOperation,
      addressStreet,
      addressCity,
      addressState,
      addressZip,
      ownerName,
      phone,
    });
    if (!result.success) {
      setErrors(flattenFieldErrors(result.error));
      return;
    }
    setErrors({});
    const d = result.data;

    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: d.ownerName, phone: d.phone })
        .eq('id', userId);
      if (profileError) throw profileError;

      const { error: farmError } = await supabase
        .from('farmer_profiles')
        .update({
          farm_name: d.farmName,
          bio: d.bio || null,
          farm_types: d.farmTypes,
          years_in_operation: d.yearsInOperation,
          address_street: d.addressStreet,
          address_city: d.addressCity,
          address_state: d.addressState,
          address_zip: d.addressZip,
          // A changed address clears the farm's map location by itself (a
          // database trigger, 0031), so the API geocodes the new one.
        })
        .eq('id', userId);
      if (farmError) throw farmError;

      await refreshProfile();
      router.back();
    } catch (err: any) {
      console.warn('Could not save farm profile:', err);
      Alert.alert('Could not save changes', err?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Farm profile</Text>
        <View style={styles.back} />
      </View>

      {!approved ? (
        <View style={styles.center}>
          <Text style={styles.muted}>You can edit your farm profile once your farm is approved.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <StorePhotoCard />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your farm</Text>
            <Text style={styles.caption}>Shown to customers on your farm page.</Text>
            <TextField placeholder="Farm name" value={farmName} onChangeText={setFarmName} error={errors.farmName} />
            <TextField
              placeholder="About your farm — what you grow, how, and your story"
              multiline
              maxLength={FARM_BIO_MAX}
              value={bio}
              onChangeText={setBio}
              error={errors.bio}
            />
            <Text style={styles.counter}>
              {bio.length}/{FARM_BIO_MAX}
            </Text>
            <Text style={styles.fieldLabel}>Farm type</Text>
            <TagSelector options={FARM_TYPE_OPTIONS} value={farmTypes} onChange={setFarmTypes} />
            {errors.farmTypes ? <Text style={styles.fieldError}>{errors.farmTypes}</Text> : null}
            <TextField
              placeholder="Years in operation"
              keyboardType="number-pad"
              value={yearsInOperation}
              onChangeText={setYearsInOperation}
              error={errors.yearsInOperation}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pickup address</Text>
            <Text style={styles.caption}>
              Customers pick up orders here. Orders already placed keep the address they were placed with.
            </Text>
            <AddressSearchField
              value={addressStreet}
              onChangeText={setAddressStreet}
              onSelectAddress={(a) => {
                setAddressStreet(a.street);
                setAddressCity(a.city);
                setAddressState(a.state);
                setAddressZip(a.zip);
              }}
              error={errors.addressStreet}
            />
            <TextField placeholder="City" value={addressCity} onChangeText={setAddressCity} error={errors.addressCity} />
            <View style={styles.row}>
              <View style={styles.flex1}>
                <TextField
                  placeholder="State"
                  autoCapitalize="characters"
                  value={addressState}
                  onChangeText={setAddressState}
                  error={errors.addressState}
                />
              </View>
              <View style={styles.flex1}>
                <TextField
                  placeholder="ZIP code"
                  keyboardType="number-pad"
                  value={addressZip}
                  onChangeText={setAddressZip}
                  error={errors.addressZip}
                />
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Contact</Text>
            <TextField placeholder="Your name" value={ownerName} onChangeText={setOwnerName} error={errors.ownerName} />
            <TextField
              placeholder="Phone number"
              keyboardType="phone-pad"
              autoComplete="tel"
              value={phone}
              onChangeText={setPhone}
              error={errors.phone}
            />
            <Text style={styles.caption}>Email: {session?.user.email} — contact HarvestHub to change it.</Text>
          </View>

          <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>Save changes</Text>}
          </Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  card: { marginBottom: spacing.lg },
  cardTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: 2 },
  caption: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginBottom: spacing.md },
  counter: { fontSize: 11, color: colors.textMuted, textAlign: 'right', marginTop: -spacing.md, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  muted: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  saveButton: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  saveText: { color: colors.white, fontWeight: '700', fontSize: 15 },
});
