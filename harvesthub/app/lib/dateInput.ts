// A date typed the US way, MM/DD/YYYY, with the slashes filled in as you type
// (number keypad, no format to remember), stored as YYYY-MM-DD.

export function formatUsDate(typed: string): string {
  const digits = typed.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

// "06/30/2027" -> "2027-06-30"; anything incomplete or impossible comes back
// unchanged, so the form's check can say what's wrong.
export function usDateToIso(us: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(us);
  if (!m) return us;
  const [, mm, dd, yyyy] = m;
  const date = new Date(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)));
  const valid = date.getUTCFullYear() === Number(yyyy) && date.getUTCMonth() === Number(mm) - 1 && date.getUTCDate() === Number(dd);
  return valid ? `${yyyy}-${mm}-${dd}` : us;
}

// "2027-06-30" -> "06/30/2027" (for a date already saved).
export function isoToUsDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[2]}/${m[3]}/${m[1]}` : '';
}
