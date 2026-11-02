import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, fonts } from '../../constants/theme';
import { Logo } from '../Logo';
import { SearchBar } from './SearchBar';

type Props = {
  addressCity: string | null;
  onPressLocation?: () => void;
  searchValue: string;
  onSearchChange: (text: string) => void;
  cartItemCount: number;
  onPressCart: () => void;
  avatarInitial: string;
};

// Home's sticky top: brand + location, cart, avatar, and the search pill —
// sitting on the same page background as everything below it (no colored
// hero block), so the page reads as one continuous surface. Everything else
// on Home scrolls underneath.
export function Header({ addressCity, onPressLocation, searchValue, onSearchChange, cartItemCount, onPressCart, avatarInitial }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <View style={styles.brandRow}>
          <Logo size={36} />
          <View>
            <Text style={styles.brandText}>HarvestHub</Text>
            <Pressable
              style={styles.locationRow}
              onPress={onPressLocation}
              disabled={!onPressLocation}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityHint="Choose which saved place to see farms near"
            >
              <MaterialIcons name="place" size={13} color={colors.primary} />
              <Text style={styles.locationText} numberOfLines={1}>
                {addressCity ? `Near ${addressCity}` : 'Finding farms near you'}
              </Text>
              {onPressLocation ? <MaterialIcons name="expand-more" size={15} color={colors.textMuted} /> : null}
            </Pressable>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.iconButton} onPress={onPressCart} hitSlop={8}>
            <MaterialIcons name="shopping-basket" size={20} color={colors.primary} />
            {cartItemCount > 0 ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{cartItemCount > 99 ? '99+' : cartItemCount}</Text>
              </View>
            ) : null}
          </Pressable>
          <Pressable style={styles.avatar} onPress={() => router.push('/(customer)/(tabs)/account')} hitSlop={4}>
            <Text style={styles.avatarText}>{avatarInitial}</Text>
          </Pressable>
        </View>
      </View>

      <SearchBar value={searchValue} onChangeText={onSearchChange} />
    </View>
  );
}

const AVATAR_SIZE = 40;

const styles = StyleSheet.create({
  container: { backgroundColor: colors.background },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  brandText: { fontFamily: fonts.brand, fontSize: 16, color: colors.primaryDark, letterSpacing: 0.2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 1 },
  locationText: { fontSize: 12.5, fontWeight: '600', color: colors.textMuted, maxWidth: 190 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.berry,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: fonts.headline, fontSize: 17, color: colors.background },
});
