import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import type { DeliveryProgress } from '../../types/delivery';

type Props = {
  orderId: string;
  storeOrderId: string;
  delivery: DeliveryProgress;
};

const STEPS = [
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'on_the_way', label: 'On the way' },
  { key: 'delivered', label: 'Delivered' },
] as const;

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// A delivery order's progress on the customer's order screen: where it is
// (scheduled → on the way → delivered), how many stops are ahead, and the
// farm's photo of where it was left.
export function DeliveryTracker({ orderId, storeOrderId, delivery }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  if (delivery.stage === 'cancelled') return null;
  const current = STEPS.findIndex((s) => s.key === delivery.stage);

  const message =
    delivery.stage === 'scheduled'
      ? "We'll let you know when it's on the way."
      : delivery.stage === 'on_the_way'
        ? delivery.stops_before === 0
          ? "You're next — the farm is heading to you now."
          : `On the way — ${delivery.stops_before} stop${delivery.stops_before === 1 ? '' : 's'} before yours.`
        : `Delivered${delivery.delivered_at ? ` at ${clock(delivery.delivered_at)}` : ''}.`;

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
