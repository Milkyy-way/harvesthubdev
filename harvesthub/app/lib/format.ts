// To the cent the way the server (Python's round(x, 2)) does it, so an amount
// worked out in the app matches checkout's: half-cents round to the even cent
// ($0.125 -> $0.12), and toFixed reads the float's exact value (1.075 is
// really 1.07499..., so $1.07), where Math.round(x * 100) would say $1.08.
export function roundCents(x: number): number {
  if (Number.isInteger(x * 8) && Math.round(x * 1000) % 10 === 5) {
    const cents = Math.floor(x * 100);
    return (cents % 2 === 0 ? cents : cents + 1) / 100;
  }
  return Number(x.toFixed(2));
}

// "$1,234.50" / "-$10.00"
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 ? '-' : ''}$${abs}`;
}

// A date-only "YYYY-MM-DD" (pay periods) as "Fri, Oct 10". Parsed as a LOCAL
// date on purpose: new Date('2025-10-10') is UTC midnight, which shows as
// the previous day anywhere west of UTC.
export function formatDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// "Oct 4 – Oct 10"
export function formatPeriod(start: string, end: string): string {
  const short = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return `${short(start)} – ${short(end)}`;
}
