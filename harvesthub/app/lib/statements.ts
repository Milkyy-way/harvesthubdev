import * as WebBrowser from 'expo-web-browser';
import { apiClient } from './apiClient';

// The weekly statement opens in the phone's browser, which can't send the
// app's sign-in, so the API hands out a 30-minute signed link
// (harvesthub-backend/app/farmer_earnings/statements.py). From there the
// farmer can print it, save it as a PDF, or download the spreadsheet.
const apiOrigin = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');

export async function openWeeklyStatement(periodStart: string): Promise<void> {
  const res = await apiClient.post<{ path: string; expires_in: number }>(`/farmers/me/earnings/statements/${periodStart}/link`);
  await WebBrowser.openBrowserAsync(`${apiOrigin}${res.data.path}`);
}
