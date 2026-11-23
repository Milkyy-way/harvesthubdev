import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

const PROBLEM_PHOTOS_BUCKET = 'problem-photos';
export const MAX_PROBLEM_PHOTOS = 3;

export type ProblemPhoto = { uri: string; mimeType: string };

// "Report a problem" photos (2026-11-21): taken with the camera or picked from
// the library. The library opens the system photo picker, which needs no
// permission; the camera asks. Resolves null if the customer backs out.
export async function pickProblemPhoto(source: 'camera' | 'library'): Promise<ProblemPhoto | null> {
  let result: ImagePicker.ImagePickerResult;
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return null;
    result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: false });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.5,
      allowsEditing: false,
      // Ask for the most widely readable format, so HarvestHub can open it.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
  }
  const asset = result.canceled ? null : result.assets?.[0];
  if (!asset) return null;
  return { uri: asset.uri, mimeType: asset.mimeType ?? 'image/jpeg' };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/heif': 'heic',
  'image/webp': 'webp',
};

// Uploads to the PRIVATE bucket at {customer uid}/{store order id}/{n}.{ext},
// the only paths the API accepts for that report and the customer's own folder
// under the storage policies (0043). Only HarvestHub sees them, through
// short-lived links; they're deleted after 120 days. Returns the path.
export async function uploadProblemPhoto(userId: string, storeOrderId: string, n: number, photo: ProblemPhoto): Promise<string> {
  const ext = EXTENSIONS[photo.mimeType.toLowerCase()] ?? 'jpg';
  const type = ext === 'jpg' ? 'image/jpeg' : photo.mimeType.toLowerCase() === 'image/heif' ? 'image/heif' : `image/${ext}`;
  const path = `${userId}/${storeOrderId}/${n}.${ext}`;
  const formData = new FormData();
  formData.append('file', { uri: photo.uri, name: `${n}.${ext}`, type } as unknown as Blob);
  const { error } = await supabase.storage.from(PROBLEM_PHOTOS_BUCKET).upload(path, formData, { upsert: true });
  if (error) throw error;
  return path;
}
