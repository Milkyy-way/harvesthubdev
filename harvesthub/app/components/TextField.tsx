import { useRef, type Ref } from 'react';
import { TextInput, Text, View, StyleSheet, type TextInputProps } from 'react-native';
import { colors, spacing, radius } from '../constants/theme';

type Props = TextInputProps & {
  error?: string | null;
  // Shown above the box, so it stays once something is typed (the placeholder
  // disappears). Tapping it focuses the box.
  label?: string;
  hint?: string; // a short line under the label, like "At least 8 characters"
  ref?: Ref<TextInput>;
};

export function TextField({ style, error, label, hint, ref, ...props }: Props) {
  const input = useRef<TextInput | null>(null);
  const setRef = (node: TextInput | null) => {
    input.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: TextInput | null }).current = node;
  };
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={styles.label} onPress={() => input.current?.focus()} accessible={false}>
          {label}
        </Text>
      ) : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <TextInput
        ref={setRef}
        style={[styles.input, style]}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={props.accessibilityLabel ?? label}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.md + spacing.xs },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.xs },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: -2, marginBottom: spacing.xs },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingVertical: 15,
    paddingHorizontal: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
});
