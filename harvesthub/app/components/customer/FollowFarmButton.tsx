import { useEffect, useState } from 'react';
import { Text, Pressable, Alert, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';

// Follow a farm to hear when it publishes a group deal.
export function FollowFarmButton({ farmerId, initial }: { farmerId: string; initial?: boolean }) {
  const [following, setFollowing] = useState<boolean | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial !== undefined) {
      setFollowing(initial);
      return;
    }
    let active = true;
    apiClient.get<{ following: boolean }>(`/farm-follows/${farmerId}`).then(
      (res) => {
        if (active) setFollowing(res.data.following);
      },
      (err) => console.warn('Could not load follow status:', err)
    );
    return () => {
      active = false;
    };
  }, [farmerId, initial]);

  if (following === null) return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const res = following
        ? await apiClient.delete<{ following: boolean }>(`/farm-follows/${farmerId}`)
        : await apiClient.put<{ following: boolean }>(`/farm-follows/${farmerId}`);
      setFollowing(res.data.following);
    } catch (err) {
      Alert.alert("Couldn't update this", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      style={[styles.button, following && styles.following, busy && styles.busy]}
      onPress={toggle}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: following }}
      accessibilityHint="Follow a farm to hear when it publishes a group deal"
    >
      <MaterialIcons name={following ? 'notifications-active' : 'notifications-none'} size={16} color={following ? colors.white : colors.primary} />
      <Text style={[styles.text, following && styles.textFollowing]}>{following ? 'Following' : 'Follow farm'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 7,
    paddingHorizontal: spacing.sm + 4,
  },
  following: { backgroundColor: colors.primary },
  busy: { opacity: 0.5 },
  text: { fontSize: 13, fontWeight: '700', color: colors.primary },
  textFollowing: { color: colors.white },
});
