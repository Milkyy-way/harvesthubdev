// Calendar periods for the Dashboard's Month / Year / All control. A period is
// named by its first day, 'YYYY-MM-DD' (the backend's `start`). Built from
// numbers, never `new Date('2026-11-01')`, which is UTC midnight and shows as
// Oct 31 on a US phone.

export type PeriodKind = 'month' | 'year' | 'all';

export type Period = { kind: PeriodKind; start: string };

function iso(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, '0')}-01`;
}

function parts(start: string): { y: number; m: number } {
  const [y, m] = start.split('-').map(Number);
  return { y, m };
}

/** This month or this year (or all time), from the phone's date. */
export function currentPeriod(kind: PeriodKind, today = new Date()): Period {
  const y = today.getFullYear();
  return { kind, start: kind === 'year' ? iso(y, 1) : iso(y, today.getMonth() + 1) };
}

/** The month or year before (-1) or after (+1). */
export function stepPeriod(period: Period, by: -1 | 1): Period {
  const { y, m } = parts(period.start);
  if (period.kind === 'year') return { ...period, start: iso(y + by, 1) };
  const index = y * 12 + (m - 1) + by;
  return { ...period, start: iso(Math.floor(index / 12), (index % 12) + 1) };
}

/** Switching Month ⇄ Year keeps you around the same time. */
export function switchKind(period: Period, kind: PeriodKind, today = new Date()): Period {
  if (kind === 'all') return { kind, start: period.start };
  const { y } = parts(period.start);
  if (kind === 'year') return { kind, start: iso(y, 1) };
  // Year → Month: the current month in the current year, else that year's December.
  const now = currentPeriod('month', today);
  return { kind, start: y === today.getFullYear() ? now.start : iso(y, 12) };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "November 2026", "2026", "All time". */
export function periodTitle(period: Period): string {
  const { y, m } = parts(period.start);
  if (period.kind === 'all') return 'All time';
  return period.kind === 'year' ? String(y) : `${MONTHS[m - 1]} ${y}`;
}

/** For sentences: "in November", "in November 2025", "in 2026", "so far". */
export function periodPhrase(period: Period, today = new Date()): string {
  const { y, m } = parts(period.start);
  if (period.kind === 'all') return 'so far';
  if (period.kind === 'year') return `in ${y}`;
  return y === today.getFullYear() ? `in ${MONTHS[m - 1]}` : `in ${MONTHS[m - 1]} ${y}`;
}

/** Short name of a period for "+2 vs Oct" / "vs 2025". */
export function shortName(start: string, kind: PeriodKind): string {
  const { y, m } = parts(start);
  return kind === 'year' ? String(y) : MONTHS[m - 1].slice(0, 3);
}

/** Whether there's anything to step back to: not before the first order. */
export function canGoBack(period: Period, firstOrderOn: string | null): boolean {
  if (period.kind === 'all' || !firstOrderOn) return false;
  const first = currentPeriod(period.kind, new Date(Number(firstOrderOn.slice(0, 4)), Number(firstOrderOn.slice(5, 7)) - 1, 1));
  return period.start > first.start;
}

/** Not past the current month or year. */
export function canGoForward(period: Period, today = new Date()): boolean {
  if (period.kind === 'all') return false;
  return period.start < currentPeriod(period.kind, today).start;
}
