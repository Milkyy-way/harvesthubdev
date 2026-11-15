import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import type { FarmerFeedCard as FarmerFeedCardType } from '../../types/database';
import { formatDistance } from './formatDistance';

type Props = {
  farmer: FarmerFeedCardType;
  onPress: () => void;
};

// No card box: a big rounded photo, then the farm's name and details right
// under it on the page background — the photo carries the design.
export function FarmerCard({ farmer, onPress }: Props) {
  // photo_url being present doesn't guarantee the image actually loads (a
  // dead URL, blocked host, etc.) — without this, a failed load just
  // renders a blank/broken box instead of falling back to the icon.
  const [imageFailed, setImageFailed] = useState(false);
  const showPhoto = farmer.photo_url && !imageFailed;

  return (
    <Pressable style={({ pressed }) => [styles.container, pressed && styles.pressed]} onPress={onPress}>
      <View>
        {showPhoto ? (
          <Image
            source={{ uri: farmer.photo_url! }}
            style={styles.photo}
            contentFit="cover"
            transition={150}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <View style={[styles.photo, styles.photoFallback]}>
            <MaterialIcons name="storefront" size={44} color={colors.primaryMid} />
          </View>
        )}
        <View style={styles.distanceBadge}>
          <MaterialIcons name="near-me" size={12} color={colors.primaryDark} />
          <Text style={styles.distanceBadgeText}>{formatDistance(farmer.distance_km)}</Text>
        </View>
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {farmer.farm_name}
      </Text>
      <View style={styles.metaRow}>
        {/* Every farm offers pickup; delivery only where it reaches this customer (2026-11-14). */}
        <MaterialIcons name={farmer.delivers ? 'local-shipping' : 'storefront'} size={14} color={colors.textMuted} />
        <Text style={styles.meta}>{farmer.delivers ? 'Pickup & delivery' : 'Pickup only'}</Text>
        {farmer.matched_categories.length > 0 ? (
          <View style={styles.matchedTag}>
            <Text style={styles.matchedText} numberOfLines={1}>
              {farmer.matched_categories.join(' · ')}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const CARD_IMAGE_HEIGHT = 176;

const styles = StyleSheet.create({
  container: { marginHorizontal: spacing.lg, marginBottom: spacing.xl },
  pressed: { opacity: 0.85 },
  photo: { width: '100%', height: CARD_IMAGE_HEIGHT, borderRadius: 20, backgroundColor: '#EAF2EC' },
  photoFallback: { alignItems: 'center', justifyContent: 'center' },
  distanceBadge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  distanceBadgeText: { color: colors.primaryDark, fontSize: 12, fontWeight: '800' },
  name: { fontFamily: fonts.headline, fontSize: 19, color: colors.text, marginTop: spacing.sm },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  meta: { fontSize: 13, color: colors.textMuted, marginRight: 4 },
  matchedTag: { flexShrink: 1, backgroundColor: '#EAF2EC', borderRadius: radius.sm, paddingHorizontal: 7, paddingVertical: 2 },
  matchedText: { fontSize: 12, fontWeight: '700', color: colors.primary, textTransform: 'capitalize' },
});
