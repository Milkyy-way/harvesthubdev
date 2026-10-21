import { isAxiosError } from 'axios';
import { apiClient } from './apiClient';

// Address suggestions while the user types, from Google Maps — through our
// API (/addresses/*, harvesthub-backend/app/addresses/), so the Google key
// never ships inside the app. Picking one fills the form; the app stores only
// the address text, and the API geocodes it itself
// (harvesthub-backend/app/core/geocoding.py) — the app never sends
// coordinates.
//
// A "session" is one address being typed: the same token on every
// suggestion request and on the final details request, which is how Google
// bills it as a single lookup. Start a new one after each pick.

export type AddressParts = { street: string; city: string; state: string; zip: string };

export type AddressSuggestion = {
  placeId: string;
  label: string; // "1600 Pennsylvania Avenue Northwest"
  secondary: string; // "Washington, DC, USA"
};

type SuggestionsResponse = { suggestions: { place_id: string; main_text: string; secondary_text: string }[] };

// Once the API says suggestions aren't set up (no Google key on the
// server), stop asking for the rest of this app session.
let unavailable = false;

const TOKEN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Google wants a URL-safe string of at most 36 characters. It only groups
// requests for billing, so it needs to be unique, not secret.
export function newSearchSession(): string {
  let token = '';
  for (let i = 0; i < 32; i++) token += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  return token;
}

export function isSearchUnavailable(err: unknown): boolean {
  return isAxiosError(err) && err.response?.status === 503;
}

export async function searchAddresses(query: string, session: string, signal?: AbortSignal): Promise<AddressSuggestion[]> {
  const q = query.trim();
  if (unavailable || q.length < 3) return [];
  try {
    const res = await apiClient.get<SuggestionsResponse>('/addresses/suggestions', { params: { q, session }, signal });
    return res.data.suggestions.map((s) => ({ placeId: s.place_id, label: s.main_text, secondary: s.secondary_text }));
  } catch (err) {
    if (isSearchUnavailable(err)) {
      unavailable = true;
      return [];
    }
    throw err;
  }
}

export async function getAddress(placeId: string, session: string): Promise<AddressParts> {
  const res = await apiClient.get<AddressParts>(`/addresses/details/${encodeURIComponent(placeId)}`, { params: { session } });
  return res.data;
}
