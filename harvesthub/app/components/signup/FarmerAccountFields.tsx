import { useRef } from 'react';
import type { TextInput } from 'react-native';
import { TextField } from '../TextField';

export interface FarmerAccountFormValues {
  farmName: string;
  ownerFullName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
}

export const initialFarmerAccountFormValues: FarmerAccountFormValues = {
  farmName: '',
  ownerFullName: '',
  email: '',
  phone: '',
  password: '',
  confirmPassword: '',
};

type Props = {
  value: FarmerAccountFormValues;
  onChange: (patch: Partial<FarmerAccountFormValues>) => void;
  errors: Record<string, string>;
};

export function FarmerAccountFields({ value, onChange, errors }: Props) {
  // Enter on the keyboard moves to the next box.
  const owner = useRef<TextInput>(null);
  const email = useRef<TextInput>(null);
  const phone = useRef<TextInput>(null);
  const password = useRef<TextInput>(null);
  const confirm = useRef<TextInput>(null);
  const next = (ref: { current: TextInput | null }) => ({
    returnKeyType: 'next' as const,
    submitBehavior: 'submit' as const,
    onSubmitEditing: () => ref.current?.focus(),
  });

  return (
    <>
      <TextField
        label="Farm or business name"
        placeholder="e.g. Sunny Acres Farm"
        value={value.farmName}
        onChangeText={(farmName) => onChange({ farmName })}
        error={errors.farmName}
        {...next(owner)}
      />
      <TextField
        ref={owner}
        label="Owner or contact's full name"
        placeholder="e.g. Jordan Lee"
        autoComplete="name"
        value={value.ownerFullName}
        onChangeText={(ownerFullName) => onChange({ ownerFullName })}
        error={errors.ownerFullName}
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
        returnKeyType="done"
      />
    </>
  );
}
