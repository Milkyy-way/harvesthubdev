import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { signOut } from '../../../lib/signOut';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { DIETARY_PREFERENCE_OPTIONS, PRODUCE_INTEREST_OPTIONS } from '../../../lib/validation/schemas';
import { HeroShell } from '../../../components/customer/HeroShell';
import { StatTile } from '../../../components/customer/StatTile';
import { SettingsRow } from '../../../components/customer/SettingsRow';
import { Section } from '../../../components/Section';
import { InfoRow, ChipRow } from '../../../components/InfoRow';
import type { DashboardSummary } from '../../../types/dashboard';
import type { MembershipOverview } from '../../../types/membership';
import { formatLongDate } from '../../../lib/harvestPass';

export default function CustomerAccount() {
  const { session, profile, customerProfile } = useAuth();
  const router = useRouter();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [pass, setPass] = useState<MembershipOverview | null>(null);
  const firstName = profile?.full_name?.trim().split(' ')[0];

  useFocusEffect(
    useCallback(() => {
      apiClient.get<DashboardSummary>('/customers/me/dashboard-summary').then(
        (res) => setSummary(res.data),
        (err) => console.warn('Could not load account stats:', err)
      );
      apiClient.get<MembershipOverview>('/membership').then(
        (res) => setPass(res.data),
        (err) => console.warn('Could not load Harvest Pass status:', err)
      );
    }, [])
  );

  const dietaryLabels = (customerProfile?.dietary_preferences ?? []).map(
    (value) => DIETARY_PREFERENCE_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
  const produceLabels = (customerProfile?.produce_interests ?? []).map(
    (value) => PRODUCE_INTEREST_OPTIONS.find((o) => o.value === value)?.label ?? value
  );

  const addressLine = customerProfile
    ? [customerProfile.address_street, `${customerProfile.address_city}, ${customerProfile.address_state} ${customerProfile.address_zip}`]
    : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <HeroShell headline={firstName ? `Hi, ${firstName}` : 'Your Account'} subheadline="Manage your profile, preferences, and orders." />

      <View style={styles.body}>
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <MaterialIcons name="person" size={26} color={colors.white} />
          </View>
          <View style={styles.profileHeaderText}>
            <Text style={styles.name}>{profile?.full_name ?? 'Your account'}</Text>
            <Text style={styles.email}>{session?.user.email}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatTile icon="receipt-long" label="Total Orders" value={summary ? String(summary.orders_total) : '—'} />
          <StatTile icon="cancel" label="Cancelled" value={summary ? String(summary.orders_cancelled) : '—'} />
        </View>

        <SettingsRow
          icon="workspace-premium"
          label="Harvest Pass"
          caption={harvestPassCaption(pass)}
          onPress={() => router.push('/(customer)/harvest-pass')}
        />
        <SettingsRow
          icon="groups"
          label="Neighborhood Pods"
          caption="Share a drop point with neighbors and pay less for delivery"
          onPress={() => router.push('/(customer)/pods' as Href)}
        />
        <SettingsRow
          icon="share"
          label="Invite friends"
          caption="Share HarvestHub with people you know"
          onPress={() => router.push('/(customer)/referral')}
        />
        <SettingsRow icon="help-outline" label="Help" onPress={() => router.push('/(customer)/help')} />
        <SettingsRow icon="settings" label="Settings" onPress={() => router.push('/(customer)/settings')} />

        <Section title="Contact">
          <InfoRow icon="email" label="Email" value={session?.user.email ?? '—'} />
          <InfoRow icon="phone" label="Phone" value={profile?.phone ?? 'Not set'} />
        </Section>

        <Section title="Delivery Address">
          {addressLine.length > 0 ? (
            <InfoRow icon="place" label="Address" value={addressLine.join('\n')} />
          ) : (
            <Text style={styles.emptyText}>No address on file.</Text>
          )}
        </Section>

        <Section title="Dietary Preferences">
          {dietaryLabels.length > 0 ? <ChipRow labels={dietaryLabels} /> : <Text style={styles.emptyText}>None set.</Text>}
        </Section>

        <Section title="Produce Interests">
          {produceLabels.length > 0 ? <ChipRow labels={produceLabels} /> : <Text style={styles.emptyText}>None set.</Text>}
        </Section>

        <Pressable style={styles.logoutButton} onPress={() => signOut()}>
          <MaterialIcons name="logout" size={16} color={colors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function harvestPassCaption(pass: MembershipOverview | null): string | undefined {
  if (!pass) return undefined;
  const m = pass.membership;
  const min = pass.free_service_fee_min_subtotal.toFixed(0);
  if (!m) {
    return pass.free_period_active && pass.free_period_ends_at
      ? `Free until ${formatLongDate(pass.free_period_ends_at)} — no service fee on $${min}+ orders`
      : `Join for no service fee on orders of $${min}+`;
  }
  if (!m.has_benefits || m.status === 'past_due') return 'Payment problem — tap to update your card';
  if (m.cancel_at_period_end && m.ends_at) return `Ends ${formatLongDate(m.ends_at)}`;
  if (m.status === 'trialing' && m.trial_end) return `Free month — your plan starts ${formatLongDate(m.trial_end)}`;
  return `Member · $${pass.total_savings.toFixed(2)} saved`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: spacing.xl },
  body: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileHeaderText: { flex: 1 },
  name: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  emptyText: { fontSize: 13, color: colors.textMuted },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: 12,
    marginTop: spacing.sm,
  },
  logoutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
