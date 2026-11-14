import { useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { supabase } from '../../lib/supabase';
import { chooseFarmPhoto, uploadFarmPhoto } from '../../lib/farmerPhoto';
import { useAuth } from '../../contexts/AuthContext';
import { colors, spacing, radius, fonts } from '../../constants/theme';

// The farm's store photo — what customers see on its card in the feed.
// Replaces the old forced "add a photo" screen after approval: now an
// optional card on the farmer's Home tab, add or replace any time.
export function StorePhotoCard() {
  const { session, farmerProfile, refreshProfile } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photoUrl = farmerProfile?.photo_url;

  const handleChoose = async () => {
    if (!session?.user || uploading) return;
    setError(null);
    try {
      const file = await chooseFarmPhoto();
      if (!file) return; // picker cancelled
      setUploading(true);
      const url = await uploadFarmPhoto(session.user.id, file);
      const { error: updateError } = await supabase
        .from('farmer_profiles')
        .update({ photo_url: url })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
    } catch (err) {
      console.warn('Could not save store photo:', err);
      setError('Could not save your photo. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]}>
            <MaterialIcons name="add-a-photo" size={24} color={colors.textMuted} />
          </View>
        )}
        <View style={styles.textWrap}>
          <Text style={styles.title}>{photoUrl ? 'Store photo' : 'Add your store photo'}</Text>
          <Text style={styles.body}>
            {photoUrl
              ? 'Customers see this on your farm’s card.'
              : 'Customers see this on your farm’s card when they browse nearby farms.'}
          </Text>
        </View>
      </View>
      <Pressable style={styles.button} onPress={handleChoose} disabled={uploading}>
        {uploading ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Text style={styles.buttonText}>{photoUrl ? 'Change photo' : 'Choose photo'}</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photo: { width: 72, height: 72, borderRadius: radius.md, backgroundColor: colors.tint },
  photoEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed' },
  textWrap: { flex: 1 },
  title: { fontFamily: fonts.headline, fontSize: 17, color: colors.text, marginBottom: 2 },
  body: { fontSize: 12.5, lineHeight: 18, color: colors.textMuted },
  button: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.pill,
    paddingVertical: 11,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  buttonText: { color: colors.primary, fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 12, marginTop: spacing.xs },
});
