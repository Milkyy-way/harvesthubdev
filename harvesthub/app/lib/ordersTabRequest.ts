import type { OrderStatus } from '../types/orders';

// Which list the Orders tab should open on next, when another screen sends the
// customer there (the Dashboard and Account order tiles). Read once, on the
// tab's next focus, so it never overrides a list the customer picked
// themselves afterwards.
let requested: OrderStatus | null = null;

export function requestOrdersTab(tab: OrderStatus) {
  requested = tab;
}

export function takeOrdersTabRequest(): OrderStatus | null {
  const tab = requested;
  requested = null;
  return tab;
}
