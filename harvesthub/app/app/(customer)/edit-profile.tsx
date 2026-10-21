import { useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { z } from 'zod';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { TextField } from '../../components/TextField';
import { AddressSearchField } from '../../components/AddressSearchField';
import { TagSelector } from '../../components/TagSelector';
import { phoneSchema, zipSchema, flattenFieldErrors, DIETARY_PREFERENCE_OPTIONS, PRODUCE_INTEREST_OPTIONS } from '../../lib/validation/schemas';
import type { DietaryPreference, ProduceInterest } from '../../types/database';

const editProfileSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required'),
  phone: phoneSchema,
  addressStreet: z.string().trim().min(1, 'Street address is required'),
  addressCity: z.string().trim().min(1, 'City is required'),
  addressState: z.string().trim().min(1, 'State is required'),
  addressZip: zipSchema,
});

export default function EditProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, profile, customerProfile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [addressStreet, setAddressStreet] = useState(customerProfile?.address_street ?? '');
  const [addressCity, setAddressCity] = useState(customerProfile?.address_city ?? '');
  const [addressState, setAddressState] = useState(customerProfile?.address_state ?? '');
  const [addressZip, setAddressZip] = useState(customerProfile?.address_zip ?? '');
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryPreference[]>(customerProfile?.dietary_preferences ?? []);
  const [produceInterests, setProduceInterests] = useState<ProduceInterest[]>(customerProfile?.produce_interests ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const result = editProfileSchema.safeParse({ fullName, phone, addressStreet, addressCity, addressState, addressZip });
    if (!result.success) {
      setErrors(flattenFieldErrors(result.error));
      return;
    }
    setErrors({});
    setSaving(true);

    const userId = session?.user.id;
    if (!userId) {
      setSaving(false);
      return;
    }

    try {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() })
        .eq('id', userId);
      if (profileError) throw profileError;

      const { error: customerProfileError } = await supabase
        .from('customer_profiles')
        .update({
          address_street: addressStreet.trim(),
          address_city: addressCity.trim(),
          address_state: addressState.trim(),
          address_zip: addressZip.trim(),
          dietary_preferences: dietaryPreferences,
          produce_interests: produceInterests,
          // A changed address clears the stored map location by itself (a
          // database trigger, 0031); the API geocodes the new one on the
          // next /customers/me fetch, which refreshProfile() below makes.
        })
        .eq('id', userId);
      if (customerProfileError) throw customerProfileError;

      await refreshProfile();
      router.back();
    } catch (err: any) {
      console.warn('Could not save profile:', err);
      Alert.alert('Could not save changes', err?.message ?? 'Please try again.');
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
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.sectionTitle}>Contact</Text>
        <TextField placeholder="Full name" value={fullName} onChangeText={setFullName} error={errors.fullName} />
        <TextField
          placeholder="Phone number"
          keyboardType="phone-pad"
          autoComplete="tel"
          value={phone}
          onChangeText={setPhone}
          error={errors.phone}
        />

        <Text style={styles.sectionTitle}>Delivery Address</Text>
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
            <TextField placeholder="State" value={addressState} onChangeText={setAddressState} error={errors.addressState} />
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

        <Text style={styles.sectionTitle}>Dietary Preferences</Text>
        <TagSelector options={DIETARY_PREFERENCE_OPTIONS} value={dietaryPreferences} onChange={setDietaryPreferences} />

        <Text style={styles.sectionTitle}>Produce Interests</Text>
        <TagSelector options={PRODUCE_INTEREST_OPTIONS} value={produceInterests} onChange={setProduceInterests} />

        <Pressable style={[styles.saveButton, saving && styles.saveButtonDisabled]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={colors.white} /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </Pressable>
      </ScrollView>
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
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginBottom: spacing.sm, marginTop: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
