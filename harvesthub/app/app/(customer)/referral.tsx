import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Share, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { HARVEST_PASS_NAME } from '../../lib/harvestPass';
import type { ReferralSummary } from '../../types/membership';

// "Give a month, get a month": a friend who joins Harvest Pass with your
// code gets their first 30 days free; once they pay for their first period,
// you get one month's price off your next Harvest Pass bill (a Stripe
// credit — see harvesthub-backend/app/membership/service.py::_reward_referral).
export default function ReferralScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState<ReferralSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      apiClient.get<ReferralSummary>('/membership/referral').then(
        (res) => {
          setSummary(res.data);
          setError(null);
        },
        (err) => {
          console.warn('Could not load referral code:', err);
          setError("Couldn't load your referral code. Please try again.");
        }
      );
    }, [])
  );

  const reward = summary ? `$${summary.reward_amount.toFixed(0)}` : '';

  const handleShare = () => {
    if (!summary) return;
    // Opens straight to Harvest Pass with the code filled in for friends who
    // already have the app; everyone else types the code when they join.
    const link = Linking.createURL('/harvest-pass', { queryParams: { ref: summary.code } });
    Share.share({
      message:
        `I use ${HARVEST_PASS_NAME} on HarvestHub to skip service fees on fresh food from local farms. ` +
        `Join with my code ${summary.code} and get your first ${summary.friend_trial_days} days free.\n\n${link}`,
    }).catch((err) => console.warn('Share failed:', err));
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Refer a friend</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        <View style={styles.hero}>
          <View style={styles.iconWrap}>
            <MaterialIcons name="card-giftcard" size={28} color={colors.accent} />
          </View>
          <Text style={styles.title}>Give a month, get a month</Text>
          <Text style={styles.subtitle}>Share {HARVEST_PASS_NAME} with friends and you both save.</Text>
        </View>

        {!summary ? (
          error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : (
          <>
            <View style={styles.codeBox}>
              <Text style={styles.codeLabel}>Your code</Text>
              <Text style={styles.code} selectable>
                {summary.code}
              </Text>
            </View>
            <Pressable style={styles.shareButton} onPress={handleShare}>
              <MaterialIcons name="ios-share" size={18} color={colors.white} />
              <Text style={styles.shareButtonText}>Share your code</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>How it works</Text>
            <Step n={1} text="Share your code with a friend." />
            <Step n={2} text={`They join ${HARVEST_PASS_NAME} with it and get their first ${summary.friend_trial_days} days free.`} />
            <Step n={3} text={`When they pay for their first period, you get ${reward} off your next ${HARVEST_PASS_NAME} bill.`} />

            <View style={styles.statsRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{summary.joined_count}</Text>
                <Text style={styles.statLabel}>friends joined</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>${summary.credit_earned.toFixed(2)}</Text>
                <Text style={styles.statLabel}>credit earned</Text>
              </View>
            </View>
            <Text style={styles.finePrint}>
              Credits come off your {HARVEST_PASS_NAME} bill automatically. Not a member yet? Your credit waits for you.
              Codes are for people joining {HARVEST_PASS_NAME} for the first time.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNumber}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
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
  loading: { marginTop: spacing.xl },
  errorText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: spacing.xl },
  hero: { alignItems: 'center', paddingTop: spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FBF1DC',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, textAlign: 'center' },
  subtitle: { fontSize: 13.5, color: colors.textMuted, textAlign: 'center', marginTop: 2 },
  codeBox: {
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  codeLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  code: { fontSize: 30, fontWeight: '800', color: colors.primaryDark, letterSpacing: 4, marginTop: spacing.xs },
  shareButton: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  shareButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 20, color: colors.text, marginTop: spacing.xl, marginBottom: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.xs + 2 },
  stepNumber: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: `${colors.accent}40`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { fontSize: 13, fontWeight: '800', color: colors.primaryDark },
  stepText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  stat: { flex: 1, backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, alignItems: 'center' },
  statValue: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.primaryDark },
  statLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  finePrint: { fontSize: 11.5, lineHeight: 16, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
});
