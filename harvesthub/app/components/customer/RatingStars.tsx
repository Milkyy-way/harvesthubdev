import { View, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors } from '../../constants/theme';

type Props = {
  value: number;
  onSelect?: (rating: number) => void;
  size?: number;
  disabled?: boolean;
};

const STAR_VALUES = [1, 2, 3, 4, 5];

export function RatingStars({ value, onSelect, size = 22, disabled }: Props) {
  return (
    <View style={styles.row}>
      {STAR_VALUES.map((star) => (
        <Pressable
          key={star}
          onPress={onSelect && !disabled ? () => onSelect(star) : undefined}
          disabled={!onSelect || disabled}
          // At least 44 points to tap, whatever the star's size.
          hitSlop={Math.max(6, Math.ceil((44 - size) / 2))}
          accessibilityRole={onSelect ? 'button' : undefined}
          accessibilityLabel={`${star} star${star === 1 ? '' : 's'}`}
          accessibilityState={{ selected: star <= value, disabled: !onSelect || disabled }}
        >
          <MaterialIcons
            name={star <= value ? 'star' : 'star-border'}
            size={size}
            color={star <= value ? colors.accent : colors.border}
          />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
});
