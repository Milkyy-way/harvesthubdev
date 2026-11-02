import { useState } from 'react';
import { View, Text, Pressable, Modal, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { apiClient } from '../../lib/apiClient';
import { apiErrorMessage } from '../../lib/apiError';
import type { PlacesOverview } from '../../types/places';

// Home's location switcher: which saved place to see nearby farms from. It never
// changes where an order goes, and says so.
export function PlacePicker({
  visible,
  overview,
  onClose,
  onChanged,
}: {
  visible: boolean;
  overview: PlacesOverview | null;
  onClose: () => void;
  onChanged: (overview: PlacesOverview) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState<string | null>(null);

  if (!overview) return null;

  const choose = async (placeId: string | null) => {
    if (placeId === overview.active_place_id) {
      onClose();
      return;
    }
    setBusy(placeId ?? 'home');
    try {
      const res = await apiClient.put<PlacesOverview>('/customers/me/places/active', { place_id: placeId });
      onChanged(res.data);
      onClose();
    } catch (err) {
      Alert.alert("Couldn't switch places", apiErrorMessage(err, 'Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = (placeId: string, name: string) =>
    Alert.alert(`Remove ${name}?`, undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const res = await apiClient.delete<PlacesOverview>(`/customers/me/places/${placeId}`);
            onChanged(res.data);
          } catch (err) {
            Alert.alert("Couldn't remove it", apiErrorMessage(err, 'Please try again.'));
          }
        },
      },
    ]);

  const canAdd = overview.places.length < overview.max_places;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.dismiss} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.md }]}>
          <Text style={styles.title}>See farms near</Text>

          <Row
            icon="home"
            name="Home"
            detail={overview.home_city ?? 'Your saved address'}
            selected={overview.active_place_id === null}
            busy={busy === 'home'}
            onPress={() => choose(null)}
          />
          {overview.places.map((place) => (
            <Row
              key={place.id}
              icon={place.name.toLowerCase() === 'work' ? 'work' : 'place'}
              name={place.name}
              detail={place.address_line}
              selected={overview.active_place_id === place.id}
              busy={busy === place.id}
              onPress={() => choose(place.id)}
              onRemove={() => remove(place.id, place.name)}
            />
          ))}

          {canAdd ? (
            <Pressable
              style={styles.add}
              onPress={() => {
                onClose();
                router.push('/(customer)/add-place' as Href);
              }}
              accessibilityRole="button"
            >
              <MaterialIcons name="add" size={20} color={colors.primary} />
              <Text style={styles.addText}>Add a place</Text>
            </Pressable>
          ) : null}

          <Text style={styles.fine}>This only changes which farms you see. Deliveries always go to the address in your profile.</Text>
        </View>
      </View>
    </Modal>
  );
}

function Row({
  icon,
  name,
  detail,
  selected,
  busy,
  onPress,
  onRemove,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  name: string;
  detail: string;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.row}>
      <Pressable style={styles.rowMain} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }}>
        <MaterialIcons name={icon} size={20} color={colors.primary} />
        <View style={styles.rowText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        </View>
        {busy ? <ActivityIndicator size="small" color={colors.primary} /> : selected ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
      </Pressable>
      {onRemove ? (
        <Pressable onPress={onRemove} hitSlop={10} accessibilityLabel={`Remove ${name}`} style={styles.remove}>
          <MaterialIcons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  dismiss: { flex: 1 },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  title: { fontFamily: fonts.headlineBold, fontSize: 22, color: colors.text, marginBottom: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 4 },
  rowText: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700', color: colors.text },
  detail: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  remove: { paddingLeft: spacing.md, paddingVertical: spacing.sm },
  add: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  addText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  fine: { fontSize: 12, lineHeight: 17, color: colors.textMuted },
});
