import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Switch,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useAuth } from '../../../contexts/AuthContext';
import { apiClient } from '../../../lib/apiClient';
import { apiErrorMessage } from '../../../lib/apiError';
import { pickFarmPhoto, uploadProductPhoto } from '../../../lib/farmerPhoto';
import { farmerProductSchema, flattenFieldErrors, type PickedFile } from '../../../lib/validation/schemas';
import { colors, spacing, radius, fonts } from '../../../constants/theme';
import { TextField } from '../../../components/TextField';
import { TagSelector } from '../../../components/TagSelector';
import type { Category } from '../../../types/database';
import type { FarmerProduct, FarmerProductInput, TaxCategory } from '../../../types/farmer';

const UNIT_OPTIONS = ['lb', 'oz', 'each', 'dozen', 'bunch', 'pint', 'quart', 'gallon', 'jar', 'bag'] as const;
const OTHER_UNIT = 'other';
const UNIT_CHOICES = [...UNIT_OPTIONS, OTHER_UNIT].map((u) => ({ value: u, label: u === OTHER_UNIT ? 'Other…' : u }));

type FormState = {
  name: string;
  description: string;
  categorySlug: string | null;
  price: string;
  unitChoice: string;
  customUnit: string;
  quantity: string;
  taxCategory: TaxCategory;
  keepCold: boolean;
  isActive: boolean;
};

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  categorySlug: null,
  price: '',
  unitChoice: 'lb',
  customUnit: '',
  quantity: '',
  taxCategory: 'raw',
  keepCold: false,
  isActive: true,
};

// Add (id = 'new') or edit one of the farmer's products (Farmer F2). Saves
// through FastAPI (/farmers/me/products), then uploads the one product
// photo, if a new one was picked, and attaches it.
export default function ProductEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Set after the first successful save of a new product, so a retry (e.g.
  // the photo upload failed) updates that product instead of creating another.
  const [productId, setProductId] = useState<string | null>(id === 'new' ? null : id);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PickedFile | null>(null);
  const [loading, setLoading] = useState(id !== 'new');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const isNew = id === 'new';
  const approved = profile?.status === 'active';

  useEffect(() => {
    apiClient.get<Category[]>('/categories').then(
      (res) => setCategories(res.data),
      (err) => console.warn('Could not load categories:', err)
    );
  }, []);

  useEffect(() => {
    if (isNew || !id) return;
    apiClient
      .get<FarmerProduct>(`/farmers/me/products/${id}`)
      .then((res) => {
        const p = res.data;
        const knownUnit = (UNIT_OPTIONS as readonly string[]).includes(p.unit);
        setForm({
          name: p.name,
          description: p.description ?? '',
          categorySlug: p.category_slug,
          price: p.price.toFixed(2),
          unitChoice: knownUnit ? p.unit : OTHER_UNIT,
          customUnit: knownUnit ? '' : p.unit,
          quantity: String(p.quantity_available),
          taxCategory: p.tax_category,
          keepCold: p.keep_cold,
          isActive: p.is_active,
        });
        setImageUrl(p.image_url);
      })
      .catch((err) => setError(apiErrorMessage(err, "Couldn't load this product.")))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handlePickPhoto = async () => {
    try {
      const file = await pickFarmPhoto();
      if (file) setPhoto(file);
    } catch {
      setError('Could not open the photo picker. Try again.');
    }
  };

  const handleSave = async () => {
    if (saving || !session?.user) return;
    setError(null);
    setFieldErrors({});

    const unit = form.unitChoice === OTHER_UNIT ? form.customUnit : form.unitChoice;
    const result = farmerProductSchema.safeParse({
      name: form.name,
      description: form.description,
      categorySlug: form.categorySlug ?? '',
      price: form.price,
      unit,
      quantity: form.quantity,
    });
    if (!result.success) {
      setFieldErrors(flattenFieldErrors(result.error));
      setError('Fix the highlighted fields and try again.');
      return;
    }

    const payload: FarmerProductInput = {
      name: result.data.name,
      description: result.data.description || null,
      category_slug: result.data.categorySlug,
      price: result.data.price,
      unit: result.data.unit,
      quantity_available: result.data.quantity,
      tax_category: form.taxCategory,
      keep_cold: form.keepCold,
      is_active: form.isActive,
    };

    setSaving(true);
    let saved: FarmerProduct;
    try {
      saved = productId
        ? (await apiClient.patch<FarmerProduct>(`/farmers/me/products/${productId}`, payload)).data
        : (await apiClient.post<FarmerProduct>('/farmers/me/products', payload)).data;
      setProductId(saved.id);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this product. Try again.'));
      setSaving(false);
      return;
    }

    if (photo) {
      try {
        const url = await uploadProductPhoto(session.user.id, saved.id, photo);
        await apiClient.patch(`/farmers/me/products/${saved.id}`, { image_url: url });
        setImageUrl(url);
        setPhoto(null);
      } catch (err) {
        console.warn('Could not upload product photo:', err);
        setError('The product was saved, but its photo didn’t upload. Tap Save to try the photo again.');
        setSaving(false);
        return;
      }
    }

    setSaving(false);
    router.back();
  };

  const previewUri = photo?.uri ?? imageUrl;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex1}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable style={styles.back} onPress={() => router.back()} hitSlop={12}>
          <MaterialIcons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>{isNew ? 'Add product' : 'Edit product'}</Text>
        <View style={styles.back} />
      </View>

      {!approved ? (
        <View style={styles.center}>
          <Text style={styles.muted}>Products unlock once your farm is approved.</Text>
        </View>
      ) : loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.card}>
            <Pressable style={styles.photoPicker} onPress={handlePickPhoto}>
              {previewUri ? (
                <Image source={{ uri: previewUri }} style={styles.photo} contentFit="cover" />
              ) : (
                <View style={[styles.photo, styles.photoEmpty]}>
                  <MaterialIcons name="add-a-photo" size={28} color={colors.textMuted} />
                </View>
              )}
              <Text style={styles.photoText}>{previewUri ? 'Change photo' : 'Add a photo'}</Text>
            </Pressable>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Details</Text>
            <TextField
              placeholder="Product name (e.g. Heirloom tomatoes)"
              value={form.name}
              onChangeText={(name) => update({ name })}
              error={fieldErrors.name}
            />
            <Text style={styles.fieldLabel}>Category</Text>
            <TagSelector
              options={categories.map((c) => ({ value: c.slug, label: c.name }))}
              value={form.categorySlug ? [form.categorySlug] : []}
              multiple={false}
              onChange={(next) => update({ categorySlug: next[0] ?? null })}
            />
            {fieldErrors.categorySlug ? <Text style={styles.fieldError}>{fieldErrors.categorySlug}</Text> : null}
            <TextField
              placeholder="Description (optional) — variety, how it's grown, taste"
              multiline
              value={form.description}
              onChangeText={(description) => update({ description })}
              error={fieldErrors.description}
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Price & stock</Text>
            <View style={styles.row}>
              <View style={styles.flex1}>
                <TextField
                  placeholder="Price ($)"
                  keyboardType="decimal-pad"
                  value={form.price}
                  onChangeText={(price) => update({ price })}
                  error={fieldErrors.price}
                />
              </View>
              <View style={styles.flex1}>
                <TextField
                  placeholder="How many available"
                  keyboardType="number-pad"
                  value={form.quantity}
                  onChangeText={(quantity) => update({ quantity })}
                  error={fieldErrors.quantity}
                />
              </View>
            </View>
            <Text style={styles.fieldLabel}>Sold per</Text>
            <TagSelector
              options={UNIT_CHOICES}
              value={[form.unitChoice]}
              multiple={false}
              onChange={(next) => update({ unitChoice: next[0] ?? form.unitChoice })}
            />
            {form.unitChoice === OTHER_UNIT ? (
              <TextField
                placeholder="Unit (e.g. half-peck, bouquet)"
                value={form.customUnit}
                onChangeText={(customUnit) => update({ customUnit })}
                error={fieldErrors.unit}
              />
            ) : fieldErrors.unit ? (
              <Text style={styles.fieldError}>{fieldErrors.unit}</Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tax type</Text>
            <TaxOption
              selected={form.taxCategory === 'raw'}
              title="Fresh / raw"
              body="Sold as harvested — fruit, vegetables, eggs, honey, cuts of meat."
              onPress={() => update({ taxCategory: 'raw' })}
            />
            <TaxOption
              selected={form.taxCategory === 'prepared'}
              title="Prepared"
              body="Made or cooked — jams, baked goods, ready-to-eat food. Usually taxed at a higher rate."
              onPress={() => update({ taxCategory: 'prepared' })}
            />
          </View>

          <View style={[styles.card, styles.switchRow]}>
            <View style={styles.flex1}>
              <Text style={styles.cardTitle}>Needs to stay cold</Text>
              <Text style={styles.muted}>
                Dairy, meat, eggs and the like. Customers collecting from a pod&apos;s drop point are told to pick it up soon after delivery.
              </Text>
            </View>
            <Switch
              value={form.keepCold}
              onValueChange={(keepCold) => update({ keepCold })}
              trackColor={{ true: colors.primaryMid, false: colors.border }}
              thumbColor={colors.white}
              accessibilityLabel="Needs to stay cold"
            />
          </View>

          <View style={[styles.card, styles.switchRow]}>
            <View style={styles.flex1}>
              <Text style={styles.cardTitle}>Visible to customers</Text>
              <Text style={styles.muted}>
                {form.isActive
                  ? 'Shown on your farm page and can be ordered.'
                  : 'Hidden — customers can’t see or order it. Hiding also removes it from carts.'}
              </Text>
            </View>
            <Switch
              value={form.isActive}
              onValueChange={(isActive) => update({ isActive })}
              trackColor={{ true: colors.primaryMid, false: colors.border }}
              thumbColor={colors.white}
            />
          </View>

          <Pressable style={styles.saveButton} onPress={handleSave} disabled={saving}>
            {saving ? <ActivityIndicator color={colors.white} /> : <Text style={styles.saveText}>{isNew ? 'Add product' : 'Save changes'}</Text>}
          </Pressable>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

function TaxOption({ selected, title, body, onPress }: { selected: boolean; title: string; body: string; onPress: () => void }) {
  return (
    <Pressable style={[styles.taxOption, selected && styles.taxOptionSelected]} onPress={onPress}>
      <MaterialIcons
        name={selected ? 'radio-button-checked' : 'radio-button-unchecked'}
        size={20}
        color={selected ? colors.primary : colors.border}
      />
      <View style={styles.flex1}>
        <Text style={styles.taxTitle}>{title}</Text>
        <Text style={styles.muted}>{body}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  screen: { backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    backgroundColor: colors.background,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.md },
  card: { marginBottom: spacing.lg },
  cardTitle: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: spacing.sm },
  fieldError: { color: colors.danger, fontSize: 12, marginTop: -spacing.sm, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  photoPicker: { alignItems: 'center' },
  photo: { width: 140, height: 140, borderRadius: radius.lg, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  photoText: { color: colors.primary, fontWeight: '700', fontSize: 14, marginTop: spacing.sm },
  taxOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  taxOptionSelected: { borderColor: colors.primary, backgroundColor: colors.tint },
  taxTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 2 },
  muted: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  saveButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveText: { color: colors.white, fontWeight: '700', fontSize: 15 },
});
