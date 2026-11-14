// The Orders tab's date headings, newest first: "Today", "This week",
// "Earlier in November", "October", "December 2025". Replaces the date chips
// (2026-11-14): one list, the way Amazon or Uber Eats show past orders.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The heading an order placed at `placedAt` falls under, seen on `now` (phone's time zone). */
export function dateHeading(placedAt: Date, now = new Date()): string {
  const today = startOfDay(now);
  const day = startOfDay(placedAt);
  if (day >= today) return 'Today';
  if (day > today - 7 * DAY) return 'This week';
  const sameMonth = placedAt.getFullYear() === now.getFullYear() && placedAt.getMonth() === now.getMonth();
  if (sameMonth) return `Earlier in ${MONTHS[now.getMonth()]}`;
  const month = MONTHS[placedAt.getMonth()];
  return placedAt.getFullYear() === now.getFullYear() ? month : `${month} ${placedAt.getFullYear()}`;
}

/** Orders (newest first) into SectionList sections, in that order. */
export function groupByDate<T extends { placed_at: string }>(orders: T[], now = new Date()): { title: string; data: T[] }[] {
  const sections: { title: string; data: T[] }[] = [];
  for (const order of orders) {
    const title = dateHeading(new Date(order.placed_at), now);
    const last = sections[sections.length - 1];
    if (last && last.title === title) last.data.push(order);
    else sections.push({ title, data: [order] });
  }
  return sections;
}
