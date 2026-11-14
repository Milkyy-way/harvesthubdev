import { useRef } from 'react';
import { View, Text, StyleSheet, type TextInput } from 'react-native';
import { TextField } from '../TextField';
import { AddressSearchField } from '../AddressSearchField';
import { TagSelector } from '../TagSelector';
import { splitUnit } from '../../lib/addressSearch';
import { colors, spacing } from '../../constants/theme';
import {
  DIETARY_PREFERENCE_OPTIONS,
  PRODUCE_INTEREST_OPTIONS,
  REFERRAL_SOURCE_OPTIONS,
} from '../../lib/validation/schemas';
import type { DietaryPreference, ProduceInterest, ReferralSource } from '../../types/database';

export interface CustomerFormValues {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  addressUnit: string;
  dietaryPreferences: DietaryPreference[];
  produceInterests: ProduceInterest[];
  referralSource: ReferralSource[];
  referralSourceOther: string;
}

export const initialCustomerFormValues: CustomerFormValues = {
  fullName: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
  addressStreet: '',
  addressCity: '',
  addressState: '',
  addressZip: '',
  addressUnit: '',
  dietaryPreferences: [],
  produceInterests: [],
  referralSource: [],
  referralSourceOther: '',
};

type Props = {
  value: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  errors: Record<string, string>;
  // The street box got focus: the screen scrolls it (with its y) to the top,
  // so the keyboard doesn't hide it or Google's suggestions under it.
  onAddressFocus?: (y: number) => void;
};

export function CustomerFields({ value, onChange, errors, onAddressFocus }: Props) {
  // Enter on the keyboard moves to the next box.
  const email = useRef<TextInput>(null);
  const phone = useRef<TextInput>(null);
  const password = useRef<TextInput>(null);
  const confirm = useRef<TextInput>(null);
  const street = useRef<TextInput>(null);
  const unit = useRef<TextInput>(null);
  const city = useRef<TextInput>(null);
  const state = useRef<TextInput>(null);
  const zip = useRef<TextInput>(null);
  const addressY = useRef(0);
  const next = (ref: { current: TextInput | null }) => ({
    returnKeyType: 'next' as const,
    submitBehavior: 'submit' as const,
    onSubmitEditing: () => ref.current?.focus(),
  });

  return (
    <>
      <TextField
        label="Full name"
        placeholder="e.g. Jordan Lee"
        autoComplete="name"
        value={value.fullName}
        onChangeText={(fullName) => onChange({ fullName })}
        error={errors.fullName}
        {...next(email)}
      />
      <TextField
        ref={email}
        label="Email"
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={value.email}
        onChangeText={(email) => onChange({ email })}
        error={errors.email}
        {...next(phone)}
      />
      <TextField
        ref={phone}
        label="Phone number"
        placeholder="e.g. 202 555 0123"
        autoComplete="tel"
        keyboardType="phone-pad"
        value={value.phone}
        onChangeText={(phone) => onChange({ phone })}
        error={errors.phone}
        {...next(password)}
      />
      <TextField
        ref={password}
        label="Password"
        placeholder="At least 8 characters"
        secureTextEntry
        autoComplete="password-new"
        value={value.password}
        onChangeText={(password) => onChange({ password })}
        error={errors.password}
        {...next(confirm)}
      />
      <TextField
        ref={confirm}
        label="Confirm password"
        placeholder="Type it again"
        secureTextEntry
        autoComplete="password-new"
        value={value.confirmPassword}
        onChangeText={(confirmPassword) => onChange({ confirmPassword })}
        error={errors.confirmPassword}
        {...next(street)}
      />

      <View onLayout={(e) => (addressY.current = e.nativeEvent.layout.y)}>
        <Text style={styles.sectionTitle}>Delivery / pickup address</Text>
        <AddressSearchField
          ref={street}
          label="Street address"
          placeholder="Start typing, then pick your address"
          value={value.addressStreet}
          onChangeText={(addressStreet) => onChange({ addressStreet })}
          onSelectAddress={(a) => {
            const { street, unit } = splitUnit(a.street);
            onChange({ addressStreet: street, addressUnit: unit, addressCity: a.city, addressState: a.state, addressZip: a.zip });
          }}
          onFocus={() => onAddressFocus?.(addressY.current)}
          error={errors.addressStreet}
          returnKeyType="next"
          onSubmitEditing={() => unit.current?.focus()}
        />
      </View>
      <TextField
        ref={unit}
        label="Apt, suite or unit (optional)"
        placeholder="e.g. Apt 4B"
        value={value.addressUnit}
        onChangeText={(addressUnit) => onChange({ addressUnit })}
        error={errors.addressUnit}
        {...next(city)}
      />
      <TextField
        ref={city}
        label="City"
        value={value.addressCity}
        onChangeText={(addressCity) => onChange({ addressCity })}
        error={errors.addressCity}
        {...next(state)}
      />
      <View style={styles.row}>
        <TextField
          ref={state}
          style={styles.flex1}
          label="State"
          placeholder="DC"
          autoCapitalize="characters"
          value={value.addressState}
          onChangeText={(addressState) => onChange({ addressState })}
          error={errors.addressState}
          {...next(zip)}
        />
        <TextField
          ref={zip}
          style={styles.flex1}
          label="ZIP code"
          keyboardType="number-pad"
          value={value.addressZip}
          onChangeText={(addressZip) => onChange({ addressZip })}
          error={errors.addressZip}
          returnKeyType="done"
        />
      </View>

      <Text style={styles.sectionTitle}>Dietary preferences (optional)</Text>
      <TagSelector
        options={DIETARY_PREFERENCE_OPTIONS}
        value={value.dietaryPreferences}
        onChange={(dietaryPreferences) => onChange({ dietaryPreferences })}
      />

      <Text style={styles.sectionTitle}>What are you interested in? (optional)</Text>
      <TagSelector
        options={PRODUCE_INTEREST_OPTIONS}
        value={value.produceInterests}
        onChange={(produceInterests) => onChange({ produceInterests })}
      />

      <Text style={styles.sectionTitle}>How did you hear about us? (optional)</Text>
      <TagSelector
        options={REFERRAL_SOURCE_OPTIONS}
        value={value.referralSource}
        onChange={(referralSource) => onChange({ referralSource })}
        multiple={false}
      />
      {value.referralSource[0] === 'other' ? (
        <TextField
          label="Tell us more (optional)"
          placeholder="Where did you hear about HarvestHub?"
          value={value.referralSourceOther}
          onChangeText={(referralSourceOther) => onChange({ referralSourceOther })}
          error={errors.referralSourceOther}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex1: { flex: 1 },
});
