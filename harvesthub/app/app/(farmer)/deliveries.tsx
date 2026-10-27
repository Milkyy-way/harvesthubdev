import { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import type { RunSummary, RunsResponse } from '../../types/delivery';

const STATUS: Record<RunSummary['status'], { label: string; color: string }> = {
  scheduled: { label: 'Scheduled', color: colors.accent },
  in_progress: { label: 'Out delivering', color: colors.primary },
  completed: { label: 'Done', color: colors.primaryDark },
};

// The farmer's delivery runs — one per delivery window with orders in it.
export default function DeliveriesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [runs, setRuns] = useState<RunsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    () =>
      apiClient.get<RunsResponse>('/farmers/me/delivery/runs').then(
        (res) => {
          setRuns(res.data);
          setError(null);
        },
        (err) => {
          console.warn('Could not load deliveries:', err);
          setError("Couldn't load your deliveries. Pull down to try again.");
        }
      ),
    []
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const empty = runs && runs.upcoming.length === 0 && runs.recent.length === 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Deliveries</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => router.push('/(farmer)/delivery-settings')}
          hitSlop={12}
          accessibilityLabel="Delivery settings"
        >
          <MaterialIcons name="tune" size={22} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.primary}
          />
        }
      >
        {!runs ? (
          error ? (
            <Text style={styles.muted}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : empty ? (
          <View style={styles.empty}>
            <MaterialIcons name="local-shipping" size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No deliveries yet</Text>
            <Text style={styles.muted}>
              Turn on delivery and add your delivery windows. Orders customers book for delivery show up here, grouped by
              window.
            </Text>
            <Pressable style={styles.primaryButton} onPress={() => router.push('/(farmer)/delivery-settings')}>
              <Text style={styles.primaryButtonText}>Delivery settings</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Upcoming</Text>
            {runs.upcoming.length === 0 ? <Text style={styles.muted}>Nothing scheduled right now.</Text> : null}
            {runs.upcoming.map((run) => (
              <RunRow key={run.id} run={run} onPress={() => router.push({ pathname: '/(farmer)/delivery-run/[id]', params: { id: run.id } })} />
            ))}

            {runs.recent.length > 0 ? (
              <>
                <Text style={styles.sectionTitle}>Last 7 days</Text>
                {runs.recent.map((run) => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onPress={() => router.push({ pathname: '/(farmer)/delivery-run/[id]', params: { id: run.id } })}
                  />
                ))}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function RunRow({ run, onPress }: { run: RunSummary; onPress: () => void }) {
  const status = STATUS[run.status];
  return (
    <Pressable style={({ pressed }) => [styles.row, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.rowIcon}>
        <MaterialIcons name="local-shipping" size={20} color={colors.primary} />
      </View>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{run.label}</Text>
        <Text style={styles.rowSub}>
          {run.stop_count} stop{run.stop_count === 1 ? '' : 's'}
          {run.status !== 'scheduled' ? ` · ${run.delivered_count} delivered` : ''}
          {run.can_start ? ' · ready to start' : ''}
        </Text>
      </View>
      <View style={[styles.pill, { backgroundColor: `${status.color}1A` }]}>
        <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
    </Pressable>
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
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text },
  content: { paddingHorizontal: spacing.lg },
  loading: { marginTop: spacing.xl },
  muted: { fontSize: 13.5, lineHeight: 20, color: colors.textMuted, textAlign: 'center' },
  empty: { alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl, paddingHorizontal: spacing.md },
  emptyTitle: { fontFamily: fonts.headline, fontSize: 20, color: colors.text },
  sectionTitle: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.lg, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md - 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: { opacity: 0.6 },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  rowSub: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  pill: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 9 },
  pillText: { fontSize: 11, fontWeight: '700' },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  primaryButtonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
});
