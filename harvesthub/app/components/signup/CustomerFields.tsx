import { View, Text, StyleSheet } from 'react-native';
import { TextField } from '../TextField';
import { AddressSearchField } from '../AddressSearchField';
import { TagSelector } from '../TagSelector';
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
  dietaryPreferences: [],
  produceInterests: [],
  referralSource: [],
  referralSourceOther: '',
};

type Props = {
  value: CustomerFormValues;
  onChange: (patch: Partial<CustomerFormValues>) => void;
  errors: Record<string, string>;
};

export function CustomerFields({ value, onChange, errors }: Props) {
  return (
    <>
      <TextField
        placeholder="Full name"
        value={value.fullName}
        onChangeText={(fullName) => onChange({ fullName })}
        error={errors.fullName}
      />
      <TextField
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={value.email}
        onChangeText={(email) => onChange({ email })}
        error={errors.email}
      />
      <TextField
        placeholder="Phone number"
        autoComplete="tel"
        keyboardType="phone-pad"
        value={value.phone}
        onChangeText={(phone) => onChange({ phone })}
        error={errors.phone}
      />
      <TextField
        placeholder="Password (min 8 characters)"
        secureTextEntry
        autoComplete="password-new"
        value={value.password}
        onChangeText={(password) => onChange({ password })}
        error={errors.password}
      />
      <TextField
        placeholder="Confirm password"
        secureTextEntry
        autoComplete="password-new"
        value={value.confirmPassword}
        onChangeText={(confirmPassword) => onChange({ confirmPassword })}
        error={errors.confirmPassword}
      />

      <Text style={styles.sectionTitle}>Delivery / pickup address</Text>
      <AddressSearchField
        value={value.addressStreet}
        onChangeText={(addressStreet) => onChange({ addressStreet })}
        onSelectAddress={(a) =>
          onChange({ addressStreet: a.street, addressCity: a.city, addressState: a.state, addressZip: a.zip })
        }
        error={errors.addressStreet}
      />
      <TextField
        placeholder="City"
        value={value.addressCity}
        onChangeText={(addressCity) => onChange({ addressCity })}
        error={errors.addressCity}
      />
      <View style={styles.row}>
        <TextField
          style={styles.flex1}
          placeholder="State"
          value={value.addressState}
          onChangeText={(addressState) => onChange({ addressState })}
          error={errors.addressState}
        />
        <TextField
          style={styles.flex1}
          placeholder="ZIP code"
          keyboardType="number-pad"
          value={value.addressZip}
          onChangeText={(addressZip) => onChange({ addressZip })}
          error={errors.addressZip}
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
          placeholder="Tell us more"
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
