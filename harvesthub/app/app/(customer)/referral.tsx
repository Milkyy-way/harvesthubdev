import { View, Text, Pressable, ScrollView, Share, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { HARVEST_PASS_NAME } from '../../lib/harvestPass';

// Where the shared message sends friends. Defaults to the Google Play
// listing; set EXPO_PUBLIC_APP_SHARE_URL to a website or store link instead.
const SHARE_URL =
  process.env.EXPO_PUBLIC_APP_SHARE_URL ?? 'https://play.google.com/store/apps/details?id=com.harvesthubmarket.app';

// "Invite friends" — a plain share, with no codes and no rewards for either
// side (decided with the user 2026-10-19). Every new customer already gets
// Harvest Pass free for their first month, invited or not.
export default function InviteFriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleShare = () => {
    Share.share({
      message:
        `I get fresh food from local farms on HarvestHub. New members get ${HARVEST_PASS_NAME} free for their first ` +
        `month — no service fee on bigger orders.\n\n${SHARE_URL}`,
    }).catch((err) => console.warn('Share failed:', err));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Invite friends</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <MaterialIcons name="people-outline" size={28} color={colors.primary} />
          </View>
          <Text style={styles.title}>Share HarvestHub</Text>
          <Text style={styles.subtitle}>
            Know someone who&apos;d love fresh food from local farms? Send them the app — new members get{' '}
            {HARVEST_PASS_NAME} free for their first month.
          </Text>
        </View>

        <Pressable style={styles.shareButton} onPress={handleShare}>
          <MaterialIcons name="ios-share" size={18} color={colors.white} />
          <Text style={styles.shareButtonText}>Share HarvestHub</Text>
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
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { paddingHorizontal: spacing.lg },
  hero: { alignItems: 'center', paddingTop: spacing.lg },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xs },
  shareButton: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  shareButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
