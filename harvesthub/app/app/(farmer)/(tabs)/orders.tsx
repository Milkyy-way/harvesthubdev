import { useCallback, useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { colors, spacing, radius } from '../../../constants/theme';
import { HeroShell } from '../../../components/customer/HeroShell';
import { LockedTabNotice, TabNotice } from '../../../components/farmer/TabNotice';
import { FarmerOrderCard } from '../../../components/farmer/FarmerOrderCard';
import { CancelOrderSheet } from '../../../components/farmer/CancelOrderSheet';
import type { FarmerOrder, FarmerOrderView, FarmerOrdersResponse } from '../../../types/farmer';

const VIEWS: { key: FarmerOrderView; label: string; empty: string }[] = [
  { key: 'to_prepare', label: 'To prepare', empty: 'No orders to prepare right now. New orders show up here as soon as they’re placed.' },
  { key: 'ready', label: 'Ready / out', empty: 'Nothing waiting for pickup or out for delivery.' },
  { key: 'completed', label: 'Done', empty: 'Picked-up and delivered orders will appear here.' },
  { key: 'cancelled', label: 'Cancelled', empty: 'No cancelled orders.' },
];

// The farmer's incoming orders (Farmer F3): pack them, mark them ready for
// pickup, or cancel. Locked until the farmer is approved.
export default function FarmerOrders() {
  const { profile } = useAuth();
  const approved = profile?.status === 'active';

  const [view, setView] = useState<FarmerOrderView>('to_prepare');
  const [data, setData] = useState<FarmerOrdersResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<FarmerOrder | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async (which: FarmerOrderView) => {
    try {
      const res = await apiClient.get<FarmerOrdersResponse>('/farmers/me/orders', { params: { view: which } });
      setData(res.data);
      setError(null);
    } catch (err) {
      console.warn('Could not load orders:', err);
      setError("Couldn't load your orders. Pull down to try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (approved) load(view);
    }, [approved, load, view])
  );

  const switchView = (next: FarmerOrderView) => {
    if (next === view) return;
    setData(null);
    setView(next);
  };

  const markReady = async (order: FarmerOrder) => {
    setBusyId(order.id);
    try {
      await apiClient.post(`/farmers/me/orders/${order.id}/ready`);
      await load(view);
    } catch (err) {
      Alert.alert('Could not update order', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusyId(null);
    }
  };

  const confirmCancel = async (reason: string) => {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await apiClient.post(`/farmers/me/orders/${cancelTarget.id}/cancel`, { reason });
      setCancelTarget(null);
      await load(view);
    } catch (err) {
      Alert.alert('Could not cancel', apiErrorMessage(err, 'Please try again.'));
    } finally {
      setCancelling(false);
    }
  };

  if (!approved) {
    return (
      <View style={styles.container}>
        <HeroShell headline="Orders" subheadline="Orders customers place with your farm." />
        <LockedTabNotice status={profile?.status} feature="Orders" />
      </View>
    );
  }

  const current = VIEWS.find((v) => v.key === view)!;

  return (
    <View style={styles.container}>
      <FlatList
        data={data?.items ?? []}
        keyExtractor={(o) => o.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load(view);
            }}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.headerWrap}>
            <HeroShell headline="Orders" subheadline="Pack them, mark them ready, and customers come to you.">
              <View style={styles.segments}>
                {VIEWS.map((v) => {
                  const active = v.key === view;
                  const count = data?.counts[v.key];
                  return (
                    <Pressable key={v.key} style={[styles.segment, active && styles.segmentActive]} onPress={() => switchView(v.key)}>
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {v.label}
                        {count ? ` ${count}` : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </HeroShell>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </View>
        }
        ListEmptyComponent={
          data === null ? (
            <ActivityIndicator style={styles.loading} color={colors.primary} />
          ) : (
            <View style={styles.empty}>
              <TabNotice icon="receipt-long" title={`Nothing in “${current.label}”`} body={current.empty} />
            </View>
          )
        }
        renderItem={({ item }) => (
          <FarmerOrderCard
            order={item}
            busy={busyId === item.id}
            onMarkReady={() => markReady(item)}
            onCancel={() => setCancelTarget(item)}
          />
        )}
      />
      <CancelOrderSheet
        order={cancelTarget}
        submitting={cancelling}
        onClose={() => setCancelTarget(null)}
        onConfirm={confirmCancel}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  listContent: { paddingBottom: spacing.xl },
  headerWrap: { marginBottom: spacing.md },
  segments: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: 4 },
  segment: {
    borderRadius: radius.pill,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    elevation: 2,
  },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontSize: 13, fontWeight: '600', color: colors.text },
  segmentTextActive: { color: colors.white },
  error: { color: colors.danger, fontSize: 13, marginHorizontal: spacing.lg, marginTop: spacing.md },
  loading: { marginTop: spacing.xl },
  empty: { minHeight: 300 },
});
