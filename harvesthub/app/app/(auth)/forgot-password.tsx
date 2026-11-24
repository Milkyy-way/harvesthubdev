import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { sendPasswordResetCode } from '../../lib/passwordReset';
import { emailSchema } from '../../lib/validation/schemas';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { Logo } from '../../components/Logo';

// Step 1 of a password reset: email → a one-time code is sent (see
// lib/passwordReset.ts for why a code and not a link) → the code is entered
// on app/(auth)/reset-password.tsx.
export default function ForgotPassword() {
  const { email: initialEmail } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState(initialEmail ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (loading) return;
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter a valid email address');
      return;
    }
    const normalized = parsed.data.toLowerCase();
    setLoading(true);
    const { error: sendError } = await sendPasswordResetCode(normalized);
    setLoading(false);
    if (sendError) {
      // e.g. Supabase's per-email rate limit ("For security purposes, you can
      // only request this after N seconds.") — already human-readable.
      setError(sendError.message);
      return;
    }
    // Same next screen whether or not the email has an account (Supabase
    // doesn't say either), so this can't be used to probe who's signed up.
    router.push({ pathname: '/(auth)/reset-password', params: { email: normalized } });
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex1}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.md }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>

        <View style={styles.body}>
          <Logo size={44} />
          <Text style={styles.title}>Reset your password</Text>
          <Text style={styles.subtitle}>
            Enter the email you signed up with and we&apos;ll send you a code to set a new password.
          </Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            onSubmitEditing={handleSend}
          />
          <Pressable style={styles.button} onPress={handleSend} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Send code</Text>}
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: -spacing.sm },
  body: { flex: 1, justifyContent: 'center', paddingBottom: spacing.xl * 2 },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginBottom: spacing.xl },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
});
