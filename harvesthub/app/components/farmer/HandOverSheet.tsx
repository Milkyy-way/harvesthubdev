import { useState } from 'react';
import { Modal, View, Text, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { TagSelector } from '../TagSelector';
import { TextField } from '../TextField';
import type { FarmerOrder } from '../../types/farmer';

export type HandOver = { code: string } | { phone_last4: string; reason: string };

type Props = {
  order: FarmerOrder | null; // null = closed
  submitting: boolean;
  error: string | null; // from the last try: "That code doesn't match. 4 tries left."
  onClose: () => void;
  onConfirm: (handOver: HandOver) => void;
};

const BACKUP_REASONS = [
  { value: "Customer's phone died", label: 'Phone died' },
  { value: "Customer doesn't have the app", label: 'No app' },
  { value: 'Someone else is collecting it', label: 'Someone else collecting' },
  { value: 'other', label: 'Other…' },
];

// Handing a pickup over (2026-11-20): the customer tells the farm their
// 4-digit code. If they can't, the farm checks the last 4 digits of their
// phone instead and says why — HarvestHub sees those in its daily check.
export function HandOverSheet({ order, submitting, error, onClose, onConfirm }: Props) {
  const insets = useSafeAreaInsets();
  const [code, setCode] = useState('');
  const [backup, setBackup] = useState(false);
  const [digits, setDigits] = useState('');
  const [choice, setChoice] = useState<string | null>(null);
  const [otherText, setOtherText] = useState('');

  const reason = choice === 'other' ? otherText.trim() : choice;
  const ready = backup ? digits.length === 4 && !!reason : code.length === 4;

  const close = () => {
    setCode('');
    setBackup(false);
    setDigits('');
    setChoice(null);
    setOtherText('');
    onClose();
  };

  const confirm = () => {
    if (!ready) return;
    onConfirm(backup ? { phone_last4: digits, reason: reason! } : { code });
  };

  return (
    <Modal visible={!!order} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <Pressable style={styles.flex1} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.title}>Hand over the order</Text>
          {order?.payment_method === 'cash_on_pickup' && order.amount_to_collect > 0 ? (
            <Text style={styles.cash}>Collect ${order.amount_to_collect.toFixed(2)} in cash first.</Text>
          ) : null}

          {!backup ? (
            <>
              <Text style={styles.body}>Ask {order?.customer_name ?? 'the customer'} for the 4-digit code in their app.</Text>
              <TextField
                label="Pickup code"
                placeholder="1234"
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
                autoFocus
                style={styles.codeInput}
                accessibilityLabel="Pickup code"
              />
              {order?.customer_has_phone ? (
                <Pressable onPress={() => setBackup(true)} hitSlop={8}>
                  <Text style={styles.link}>They can&apos;t show their code?</Text>
                </Pressable>
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.body}>
                Check their name, and ask for the last 4 digits of the phone number on their account. Tell us why the code
                couldn&apos;t be used.
              </Text>
              <TextField
                label="Last 4 digits of their phone"
                placeholder="0123"
                value={digits}
                onChangeText={(t) => setDigits(t.replace(/\D/g, '').slice(0, 4))}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={styles.label}>Why not the code?</Text>
              <TagSelector options={BACKUP_REASONS} value={choice ? [choice] : []} multiple={false} onChange={(n) => setChoice(n[0] ?? null)} />
              {choice === 'other' ? (
                <TextField placeholder="What happened?" value={otherText} onChangeText={setOtherText} maxLength={300} />
              ) : null}
              <Pressable onPress={() => setBackup(false)} hitSlop={8}>
                <Text style={styles.link}>Use their code instead</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={styles.keepButton} onPress={close} disabled={submitting}>
              <Text style={styles.keepText}>Not yet</Text>
            </Pressable>
            <Pressable style={[styles.confirmButton, !ready && styles.disabled]} onPress={confirm} disabled={!ready || submitting}>
              {submitting ? <ActivityIndicator color={colors.white} /> : <Text style={styles.confirmText}>Hand over</Text>}
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
  cash: { fontSize: 14, fontWeight: '700', color: colors.primaryDark, marginBottom: spacing.sm },
  codeInput: { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '700' },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  link: { fontSize: 13, fontWeight: '700', color: colors.primary, marginBottom: spacing.sm },
  error: { fontSize: 13, color: colors.danger, marginBottom: spacing.sm },
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
