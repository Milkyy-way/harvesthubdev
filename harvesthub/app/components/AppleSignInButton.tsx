import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { spacing } from '../constants/theme';

type Props = {
  mode: 'continue' | 'signUp';
  busy: boolean;
  onPress: () => void;
};

const HEIGHT = 46;

// Apple's own button, which the App Store guidelines require for starting Sign
// in with Apple. Renders nothing on Android.
export function AppleSignInButton({ mode, busy, onPress }: Props) {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let active = true;
    AppleAuthentication.isAvailableAsync().then(
      (result) => {
        if (active) setAvailable(result);
      },
      (err) => console.warn('Could not check for Sign in with Apple:', err)
    );
    return () => {
      active = false;
    };
  }, []);

  if (!available) return null;

  return (
    <View style={[styles.wrap, busy && styles.busy]} pointerEvents={busy ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={
          mode === 'signUp'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
        }
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={HEIGHT / 2}
        style={styles.button}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.sm + spacing.xs },
  busy: { opacity: 0.6 },
  button: { width: '100%', height: HEIGHT },
});
