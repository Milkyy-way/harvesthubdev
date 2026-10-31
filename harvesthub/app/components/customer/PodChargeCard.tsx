import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import { useCardSetupSheet } from '../../lib/harvestPass';
import type { PodCharge } from '../../types/delivery';

function closesAt(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// A pod order before its charge: nothing has been taken yet, how the split
// stands right now, and a way to change a declined card. See
// harvesthub-backend/app/pods/charging.py.
export function PodChargeCard({ orderId, charge, onChanged }: { orderId: string; charge: PodCharge; onChanged?: () => void }) {
  const saveCard = useCardSetupSheet();
  const [busy, setBusy] = useState(false);

  const updateCard = async () => {
    setBusy(true);
    try {
      const res = await apiClient.post<{ setup_intent_client_secret: string }>(`/orders/${orderId}/pod-card`);
      if (await saveCard(res.data.setup_intent_client_secret, 'Use this card')) {
        await apiClient.post(`/orders/${orderId}/sync-payment-status`);
        onChanged?.();
      }
    } catch (err) {
      Alert.alert("Couldn't update your card", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (charge.status === 'failed') {
    return (
      <View style={[styles.card, styles.failed]}>
        <Text style={styles.title}>Your card was declined</Text>
        <Text style={styles.body}>
          {charge.failure_reason ? `${charge.failure_reason} ` : ''}We&apos;ll try once more soon. To keep this order, use a different card.
        </Text>
        <Pressable style={[styles.button, busy && styles.disabled]} onPress={updateCard} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Use a different card</Text>}
        </Pressable>
      </View>
    );
  }

  if (charge.status === 'awaiting') {
    return (
      <View style={styles.card}>
        <View style={styles.titleRow}>
          <MaterialIcons name="schedule" size={18} color={colors.primary} />
          <Text style={styles.title}>Not charged yet</Text>
        </View>
        <Text style={styles.body}>
          {charge.households_ordered} of {charge.households_total} members have ordered, so delivery is $
          {charge.share_now.toFixed(2)} each right now. The more neighbors order, the less each pays.
        </Text>
        <Text style={styles.body}>
          Orders close {closesAt(charge.charge_at)}. Your card is charged once then, for your exact total. You can cancel for free until
          then.
        </Text>
      </View>
    );
  }

  if (charge.status === 'charging') {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Charging your card</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.tint, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, gap: 4 },
  failed: { backgroundColor: '#F6E7E5' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  body: { fontSize: 13, lineHeight: 19, color: colors.text },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  disabled: { opacity: 0.45 },
});
