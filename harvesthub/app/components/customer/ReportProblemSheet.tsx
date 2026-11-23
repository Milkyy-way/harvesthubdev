import { useState } from 'react';
import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { MAX_PROBLEM_PHOTOS, pickProblemPhoto, type ProblemPhoto } from '../../lib/problemPhoto';
import { TagSelector } from '../TagSelector';
import { TextField } from '../TextField';
import type { ProblemReason, StoreOrder } from '../../types/orders';

export const PROBLEM_REASONS: { value: ProblemReason; label: string }[] = [
  { value: 'missing_item', label: 'Something was missing' },
  { value: 'damaged', label: 'Something was damaged' },
  { value: 'wrong_item', label: 'Wrong item' },
  { value: 'quality', label: 'Poor quality' },
  { value: 'farm_closed', label: "I came but couldn't collect it" },
  { value: 'other', label: 'Something else' },
];

export type ProblemSubmission = {
  reason: ProblemReason;
  details: string;
  items: { item_id: string; quantity: number }[];
  photos: ProblemPhoto[]; // on the phone; the order screen uploads them first
};

type Props = {
  storeOrder: StoreOrder | null; // null = closed
  submitting: boolean;
  onClose: () => void;
  onSubmit: (report: ProblemSubmission) => void;
};

// "Report a problem" (2026-11-20): within 24 hours of pickup or delivery, or
// of the end of a pickup time the customer missed. HarvestHub looks at every
// report and decides on any refund; nothing waits on the farm.
export function ReportProblemSheet({ storeOrder, submitting, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<ProblemReason | null>(null);
  const [details, setDetails] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [photos, setPhotos] = useState<ProblemPhoto[]>([]);

  const notPicked = storeOrder?.status === 'not_picked';
  const reasons = PROBLEM_REASONS.filter((r) => (notPicked ? r.value === 'farm_closed' || r.value === 'other' : r.value !== 'farm_closed'));
  const itemsMatter = reason !== null && reason !== 'farm_closed' && reason !== 'other';
  const chosen = Object.entries(quantities)
    .filter(([, q]) => q > 0)
    .map(([item_id, quantity]) => ({ item_id, quantity }));
  const ready = reason !== null && (reason !== 'other' || details.trim().length > 0) && (!itemsMatter || chosen.length > 0);

  const close = () => {
    setReason(null);
    setDetails('');
    setQuantities({});
    setPhotos([]);
    onClose();
  };

  // Up to 3 photos (2026-11-21): optional, but they help HarvestHub decide.
  const addPhoto = () => {
    const take = async (source: 'camera' | 'library') => {
      try {
        const photo = await pickProblemPhoto(source);
        if (photo) setPhotos((prev) => (prev.length < MAX_PROBLEM_PHOTOS ? [...prev, photo] : prev));
      } catch (err) {
        console.warn('Could not add a photo:', err);
        Alert.alert("Couldn't add the photo", 'Please try again.');
      }
    };
    Alert.alert('Add a photo', undefined, [
      { text: 'Take a photo', onPress: () => take('camera') },
      { text: 'Choose from library', onPress: () => take('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const step = (itemId: string, max: number, delta: number) =>
    setQuantities((prev) => ({ ...prev, [itemId]: Math.max(0, Math.min(max, (prev[itemId] ?? 0) + delta)) }));

  return (
    <Modal visible={!!storeOrder} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={styles.flex1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>Report a problem</Text>
            <Text style={styles.body}>
              Tell us what went wrong with your {storeOrder?.farm_name} order. We look at every report and get back to you within 2
              business days.
            </Text>

            <Text style={styles.label}>What went wrong?</Text>
            <TagSelector options={reasons} value={reason ? [reason] : []} multiple={false} onChange={(next) => setReason(next[0] ?? null)} />

            {itemsMatter && storeOrder ? (
              <>
                <Text style={styles.label}>Which items?</Text>
                {storeOrder.items
                  .filter((item) => item.id)
                  .map((item) => {
                    const q = quantities[item.id!] ?? 0;
                    return (
                      <View key={item.id} style={styles.itemRow}>
                        <Text style={styles.itemName} numberOfLines={1}>
                          {item.product_name}
                          <Text style={styles.itemOf}> (of {item.quantity})</Text>
                        </Text>
                        <Pressable
                          style={styles.stepButton}
                          onPress={() => step(item.id!, item.quantity, -1)}
                          disabled={q === 0}
                          accessibilityLabel={`One fewer ${item.product_name}`}
                        >
                          <MaterialIcons name="remove" size={18} color={q === 0 ? colors.border : colors.primary} />
                        </Pressable>
                        <Text style={styles.qty}>{q}</Text>
                        <Pressable
                          style={styles.stepButton}
                          onPress={() => step(item.id!, item.quantity, 1)}
                          disabled={q >= item.quantity}
                          accessibilityLabel={`One more ${item.product_name}`}
                        >
                          <MaterialIcons name="add" size={18} color={q >= item.quantity ? colors.border : colors.primary} />
                        </Pressable>
                      </View>
                    );
                  })}
              </>
            ) : null}

            {reason !== null && reason !== 'farm_closed' ? (
              <>
                <Text style={styles.label}>Photos (optional)</Text>
                <View style={styles.photoRow}>
                  {photos.map((photo, index) => (
                    <View key={photo.uri} style={styles.photoBox}>
                      <Image source={{ uri: photo.uri }} style={styles.photo} contentFit="cover" />
                      <Pressable
                        style={styles.photoRemove}
                        onPress={() => setPhotos((prev) => prev.filter((_, i) => i !== index))}
                        hitSlop={8}
                        accessibilityLabel={`Remove photo ${index + 1}`}
                      >
                        <MaterialIcons name="close" size={14} color={colors.white} />
                      </Pressable>
                    </View>
                  ))}
                  {photos.length < MAX_PROBLEM_PHOTOS ? (
                    <Pressable style={[styles.photoBox, styles.photoAdd]} onPress={addPhoto} accessibilityLabel="Add a photo">
                      <MaterialIcons name="add-a-photo" size={22} color={colors.primary} />
                      <Text style={styles.photoAddText}>Add</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Text style={styles.hint}>A photo of the problem helps us sort it out faster. Only HarvestHub sees it.</Text>
              </>
            ) : null}

            <TextField
              label={reason === 'other' ? 'What happened?' : 'Anything else? (optional)'}
              placeholder="A few words help us sort it out quickly"
              value={details}
              onChangeText={setDetails}
              multiline
              maxLength={1000}
            />

            <View style={styles.actions}>
              <Pressable style={styles.keepButton} onPress={close} disabled={submitting}>
                <Text style={styles.keepText}>Not now</Text>
              </Pressable>
              <Pressable
                style={[styles.confirmButton, !ready && styles.disabled]}
                onPress={() =>
                  reason &&
                  onSubmit({ reason, details: details.trim(), items: itemsMatter ? chosen : [], photos: reason === 'farm_closed' ? [] : photos })
                }
                disabled={!ready || submitting}
              >
                {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmText}>Send report</Text>}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '88%',
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: 13.5, lineHeight: 20, color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm, marginTop: spacing.xs },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  itemName: { flex: 1, fontSize: 14, color: colors.text },
  itemOf: { fontSize: 12, color: colors.textMuted },
  stepButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: { width: 22, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.text },
  photoRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  photoBox: { width: 72, height: 72, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.tint },
  photo: { width: '100%', height: '100%' },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  photoAddText: { fontSize: 11.5, fontWeight: '600', color: colors.primary, marginTop: 2 },
  hint: { fontSize: 12, lineHeight: 17, color: colors.textMuted, marginTop: spacing.xs, marginBottom: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  keepButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  keepText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  confirmButton: { flex: 1, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  confirmText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.4 },
});
