import { useCallback, useRef, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { LiveDeliveryMap } from './LiveDeliveryMap';
import type { DeliveryProgress, DeliveryTracking } from '../../types/delivery';

type Props = {
  orderId: string;
  storeOrderId: string;
  farmName: string;
  delivery: DeliveryProgress;
  // The delivery moved on (delivered, cancelled) — reload the order.
  onStageChange?: () => void;
};

const POLL_MS = 10_000;

const STEPS = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
] as const;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// A delivery order's progress on the customer's order screen: where it is
// (scheduled → on the way → delivered), how many stops are ahead, the
// farmer on a live map once this customer is next, and the farm's photo of
// where it was left. While on the way it polls the API every 10 s.
export function DeliveryTracker({ orderId, storeOrderId, farmName, delivery, onStageChange }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<DeliveryTracking | null>(null);
  const onStageChangeRef = useRef(onStageChange);
  onStageChangeRef.current = onStageChange;

  const onTheWay = delivery.stage === 'on_the_way';
  useFocusEffect(
    useCallback(() => {
      if (!onTheWay) return;
      let active = true;
      const poll = () =>
        apiClient.get<DeliveryTracking>(`/orders/${orderId}/store/${storeOrderId}/tracking`).then(
          (res) => {
            if (!active) return;
            setTracking(res.data);
            if (res.data.stage !== 'on_the_way') onStageChangeRef.current?.();
          },
          (err) => console.warn('Could not refresh delivery tracking:', err)
        );
      poll();
      const timer = setInterval(poll, POLL_MS);
      return () => {
        active = false;
        clearInterval(timer);
      };
    }, [onTheWay, orderId, storeOrderId])
  );

  if (delivery.stage === 'cancelled') return null;
  const current = STEPS.findIndex((s) => s.key === delivery.stage);
  const stopsBefore = tracking?.stops_before ?? delivery.stops_before;
  const live = onTheWay && tracking?.farmer ? tracking : null;

  const toPod = Boolean(delivery.pod_name);
  const message =
    delivery.stage === 'scheduled'
      ? "We'll let you know when it's on the way."
      : delivery.stage === 'on_the_way'
        ? stopsBefore === 0
          ? live?.eta_minutes
            ? `You're next — arriving in about ${live.eta_minutes} min.`
            : `You're next — the farm is heading to ${toPod ? "your pod's drop point" : 'you'} now.`
          : `On the way — ${stopsBefore} stop${stopsBefore === 1 ? '' : 's'} before yours.`
        : `Delivered${toPod ? " to your pod's drop point" : ''}${delivery.delivered_at ? ` at ${clock(delivery.delivered_at)}` : ''}.`;

  const showPhoto = async () => {
    setLoadingPhoto(true);
    setPhotoError(null);
    try {
      const res = await apiClient.get<{ url: string | null }>(`/orders/${orderId}/store/${storeOrderId}/delivery-photo`);
      if (res.data.url) setPhotoUrl(res.data.url);
      else setPhotoError('The photo is no longer available.');
    } catch (err) {
      console.warn('Could not load delivery photo:', err);
      setPhotoError("Couldn't load the photo. Try again.");
    } finally {
      setLoadingPhoto(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.steps} accessibilityLabel={`Delivery: ${STEPS[current]?.label}`}>
        {STEPS.map((step, i) => {
          const done = i <= current;
          return (
            <View key={step.key} style={styles.step}>
              <View style={styles.markerRow}>
                {i > 0 ? <View style={[styles.line, i <= current && styles.lineDone]} /> : <View style={styles.lineSpacer} />}
                <View style={[styles.dot, done && styles.dotDone]}>
                  {done ? <MaterialIcons name="check" size={12} color={colors.white} /> : null}
                </View>
                {i < STEPS.length - 1 ? (
                  <View style={[styles.line, i < current && styles.lineDone]} />
                ) : (
                  <View style={styles.lineSpacer} />
                )}
              </View>
              <Text style={[styles.stepLabel, done && styles.stepLabelDone]}>{step.label}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.message}>{message}</Text>
      {delivery.collect_within_hours && delivery.stage !== 'scheduled' ? (
        <Text style={styles.cold}>This order has cold items. Please collect it within {delivery.collect_within_hours} hours of delivery.</Text>
      ) : null}
      {live?.farmer ? (
        <>
          <LiveDeliveryMap farmer={live.farmer} destination={live.destination} farmName={farmName} />
          {live.farmer.stale ? (
            <Text style={styles.note}>Their location hasn&apos;t updated for a few minutes — they may have weak signal.</Text>
          ) : null}
        </>
      ) : null}
      {delivery.note ? <Text style={styles.note}>From the farm: “{delivery.note}”</Text> : null}

      {delivery.stage === 'delivered' && delivery.has_photo ? (
        photoUrl ? (
          <Image
            source={{ uri: photoUrl }}
            style={styles.photo}
            contentFit="cover"
            accessibilityLabel="Photo of where your order was left"
          />
        ) : (
          <Pressable style={styles.photoButton} onPress={showPhoto} disabled={loadingPhoto}>
            {loadingPhoto ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <MaterialIcons name="photo-camera" size={16} color={colors.primary} />
                <Text style={styles.photoButtonText}>See where it was left</Text>
              </>
            )}
          </Pressable>
        )
      ) : null}
      {photoError ? <Text style={styles.photoError}>{photoError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  steps: { flexDirection: 'row' },
  step: { flex: 1, alignItems: 'center' },
  markerRow: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, height: 2, backgroundColor: colors.border },
  lineDone: { backgroundColor: colors.primary },
  lineSpacer: { flex: 1 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  stepLabel: { fontSize: 11.5, color: colors.textMuted, marginTop: 4 },
  stepLabelDone: { color: colors.primaryDark, fontWeight: '700' },
  message: { fontSize: 13.5, fontWeight: '600', color: colors.text, marginTop: spacing.sm, textAlign: 'center' },
  note: { fontSize: 12.5, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  cold: { fontSize: 12.5, fontWeight: '600', color: colors.berry, marginTop: 4, textAlign: 'center' },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, marginTop: spacing.sm, backgroundColor: colors.border },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  photoButtonText: { fontSize: 13, fontWeight: '700', color: colors.primary },
  photoError: { fontSize: 12, color: colors.danger, marginTop: 4, textAlign: 'center' },
});
