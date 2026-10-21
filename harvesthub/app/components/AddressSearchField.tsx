import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, Keyboard, ActivityIndicator, StyleSheet } from 'react-native';
import { isCancel } from 'axios';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius } from '../constants/theme';
import { TextField } from './TextField';
import { apiErrorMessage } from '../lib/apiError';
import {
  getAddress,
  newSearchSession,
  searchAddresses,
  type AddressParts,
  type AddressSuggestion,
} from '../lib/addressSearch';

type Props = {
  value: string;
  onChangeText: (street: string) => void;
  // A suggestion was picked: fill street, city, state and ZIP together.
  onSelectAddress: (address: AddressParts) => void;
  placeholder?: string;
  error?: string | null;
};

// The street-address box, with real addresses suggested as you type (Google
// Maps, through our API — see lib/addressSearch.ts). City, state and ZIP stay
// ordinary fields next to it, filled in by a suggestion and still editable.
// Without suggestions (API not set up, or offline) it's a plain text box. The
// parent ScrollView needs keyboardShouldPersistTaps="handled", or the first
// tap on a suggestion only closes the keyboard.
export function AddressSearchField({ value, onChangeText, onSelectAddress, placeholder = 'Street address', error }: Props) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const session = useRef(newSearchSession());
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) return;
    if (value.trim().length < 3) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAddresses(value, session.current, controller.signal).then(setSuggestions, (err) => {
        if (isCancel(err)) return;
        console.warn('Address search failed:', err);
        setSuggestions([]);
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, open]);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    []
  );

  const handleChange = (text: string) => {
    setOpen(true);
    setPickError(null);
    onChangeText(text);
  };

  const select = async (s: AddressSuggestion) => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    setPicking(s.placeId);
    try {
      const address = await getAddress(s.placeId, session.current);
      setOpen(false);
      setSuggestions([]);
      Keyboard.dismiss();
      onSelectAddress(address);
    } catch (err) {
      // E.g. a suggestion that isn't a full street address — say so, and
      // leave the typed text for the user to finish by hand.
      setPickError(apiErrorMessage(err, "Couldn't use that address. Type it in instead."));
    } finally {
      setPicking(null);
      session.current = newSearchSession(); // that lookup is finished (and billed)
    }
  };

  return (
    <View>
      <TextField
        placeholder={placeholder}
        value={value}
        onChangeText={handleChange}
        onBlur={() => {
          // Late enough that a tap on a suggestion still lands.
          blurTimer.current = setTimeout(() => setOpen(false), 200);
        }}
        autoComplete="street-address"
        textContentType="streetAddressLine1"
        error={error ?? pickError}
      />
      {open && suggestions.length > 0 ? (
        <View style={styles.list} accessibilityRole="list">
          {suggestions.map((s, i) => (
            <Pressable
              key={s.placeId}
              style={({ pressed }) => [styles.item, i > 0 && styles.itemDivider, pressed && styles.pressed]}
              onPress={() => select(s)}
              disabled={picking !== null}
              accessibilityRole="button"
              accessibilityLabel={`${s.label}, ${s.secondary}`}
            >
              {picking === s.placeId ? (
                <ActivityIndicator size="small" color={colors.primary} style={styles.icon} />
              ) : (
                <MaterialIcons name="place" size={18} color={colors.textMuted} style={styles.icon} />
              )}
              <View style={styles.itemText}>
                <Text style={styles.label} numberOfLines={1}>
                  {s.label}
                </Text>
                <Text style={styles.secondary} numberOfLines={1}>
                  {s.secondary}
                </Text>
              </View>
            </Pressable>
          ))}
          {/* Required by Google's Places policies whenever its suggestions
              are shown without a Google map: this exact text, 12-16sp,
              regular weight, #5E5E5E (or #1F1F1F) on a contrasting background,
              never wrapped or re-cased. */}
          <Text style={styles.attribution} numberOfLines={1} accessibilityLabel="Google Maps">
            Google Maps
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // A small floating control, so white like the inputs — tucked up under the
  // field it belongs to.
  list: {
    marginTop: -spacing.md,
    marginBottom: spacing.md + spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 11, paddingHorizontal: 12 },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.tint },
  icon: { width: 18 },
  itemText: { flex: 1 },
  label: { fontSize: 14.5, fontWeight: '600', color: colors.text },
  secondary: { fontSize: 12.5, color: colors.textMuted, marginTop: 1 },
  attribution: {
    alignSelf: 'flex-end',
    fontSize: 12,
    fontWeight: '400',
    letterSpacing: 0,
    color: '#5E5E5E',
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 6,
  },
});
