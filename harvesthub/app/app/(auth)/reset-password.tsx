import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { flattenFieldErrors, newPasswordSchema, resetCodeSchema } from '../../lib/validation/schemas';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { Logo } from '../../components/Logo';
import { sendPasswordResetCode } from '../../lib/passwordReset';

const RESEND_COOLDOWN_SECONDS = 60;

// Step 2 of a password reset: the emailed code + the new password, in one
// go. verifyOtp() turns the code into a signed-in session, then
// updateUser() saves the password. startPasswordRecovery() is called first
// so the route guard keeps the user here when that session lands (instead
// of treating it as a normal login); if saving the password then fails
// (e.g. same as the old one), they're already verified and only need to
// pick another password. Saving keeps them signed in; the route guard then
// takes them to their usual home.
export default function ResetPassword() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, passwordRecovery, startPasswordRecovery, finishPasswordRecovery } = useAuth();

  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS); // a code was just sent
  const [resending, setResending] = useState(false);

  // The code has been accepted (a recovery session exists) — only the new
  // password is still needed.
  const verified = passwordRecovery && !!session;

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSave = async () => {
    if (saving || !email) return;
    setError(null);
    setNotice(null);

    const passwordResult = newPasswordSchema.safeParse({ password, confirmPassword });
    const codeResult = verified ? null : resetCodeSchema.safeParse(code);
    const errors: Record<string, string> = passwordResult.success ? {} : flattenFieldErrors(passwordResult.error);
    if (codeResult && !codeResult.success) errors.code = codeResult.error.issues[0]?.message ?? 'Enter the code from the email';
    setFieldErrors(errors);
    if (!passwordResult.success || Object.keys(errors).length > 0) return;

    setSaving(true);
    if (!verified && codeResult?.success) {
      startPasswordRecovery();
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: codeResult.data, type: 'recovery' });
      if (verifyError) {
        finishPasswordRecovery();
        setSaving(false);
        setError('That code is wrong or has expired. Use the newest code we sent, or request a new one.');
        return;
      }
    }

    const { error: updateError } = await supabase.auth.updateUser({ password: passwordResult.data.password });
    setSaving(false);
    if (updateError) {
      // e.g. "New password should be different from the old password." —
      // the code is already used up; the user just picks another password.
      setError(updateError.message);
      return;
    }
    Alert.alert('Password updated', 'Your new password is saved and you’re signed in.');
    finishPasswordRecovery();
  };

  const handleResend = async () => {
    if (!email || cooldown > 0 || resending) return;
    setError(null);
    setNotice(null);
    setResending(true);
    const { error: sendError } = await sendPasswordResetCode(email);
    setResending(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setCode('');
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setNotice('We sent a new code. Only the newest code works.');
  };

  const handleCancel = () => {
    if (verified) supabase.auth.signOut(); // also ends recovery (AuthContext)
    else if (router.canGoBack()) router.back();
    else router.replace('/(auth)/login');
  };

  if (!email) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + spacing.xl }]}>
        <Text style={styles.subtitle}>Start from “Forgot password?” on the login screen to get a code.</Text>
        <Pressable style={styles.button} onPress={() => router.replace('/(auth)/forgot-password')}>
          <Text style={styles.buttonText}>Get a reset code</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.flex1}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Logo size={44} />
        <Text style={styles.title}>{verified ? 'Choose a new password' : 'Check your email'}</Text>
        <Text style={styles.subtitle}>
          {verified ? (
            <>
              Code accepted for <Text style={styles.bold}>{email}</Text>. Pick a new password to finish.
            </>
          ) : (
            <>
              If there&apos;s a HarvestHub account for <Text style={styles.bold}>{email}</Text>, we&apos;ve emailed it a
              code. You can read it on any device — enter it here with your new password.
            </>
          )}
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {!verified ? (
          <>
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
            />
            {fieldErrors.code ? <Text style={styles.fieldError}>{fieldErrors.code}</Text> : null}
          </>
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="New password (at least 8 characters)"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
        />
        {fieldErrors.password ? <Text style={styles.fieldError}>{fieldErrors.password}</Text> : null}
        <TextInput
          style={styles.input}
          placeholder="Confirm new password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          onSubmitEditing={handleSave}
        />
        {fieldErrors.confirmPassword ? <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text> : null}

        <Pressable style={styles.button} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Save new password</Text>}
        </Pressable>

        {!verified ? (
          <Pressable style={styles.link} onPress={handleResend} disabled={cooldown > 0 || resending}>
            {resending ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Text style={[styles.linkText, cooldown > 0 && styles.linkDisabled]}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </Text>
            )}
          </Pressable>
        ) : null}
        <Pressable style={styles.link} onPress={handleCancel} disabled={saving}>
          <Text style={styles.linkText}>Cancel</Text>
        </Pressable>

        {!verified ? (
          <View style={styles.hintRow}>
            <MaterialIcons name="info-outline" size={14} color={colors.textMuted} />
            <Text style={styles.hint}>Nothing arrived? Check spam, or make sure it&apos;s the email you signed up with.</Text>
          </View>
        ) : null}
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
  fieldError: { color: colors.danger, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md },
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
