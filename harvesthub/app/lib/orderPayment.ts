import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { apiClient } from './apiClient';
import { apiErrorMessage } from './apiError';
import { useCardSetupSheet } from './harvestPass';
import type { DiscardResponse, Order } from '../types/orders';

// 'paid': placed (or, for a pod order, its card saved). 'not_paid': the sheet
// was closed or the card declined, and nothing was charged. 'error': it may
// have gone through but we couldn't confirm it; the order screen will show.
export type PayResult = 'paid' | 'not_paid' | 'error';

/** Stripe's payment sheet for an order (the card sheet, for a pod order),
 *  then the server is asked how it went. Used by checkout, and by the order
 *  screen's Pay button for a checkout left unpaid (2026-11-14). */
export function useOrderPayment() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const saveCard = useCardSetupSheet();

  return useCallback(
    async (orderId: string, clientSecret: string, cardSetup: boolean): Promise<PayResult> => {
      if (cardSetup) {
        if (!(await saveCard(clientSecret, 'Save card and place order'))) return 'not_paid';
        try {
          await apiClient.post(`/orders/${orderId}/sync-payment-status`);
        } catch (err) {
          Alert.alert('Your order wasn\'t placed', apiErrorMessage(err, 'Please try again.'));
          return 'error';
        }
        return 'paid';
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'HarvestHub',
        paymentIntentClientSecret: clientSecret,
        // Stripe only offers these on phones set up for them. Still a card
        // payment as far as the order is concerned.
        applePay: { merchantCountryCode: 'US' },
        googlePay: {
          merchantCountryCode: 'US',
          currencyCode: 'USD',
          testEnv: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith('pk_test_'),
        },
      });
      if (initError) {
        Alert.alert('Could not start payment', initError.message);
        return 'not_paid';
      }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') Alert.alert('Payment not completed', presentError.message);
        return 'not_paid';
      }
      // Immediate best-effort reconciliation for a snappy UI — the Stripe
      // webhook (app/webhooks/router.py) is the authoritative source and
      // will confirm this independently even if this call fails.
      try {
        await apiClient.post(`/orders/${orderId}/sync-payment-status`);
      } catch (err) {
        console.warn('Could not sync payment status immediately (webhook will still confirm it):', err);
      }
      return 'paid';
    },
    [initPaymentSheet, presentPaymentSheet, saveCard]
  );
}

/** Removes a checkout that wasn't paid for, so it never shows as an order or
 *  a cancellation. Returns the order when it turns out to have been paid after
 *  all. If the server can't be reached it stays, marked "Not paid yet", and is
 *  removed within the hour. */
export async function discardCheckout(orderId: string): Promise<Order | null> {
  try {
    const res = await apiClient.post<DiscardResponse>(`/orders/${orderId}/discard`);
    return res.data.removed ? null : res.data.order;
  } catch (err) {
    console.warn('Could not remove the unpaid checkout:', err);
    return null;
  }
}
