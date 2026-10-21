import { useCallback, useState } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { signOut } from '../../../lib/signOut';
import { apiClient } from '../../../lib/apiClient';
import { useAuth } from '../../../contexts/AuthContext';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { FARM_TYPE_OPTIONS } from '../../../lib/validation/schemas';
import { HeroShell } from '../../../components/customer/HeroShell';
import { SettingsRow } from '../../../components/customer/SettingsRow';
import { Section } from '../../../components/Section';
import { InfoRow } from '../../../components/InfoRow';
import { VerificationStatusCard } from '../../../components/farmer/VerificationStatusCard';
import type { FarmerRatings } from '../../../types/farmer';

// Always open, approved or not. Editing the farm profile (F6) and ratings
// (F7) are for approved farmers; certifications & documents (F5) are
// viewable any time.
export default function FarmerAccount() {
  const { session, profile, farmerProfile, farmerVerification } = useAuth();
  const router = useRouter();
  const approved = profile?.status === 'active';
  const [ratings, setRatings] = useState<FarmerRatings | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!approved) return;
      apiClient.get<FarmerRatings>('/farmers/me/ratings').then(
        (res) => setRatings(res.data),
        (err) => console.warn('Could not load ratings summary:', err)
      );
    }, [approved])
  );
  const ratingsCaption = ratings
    ? ratings.count === 0
      ? 'No ratings yet'
      : `${ratings.average?.toFixed(1)} ★ · ${ratings.count} rating${ratings.count === 1 ? '' : 's'}`
    : 'What customers think';

  const firstName = profile?.full_name?.trim().split(' ')[0];
  const farmName = farmerProfile?.farm_name ?? 'Your farm';
  const farmTypeLabels = (farmerProfile?.farm_types ?? []).map(
    (value) => FARM_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value
  );
  const address = farmerProfile?.address_street
    ? `${farmerProfile.address_street}\n${farmerProfile.address_city}, ${farmerProfile.address_state} ${farmerProfile.address_zip}`
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <HeroShell headline={firstName ? `Hi, ${firstName}` : 'Your Account'} subheadline="Your profile, farm, and application." />

      <View style={styles.body}>
        <View style={styles.profileHeader}>
          {farmerProfile?.photo_url ? (
            <Image source={{ uri: farmerProfile.photo_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={styles.avatar}>
              <MaterialIcons name="agriculture" size={26} color={colors.white} />
            </View>
          )}
          <View style={styles.profileHeaderText}>
            <Text style={styles.name}>{farmName}</Text>
            <Text style={styles.email}>{profile?.full_name ?? session?.user.email}</Text>
          </View>
        </View>

        {approved ? (
          <>
            <SettingsRow
              icon="edit"
              label="Edit farm profile"
              caption="Photo, name, bio, pickup address, contact"
              onPress={() => router.push('/(farmer)/farm-profile')}
            />
            <SettingsRow icon="star-outline" label="Ratings" caption={ratingsCaption} onPress={() => router.push('/(farmer)/ratings')} />
          </>
        ) : null}
        <SettingsRow
          icon="workspace-premium"
          label="Certifications & documents"
          caption="What's on file with HarvestHub"
          onPress={() => router.push('/(farmer)/documents')}
        />

        <Text style={[styles.groupLabel, styles.groupLabelSpaced]}>Application</Text>
        <VerificationStatusCard
          status={profile?.status}
          farmName={farmName}
          reviewerNotes={farmerVerification?.reviewer_notes}
          submittedAt={farmerVerification?.submitted_at}
          onResubmit={() => router.push('/(farmer)/application')}
        />

        <Section title="Farm">
          <InfoRow icon="storefront" label="Farm name" value={farmName} />
          <InfoRow icon="place" label="Address" value={address ?? 'Not set'} />
          <InfoRow icon="category" label="Farm type" value={farmTypeLabels.length ? farmTypeLabels.join(', ') : 'Not set'} />
          <InfoRow
            icon="schedule"
            label="Years in operation"
            value={farmerProfile?.years_in_operation != null ? String(farmerProfile.years_in_operation) : 'Not set'}
          />
        </Section>

        <Section title="Contact">
          <InfoRow icon="person" label="Owner" value={profile?.full_name ?? 'Not set'} />
          <InfoRow icon="email" label="Email" value={session?.user.email ?? '—'} />
          <InfoRow icon="phone" label="Phone" value={profile?.phone ?? 'Not set'} />
        </Section>

        <Section title="More">
          <SettingsRow
            icon="notifications-none"
            label="Notifications"
            caption="Push, email and text alerts"
            onPress={() => router.push('/(farmer)/notifications')}
          />
          <SettingsRow icon="gavel" label="Legal" caption="Terms of Service, Privacy Policy" onPress={() => router.push('/(farmer)/legal')} />
          <SettingsRow
            icon="person-remove"
            label="Delete account"
            caption="Permanently delete your account and data"
            onPress={() => router.push('/(farmer)/delete-account')}
            destructive
          />
        </Section>

        <Pressable style={styles.logoutButton} onPress={() => signOut()}>
          <MaterialIcons name="logout" size={16} color={colors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
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
  groupLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  groupLabelSpaced: { marginTop: spacing.md },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 12,
    marginTop: spacing.xl,
  },
  logoutText: { color: colors.danger, fontSize: 14, fontWeight: '700' },
});
