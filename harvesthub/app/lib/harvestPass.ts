import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import type { HarvestPassPlan, PlanOption } from '../types/membership';

export const HARVEST_PASS_NAME = 'Harvest Pass';

export function planLabel(plan: HarvestPassPlan): string {
  return plan === 'monthly' ? 'Monthly' : plan === '3_months' ? '3 months' : '6 months';
}

// "$54.00 every 3 months" / "$20.00 every month"
export function billingLine(option: Pick<PlanOption, 'billed_amount' | 'interval_months'>): string {
  const every = option.interval_months === 1 ? 'every month' : `every ${option.interval_months} months`;
  return `$${option.billed_amount.toFixed(2)} ${every}`;
}

// "Nov 14, 2026"
export function formatLongDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function cardLine(brand: string | null, last4: string | null): string | null {
  if (!last4) return null;
  const name = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
  return `${name} •••• ${last4}`;
}

// Saves a card with Stripe's PaymentSheet in setup mode (nothing is charged
// by the sheet itself — the backend starts the subscription afterwards).
// Resolves true once the card is saved, false if the customer backed out
// or it failed (failures are already shown in an alert).
export function useCardSetupSheet() {
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  return useCallback(
    async (setupIntentClientSecret: string, primaryButtonLabel: string): Promise<boolean> => {
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'HarvestHub',
        setupIntentClientSecret,
        primaryButtonLabel,
      });
      if (initError) {
        Alert.alert('Could not open the card form', initError.message);
        return false;
      }
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') {
          Alert.alert('Card not saved', presentError.message);
        }
        return false;
      }
      return true;
    },
    [initPaymentSheet, presentPaymentSheet]
  );
}
