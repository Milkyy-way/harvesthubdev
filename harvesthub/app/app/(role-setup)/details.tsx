import { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, fonts } from '../../constants/theme';
import { TextField } from '../../components/TextField';
import { AddressSearchField } from '../../components/AddressSearchField';
import { TagSelector } from '../../components/TagSelector';
import { DIETARY_PREFERENCE_OPTIONS, PRODUCE_INTEREST_OPTIONS } from '../../lib/validation/schemas';
import type { DietaryPreference, ProduceInterest } from '../../types/database';

// Only ever reached with a Google or Apple session that has an identity
// (name/email came from them) but no role yet. That sign-up is customer-only —
// farmers sign up with email/password (see 0022) — so this just asks for
// whatever a customer account still needs. Submits through
// complete_profile_setup() (0018/0022), the one place allowed to set
// role/status directly.
export default function RoleSetupDetails() {
  const { session, profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();

  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressState, setAddressState] = useState('');
  const [addressZip, setAddressZip] = useState('');
  const [dietaryPreferences, setDietaryPreferences] = useState<DietaryPreference[]>([]);
  const [produceInterests, setProduceInterests] = useState<ProduceInterest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Apple's name isn't on the profile: lib/appleAuth.ts saves it on the session
  // just after sign-in, which can land after this screen has opened.
  const nameFromSignIn: string | undefined = session?.user.user_metadata?.full_name;
  useEffect(() => {
    if (nameFromSignIn) setFullName((current) => current || nameFromSignIn);
  }, [nameFromSignIn]);

  const handleSubmit = async () => {
    if (loading) return; // already submitting — a second tap while it's in flight must not fire this twice
    setError(null);
    if (!fullName.trim() || !phone.trim()) {
      setError('Enter your name and phone number.');
      return;
    }
    if (!addressStreet.trim() || !addressCity.trim() || !addressState.trim() || !addressZip.trim()) {
      setError('Enter your full delivery/pickup address.');
      return;
    }

    setLoading(true);
    const { error: rpcError } = await supabase.rpc('complete_profile_setup', {
      p_role: 'customer',
      p_full_name: fullName.trim(),
      p_phone: phone.trim(),
      p_address_street: addressStreet.trim(),
      p_address_city: addressCity.trim(),
      p_address_state: addressState.trim(),
      p_address_zip: addressZip.trim(),
      p_dietary_preferences: dietaryPreferences,
      p_produce_interests: produceInterests,
    });

    if (rpcError) {
      setLoading(false);
      setError(rpcError.message);
      return;
    }
    // Deliberately NOT resetting loading on success — this screen doesn't
    // navigate itself, it waits for RootLayout's redirect effect to react
    // to the profile update below and move on. Re-enabling the button in
    // that gap is exactly what let a second, redundant tap through last
    // time (which then correctly — but confusingly — said "already set
    // up," since the first tap had already succeeded).
    await refreshProfile();
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Your delivery details</Text>
        <Text style={styles.subtitle}>So nearby farms show up for you and orders reach the right address.</Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TextField placeholder="Full name" value={fullName} onChangeText={setFullName} />
        <TextField
          placeholder="Phone number"
          autoComplete="tel"
          keyboardType="phone-pad"
          value={phone}
          onChangeText={setPhone}
        />

        <Text style={styles.sectionTitle}>Delivery / pickup address</Text>
        <AddressSearchField
          value={addressStreet}
          onChangeText={setAddressStreet}
          onSelectAddress={(a) => {
            setAddressStreet(a.street);
            setAddressCity(a.city);
            setAddressState(a.state);
            setAddressZip(a.zip);
          }}
        />
        <TextField placeholder="City" value={addressCity} onChangeText={setAddressCity} />
        <View style={styles.row}>
          <TextField style={styles.flex1} placeholder="State" value={addressState} onChangeText={setAddressState} />
          <TextField
            style={styles.flex1}
            placeholder="ZIP code"
            keyboardType="number-pad"
            value={addressZip}
            onChangeText={setAddressZip}
          />
        </View>

        <Text style={styles.sectionTitle}>Dietary preferences (optional)</Text>
        <TagSelector options={DIETARY_PREFERENCE_OPTIONS} value={dietaryPreferences} onChange={setDietaryPreferences} />

        <Text style={styles.sectionTitle}>What are you interested in? (optional)</Text>
        <TagSelector options={PRODUCE_INTEREST_OPTIONS} value={produceInterests} onChange={setProduceInterests} />

        <Pressable style={styles.button} onPress={handleSubmit} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Continue</Text>}
        </Pressable>

        <Pressable style={styles.signOut} onPress={() => supabase.auth.signOut()} disabled={loading}>
          <Text style={styles.signOutText}>Not you? Sign out</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.text, marginBottom: spacing.sm },
  subtitle: { fontSize: 13.5, color: colors.textMuted, marginBottom: spacing.xl, lineHeight: 19 },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  signOut: { alignItems: 'center', paddingVertical: spacing.md },
  signOutText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
});
