import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import type { PickedFile } from './validation/schemas';

const FARMER_PHOTOS_BUCKET = 'farmer-photos';
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/heic'];

// Returns null if the user cancels the picker — callers should treat that as
// "no change", not an error. Both iOS's and Android's system document
// picker expose a photo-library/gallery option, so this covers "upload from
// gallery" without adding a new dependency (expo-image-picker) — true in-app
// camera capture would need one if that's ever required.
export async function pickFarmPhoto(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ALLOWED_IMAGE_TYPES,
    multiple: false,
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets?.[0]) return null;

  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size };
}

// Take one now, with the camera (as lib/deliveryPhoto.ts does). Null if they
// back out or won't allow the camera.
export async function takeFarmPhoto(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return {
    uri: asset.uri,
    name: asset.fileName ?? `photo-${Date.now()}.jpg`,
    mimeType: asset.mimeType ?? 'image/jpeg',
    size: asset.fileSize,
  };
}

// The first step of adding a store or product photo: take one, or choose one.
export function chooseFarmPhoto(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Add a photo',
      undefined,
      [
        { text: 'Take photo', onPress: () => takeFarmPhoto().then(resolve, () => resolve(null)) },
        { text: 'Choose from library', onPress: () => pickFarmPhoto().then(resolve, () => resolve(null)) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

function extensionFor(file: PickedFile) {
  const fromName = file.name.split('.').pop();
  if (fromName && fromName !== file.name) return fromName.toLowerCase();
  if (file.mimeType === 'image/png') return 'png';
  return 'jpg';
}

// One photo per product (Farmer F2), same public bucket as the store photo,
// at {uid}/products/{productId}.<ext> — the only place the backend accepts
// a product's image_url from (see 0024 / app/farmer_products/service.py).
export async function uploadProductPhoto(userId: string, productId: string, file: PickedFile): Promise<string> {
  return uploadPublicPhoto(`${userId}/products/${productId}.${extensionFor(file)}`, file);
}

// Unlike lib/storage.ts's verification docs, this returns a PUBLIC url —
// customers browsing the feed load it directly and are never the owning
// farmer. Path convention (fixed filename, so re-upload is an upsert)
// matches the storage RLS policies in
// supabase/migrations/0009_farmer_geo_and_photo.sql.
export async function uploadFarmPhoto(userId: string, file: PickedFile): Promise<string> {
  return uploadPublicPhoto(`${userId}/farm-photo.${extensionFor(file)}`, file);
}

async function uploadPublicPhoto(path: string, file: PickedFile): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: file.uri,
    name: file.name,
    type: file.mimeType ?? 'image/jpeg',
  } as unknown as Blob);

  const { error } = await supabase.storage.from(FARMER_PHOTOS_BUCKET).upload(path, formData, { upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(FARMER_PHOTOS_BUCKET).getPublicUrl(path);
  // Replacing the photo reuses the same path, so the bare URL wouldn't
  // change and image caches (expo-image, customers' devices) would keep
  // showing the old one — the version param makes each upload a new URL.
  return `${data.publicUrl}?v=${Date.now()}`;
}
