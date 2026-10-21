import { useEffect, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '../../lib/supabase';
import { signOut } from '../../lib/signOut';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius, fonts } from '../../constants/theme';
import { Logo } from '../../components/Logo';
import { TextField } from '../../components/TextField';
import { AddressSearchField } from '../../components/AddressSearchField';
import { TagSelector } from '../../components/TagSelector';
import { DocumentUploadField } from '../../components/DocumentUploadField';
import { removeVerificationDocument, uploadVerificationDocument } from '../../lib/storage';
import {
  VERIFICATION_DOCUMENTS as DOCUMENTS,
  type VerificationDocColumn as DocColumn,
  type VerificationDocKey as DocKey,
} from '../../lib/verificationDocuments';
import {
  FARM_TYPE_OPTIONS,
  CERTIFICATION_TYPE_OPTIONS,
  farmerFarmDetailsSchema,
  farmerVerificationSchema,
  flattenFieldErrors,
  type PickedFile,
} from '../../lib/validation/schemas';
import type { CertificationType, FarmType, FarmerCertification } from '../../types/database';

type Step = 'farm-details' | 'documents';

type FarmDetailsForm = {
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZip: string;
  farmTypes: FarmType[];
  yearsInOperation: string;
  taxId: string;
};

const NO_FILES: Record<DocKey, PickedFile | null> = {
  businessLicense: null,
  insurance: null,
  govId: null,
  landProof: null,
  foodSafety: null,
};

type NewCertification = { certType: CertificationType; certName: string; file: PickedFile | null };

// The farmer application (Farmer F0): step 1 farm details, step 2
// verification documents, then submit_farmer_verification() (0022) checks
// it server-side and marks it submitted. Also the fix-and-resubmit form for
// a REJECTED farmer — everything already saved is pre-filled, and
// documents already uploaded don't need picking again. This screen never
// navigates on success: it refreshes the profile and lib/routeGuard.ts moves
// the farmer into the farmer app.
export default function FarmerApplication() {
  const { session, profile, farmerProfile, farmerVerification, refreshProfile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isResubmission = profile?.status === 'rejected';
  const reviewerNotes = farmerVerification?.reviewer_notes?.trim();

  // Initialised once from what's already saved — never re-synced from the
  // context afterwards, so a profile refresh can't wipe in-progress edits.
  // A first-time farmer who already saved step 1 resumes at step 2; a
  // rejected farmer starts at step 1 to review everything.
  const [step, setStep] = useState<Step>(() =>
    !isResubmission && farmerProfile?.address_street ? 'documents' : 'farm-details'
  );
  const [farmDetails, setFarmDetails] = useState<FarmDetailsForm>(() => ({
    addressStreet: farmerProfile?.address_street ?? '',
    addressCity: farmerProfile?.address_city ?? '',
    addressState: farmerProfile?.address_state ?? '',
    addressZip: farmerProfile?.address_zip ?? '',
    farmTypes: farmerProfile?.farm_types ?? [],
    yearsInOperation: farmerProfile?.years_in_operation != null ? String(farmerProfile.years_in_operation) : '',
    taxId: farmerProfile?.tax_id ?? '',
  }));
  const [businessLicenseNumber, setBusinessLicenseNumber] = useState(farmerVerification?.business_license_number ?? '');
  const [insuranceExpirationDate, setInsuranceExpirationDate] = useState(farmerVerification?.insurance_expiration_date ?? '');
  const [referencesText, setReferencesText] = useState(farmerVerification?.references_text ?? '');
  const [files, setFiles] = useState<Record<DocKey, PickedFile | null>>(NO_FILES);
  const [storedPaths, setStoredPaths] = useState<Partial<Record<DocColumn, string | null>>>(() =>
    Object.fromEntries(DOCUMENTS.map((d) => [d.column, farmerVerification?.[d.column] ?? null]))
  );
  const [existingCerts, setExistingCerts] = useState<FarmerCertification[]>([]);
  const [newCerts, setNewCerts] = useState<NewCertification[]>([]);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('farmer_certifications')
      .select('*')
      .eq('farmer_id', userId)
      .order('created_at')
      .then(({ data, error: certError }) => {
        if (certError) console.warn('Could not load certifications:', certError.message);
        else setExistingCerts((data ?? []) as FarmerCertification[]);
      });
  }, [userId]);

  const updateFarmDetails = (patch: Partial<FarmDetailsForm>) => setFarmDetails((prev) => ({ ...prev, ...patch }));
  const setFile = (key: DocKey, file: PickedFile | null) => setFiles((prev) => ({ ...prev, [key]: file }));
  const updateNewCert = (index: number, patch: Partial<NewCertification>) =>
    setNewCerts((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));

  const handleLeave = () => {
    if (isResubmission) {
      if (router.canGoBack()) router.back();
      else router.replace('/(farmer)/(tabs)');
    } else {
      signOut();
    }
  };

  const handleNext = async () => {
    setError(null);
    setFieldErrors({});
    const result = farmerFarmDetailsSchema.safeParse(farmDetails);
    if (!result.success) {
      setFieldErrors(flattenFieldErrors(result.error));
      setError('Fix the highlighted fields and try again.');
      return;
    }
    if (!userId) return;

    const d = result.data;

    setSaving(true);
    const { error: updateError } = await supabase
      .from('farmer_profiles')
      .update({
        address_street: d.addressStreet,
        address_city: d.addressCity,
        address_state: d.addressState,
        address_zip: d.addressZip,
        farm_types: d.farmTypes,
        years_in_operation: d.yearsInOperation,
        tax_id: d.taxId,
        // A changed address clears the farm's map location by itself (a
        // database trigger, 0031), so the API geocodes the new one.
      })
      .eq('id', userId);
    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }
    setStep('documents');
  };

  const removeExistingCert = (cert: FarmerCertification) => {
    Alert.alert('Remove this certification?', cert.cert_name, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          const { error: deleteError } = await supabase.from('farmer_certifications').delete().eq('id', cert.id);
          if (deleteError) {
            setError(deleteError.message);
            return;
          }
          if (cert.file_path) removeVerificationDocument(cert.file_path);
          setExistingCerts((prev) => prev.filter((c) => c.id !== cert.id));
        },
      },
    ]);
  };

  const handleSubmit = async () => {
    if (saving) return;
    setError(null);
    setFieldErrors({});

    const result = farmerVerificationSchema.safeParse({
      businessLicenseNumber,
      insuranceExpirationDate,
      referencesText,
      certifications: newCerts,
    });
    const errors: Record<string, string> = result.success ? {} : flattenFieldErrors(result.error);
    for (const doc of DOCUMENTS) {
      if (doc.required && !files[doc.key] && !storedPaths[doc.column]) errors[doc.key] = 'This document is required';
    }
    if (!result.success || Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      const certProblem = Object.keys(errors).some((k) => k.startsWith('certifications'));
      setError(
        certProblem
          ? 'Each certification you add needs a name and a file (or remove it).'
          : 'Fix the highlighted fields and try again.'
      );
      return;
    }
    if (!userId) return;

    setSaving(true);
    try {
      // 1. Upload only the documents picked this time; the rest stay as stored.
      const picked = DOCUMENTS.filter((d) => files[d.key]);
      const paths = await Promise.all(picked.map((d) => uploadVerificationDocument(userId, d.storageKey, files[d.key]!)));
      const pathUpdates = Object.fromEntries(picked.map((d, i) => [d.column, paths[i]])) as Partial<Record<DocColumn, string>>;

      // 2. Text fields + any new document paths.
      const { error: updateError } = await supabase
        .from('farmer_verification')
        .update({
          business_license_number: result.data.businessLicenseNumber,
          insurance_expiration_date: result.data.insuranceExpirationDate,
          references_text: result.data.referencesText || null,
          ...pathUpdates,
        })
        .eq('id', userId);
      if (updateError) throw updateError;
      setStoredPaths((prev) => ({ ...prev, ...pathUpdates }));
      setFiles(NO_FILES);

      // 3. New certifications, one at a time. Each moves to existingCerts
      //    as soon as it's fully saved, so retrying after a failure never
      //    inserts it twice; a half-saved one (row but no file) is removed.
      for (const cert of newCerts) {
        const { data: row, error: insertError } = await supabase
          .from('farmer_certifications')
          .insert({ farmer_id: userId, cert_type: cert.certType, cert_name: cert.certName.trim() })
          .select()
          .single();
        if (insertError) throw insertError;
        try {
          const filePath = await uploadVerificationDocument(userId, `certifications/${row.id}`, cert.file!);
          const { error: certUpdateError } = await supabase
            .from('farmer_certifications')
            .update({ file_path: filePath })
            .eq('id', row.id);
          if (certUpdateError) throw certUpdateError;
          setExistingCerts((prev) => [...prev, { ...(row as FarmerCertification), file_path: filePath }]);
          setNewCerts((prev) => prev.filter((c) => c !== cert));
        } catch (certErr) {
          await supabase.from('farmer_certifications').delete().eq('id', row.id);
          throw certErr;
        }
      }

      // 4. Submit — re-checked server-side; a rejected application goes back to pending.
      const { error: submitError } = await supabase.rpc('submit_farmer_verification');
      if (submitError) throw submitError;

      await refreshProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.container, { paddingTop: insets.top + spacing.sm }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Logo size={28} />
            <Text style={styles.brandText}>HarvestHub</Text>
          </View>
          <Pressable onPress={handleLeave} hitSlop={12}>
            <Text style={styles.leaveText}>{isResubmission ? 'Cancel' : 'Log out'}</Text>
          </Pressable>
        </View>

        <View style={styles.progressRow}>
          <View style={[styles.progressBar, styles.progressBarActive]} />
          <View style={[styles.progressBar, step === 'documents' && styles.progressBarActive]} />
        </View>
        <Text style={styles.stepLabel}>
          Step {step === 'farm-details' ? '1' : '2'} of 2 · {step === 'farm-details' ? 'Farm details' : 'Verification documents'}
        </Text>

        <Text style={styles.title}>
          {step === 'farm-details'
            ? isResubmission
              ? 'Update your application'
              : 'Tell us about your farm'
            : 'Verification documents'}
        </Text>
        <Text style={styles.subtitle}>
          {step === 'farm-details'
            ? 'This stays with your application — it isn’t shown on your public profile.'
            : 'We review these by hand before approving your account. PDF, JPG, PNG or HEIC, up to 10 MB each.'}
        </Text>

        {isResubmission && reviewerNotes ? (
          <View style={styles.notesBox}>
            <MaterialIcons name="info-outline" size={18} color={colors.danger} />
            <View style={styles.flex1}>
              <Text style={styles.notesLabel}>What the reviewer asked you to fix</Text>
              <Text style={styles.notesText}>{reviewerNotes}</Text>
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {step === 'farm-details' ? (
          <>
            <Card title="Farm location">
              <AddressSearchField
                placeholder="Farm street address"
                value={farmDetails.addressStreet}
                onChangeText={(addressStreet) => updateFarmDetails({ addressStreet })}
                onSelectAddress={(a) =>
                  updateFarmDetails({ addressStreet: a.street, addressCity: a.city, addressState: a.state, addressZip: a.zip })
                }
                error={fieldErrors.addressStreet}
              />
              <TextField
                placeholder="City"
                value={farmDetails.addressCity}
                onChangeText={(addressCity) => updateFarmDetails({ addressCity })}
                error={fieldErrors.addressCity}
              />
              <View style={styles.row}>
                <TextField
                  style={styles.flex1}
                  placeholder="State"
                  autoCapitalize="characters"
                  value={farmDetails.addressState}
                  onChangeText={(addressState) => updateFarmDetails({ addressState })}
                  error={fieldErrors.addressState}
                />
                <TextField
                  style={styles.flex1}
                  placeholder="ZIP code"
                  keyboardType="number-pad"
                  value={farmDetails.addressZip}
                  onChangeText={(addressZip) => updateFarmDetails({ addressZip })}
                  error={fieldErrors.addressZip}
                />
              </View>
            </Card>

            <Card title="About your farm">
              <Text style={styles.fieldLabel}>Farm type</Text>
              <TagSelector
                options={FARM_TYPE_OPTIONS}
                value={farmDetails.farmTypes}
                onChange={(farmTypes) => updateFarmDetails({ farmTypes })}
              />
              {fieldErrors.farmTypes ? <Text style={styles.fieldError}>{fieldErrors.farmTypes}</Text> : null}
              <TextField
                placeholder="Years in operation"
                keyboardType="number-pad"
                value={farmDetails.yearsInOperation}
                onChangeText={(yearsInOperation) => updateFarmDetails({ yearsInOperation })}
                error={fieldErrors.yearsInOperation}
              />
              <TextField
                placeholder="Tax ID / EIN"
                value={farmDetails.taxId}
                onChangeText={(taxId) => updateFarmDetails({ taxId })}
                error={fieldErrors.taxId}
              />
            </Card>

            <Pressable style={styles.button} onPress={handleNext} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.buttonText}>Continue</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Card title="Business license">
              <TextField
                placeholder="Business license number"
                value={businessLicenseNumber}
                onChangeText={setBusinessLicenseNumber}
                error={fieldErrors.businessLicenseNumber}
              />
              <DocumentField doc={DOCUMENTS[0]} files={files} storedPaths={storedPaths} errors={fieldErrors} onChange={setFile} />
            </Card>

            <Card title="Insurance">
              <DocumentField doc={DOCUMENTS[1]} files={files} storedPaths={storedPaths} errors={fieldErrors} onChange={setFile} />
              <TextField
                placeholder="Insurance expiration date (YYYY-MM-DD)"
                value={insuranceExpirationDate}
                onChangeText={setInsuranceExpirationDate}
                error={fieldErrors.insuranceExpirationDate}
              />
            </Card>

            <Card title="Identity & land">
              <DocumentField doc={DOCUMENTS[2]} files={files} storedPaths={storedPaths} errors={fieldErrors} onChange={setFile} />
              <DocumentField doc={DOCUMENTS[3]} files={files} storedPaths={storedPaths} errors={fieldErrors} onChange={setFile} />
            </Card>

            <Card title="Certifications" caption="Optional — organic, USDA, state registration, or anything else you hold.">
              {existingCerts.map((cert) => (
                <View key={cert.id} style={styles.existingCert}>
                  <MaterialIcons name="workspace-premium" size={18} color={colors.primary} />
                  <View style={styles.flex1}>
                    <Text style={styles.existingCertName}>{cert.cert_name}</Text>
                    <Text style={styles.existingCertType}>
                      {CERTIFICATION_TYPE_OPTIONS.find((o) => o.value === cert.cert_type)?.label ?? cert.cert_type}
                      {cert.file_path ? ' · file uploaded' : ''}
                    </Text>
                  </View>
                  <Pressable onPress={() => removeExistingCert(cert)} hitSlop={8}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                </View>
              ))}
              {newCerts.map((cert, index) => (
                <View key={index} style={styles.newCert}>
                  <TagSelector
                    options={CERTIFICATION_TYPE_OPTIONS}
                    value={[cert.certType]}
                    multiple={false}
                    onChange={(next) => updateNewCert(index, { certType: next[0] ?? cert.certType })}
                  />
                  <TextField
                    placeholder="Certification name (e.g. CCOF Organic)"
                    value={cert.certName}
                    onChangeText={(certName) => updateNewCert(index, { certName })}
                  />
                  <DocumentUploadField
                    label="Certificate file"
                    required
                    value={cert.file}
                    onChange={(file) => updateNewCert(index, { file })}
                  />
                  <Pressable onPress={() => setNewCerts((prev) => prev.filter((_, i) => i !== index))}>
                    <Text style={styles.remove}>Remove this certification</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setNewCerts((prev) => [...prev, { certType: 'organic', certName: '', file: null }])}
              >
                <Text style={styles.secondaryButtonText}>+ Add a certification</Text>
              </Pressable>
            </Card>

            <Card title="Anything else" caption="Optional.">
              <DocumentField doc={DOCUMENTS[4]} files={files} storedPaths={storedPaths} errors={fieldErrors} onChange={setFile} />
              <TextField
                placeholder="References — markets or co-ops you've sold through"
                multiline
                value={referencesText}
                onChangeText={setReferencesText}
              />
            </Card>

            <Pressable style={styles.button} onPress={handleSubmit} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.buttonText}>{isResubmission ? 'Resubmit application' : 'Submit application'}</Text>
              )}
            </Pressable>
            <Pressable style={styles.backLink} onPress={() => setStep('farm-details')} disabled={saving}>
              <Text style={styles.backLinkText}>Back to farm details</Text>
            </Pressable>
          </>
        )}

        {!isResubmission ? (
          <Pressable style={styles.backLink} onPress={() => router.push('/(farmer)/delete-account')} disabled={saving}>
            <Text style={styles.deleteLinkText}>Changed your mind? Delete your account</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Card({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {caption ? <Text style={styles.cardCaption}>{caption}</Text> : null}
      {children}
    </View>
  );
}

function DocumentField({
  doc,
  files,
  storedPaths,
  errors,
  onChange,
}: {
  doc: (typeof DOCUMENTS)[number];
  files: Record<DocKey, PickedFile | null>;
  storedPaths: Partial<Record<DocColumn, string | null>>;
  errors: Record<string, string>;
  onChange: (key: DocKey, file: PickedFile | null) => void;
}) {
  return (
    <DocumentUploadField
      label={doc.label}
      required={doc.required}
      value={files[doc.key]}
      uploaded={!!storedPaths[doc.column]}
      error={errors[doc.key]}
      onChange={(file) => onChange(doc.key, file)}
    />
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  screen: { backgroundColor: colors.background },
  container: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandText: { fontFamily: fonts.brand, fontSize: 15, color: colors.text },
  leaveText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  progressRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.sm },
  progressBar: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.border },
  progressBarActive: { backgroundColor: colors.primary },
  stepLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginBottom: spacing.md },
  title: { fontFamily: fonts.headlineBold, fontSize: 26, color: colors.text, marginBottom: spacing.xs },
  subtitle: { fontSize: 13.5, lineHeight: 19, color: colors.textMuted, marginBottom: spacing.lg },
  notesBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: '#F6E7E5',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  notesLabel: { fontSize: 12, fontWeight: '700', color: colors.danger, marginBottom: 2 },
  notesText: { fontSize: 13.5, lineHeight: 19, color: colors.text },
  error: { color: colors.danger, marginBottom: spacing.md, fontSize: 13 },
  card: { marginBottom: spacing.lg },
  cardTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: spacing.sm },
  cardCaption: { fontSize: 12, color: colors.textMuted, marginTop: -spacing.xs, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  existingCert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: spacing.sm,
  },
  existingCertName: { fontSize: 14, fontWeight: '600', color: colors.text },
  existingCertType: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  newCert: { borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, backgroundColor: colors.tint },
  remove: { color: colors.danger, fontSize: 12, fontWeight: '600' },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  secondaryButtonText: { color: colors.text, fontWeight: '600', fontSize: 14 },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonText: { color: colors.white, fontWeight: '700', fontSize: 15 },
  backLink: { alignItems: 'center', paddingVertical: spacing.md },
  backLinkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  deleteLinkText: { color: colors.textMuted, fontSize: 13 },
});
