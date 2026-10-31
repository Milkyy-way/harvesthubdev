import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { Section } from '../../../components/Section';
import type { InvitePreview, Pod } from '../../../types/pods';

// The accept screen: says exactly what joining shares and what it costs, so
// that saying yes is informed consent. Opened by an invite link, or a typed code.
export default function PodInviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Also on coming back from Harvest Pass, which may have changed the answer.
  useFocusEffect(
    useCallback(() => {
      apiClient.get<InvitePreview>(`/pods/invites/${code}`).then(
        (res) => {
          setInvite(res.data);
          setError(null);
        },
        (err) => setError(apiErrorMessage(err, "Couldn't open this invite.")),
      );
    }, [code])
  );

  const accept = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<Pod>(`/pods/invites/${code}/accept`);
      router.replace(`/(customer)/pods/${res.data.id}` as Href);
    } catch (err) {
      Alert.alert("Couldn't join", apiErrorMessage(err, 'Please try again.'));
      setBusy(false);
    }
  };

  const decline = () =>
    Alert.alert('Say no to this invite?', 'This neighbor won\'t be able to invite you again for 30 days.', [
      { text: 'Go back', style: 'cancel' },
      {
        text: 'Say no',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await apiClient.post(`/pods/invites/${code}/decline`);
            router.back();
          } catch (err) {
            Alert.alert("Couldn't answer", apiErrorMessage(err, 'Please try again.'));
            setBusy(false);
          }
        },
      },
    ]);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Pod invite</Text>
        <View style={styles.back} />
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}>
        {!invite ? (
          error ? (
            <Text style={styles.muted}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : (
          <>
            <Text style={styles.title}>
              {invite.host_first_name} invited you to {invite.pod_name}
            </Text>
            <Text style={styles.subtitle}>
              {invite.member_count} member{invite.member_count === 1 ? '' : 's'} so far, up to {invite.size_cap}.
            </Text>

            <View style={styles.facts}>
              <Fact icon="place" label="Drop point" value={invite.drop_line} />
              {invite.shelter_note ? <Fact icon="roofing" label="Where" value={invite.shelter_note} /> : null}
              <Fact icon="event" label="Delivery day" value={`${invite.delivery_day}s`} />
            </View>

            <Section title="What's shared">
              <Bullet icon="check" text="Your first name, with the other members." />
              <Bullet icon="check" text="That you collect your orders at this drop point." />
            </Section>

            <Section title="What's never shared">
              <Bullet icon="block" text="Your home address." />
              <Bullet icon="block" text="What you order." />
              <Bullet icon="block" text="Your payment details." />
            </Section>

            <Section
              title="What it costs"
              caption="The delivery fee is split evenly among the members who order. You order on your own and only pay when you order, charged once when the farm's orders close. The more neighbors order, the less each pays."
            >
              {invite.farms.length === 0 ? <Text style={styles.body}>No farm delivers here on this day right now.</Text> : null}
              {invite.farms.map((farm) => (
                <View key={farm.farmer_id} style={styles.farmRow}>
                  <Text style={styles.farmName}>{farm.farm_name}</Text>
                  <Text style={styles.farmFee}>
                    ${farm.pod_delivery_fee.toFixed(2)} · as little as ${farm.share.toFixed(2)} each
                  </Text>
                </View>
              ))}
            </Section>

            {invite.blocker ? (
              <View style={styles.blocker}>
                <MaterialIcons name="error-outline" size={18} color={colors.danger} />
                <Text style={styles.blockerText}>{invite.blocker}</Text>
              </View>
            ) : null}

            {invite.needs_harvest_pass ? (
              <>
                <View style={styles.notice}>
                  <MaterialIcons name="workspace-premium" size={18} color={colors.primary} />
                  <Text style={styles.noticeText}>
                    Pods are for Harvest Pass members. Join to accept this invite, then come back here.
                  </Text>
                </View>
                <Pressable style={styles.primaryButton} onPress={() => router.push('/(customer)/harvest-pass')}>
                  <Text style={styles.primaryButtonText}>See Harvest Pass</Text>
                </Pressable>
              </>
            ) : null}

            {invite.can_accept ? (
              <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={accept} disabled={busy}>
                {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Join this pod</Text>}
              </Pressable>
            ) : null}

            {invite.status === 'sent' && !invite.blocker ? (
              <Pressable style={styles.secondaryButton} onPress={decline} disabled={busy}>
                <Text style={styles.secondaryText}>No thanks</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Fact({ icon, label, value }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <MaterialIcons name={icon} size={19} color={colors.primary} />
      <View style={styles.flex1}>
        <Text style={styles.factLabel}>{label}</Text>
        <Text style={styles.factValue}>{value}</Text>
      </View>
    </View>
  );
}

function Bullet({ icon, text }: { icon: React.ComponentProps<typeof MaterialIcons>['name']; text: string }) {
  return (
    <View style={styles.bullet}>
      <MaterialIcons name={icon} size={17} color={colors.textMuted} />
      <Text style={styles.bulletText}>{text}</Text>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  loading: { marginTop: spacing.xl },
  muted: { fontSize: 13.5, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  flex1: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 25, lineHeight: 31, color: colors.text },
  subtitle: { fontSize: 13.5, color: colors.textMuted, marginTop: spacing.xs },
  facts: { marginTop: spacing.md },
  fact: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  factLabel: { fontSize: 12, color: colors.textMuted },
  factValue: { fontSize: 15, color: colors.text, marginTop: 1 },
  bullet: { flexDirection: 'row', gap: spacing.xs, paddingVertical: 4 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, color: colors.text },
  body: { fontSize: 14, color: colors.text },
  farmRow: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  farmName: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  farmFee: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  blocker: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: '#F6E7E5',
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  blockerText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.danger },
  notice: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    marginTop: spacing.lg,
  },
  noticeText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  secondaryButton: { paddingVertical: 13, alignItems: 'center', marginTop: spacing.xs },
  secondaryText: { color: colors.textMuted, fontSize: 14.5, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
