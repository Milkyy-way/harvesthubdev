import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '../../lib/supabase';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { LEGAL_URLS } from '../../constants/legal';

type DeletionCheck = { can_delete: boolean; blockers: string[] };

const CONFIRM_WORD = 'DELETE';

// Account deletion for customers and farmers (Google Play requires an
// in-app way to delete an account). The API refuses while an order is in
// progress or a farmer has money still to be paid or settled — the reasons
// are shown here before the user gets to the button. What's erased vs.
// kept is decided server-side (0027_account_deletion.sql) and described on
// the public /delete-account page.
export default function DeleteAccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const isFarmer = profile?.role === 'farmer';

  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    apiClient.get<DeletionCheck>('/account/deletion-check').then(
      (res) => setCheck(res.data),
      (err) => setLoadError(apiErrorMessage(err, "Couldn't check your account right now. Go back and try again."))
    );
  }, []);

  const canConfirm = !!check?.can_delete && confirmText.trim().toUpperCase() === CONFIRM_WORD && !deleting;

  const handleDelete = async () => {
    if (!canConfirm) return;
    setDeleting(true);
    try {
      await apiClient.delete('/account');
    } catch (err) {
      setDeleting(false);
      Alert.alert('Account not deleted', apiErrorMessage(err, 'Please try again in a few minutes.'));
      return;
    }
    // The user no longer exists on the server, so only clear this device's
    // session; the route guard then shows the welcome screen.
    await supabase.auth.signOut({ scope: 'local' });
    Alert.alert('Account deleted', 'Your HarvestHub account has been deleted. Thanks for being part of HarvestHub.');
  };

  const deleted = isFarmer
    ? [
        'Your login, name, and phone number',
        "Your farm's address, location, photos, bio, and tax ID",
        'Your verification documents and certifications',
        'Your products, product photos, and promo codes',
      ]
    : [
        'Your login, name, and phone number',
        'Your address and preferences',
        'Your cart and the comments on your ratings',
        'Your Harvest Pass and saved cards — it ends right away, with no further charges, and any referral credit is lost',
      ];
  const kept = isFarmer
    ? 'Records of your past orders and payouts (amounts and dates, without your name or contact details), because tax and accounting laws require them.'
    : 'Records of your past orders and payments (amounts, dates, and items, without your name, phone, or address), because tax and accounting laws require them.';

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} disabled={deleting}>
            <MaterialIcons name="arrow-back" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Delete account</Text>
          <View style={styles.back} />
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Delete your HarvestHub account?</Text>
          <Text style={styles.body}>This can&apos;t be undone. You&apos;ll be logged out, and you can&apos;t log back in to this account.</Text>

          <Text style={styles.sectionTitle}>What gets deleted</Text>
          {deleted.map((line) => (
            <View key={line} style={styles.bullet}>
              <MaterialIcons name="remove-circle-outline" size={16} color={colors.danger} />
              <Text style={styles.bulletText}>{line}</Text>
            </View>
          ))}

          <Text style={styles.sectionTitle}>What we keep</Text>
          <Text style={styles.body}>{kept}</Text>
          <Pressable onPress={() => WebBrowser.openBrowserAsync(LEGAL_URLS.deleteAccount)} hitSlop={8}>
            <Text style={styles.link}>Read the full details</Text>
          </Pressable>

          {!check ? (
            loadError ? (
              <Text style={styles.error}>{loadError}</Text>
            ) : (
              <ActivityIndicator style={styles.loading} color={colors.primary} />
            )
          ) : check.can_delete ? (
            <>
              <Text style={styles.sectionTitle}>Confirm</Text>
              <Text style={styles.body}>
                Type <Text style={styles.bold}>{CONFIRM_WORD}</Text> to confirm.
              </Text>
              <TextInput
                style={styles.input}
                value={confirmText}
                onChangeText={setConfirmText}
                placeholder={CONFIRM_WORD}
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!deleting}
              />
              <Pressable style={[styles.deleteButton, !canConfirm && styles.disabled]} onPress={handleDelete} disabled={!canConfirm}>
                {deleting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.deleteText}>Delete my account</Text>}
              </Pressable>
            </>
          ) : (
            <View style={styles.blockers}>
              <Text style={styles.blockersTitle}>You can&apos;t delete your account yet</Text>
              {check.blockers.map((reason) => (
                <View key={reason} style={styles.bullet}>
                  <MaterialIcons name="info-outline" size={16} color={colors.berry} />
                  <Text style={styles.bulletText}>{reason}</Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
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
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 18, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  body: { fontSize: 14, lineHeight: 20, color: colors.textMuted },
  bold: { fontWeight: '700', color: colors.text },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 4 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  link: { color: colors.primary, fontSize: 14, fontWeight: '600', marginTop: spacing.sm },
  loading: { marginTop: spacing.xl },
  error: { color: colors.danger, fontSize: 13, marginTop: spacing.lg },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginTop: spacing.sm,
    color: colors.text,
    backgroundColor: colors.surface,
    fontSize: 16,
    letterSpacing: 2,
  },
  deleteButton: {
    backgroundColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  disabled: { opacity: 0.4 },
  deleteText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  blockers: { backgroundColor: `${colors.berry}14`, borderRadius: radius.lg, padding: spacing.md, marginTop: spacing.lg },
  blockersTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: spacing.xs },
});
