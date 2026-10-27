import { useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { TagSelector } from '../TagSelector';
import { TextField } from '../TextField';
import type { FarmerOrder } from '../../types/farmer';

const REASONS = [
  { value: 'Out of stock', label: 'Out of stock' },
  { value: 'Quality issue with the produce', label: 'Quality issue' },
  { value: 'Farm closed / emergency', label: 'Farm closed' },
  { value: 'other', label: 'Other…' },
];

// "Couldn't deliver" on a delivery run — the same cancellation, other reasons.
const DELIVERY_REASONS = [
  { value: "Couldn't get in (gate, door code or building)", label: "Couldn't get in" },
  { value: "Couldn't find the address", label: "Couldn't find it" },
  { value: "Not safe to leave it at the door", label: 'Not safe to leave' },
  { value: 'other', label: 'Other…' },
];

export type CancellableOrder = Pick<FarmerOrder, 'customer_name' | 'total' | 'service_fee' | 'payment_method'>;

type Props = {
  order: CancellableOrder | null; // null = closed
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  delivery?: boolean; // "Couldn't deliver" wording and reasons
};

// Confirms a farmer cancellation and spells out what it costs before it
// happens: a paid card order is refunded to the customer in full and the
// service fee comes out of the farmer's next payout (decided with the user);
// a cash order hasn't been paid, so nothing is refunded and there's no fee.
// The reason is shown to the customer.
export function CancelOrderSheet({ order, submitting, onClose, onConfirm, delivery = false }: Props) {
  const insets = useSafeAreaInsets();
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');

  const reason = choice === 'other' ? otherText.trim() : choice;
  const paidByCard = order?.payment_method === 'card';

  const close = () => {
    setChoice(null);
    setOtherText('');
    onClose();
  };

  return (
    <Modal visible={!!order} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={styles.flex1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.title}>{delivery ? "Couldn't deliver?" : 'Cancel this order?'}</Text>
          {order ? (
            <Text style={styles.body}>
              {paidByCard
                ? `${order.customer_name ?? 'The customer'} gets a full refund of $${order.total.toFixed(2)} to their card. The $${order.service_fee.toFixed(2)} service fee will be deducted from your next payout.`
                : 'This is a cash-on-pickup order and the customer hasn’t paid yet, so nothing is refunded and there’s no fee.'}
            </Text>
          ) : null}

          <Text style={styles.label}>Reason (the customer will see this)</Text>
          <TagSelector
            options={delivery ? DELIVERY_REASONS : REASONS}
            value={choice ? [choice] : []}
            multiple={false}
            onChange={(next) => setChoice(next[0] ?? null)}
          />
          {choice === 'other' ? (
            <TextField placeholder="Tell the customer why" value={otherText} onChangeText={setOtherText} maxLength={300} />
          ) : null}

          <View style={styles.actions}>
            <Pressable style={styles.keepButton} onPress={close} disabled={submitting}>
              <Text style={styles.keepText}>{delivery ? 'Go back' : 'Keep order'}</Text>
            </Pressable>
            <Pressable
              style={[styles.confirmButton, !reason && styles.disabled]}
              onPress={() => reason && onConfirm(reason)}
              disabled={!reason || submitting}
            >
              {submitting ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.confirmText}>{delivery ? 'Cancel and refund' : 'Cancel order'}</Text>
              )}
            </Pressable>
          </View>
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
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.text, marginBottom: spacing.sm },
  body: { fontSize: 13.5, lineHeight: 20, color: colors.text, marginBottom: spacing.md },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
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
  confirmButton: { flex: 1, backgroundColor: colors.danger, borderRadius: radius.pill, paddingVertical: 13, alignItems: 'center' },
  confirmText: { color: colors.white, fontWeight: '700', fontSize: 14 },
  disabled: { opacity: 0.4 },
});
