import { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AntDesign from '@expo/vector-icons/AntDesign';
import { supabase } from '../../lib/supabase';
import { signInWithGoogle, isFirstEverSignIn } from '../../lib/googleAuth';
import { resendSignupCode } from '../../lib/emailVerification';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { Logo } from '../../components/Logo';

export default function Login() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setLoading(true);
    const normalizedEmail = email.trim().toLowerCase();
    const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
    if (error?.code === 'email_not_confirmed') {
      // Signed up but never entered the emailed code — send a fresh one.
      const { error: resendError } = await resendSignupCode(normalizedEmail);
      setLoading(false);
      router.push({ pathname: '/(auth)/verify-email', params: { email: normalizedEmail, sent: resendError ? '0' : '1' } });
      return;
    }
    setLoading(false);
    if (error) {
      // Supabase intentionally returns the same generic message for a wrong
      // password vs. a nonexistent email, so this doesn't leak which one it was.
      setError(error.message);
      return;
    }
    // No manual navigation here — RootLayout's auth listener sees the new
    // session and redirects to the right role's home screen automatically.
  };

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const session = await signInWithGoogle();
      if (!session) return; // cancelled the Google sheet — nothing to show

      if (isFirstEverSignIn(session)) {
        // This Google account has never signed in here before — the Login
        // screen shouldn't silently create one (that's what Sign Up is
        // for). Undo it and send them there instead.
        await supabase.auth.signOut();
        Alert.alert(
          "We don't have that account yet",
          'No HarvestHub account is linked to that Google email. Sign up first, or log in with the email and password you already registered.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign Up', onPress: () => router.push('/(auth)/signup') },
          ]
        );
        return;
      }
      // An existing account (whether fully set up or still finishing
      // role-setup) — RootLayout's own auth listener takes it from here,
      // same as the password path above.
    } catch (err: any) {
      console.warn('Could not sign in with Google:', err);
      setError(err?.message ?? 'Could not sign in with Google.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={[styles.container, { paddingTop: insets.top + spacing.lg }]}>
        <View style={styles.brandRow}>
          <Logo size={40} />
          <Text style={styles.brandText}>HarvestHub</Text>
        </View>

        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>Log in to your HarvestHub account</Text>

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
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry
          autoComplete="password"
          value={password}
          onChangeText={setPassword}
        />
        <Pressable
          style={styles.forgot}
          onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: { email: email.trim() } })}
          hitSlop={8}
        >
          <Text style={styles.forgotText}>Forgot password?</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Log in</Text>}
        </Pressable>

        <Pressable style={styles.signupButton} onPress={() => router.push('/(auth)/signup')}>
          <Text style={styles.signupButtonText}>Sign up</Text>
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or continue with</Text>
          <View style={styles.dividerLine} />
        </View>

        <Pressable style={styles.googleButton} onPress={handleGoogleSignIn} disabled={googleLoading}>
          {googleLoading ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <>
              <AntDesign name="google" size={17} color={colors.text} />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.lg, paddingVertical: spacing.xl, justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl + spacing.sm, alignSelf: 'center' },
  brandText: { fontFamily: fonts.brand, fontSize: 17, color: colors.text },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.xl },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: 14,
    marginBottom: spacing.md + spacing.xs,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  forgot: { alignSelf: 'flex-end', marginTop: -spacing.xs },
  forgotText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { color: colors.white, fontWeight: '600', fontSize: 15 },
  signupButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  signupButtonText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, marginBottom: spacing.md + spacing.xs },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { fontSize: 12, color: colors.textMuted },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 13,
    backgroundColor: colors.surface,
  },
  googleButtonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
});
