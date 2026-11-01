import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { Section } from '../../../components/Section';
import { TextField } from '../../../components/TextField';
import { POD_STATUS_LABELS, type PodSummary } from '../../../types/pods';
import type { MembershipOverview } from '../../../types/membership';

// Your Neighborhood Pods, and the two ways in: start one, or type in a code a
// neighbor sent you (what someone new to the app does, since their invite link
// can't reach the app until it's installed).
export default function PodsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [pods, setPods] = useState<PodSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [pass, setPass] = useState<MembershipOverview | null>(null);
  const [startingFree, setStartingFree] = useState(false);

  useFocusEffect(
    useCallback(() => {
      apiClient.get<{ pods: PodSummary[] }>('/pods').then(
        (res) => {
          setPods(res.data.pods);
          setError(null);
        },
        (err) => setError(apiErrorMessage(err, "Couldn't load your pods. Try again.")),
      );
      apiClient.get<MembershipOverview>('/membership').then(
        (res) => setPass(res.data),
        (err) => console.warn('Could not load Harvest Pass status:', err)
      );
    }, [])
  );

  const startFree = async () => {
    setStartingFree(true);
    try {
      setPass((await apiClient.post<MembershipOverview>('/membership/start-free')).data);
    } catch (err) {
      Alert.alert("Couldn't start your free month", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setStartingFree(false);
    }
  };

  const cleanCode = code.trim().toUpperCase();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12} accessibilityLabel="Back">
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Neighborhood Pods</Text>
        <View style={styles.back} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Share a drop point with your neighbors</Text>
        <Text style={styles.subtitle}>
          A pod is 3 to 8 nearby Harvest Pass members with one drop point and one delivery day. Everyone orders and pays on
          their own, and each farm&apos;s delivery fee is split evenly among those who order.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!pods && !error ? <ActivityIndicator color={colors.primary} style={styles.loading} /> : null}

        {pods && pods.length > 0 ? (
          <Section title="Your pods">
            {pods.map((pod) => (
              <Pressable
                key={pod.id}
                style={styles.row}
                onPress={() => router.push(`/(customer)/pods/${pod.id}` as Href)}
                accessibilityRole="button"
              >
                <View style={styles.rowText}>
                  <Text style={styles.podName}>{pod.name}</Text>
                  <Text style={styles.podLine}>
                    {pod.delivery_day}s · {pod.member_count} member{pod.member_count === 1 ? '' : 's'}
                    {pod.is_host ? ' · You host' : ''}
                  </Text>
                  <Text style={[styles.podStatus, pod.status === 'active' && styles.podStatusActive]}>
                    {pod.needs_pass
                      ? 'Join Harvest Pass to order to this pod'
                      : pod.needs_reapproval
                      ? 'Please approve the new drop point'
                      : pod.needs_drop_point
                        ? 'Needs a new drop point'
                        : POD_STATUS_LABELS[pod.status]}
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
              </Pressable>
            ))}
          </Section>
        ) : null}

        {pass && !pass.is_member ? (
          <View style={styles.locked}>
            <View style={styles.lockedTitleRow}>
              <MaterialIcons name="lock-outline" size={19} color={colors.primaryDark} />
              <Text style={styles.lockedTitle}>Pods are for Harvest Pass members</Text>
            </View>
            <Text style={styles.lockedBody}>
              With Harvest Pass you can start or join a pod, order to its drop point and split the delivery fee with your neighbors. You also
              pay no service fee on orders of ${pass.free_service_fee_min_subtotal.toFixed(0)} or more.
            </Text>
            {pass.free_period_available ? (
              <>
                <Pressable style={[styles.primaryButton, startingFree && styles.disabled]} onPress={startFree} disabled={startingFree}>
                  {startingFree ? <ActivityIndicator color={colors.white} /> : <Text style={styles.primaryButtonText}>Start free month</Text>}
                </Pressable>
                <Text style={styles.lockedFine}>No card needed to start your free month.</Text>
              </>
            ) : (
              <Pressable style={styles.primaryButton} onPress={() => router.push('/(customer)/harvest-pass')}>
                <Text style={styles.primaryButtonText}>Join Harvest Pass</Text>
              </Pressable>
            )}
          </View>
        ) : pass ? (
          <Pressable style={styles.primaryButton} onPress={() => router.push('/(customer)/pods/new' as Href)}>
            <MaterialIcons name="add" size={18} color={colors.white} />
            <Text style={styles.primaryButtonText}>Start a pod</Text>
          </Pressable>
        ) : null}

        <Section title="Got an invite?" caption="Enter the 8-character code your neighbor sent you.">
          <View style={styles.codeRow}>
            <View style={styles.flex1}>
              <TextField
                value={code}
                onChangeText={setCode}
                placeholder="Invite code"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
              />
            </View>
            <Pressable
              style={[styles.codeButton, cleanCode.length !== 8 && styles.disabled]}
              disabled={cleanCode.length !== 8}
              onPress={() => {
                setCode('');
                router.push(`/(customer)/invite/${cleanCode}` as Href);
              }}
            >
              <Text style={styles.codeButtonText}>Open</Text>
            </Pressable>
          </View>
        </Section>
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
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  flex1: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, lineHeight: 30, color: colors.text },
  subtitle: { fontSize: 14, lineHeight: 20, color: colors.textMuted, marginTop: spacing.xs },
  error: { fontSize: 13.5, color: colors.danger, marginTop: spacing.md },
  loading: { marginTop: spacing.lg },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowText: { flex: 1 },
  podName: { fontSize: 16, fontWeight: '700', color: colors.text },
  podLine: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  podStatus: { fontSize: 12.5, fontWeight: '700', color: colors.berry, marginTop: 3 },
  podStatusActive: { color: colors.primary },
  primaryButton: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  locked: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  lockedTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  lockedTitle: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.primaryDark },
  lockedBody: { fontSize: 13.5, lineHeight: 19, color: colors.text, marginTop: spacing.xs },
  lockedFine: { fontSize: 12.5, textAlign: 'center', color: colors.textMuted, marginTop: spacing.xs },
  codeRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  codeButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
