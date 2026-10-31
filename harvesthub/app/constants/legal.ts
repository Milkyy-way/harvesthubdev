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

// The link "Invite friends" shares (harvesthub-backend/app/legal/router.py,
// GET /app): Android phones land on Google Play, iPhones on the App Store
// once it's listed, anything else on a page with both. Same base as above,
// or EXPO_PUBLIC_APP_SHARE_URL to share a different link entirely.
export const APP_SHARE_URL = process.env.EXPO_PUBLIC_APP_SHARE_URL ?? `${base}/app`;

// A Neighborhood Pod invite (harvesthub-backend/app/legal/router.py, GET
// /invite/{code}): opens the app, or shows the code and where to get the app.
export function podInviteUrl(code: string): string {
  return `${base}/invite/${code}`;
}
