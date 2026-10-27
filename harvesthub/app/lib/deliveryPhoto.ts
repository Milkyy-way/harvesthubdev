import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

const DELIVERY_PHOTOS_BUCKET = 'delivery-photos';

// Proof of delivery: the farmer photographs where they left the order.
// The camera only — never the photo library. Resolves null if the farmer
// backs out or won't allow the camera (the photo is optional).
export async function takeDeliveryPhoto(): Promise<string | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.5, allowsEditing: false });
  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0].uri;
}

// Uploads it to the PRIVATE bucket at {farmer uid}/{stop id}.jpg — the only
// path the API accepts for that stop, and the farmer's own folder under the
// storage policies (0032). Customers see it through a short-lived link from
// the API; it's deleted after 30 days. Returns the path for the API.
export async function uploadDeliveryPhoto(userId: string, stopId: string, uri: string): Promise<string> {
  const path = `${userId}/${stopId}.jpg`;
  const formData = new FormData();
  formData.append('file', { uri, name: `${stopId}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  const { error } = await supabase.storage.from(DELIVERY_PHOTOS_BUCKET).upload(path, formData, { upsert: true });
  if (error) throw error;
  return path;
}
