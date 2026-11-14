import * as SecureStore from 'expo-secure-store';

// What a farmer has typed into the application so far, kept on the phone until
// it's submitted: switching apps to look up the Tax ID, or a phone call, used
// to lose all of it. Picked files aren't kept (they're quick to pick again).
// SecureStore, because it holds the Tax ID; small enough for its size limit.
export type ApplicationDraft = {
  step: 'farm-details' | 'documents';
  farmDetails: {
    addressStreet: string;
    addressCity: string;
    addressState: string;
    addressZip: string;
    farmTypes: string[];
    yearsInOperation: string;
    taxId: string;
  };
  businessLicenseNumber: string;
  insuranceExpiration: string; // as typed, MM/DD/YYYY
  referencesText: string;
};

const keyFor = (userId: string) => `farmer-application-draft-${userId}`;

export async function loadApplicationDraft(userId: string): Promise<ApplicationDraft | null> {
  try {
    const raw = await SecureStore.getItemAsync(keyFor(userId));
    return raw ? (JSON.parse(raw) as ApplicationDraft) : null;
  } catch {
    return null;
  }
}

export async function saveApplicationDraft(userId: string, draft: ApplicationDraft): Promise<void> {
  await SecureStore.setItemAsync(keyFor(userId), JSON.stringify(draft)).catch(() => undefined);
}

export async function clearApplicationDraft(userId: string): Promise<void> {
  await SecureStore.deleteItemAsync(keyFor(userId)).catch(() => undefined);
}
