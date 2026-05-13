// Helpers para capturar + comprimir fotos para evidencia.
//
// expo-image-picker abre la cámara nativa (intent Android) en modo "tomar
// foto y regresar". Es más simple que montar `<CameraView>` de expo-camera
// porque no necesitamos UI custom — sólo capturar.
//
// Tras capturar, comprimimos con expo-image-manipulator a JPEG 78% calidad
// y lado máximo 1600px (mismos parámetros que el web driver).

import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.78;

export type CaptureResult =
  | { ok: true; uri: string }
  | { ok: false; reason: 'permission_denied' | 'cancelled' | 'error'; message: string };

export async function captureAndCompress(): Promise<CaptureResult> {
  // Permiso de cámara.
  const perm = await ImagePicker.getCameraPermissionsAsync();
  let granted = perm.granted;
  if (!granted) {
    const ask = await ImagePicker.requestCameraPermissionsAsync();
    granted = ask.granted;
  }
  if (!granted) {
    return {
      ok: false,
      reason: 'permission_denied',
      message: 'Necesitamos acceso a la cámara para tomar la foto de evidencia.',
    };
  }

  // Lanzar cámara.
  let result;
  try {
    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1, // tomar full quality, comprimimos manualmente.
      allowsEditing: false,
      exif: false,
    });
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Error al abrir cámara.',
    };
  }

  if (result.canceled || !result.assets?.[0]) {
    return { ok: false, reason: 'cancelled', message: 'Captura cancelada.' };
  }

  const original = result.assets[0];

  // Comprimir.
  try {
    const ctx = ImageManipulator.manipulate(original.uri);
    const scale =
      original.width && original.height
        ? Math.max(original.width, original.height) > MAX_DIMENSION
          ? MAX_DIMENSION / Math.max(original.width, original.height)
          : 1
        : 1;
    if (scale < 1) {
      ctx.resize({
        width: Math.round((original.width ?? MAX_DIMENSION) * scale),
        height: Math.round((original.height ?? MAX_DIMENSION) * scale),
      });
    }
    const image = await ctx.renderAsync();
    const saved = await image.saveAsync({
      compress: JPEG_QUALITY,
      format: SaveFormat.JPEG,
    });
    return { ok: true, uri: saved.uri };
  } catch (err) {
    // Si la compresión falla, devolvemos la URI original — mejor subir
    // grande que perder la evidencia.
    console.warn('[photo.compress] falló, usando original:', err);
    return { ok: true, uri: original.uri };
  }
}
