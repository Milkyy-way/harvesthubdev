import { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { openDrivingDirections } from '../../../lib/maps';
import { takeDeliveryPhoto, uploadDeliveryPhoto } from '../../../lib/deliveryPhoto';
import { useAuth } from '../../../contexts/AuthContext';
import { TextField } from '../../../components/TextField';
import { CancelOrderSheet, type CancellableOrder } from '../../../components/farmer/CancelOrderSheet';
import type { RunDetail, Stop, StopOrder } from '../../../types/delivery';

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// One delivery run: start it (customers are told it's on the way, stops are
// put in route order), then deliver stop by stop — navigate, call, mark
// delivered with an optional photo, or "Couldn't deliver" (cancel + refund).
export default function DeliveryRunScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [delivering, setDelivering] = useState<Stop | null>(null);
  const [failing, setFailing] = useState<StopOrder | null>(null);
  const [failingBusy, setFailingBusy] = useState(false);

  const load = useCallback(
    () =>
      apiClient.get<RunDetail>(`/farmers/me/delivery/runs/${id}`).then(
        (res) => {
          setRun(res.data);
          setError(null);
        },
        (err) => setError(apiErrorMessage(err, "Couldn't load this delivery run.")),
      ),
    [id]
  );

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const start = () => {
    Alert.alert('Start delivering?', "We'll tell each customer their order is on the way, in route order.", [
      { text: 'Not yet', style: 'cancel' },
      {
        text: 'Start',
        onPress: async () => {
          setStarting(true);
          try {
            const res = await apiClient.post<RunDetail>(`/farmers/me/delivery/runs/${id}/start`);
            setRun(res.data);
          } catch (err) {
            Alert.alert("Couldn't start", apiErrorMessage(err, 'Please try again.'));
          } finally {
            setStarting(false);
          }
        },
      },
    ]);
  };

  const cantDeliver = async (reason: string) => {
    if (!failing) return;
    setFailingBusy(true);
    try {
      await apiClient.post(`/farmers/me/orders/${failing.store_order_id}/cancel`, { reason });
      setFailing(null);
      await load();
    } catch (err) {
      Alert.alert("Couldn't cancel", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setFailingBusy(false);
    }
  };

  const failingTarget: CancellableOrder | null = failing
    ? { customer_name: failing.customer_name, total: failing.total, service_fee: failing.service_fee, payment_method: 'card' }
    : null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Delivery run</Text>
        <View style={styles.back} />
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
        {!run ? (
          error ? (
            <Text style={styles.muted}>{error}</Text>
          ) : (
            <ActivityIndicator color={colors.primary} style={styles.loading} />
          )
        ) : (
          <>
            <Text style={styles.title}>{run.label}</Text>
            <Text style={styles.subtitle}>
              {run.stop_count} stop{run.stop_count === 1 ? '' : 's'} · {run.delivered_count} delivered
            </Text>

            {run.status === 'scheduled' ? (
              run.can_start ? (
                <Pressable style={[styles.primaryButton, starting && styles.disabled]} onPress={start} disabled={starting}>
                  {starting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <MaterialIcons name="local-shipping" size={18} color={colors.white} />
                      <Text style={styles.primaryButtonText}>Start delivering</Text>
                    </>
                  )}
                </Pressable>
              ) : (
                <Text style={styles.hint}>You can start this run on its delivery day. Pack the orders below before you go.</Text>
              )
            ) : run.status === 'completed' ? (
              <View style={styles.doneBanner}>
                <MaterialIcons name="check-circle" size={20} color={colors.primary} />
                <Text style={styles.doneText}>All done — every stop on this run is finished.</Text>
              </View>
            ) : null}

            {run.stops.map((stop) => (
              <StopCard
                key={stop.id}
                stop={stop}
                running={run.status === 'in_progress'}
                onDelivered={() => setDelivering(stop)}
                onCantDeliver={(order) => setFailing(order)}
              />
            ))}
          </>
        )}
      </ScrollView>

      <DeliveredSheet
        stop={delivering}
        userId={session?.user.id ?? null}
        runId={String(id)}
        onClose={() => setDelivering(null)}
        onDone={(updated) => {
          setDelivering(null);
          setRun(updated);
        }}
      />
      <CancelOrderSheet order={failingTarget} submitting={failingBusy} onClose={() => setFailing(null)} onConfirm={cantDeliver} delivery />
    </View>
  );
}

function StopCard({
  stop,
  running,
  onDelivered,
  onCantDeliver,
}: {
  stop: Stop;
  running: boolean;
  onDelivered: () => void;
  onCantDeliver: (order: StopOrder) => void;
}) {
  const active = stop.status === 'en_route';
  const order = stop.orders[0];
  const badge =
    stop.status === 'delivered' ? (
      <MaterialIcons name="check" size={16} color={colors.white} />
    ) : stop.status === 'cancelled' ? (
      <MaterialIcons name="close" size={16} color={colors.white} />
    ) : (
      <Text style={styles.badgeText}>{stop.sequence ?? '•'}</Text>
    );

  return (
    <View style={[styles.stop, stop.status === 'cancelled' && styles.stopCancelled]}>
      <View style={styles.stopHeader}>
        <View
          style={[
            styles.badge,
            stop.status === 'delivered' && styles.badgeDone,
            stop.status === 'cancelled' && styles.badgeCancelled,
          ]}
        >
          {badge}
        </View>
        <View style={styles.flex1}>
          <Text style={styles.customer}>{order?.customer_name ?? 'Customer'}</Text>
          {stop.address_line ? <Text style={styles.address}>{stop.address_line}</Text> : null}
        </View>
      </View>

      {stop.orders.map((o) => (
        <Text key={o.store_order_id} style={styles.items}>
          {o.items.map((i) => `${i.quantity} × ${i.product_name}`).join(', ')}
        </Text>
      ))}

      {stop.status === 'delivered' ? (
        <Text style={styles.deliveredText}>
          Delivered{stop.delivered_at ? ` at ${clock(stop.delivered_at)}` : ''}
          {stop.has_photo ? ' · photo sent' : ''}
          {stop.note ? ` · “${stop.note}”` : ''}
        </Text>
      ) : stop.status === 'cancelled' ? (
        <Text style={styles.cancelledText}>Cancelled and refunded</Text>
      ) : null}

      {active || (!running && stop.status === 'pending') ? (
        <View style={styles.actions}>
          <Pressable
            style={styles.actionButton}
            onPress={() =>
              openDrivingDirections({ latitude: stop.latitude, longitude: stop.longitude, address: stop.address_line ?? '' })
            }
          >
            <MaterialIcons name="navigation" size={16} color={colors.primary} />
            <Text style={styles.actionText}>Navigate</Text>
          </Pressable>
          {order?.customer_phone ? (
            <Pressable style={styles.actionButton} onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}>
              <MaterialIcons name="phone" size={16} color={colors.primary} />
              <Text style={styles.actionText}>Call</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {active ? (
        <View style={styles.actions}>
          <Pressable style={styles.failButton} onPress={() => order && onCantDeliver(order)}>
            <Text style={styles.failText}>Couldn&apos;t deliver</Text>
          </Pressable>
          <Pressable style={styles.deliverButton} onPress={onDelivered}>
            <Text style={styles.deliverText}>Delivered</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// "Delivered": an optional photo of where it was left, and an optional note
// for the customer ("Left by the side door").
function DeliveredSheet({
  stop,
  userId,
  runId,
  onClose,
  onDone,
}: {
  stop: Stop | null;
  userId: string | null;
  runId: string;
  onClose: () => void;
  onDone: (run: RunDetail) => void;
}) {
  const insets = useSafeAreaInsets();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const close = () => {
    setPhotoUri(null);
    setNote('');
    onClose();
  };

  const takePhoto = async () => {
    const uri = await takeDeliveryPhoto();
    if (uri) setPhotoUri(uri);
    else Alert.alert('No photo taken', 'To add one, allow HarvestHub to use the camera. You can also deliver without a photo.');
  };

  const confirm = async () => {
    if (!stop || !userId) return;
    setSaving(true);
    try {
      const photoPath = photoUri ? await uploadDeliveryPhoto(userId, stop.id, photoUri) : null;
      const res = await apiClient.post<RunDetail>(`/farmers/me/delivery/runs/${runId}/stops/${stop.id}/delivered`, {
        photo_path: photoPath,
        note: note.trim() || null,
      });
      setPhotoUri(null);
      setNote('');
      onDone(res.data);
    } catch (err) {
      Alert.alert("Couldn't mark it delivered", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!stop} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={styles.flex1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.sheetTitle}>Delivered to {stop?.orders[0]?.customer_name ?? 'the customer'}?</Text>
          <Text style={styles.sheetBody}>Add a photo of where you left it — the customer sees it in the app. Optional.</Text>

          {photoUri ? (
            <Pressable onPress={takePhoto} accessibilityLabel="Retake photo">
              <Image source={{ uri: photoUri }} style={styles.preview} contentFit="cover" />
            </Pressable>
          ) : (
            <Pressable style={styles.photoButton} onPress={takePhoto}>
              <MaterialIcons name="photo-camera" size={20} color={colors.primary} />
              <Text style={styles.photoButtonText}>Take a photo</Text>
            </Pressable>
          )}

          <TextField placeholder="Note for the customer (optional)" value={note} onChangeText={setNote} maxLength={300} />

          <View style={styles.actions}>
            <Pressable style={styles.failButton} onPress={close} disabled={saving}>
              <Text style={[styles.failText, styles.neutralText]}>Back</Text>
            </Pressable>
            <Pressable style={[styles.deliverButton, saving && styles.disabled]} onPress={confirm} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.deliverText}>Mark delivered</Text>}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
  muted: { fontSize: 13.5, color: colors.textMuted, textAlign: 'center', marginTop: spacing.xl },
  flex1: { flex: 1 },
  title: { fontFamily: fonts.headlineBold, fontSize: 24, color: colors.text, marginTop: spacing.xs },
  subtitle: { fontSize: 13.5, color: colors.textMuted, marginTop: 2 },
  hint: { fontSize: 13, lineHeight: 19, color: colors.textMuted, marginTop: spacing.md },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  primaryButtonText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.tint,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  doneText: { flex: 1, fontSize: 13.5, color: colors.primaryDark, fontWeight: '600' },
  stop: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  stopCancelled: { opacity: 0.55 },
  stopHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeDone: { backgroundColor: colors.primary },
  badgeCancelled: { backgroundColor: colors.textMuted },
  badgeText: { color: colors.white, fontWeight: '800', fontSize: 13 },
  customer: { fontSize: 15.5, fontWeight: '700', color: colors.text },
  address: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  items: { fontSize: 13, color: colors.text, marginTop: spacing.xs, marginLeft: 28 + spacing.sm },
  deliveredText: { fontSize: 12.5, color: colors.primaryDark, fontWeight: '600', marginTop: spacing.xs, marginLeft: 28 + spacing.sm },
  cancelledText: { fontSize: 12.5, color: colors.danger, marginTop: spacing.xs, marginLeft: 28 + spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  failButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
  },
  failText: { color: colors.danger, fontSize: 13.5, fontWeight: '700' },
  neutralText: { color: colors.text },
  deliverButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 11, alignItems: 'center' },
  deliverText: { color: colors.white, fontSize: 13.5, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
  },
  sheetTitle: { fontFamily: fonts.headlineBold, fontSize: 21, color: colors.text, marginBottom: spacing.xs },
  sheetBody: { fontSize: 13.5, lineHeight: 19, color: colors.textMuted, marginBottom: spacing.md },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.primary,
    marginBottom: spacing.md,
  },
  photoButtonText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginBottom: spacing.md },
});
