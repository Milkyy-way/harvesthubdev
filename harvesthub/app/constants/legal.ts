// The public legal pages are served by the API (harvesthub-backend/app/legal)
// at its root: /privacy, /terms, /delete-account. The same URLs go in the
// Google Play listing. If they move to the website later, set
// EXPO_PUBLIC_LEGAL_BASE_URL (e.g. https://harvesthubmarket.com).
const apiOrigin = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/api\/v1\/?$/, '');
const base = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? apiOrigin).replace(/\/$/, '');

export const LEGAL_URLS = {
  privacy: `${base}/privacy`,
  terms: `${base}/terms`,
  deleteAccount: `${base}/delete-account`,
} as const;
