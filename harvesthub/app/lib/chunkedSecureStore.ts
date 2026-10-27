// A storage adapter for Supabase's session on top of expo-secure-store
// (the device's Keychain / Keystore — the main reason auth doesn't use
// AsyncStorage).
//
// SecureStore only promises values up to 2048 bytes, and a session (tokens
// plus the user's sign-up details) is bigger. So a long value is split into
// pieces under "<key>.0", "<key>.1", ..., and "<key>" itself holds a small
// marker saying how many. A value saved before this existed (one piece, no
// marker) still reads fine, so nobody is signed out by the change.

type KeyValueStore = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

const CHUNK_MARKER = 'chunked:';
// Characters, not bytes: 600 stays under 2048 bytes even if every character
// takes 3 bytes in UTF-8.
export const CHUNK_SIZE = 600;

export function chunkedStorage(store: KeyValueStore) {
  const chunkCount = async (key: string): Promise<number> => {
    const head = await store.getItemAsync(key);
    return head?.startsWith(CHUNK_MARKER) ? Number(head.slice(CHUNK_MARKER.length)) || 0 : 0;
  };

  const deleteChunks = async (key: string, from: number, to: number) => {
    for (let i = from; i < to; i++) await store.deleteItemAsync(`${key}.${i}`);
  };

  return {
    getItem: async (key: string): Promise<string | null> => {
      const head = await store.getItemAsync(key);
      if (!head?.startsWith(CHUNK_MARKER)) return head; // short value, or saved before chunking
      const count = Number(head.slice(CHUNK_MARKER.length)) || 0;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await store.getItemAsync(`${key}.${i}`);
        if (part === null) return null; // incomplete (an interrupted write) — treat as signed out
        parts.push(part);
      }
      return parts.join('');
    },

    setItem: async (key: string, value: string): Promise<void> => {
      const previous = await chunkCount(key);
      if (value.length <= CHUNK_SIZE) {
        await store.setItemAsync(key, value);
        await deleteChunks(key, 0, previous);
        return;
      }
      const count = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < count; i++) {
        await store.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
      }
      // The marker goes last, so a half-finished write is never read as whole.
      await store.setItemAsync(key, `${CHUNK_MARKER}${count}`);
      await deleteChunks(key, count, previous);
    },

    removeItem: async (key: string): Promise<void> => {
      const previous = await chunkCount(key);
      await store.deleteItemAsync(key);
      await deleteChunks(key, 0, previous);
    },
  };
}
