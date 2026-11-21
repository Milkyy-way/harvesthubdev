// Pickup times as people say them: "3:45 PM", "today at 3:45 PM",
// "Tue, Nov 24 at 9:00 AM".

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayAndClock(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === now.toDateString()) return `today at ${clock(iso)}`;
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow at ${clock(iso)}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} at ${clock(iso)}`;
}

// The farm can still hand an order over for a day after "not picked".
export const LATE_CONFIRM_HOURS = 24;

export function addHours(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3600 * 1000).toISOString();
}
