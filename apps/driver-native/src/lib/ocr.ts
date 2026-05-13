// Cliente OCR — proxy via el platform porque la API key de Anthropic NO debe
// estar en el bundle de la app (es trivial extraerla con `unzip apk`).
//
// El platform expone POST /api/ocr/ticket que:
//   1. Valida el JWT del chofer (vía Supabase auth).
//   2. Recibe { imageUrl } — URL signed del ticket en Storage.
//   3. Llama a @tripdrive/ai extractTicketFromImageUrl.
//   4. Devuelve TicketData.
//
// Si el platform no tiene ANTHROPIC_API_KEY seteado, devuelve 503 — la UI
// degrada a entrada manual (chofer escribe número/fecha/total).

import Constants from 'expo-constants';
import type { TicketData } from '@tripdrive/types';
import { supabase } from '@/lib/supabase';

const extra = (Constants.expoConfig?.extra ?? {}) as { platformBaseUrl?: string };
const PLATFORM_BASE_URL =
  extra.platformBaseUrl ??
  process.env.EXPO_PUBLIC_PLATFORM_URL ??
  'https://app.tripdrive.xyz';

export type OcrResult =
  | { ok: true; data: TicketData }
  | { ok: false; reason: 'unavailable' | 'timeout' | 'unauthorized' | 'error'; message: string };

const OCR_TIMEOUT_MS = 30_000;

/**
 * Pide al platform que extraiga datos del ticket. NO falla la UI: devuelve
 * un `OcrResult` que la pantalla puede ignorar ("Entrada manual") si reason
 * es unavailable/timeout/error.
 */
export async function extractTicket(imageUrl: string): Promise<OcrResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, reason: 'unauthorized', message: 'Sesión expirada — vuelve a entrar.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

  try {
    const res = await fetch(`${PLATFORM_BASE_URL}/api/ocr/ticket`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ imageUrl }),
      signal: controller.signal,
    });

    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'unauthorized', message: 'No autorizado.' };
    }
    if (res.status === 503) {
      return {
        ok: false,
        reason: 'unavailable',
        message: 'OCR no configurado en el servidor (faltan credenciales).',
      };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        reason: 'error',
        message: `OCR error ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = (await res.json()) as TicketData;
    return { ok: true, data };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'OCR tardó más de 30s.' };
    }
    return {
      ok: false,
      reason: 'error',
      message: err instanceof Error ? err.message : 'Error desconocido',
    };
  } finally {
    clearTimeout(timer);
  }
}
