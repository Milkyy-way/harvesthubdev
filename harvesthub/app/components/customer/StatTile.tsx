import { View, Text, Pressable, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { colors, spacing, radius, fonts } from '../../constants/theme';

type Props = {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  label: string;
  value: string;
  caption?: string;
  /** Makes the tile a button, with an arrow so it looks like one. */
  onPress?: () => void;
  accessibilityHint?: string;
};

// A headline number on a soft green wash (not a white card) — two per row.
export function StatTile({ icon, label, value, caption, onPress, accessibilityHint }: Props) {
  const content = (
    <>
      <View style={styles.labelRow}>
        <MaterialIcons name={icon} size={16} color={colors.primary} />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {onPress ? <MaterialIcons name="chevron-right" size={18} color={colors.primaryDark} /> : null}
      </View>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {caption ? (
        <Text style={styles.caption} numberOfLines={2}>
          {caption}
        </Text>
      ) : null}
    </>
  );

  if (!onPress) return <View style={styles.container}>{content}</View>;
  return (
    <Pressable
      style={({ pressed }) => [styles.container, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={accessibilityHint}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexBasis: '48%',
    flexGrow: 1,
    backgroundColor: colors.tint,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  pressed: { opacity: 0.75 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { flex: 1, fontSize: 12.5, fontWeight: '600', color: colors.primaryDark },
  value: { fontFamily: fonts.headlineBold, fontSize: 26, color: colors.text, marginTop: 6 },
  caption: { fontSize: 11.5, lineHeight: 16, color: colors.textMuted, marginTop: 2 },
});
