import React, { createContext, useCallback, useContext, useState } from 'react';
import type { FarmFulfillment, FulfillmentMethod } from '../types/checkout';

// Every farm starts on pickup — nothing to tap before checkout is ready.
// Delivery (farms that offer it, to the customer's saved address or their
// pod's drop point) needs a window chosen too.
const PICKUP: FarmFulfillment = { method: 'pickup', deliverySlot: null, podId: null };

type CheckoutDraftContextType = {
  fulfillmentByFarm: Record<string, FarmFulfillment>;
  ensureFarm: (farmerId: string) => void;
  setMethod: (farmerId: string, method: FulfillmentMethod) => void;
  setDeliverySlot: (farmerId: string, startsAt: string | null) => void;
  setPod: (farmerId: string, podId: string | null) => void;
};

const CheckoutDraftContext = createContext<CheckoutDraftContextType>({
  fulfillmentByFarm: {},
  ensureFarm: () => {},
  setMethod: () => {},
  setDeliverySlot: () => {},
  setPod: () => {},
});

// Session-local, in-memory only — this is a draft of "how will each
// farmer's order be fulfilled," not a real order. It exists so the cart
// screen and the checkout screen (a separate route) see the same choice
// without either persisting it to the backend before there's an order for
// it to belong to.
export function CheckoutDraftProvider({ children }: { children: React.ReactNode }) {
  const [fulfillmentByFarm, setFulfillmentByFarm] = useState<Record<string, FarmFulfillment>>({});

  const ensureFarm = useCallback((farmerId: string) => {
    setFulfillmentByFarm((prev) => (prev[farmerId] ? prev : { ...prev, [farmerId]: PICKUP }));
  }, []);

  const setMethod = useCallback((farmerId: string, method: FulfillmentMethod) => {
    setFulfillmentByFarm((prev) => ({ ...prev, [farmerId]: { ...(prev[farmerId] ?? PICKUP), method } }));
  }, []);

  const setDeliverySlot = useCallback((farmerId: string, startsAt: string | null) => {
    setFulfillmentByFarm((prev) => ({ ...prev, [farmerId]: { ...(prev[farmerId] ?? PICKUP), deliverySlot: startsAt } }));
  }, []);

  // A pod has its own windows, so changing the destination clears the choice.
  const setPod = useCallback((farmerId: string, podId: string | null) => {
    setFulfillmentByFarm((prev) => ({ ...prev, [farmerId]: { ...(prev[farmerId] ?? PICKUP), podId, deliverySlot: null } }));
  }, []);

  return (
    <CheckoutDraftContext.Provider value={{ fulfillmentByFarm, ensureFarm, setMethod, setDeliverySlot, setPod }}>
      {children}
    </CheckoutDraftContext.Provider>
  );
}

export const useCheckoutDraft = () => useContext(CheckoutDraftContext);
