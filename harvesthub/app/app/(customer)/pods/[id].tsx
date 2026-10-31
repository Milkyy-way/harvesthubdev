import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, Share, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { formatLongDate } from '../../../lib/harvestPass';
import { podInviteUrl } from '../../../constants/legal';
import { Section } from '../../../components/Section';
import { TextField } from '../../../components/TextField';
import { POD_STATUS_LABELS, type InviteStatus, type Pod, type PodInvite, type PodMember } from '../../../types/pods';

const INVITE_LABELS: Record<InviteStatus, string> = {
  sent: 'Waiting for an answer',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Ran out',
  revoked: 'Withdrawn',
};

// One pod: where it stands, its members (first names only) and, for the host,
// invites and the choices that come with hosting.
export default function PodDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pod, setPod] = useState<Pod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      apiClient.get<Pod>(`/pods/${id}`).then(
        (res) => {
          setPod(res.data);
          setError(null);
        },
        (err) => setError(apiErrorMessage(err, "Couldn't load this pod.")),
      ),
    [id]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Runs one action, then shows the pod as it now stands.
  const act = async (request: () => Promise<unknown>, failure: string, leavesPod = false) => {
    setBusy(true);
    try {
      await request();
      if (leavesPod) router.back();
      else await load();
    } catch (err) {
      Alert.alert(failure, apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const shareInvite = (invite: PodInvite, name: string) => {
    Share.share({
      message:
        `Join ${name}, my Neighborhood Pod on HarvestHub. We share a drop point and pay less for delivery from local farms.\n\n` +
        `${podInviteUrl(invite.code)}\n\nInvite code: ${invite.code} (works for 72 hours)`,
    }).catch((err) => console.warn('Share failed:', err));
  };

  const createInvite = async () => {
    if (!pod) return;
    setBusy(true);
    try {
      const res = await apiClient.post<PodInvite>(`/pods/${id}/invites`, { label: label.trim() || null });
      setLabel('');
      shareInvite(res.data, pod.name);
      await load();
    } catch (err) {
      Alert.alert("Couldn't create the invite", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const confirmLeave = () =>
    Alert.alert('Leave this pod?', 'If you have an order on the way, you leave once it has been delivered.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => act(() => apiClient.post(`/pods/${id}/leave`), "Couldn't leave", true) },
    ]);

  const confirmEnd = () =>
    Alert.alert('End this pod?', 'Everyone will be told, and it can\'t be undone. Orders already placed will still be delivered.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'End pod', style: 'destructive', onPress: () => act(() => apiClient.post(`/pods/${id}/dissolve`), "Couldn't end the pod", true) },
    ]);

  const memberActions = (member: PodMember) => {
    const homeWarning =
      pod?.drop_kind === 'home'
        ? ' The drop point is your home, so they will need to choose a new one, and the pod pauses until they do.'
        : '';
    Alert.alert(member.first_name, undefined, [
      {
        text: 'Make host and stay',
        onPress: () =>
          Alert.alert(`Make ${member.first_name} the host?`, `You stay in the pod as a member.${homeWarning}`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Make host',
              onPress: () =>
                act(() => apiClient.post(`/pods/${id}/transfer`, { member_id: member.id, leave: false }), "Couldn't hand over"),
            },
          ]),
      },
      {
        text: 'Make host and leave',
        onPress: () =>
          Alert.alert(`Hand over to ${member.first_name} and leave?`, `You leave once any order of yours has been delivered.${homeWarning}`, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Hand over and leave',
              style: 'destructive',
              onPress: () =>
                act(() => apiClient.post(`/pods/${id}/transfer`, { member_id: member.id, leave: true }), "Couldn't hand over", true),
            },
          ]),
      },
      {
        text: 'Remove from pod',
        style: 'destructive',
        onPress: () =>
          Alert.alert(`Remove ${member.first_name}?`, 'They will be told. Any order they already placed will still be delivered.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Remove',
              style: 'destructive',
              onPress: () => act(() => apiClient.post(`/pods/${id}/members/${member.id}/revoke`), "Couldn't remove them"),
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const needed = pod ? Math.max(pod.min_members - pod.member_count, 0) : 0;
  const openInvites = pod?.invites.filter((i) => i.status === 'sent') ?? [];
  const pastInvites = pod?.invites.filter((i) => i.status !== 'sent') ?? [];

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Neighborhood Pod</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {!pod ? (
          error ? (
            <Text style={styles.muted}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : (
          <>
            <Text style={styles.title}>{pod.name}</Text>
            <Text style={styles.status}>
              {POD_STATUS_LABELS[pod.status]} · {pod.delivery_day}s
            </Text>

            {pod.status === 'draft' ? (
              <Banner icon="group-add" text={`Invite at least ${needed} neighbors to get your pod going.`} />
            ) : null}
            {pod.status === 'pending' ? (
              <Banner
                icon="hourglass-empty"
                text={`${needed} more neighbor${needed === 1 ? '' : 's'} to go live${
                  pod.expires_at ? `, by ${formatLongDate(pod.expires_at)}` : ''
                }.`}
              />
            ) : null}
            {pod.status === 'active' ? (
              <Banner icon="check-circle" text={`Choose this pod for delivery when you check out, and collect on ${pod.delivery_day}s.`} />
            ) : null}
            {pod.status === 'paused' ? (
              <Banner
                icon="pause-circle-outline"
                warning
                text={`New orders are paused. ${
                  pod.needs_drop_point ? 'The pod needs a new drop point' : `The pod needs ${needed} more neighbor${needed === 1 ? '' : 's'}`
                }${pod.grace_ends_at ? ` by ${formatLongDate(pod.grace_ends_at)}, or it ends.` : '.'}`}
              />
            ) : null}
            {pod.my_leave_at ? (
              <Banner
                icon="logout"
                warning
                text={
                  pod.my_leave_reason === 'lapsed'
                    ? `You leave this pod on ${formatLongDate(pod.my_leave_at)} unless you join Harvest Pass.`
                    : 'You are leaving this pod once your order has been delivered.'
                }
              />
            ) : null}

            {pod.drop_locked_date ? (
              <Banner
                icon="lock"
                text={`Everyone has ordered for ${formatLongDate(`${pod.drop_locked_date}T12:00:00`)}, so the drop point is set and delivery happens here.`}
              />
            ) : pod.drop_on_its_way ? (
              <Banner icon="local-shipping" text="A farm is on its way here, so the drop point can't change right now." />
            ) : null}

            {pod.home_address_changed && !pod.drop_locked_date && !pod.drop_on_its_way ? (
              <Banner
                icon="home"
                warning
                text="Your saved address no longer matches this drop point. If you've moved, tap Change below and choose My home."
              />
            ) : null}

            {pod.needs_reapproval ? (
              <View style={styles.approve}>
                <Text style={styles.approveTitle}>The drop point has moved</Text>
                <Text style={styles.approveText}>
                  {pod.address_line}.{' '}
                  {pod.reapprove_by ? `Approve it by ${formatLongDate(pod.reapprove_by)} to stay in the pod.` : ''}
                </Text>
                <Pressable
                  style={[styles.primaryButton, busy && styles.disabled]}
                  disabled={busy}
                  onPress={() => act(() => apiClient.post(`/pods/${id}/reapprove`), "Couldn't approve it")}
                >
                  <Text style={styles.primaryButtonText}>Approve new drop point</Text>
                </Pressable>
              </View>
            ) : null}

            <Section
              title="Drop point"
              actionLabel={
                !pod.is_host
                  ? undefined
                  : pod.needs_drop_point
                    ? 'Choose'
                    : pod.drop_locked_date || pod.drop_on_its_way
                      ? undefined
                      : 'Change'
              }
              onAction={() => router.push(`/(customer)/pods/new?podId=${pod.id}` as Href)}>
              <Text style={styles.body}>{pod.address_line ?? 'The host needs to choose a new drop point.'}</Text>
              {pod.shelter_note ? <Text style={styles.caption}>Spot: {pod.shelter_note}</Text> : null}
              {pod.access_notes ? <Text style={styles.caption}>Driver notes: {pod.access_notes}</Text> : null}
            </Section>

            <Section
              title="Farms delivering here"
              caption="Each farm's fee is split evenly among the members who order. Your card is charged once, when that farm's orders close."
            >
              {pod.farms.length === 0 ? <Text style={styles.body}>No farm delivers here on {pod.delivery_day}s right now.</Text> : null}
              {pod.farms.map((farm) => (
                <View key={farm.farmer_id} style={styles.row}>
                  <Text style={styles.rowTitle}>{farm.farm_name}</Text>
                  <Text style={styles.rowText}>
                    ${farm.pod_delivery_fee.toFixed(2)} · ${farm.share.toFixed(2)} each if all {pod.member_count} members order
                  </Text>
                </View>
              ))}
            </Section>

            <Section title={`Members (${pod.member_count} of ${pod.size_cap})`} caption="Members see first names only, never your home address, orders or payment details.">
              {pod.members.map((member) => {
                const canManage = pod.is_host && !member.is_me;
                return (
                  <Pressable
                    key={member.id}
                    style={styles.memberRow}
                    disabled={!canManage || busy}
                    onPress={() => memberActions(member)}
                    accessibilityRole={canManage ? 'button' : undefined}
                  >
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{member.first_name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.flex1}>
                      <Text style={styles.rowTitle}>
                        {member.first_name}
                        {member.is_me ? ' (you)' : ''}
                      </Text>
                      <Text style={styles.rowText}>
                        {[member.is_host ? 'Host' : null, member.leaving ? 'Leaving' : null, member.needs_reapproval ? 'Yet to approve the drop point' : null]
                          .filter(Boolean)
                          .join(' · ') || 'Member'}
                      </Text>
                    </View>
                    {canManage ? <MaterialIcons name="more-horiz" size={22} color={colors.textMuted} /> : null}
                  </Pressable>
                );
              })}
            </Section>

            {pod.is_host && !pod.needs_drop_point && pod.member_count < pod.size_cap ? (
              <Section title="Invite a neighbor" caption={`Each invite is for one person within ${pod.radius_miles} miles of the drop point, and lasts 72 hours. You send it from your own phone.`}>
                <TextField value={label} onChangeText={setLabel} placeholder="Who's it for? Just for you (optional)" maxLength={60} />
                <Pressable style={[styles.primaryButton, styles.tight, busy && styles.disabled]} onPress={createInvite} disabled={busy}>
                  <MaterialIcons name="ios-share" size={18} color={colors.white} />
                  <Text style={styles.primaryButtonText}>Create and share invite</Text>
                </Pressable>
              </Section>
            ) : null}

            {pod.is_host && openInvites.length > 0 ? (
              <Section title="Waiting for an answer">
                {openInvites.map((invite) => (
                  <View key={invite.id} style={styles.inviteRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.rowTitle}>{invite.label ?? invite.code}</Text>
                      <Text style={styles.rowText}>Runs out {formatLongDate(invite.expires_at)}</Text>
                    </View>
                    <Pressable onPress={() => shareInvite(invite, pod.name)} hitSlop={8}>
                      <Text style={styles.link}>Share</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => act(() => apiClient.post(`/pods/${id}/invites/${invite.id}/revoke`), "Couldn't withdraw it")}
                      disabled={busy}
                      hitSlop={8}
                    >
                      <Text style={styles.linkDanger}>Withdraw</Text>
                    </Pressable>
                  </View>
                ))}
              </Section>
            ) : null}

            {pod.is_host && pastInvites.length > 0 ? (
              <Section title="Earlier invites">
                {pastInvites.slice(0, 10).map((invite) => (
                  <View key={invite.id} style={styles.inviteRow}>
                    <Text style={[styles.rowTitle, styles.flex1]}>{invite.label ?? invite.code}</Text>
                    <Text style={styles.rowText}>{INVITE_LABELS[invite.status]}</Text>
                  </View>
                ))}
              </Section>
            ) : null}

            {pod.is_host ? (
              <>
                {pod.members.length > 1 ? (
                  <Text style={styles.fine}>Want to step down? Tap a member above to hand the pod over to them.</Text>
                ) : null}
                <Pressable style={styles.dangerButton} onPress={confirmEnd} disabled={busy}>
                  <Text style={styles.dangerText}>End this pod</Text>
                </Pressable>
              </>
            ) : !pod.my_leave_at ? (
              <Pressable style={styles.dangerButton} onPress={confirmLeave} disabled={busy}>
                <Text style={styles.dangerText}>Leave this pod</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Banner({
  icon,
  text,
  warning,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  text: string;
  warning?: boolean;
}) {
  return (
    <View style={[styles.banner, warning && styles.bannerWarning]}>
      <MaterialIcons name={icon} size={19} color={warning ? colors.danger : colors.primary} />
      <Text style={styles.bannerText}>{text}</Text>
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
  title: { fontFamily: fonts.headlineBold, fontSize: 26, color: colors.text },
  status: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
  banner: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    padding: spacing.sm + 4,
    marginTop: spacing.md,
  },
  bannerWarning: { backgroundColor: '#F6E7E5' },
  bannerText: { flex: 1, fontSize: 13.5, lineHeight: 19, color: colors.text },
  approve: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  approveTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  approveText: { fontSize: 13.5, lineHeight: 19, color: colors.text, marginTop: 2 },
  body: { fontSize: 14.5, lineHeight: 20, color: colors.text },
  caption: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: 3 },
  row: { paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowTitle: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  rowText: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '800', color: colors.primaryDark },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  link: { fontSize: 13.5, fontWeight: '700', color: colors.primary },
  linkDanger: { fontSize: 13.5, fontWeight: '700', color: colors.danger },
  primaryButton: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  tight: { marginTop: 0 },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  fine: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted, marginTop: spacing.xl },
  dangerButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  dangerText: { color: colors.danger, fontSize: 14.5, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
