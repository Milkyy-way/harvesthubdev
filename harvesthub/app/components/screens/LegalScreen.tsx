import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, fonts } from '../../constants/theme';
import { LEGAL_URLS } from '../../constants/legal';
import { SettingsRow } from '../customer/SettingsRow';

// Customer Settings -> Legal and farmer Account -> Legal. The documents
// themselves are web pages (constants/legal.ts), so the text can be updated
// without an app release and is the same text linked from Google Play.
export default function LegalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const open = (url: string) => WebBrowser.openBrowserAsync(url);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Legal</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <SettingsRow icon="privacy-tip" label="Privacy Policy" caption="What we collect and who sees it" onPress={() => open(LEGAL_URLS.privacy)} />
        <SettingsRow icon="gavel" label="Terms of Service" caption="The rules for buying and selling" onPress={() => open(LEGAL_URLS.terms)} />
        <SettingsRow
          icon="person-remove"
          label="Account deletion"
          caption="What's deleted and what's kept"
          onPress={() => open(LEGAL_URLS.deleteAccount)}
        />
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
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
});
