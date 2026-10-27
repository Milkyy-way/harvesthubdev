import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { HeroShell } from '../../../components/customer/HeroShell';
import { VerificationStatusCard } from '../../../components/farmer/VerificationStatusCard';
import { StorePhotoCard } from '../../../components/farmer/StorePhotoCard';
import { EarningsCard } from '../../../components/farmer/EarningsCard';
import { DeliveriesCard } from '../../../components/farmer/DeliveriesCard';
import type { FarmerEarnings } from '../../../types/farmer';
import type { RunsResponse } from '../../../types/delivery';

export default function FarmerHome() {
  const { profile, farmerProfile, farmerVerification, refreshProfile } = useAuth();
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [earnings, setEarnings] = useState<FarmerEarnings | null>(null);
  const [runs, setRuns] = useState<RunsResponse | null>(null);

  const firstName = profile?.full_name?.trim().split(' ')[0];
  const farmName = farmerProfile?.farm_name ?? 'your farm';
  const status = profile?.status;
  const approved = status === 'active';

  const loadEarnings = useCallback(async () => {
    try {
      const [earningsRes, runsRes] = await Promise.all([
        apiClient.get<FarmerEarnings>('/farmers/me/earnings'),
        apiClient.get<RunsResponse>('/farmers/me/delivery/runs'),
      ]);
      setEarnings(earningsRes.data);
      setRuns(runsRes.data);
    } catch (err) {
      console.warn('Could not load earnings or deliveries:', err);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (approved) loadEarnings();
    }, [approved, loadEarnings])
  );

  // Pull-to-refresh and "Check status" both re-read the profile — an
  // approval in Studio shows up here (and unlocks the tabs) without logging
  // out. AuthContext also does this whenever the app returns to the foreground.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshProfile(), approved ? loadEarnings() : Promise.resolve()]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />}
    >
      <HeroShell
        headline={firstName ? `Hi, ${firstName}` : 'Welcome'}
        subheadline={approved ? `${farmName} is open for business on HarvestHub.` : `Your ${farmName} application`}
      />

      <View style={styles.body}>
        {/* Once approved, the application status lives on the Account tab;
            Home leads with earnings instead. */}
        {!approved ? (
          <VerificationStatusCard
            status={status}
            farmName={farmName}
            reviewerNotes={farmerVerification?.reviewer_notes}
            submittedAt={farmerVerification?.submitted_at}
            onResubmit={() => router.push('/(farmer)/application')}
          />
        ) : null}

        {status === 'pending_verification' ? (
          <>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>What happens next</Text>
              <Step icon="check-circle" state="done" label="Application submitted" />
              <Step icon="fact-check" state="current" label="HarvestHub reviews your details and documents" />
              <Step icon="lock-open" state="upcoming" label="Products and Orders unlock — start selling" />
            </View>
            <Pressable style={styles.checkButton} onPress={handleRefresh} disabled={refreshing}>
              {refreshing ? <ActivityIndicator color={colors.primary} /> : <Text style={styles.checkButtonText}>Check status</Text>}
            </Pressable>
          </>
        ) : null}

        {approved ? (
          <>
            <EarningsCard earnings={earnings} onPress={() => router.push('/(farmer)/earnings')} />
            <DeliveriesCard runs={runs} onPress={() => router.push('/(farmer)/deliveries')} />
            <StorePhotoCard />
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

function Step({
  icon,
  state,
  label,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  state: 'done' | 'current' | 'upcoming';
  label: string;
}) {
  const color = state === 'done' ? colors.primary : state === 'current' ? colors.accent : colors.textMuted;
  return (
    <View style={styles.step}>
      <MaterialIcons name={icon} size={20} color={color} />
      <Text style={[styles.stepLabel, state === 'upcoming' && styles.stepLabelUpcoming]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  card: { marginBottom: spacing.lg },
  cardTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  stepLabel: { flex: 1, fontSize: 13.5, color: colors.text },
  stepLabelUpcoming: { color: colors.textMuted },
  checkButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  checkButtonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
