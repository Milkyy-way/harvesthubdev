import { z } from 'zod';
import type {
  DietaryPreference,
  ProduceInterest,
  ReferralSource,
  FarmType,
  CertificationType,
} from '../../types/database';

// Canonical option lists — these MUST match the `CHECK (... <@ array[...])`
// constraints in supabase/migrations/0003_customer_profiles.sql and
// 0004_farmer_tables.sql exactly. If a value is added/removed here, the
// matching migration needs a matching change, or signup can fail outright
// (see the note in 0005_signup_trigger_v2.sql).
function valuesOf<const T extends readonly { value: string }[]>(
  options: T
): [T[number]['value'], ...T[number]['value'][]] {
  return options.map((o) => o.value) as [T[number]['value'], ...T[number]['value'][]];
}

export const DIETARY_PREFERENCE_OPTIONS: { value: DietaryPreference; label: string }[] = [
  { value: 'organic', label: 'Organic' },
  { value: 'local_only', label: 'Local-only' },
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten-free' },
  { value: 'dairy_free', label: 'Dairy-free' },
] as const;

export const PRODUCE_INTEREST_OPTIONS: { value: ProduceInterest; label: string }[] = [
  { value: 'vegetables', label: 'Vegetables' },
  { value: 'fruits', label: 'Fruits' },
  { value: 'eggs', label: 'Eggs' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'meat', label: 'Meat' },
  { value: 'herbs', label: 'Herbs' },
  { value: 'flowers', label: 'Flowers' },
  { value: 'honey', label: 'Honey' },
] as const;

export const REFERRAL_SOURCE_OPTIONS: { value: ReferralSource; label: string }[] = [
  { value: 'friend', label: 'Friend or family' },
  { value: 'social_media', label: 'Social media' },
  { value: 'search', label: 'Search engine' },
  { value: 'market_event', label: 'Farmers market / event' },
  { value: 'other', label: 'Other' },
] as const;

export const FARM_TYPE_OPTIONS: { value: FarmType; label: string }[] = [
  { value: 'produce', label: 'Produce' },
  { value: 'dairy', label: 'Dairy' },
  { value: 'livestock', label: 'Livestock' },
] as const;

export const CERTIFICATION_TYPE_OPTIONS: { value: CertificationType; label: string }[] = [
  { value: 'organic', label: 'Organic certification' },
  { value: 'usda', label: 'USDA certification' },
  { value: 'state_ag_registration', label: 'State ag department registration' },
  { value: 'other', label: 'Other' },
] as const;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;
const ZIP_RE = /^[0-9]{5}(-[0-9]{4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const emailSchema = z.string().trim().min(1, 'Email is required').regex(EMAIL_RE, 'Enter a valid email address');
export const phoneSchema = z.string().trim().regex(PHONE_RE, 'Enter a valid phone number');
export const zipSchema = z.string().trim().regex(ZIP_RE, 'Enter a valid ZIP code');

// bcrypt (used server-side by Supabase Auth) silently truncates beyond 72
// bytes — capping here avoids a password that "works" at signup but can't
// be reproduced later if it were ever re-hashed elsewhere.
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer');

function withMatchingPasswords<T extends z.ZodType<{ password: string; confirmPassword: string }>>(schema: T) {
  return schema.refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });
}

// Setting a new password with an emailed reset code — same password rules
// as signup. Supabase's email OTP length is configurable (6 by default,
// up to 10), so any 6–10 digit code is accepted here.
export const resetCodeSchema = z.string().trim().regex(/^\d{6,10}$/, 'Enter the code from the email');
export const newPasswordSchema = withMatchingPasswords(
  z.object({ password: passwordSchema, confirmPassword: z.string() })
);

export const customerSignupSchema = withMatchingPasswords(
  z
    .object({
      fullName: z.string().trim().min(1, 'Full name is required'),
      email: emailSchema,
      phone: phoneSchema,
      password: passwordSchema,
      confirmPassword: z.string(),
      addressStreet: z.string().trim().min(1, 'Street address is required'),
      addressCity: z.string().trim().min(1, 'City is required'),
      addressState: z.string().trim().min(1, 'State is required'),
      addressZip: zipSchema,
      addressUnit: z.string().trim().max(40, 'Keep the apartment under 40 characters').optional(),
      dietaryPreferences: z.array(z.enum(valuesOf(DIETARY_PREFERENCE_OPTIONS))),
      produceInterests: z.array(z.enum(valuesOf(PRODUCE_INTEREST_OPTIONS))),
      referralSource: z.enum(valuesOf(REFERRAL_SOURCE_OPTIONS)).optional(),
      referralSourceOther: z.string().trim().optional(),
    })
    .refine((data) => data.referralSource !== 'other' || !!data.referralSourceOther?.trim(), {
      message: 'Tell us more about how you heard about us',
      path: ['referralSourceOther'],
    })
);

export type CustomerSignupInput = z.infer<typeof customerSignupSchema>;

export const farmerAccountSchema = withMatchingPasswords(
  z.object({
    farmName: z.string().trim().min(1, 'Farm/business name is required'),
    ownerFullName: z.string().trim().min(1, 'Owner full name is required'),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
  })
);

export type FarmerAccountInput = z.infer<typeof farmerAccountSchema>;

export const farmerFarmDetailsSchema = z.object({
  addressStreet: z.string().trim().min(1, 'Street address is required'),
  addressCity: z.string().trim().min(1, 'City is required'),
  addressState: z.string().trim().min(1, 'State is required'),
  addressZip: zipSchema,
  farmTypes: z.array(z.enum(valuesOf(FARM_TYPE_OPTIONS))).min(1, 'Select at least one farm type'),
  yearsInOperation: z.coerce.number('Enter a number').int().min(0).max(150),
  // Deliberately loose — EIN (XX-XXXXXXXX) and a sole proprietor's SSN are
  // both valid here, so this checks length/shape, not a strict EIN pattern.
  taxId: z
    .string()
    .trim()
    .regex(/^[0-9-]{9,11}$/, 'Enter a valid Tax ID / EIN'),
});

export type FarmerFarmDetailsInput = z.infer<typeof farmerFarmDetailsSchema>;

export const pickedFileSchema = z.object({
  uri: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  size: z.number().optional(),
});

export type PickedFile = z.infer<typeof pickedFileSchema>;

export const certificationEntrySchema = z.object({
  certType: z.enum(valuesOf(CERTIFICATION_TYPE_OPTIONS)),
  certName: z.string().trim().min(1, 'Certification name is required'),
  file: pickedFileSchema,
});

export type CertificationEntry = z.infer<typeof certificationEntrySchema>;

// The document FILES aren't in this schema: a resumed or resubmitted
// application may already have some stored from an earlier save, so the
// application screen checks "picked now OR already uploaded" per document
// itself. Certifications are optional (0022) — this only validates any new
// ones being added.
export const farmerVerificationSchema = z.object({
  businessLicenseNumber: z.string().trim().min(1, 'Business license number is required'),
  // Postgres CHECK constraints can't reference now() (not immutable), so
  // "not already expired" can only be enforced here, not in the DB.
  insuranceExpirationDate: z
    .string()
    .trim()
    .regex(DATE_RE, 'Use format YYYY-MM-DD')
    .refine((value) => new Date(value).getTime() > Date.now(), 'Insurance must not already be expired'),
  certifications: z.array(certificationEntrySchema),
  referencesText: z.string().trim().optional(),
});

export type FarmerVerificationInput = z.infer<typeof farmerVerificationSchema>;

// Farmer product editor (Farmer F2) — mirrors the backend's
// FarmerProductCreate limits (app/farmer_products/schemas.py).
export const farmerProductSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(1000, 'Keep the description under 1000 characters'),
  categorySlug: z.string({ message: 'Pick a category' }).min(1, 'Pick a category'),
  price: z.coerce
    .number('Enter a price')
    .gt(0, 'Price must be more than $0')
    .max(10000, 'Price is too high')
    .refine((value) => Number(value.toFixed(2)) === value, 'Use at most 2 decimal places'),
  unit: z.string().trim().min(1, 'Pick a unit').max(30, 'Keep the unit short'),
  quantity: z.coerce.number('Enter a number').int('Whole numbers only').min(0, 'Can’t be negative').max(100000),
});

export type FarmerProductFormInput = z.infer<typeof farmerProductSchema>;

// Farmer farm-profile editor (Farmer F6). Tax ID is deliberately not here —
// it's verification data, changed through HarvestHub, not self-edited.
export const FARM_BIO_MAX = 500;
export const farmerProfileEditSchema = z.object({
  farmName: z.string().trim().min(1, 'Farm name is required').max(80, 'Keep the farm name under 80 characters'),
  bio: z.string().trim().max(FARM_BIO_MAX, `Keep it under ${FARM_BIO_MAX} characters`),
  farmTypes: z.array(z.enum(valuesOf(FARM_TYPE_OPTIONS))).min(1, 'Select at least one farm type'),
  yearsInOperation: z.coerce.number('Enter a number').int().min(0).max(150),
  addressStreet: z.string().trim().min(1, 'Street address is required'),
  addressCity: z.string().trim().min(1, 'City is required'),
  addressState: z.string().trim().min(1, 'State is required'),
  addressZip: zipSchema,
  ownerName: z.string().trim().min(1, 'Your name is required'),
  phone: phoneSchema,
});

// Flattens a ZodError into a single message per field (keyed by dotted path,
// e.g. "confirmPassword" or "addressZip") for simple inline error display —
// this codebase uses plain per-field useState, not a form library that would
// otherwise handle this.
export function flattenFieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}
