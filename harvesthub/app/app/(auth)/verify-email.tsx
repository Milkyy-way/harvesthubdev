import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { resetCodeSchema } from '../../lib/validation/schemas';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { Logo } from '../../components/Logo';
import { resendSignupCode, verifySignupCode } from '../../lib/emailVerification';

const RESEND_COOLDOWN_SECONDS = 60;

// After sign-up (or a login with an unconfirmed email): enter the code from
// the "Confirm signup" email. verifyOtp() confirms the email and signs the
// user in; the route guard then takes customers home and farmers to their
// application. `sent=1` means a code was just sent (start the cooldown).
export default function VerifyEmail() {
  const { email, sent } = useLocalSearchParams<{ email?: string; sent?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(sent === '1' ? RESEND_COOLDOWN_SECONDS : 0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleVerify = async () => {
    if (verifying || !email) return;
    setError(null);
    setNotice(null);
    const parsed = resetCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Enter the code from the email');
      return;
    }
    setVerifying(true);
    const { error: verifyError } = await verifySignupCode(email, parsed.data);
    setVerifying(false);
    if (verifyError) {
      setError('That code is wrong or has expired. Use the newest code we sent, or request a new one.');
    }
    // Success: the new session lands in AuthContext and the route guard
    // navigates away from this screen.
  };

  const handleResend = async () => {
    if (!email || cooldown > 0 || resending) return;
    setError(null);
    setNotice(null);
    setResending(true);
    const { error: sendError } = await resendSignupCode(email);
    setResending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setCode('');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setNotice('We sent a new code. Only the newest code works.');
  };

  if (!email) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + spacing.xl }]}>
        <Text style={styles.subtitle}>Log in with your email and password to get a new verification code.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/(auth)/login')}>
          <Text style={styles.buttonText}>Go to log in</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Logo size={44} />
        <Text style={styles.title}>Confirm your email</Text>
        <Text style={styles.subtitle}>
          We emailed a code to <Text style={styles.bold}>{email}</Text>. You can read it on any device — enter it here to
          finish creating your account.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <TextInput
          style={[styles.input, styles.codeInput]}
          placeholder="Code from the email"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          maxLength={10}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          value={code}
          onChangeText={(value) => setCode(value.replace(/\D/g, ''))}
          onSubmitEditing={handleVerify}
        />

        <Pressable style={styles.button} onPress={handleVerify} disabled={verifying}>
          {verifying ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Confirm email</Text>}
        </Pressable>

        <Pressable style={styles.link} onPress={handleResend} disabled={cooldown > 0 || resending}>
          {resending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={[styles.linkText, cooldown > 0 && styles.linkDisabled]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
            </Text>
          )}
        </Pressable>
        <Pressable style={styles.link} onPress={() => router.replace('/(auth)/login')} disabled={verifying}>
          <Text style={styles.linkText}>Back to log in</Text>
        </Pressable>

        <View style={styles.hintRow}>
          <MaterialIcons name="info-outline" size={14} color={colors.textMuted} />
          <Text style={styles.hint}>Nothing arrived? Check spam, or go back and make sure the email address is right.</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  screen: { backgroundColor: colors.background },
  container: { flexGrow: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  centered: { justifyContent: 'center' },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginBottom: spacing.lg },
  bold: { fontWeight: '700', color: colors.text },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  notice: { color: colors.primary, marginBottom: spacing.md, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: spacing.md,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  codeInput: { fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  button: { backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 14, alignItems: 'center', marginTop: spacing.sm },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  link: { alignItems: 'center', paddingVertical: spacing.sm, marginTop: spacing.xs },
  linkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  linkDisabled: { color: colors.textMuted },
  hintRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', marginTop: spacing.md },
  hint: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.textMuted },
});
