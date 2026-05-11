'use server';

// Server actions del comercial para responder/resolver el chat.
// RLS exige `sender='zone_manager' AND current_user_role IN ('zone_manager', 'admin', 'dispatcher')`
// (ver migración 018).

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@verdfrut/supabase/server';
import { uploadBlobToStorage } from '@/lib/storage-upload';
import { consume, LIMITS } from '@/lib/rate-limit';

const MAX_CHAT_TEXT = 2_000;

export interface ActionOk {
  ok: true;
  data?: { id: string };
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type Result = ActionOk | ActionErr;

/**
 * Inserta un mensaje del zone_manager (o admin/dispatcher actuando como tal).
 * Sin outbox aquí — la red del comercial es típicamente estable (oficina).
 * Si en el futuro hace falta tolerar offline en platform, agregamos otro outbox.
 */
export async function sendManagerMessage(
  reportId: string,
  body: { text?: string | null; imageUrl?: string | null },
): Promise<Result> {
  if (!body.text && !body.imageUrl) {
    return { ok: false, error: 'El mensaje debe tener texto o imagen.' };
  }
  if (body.text && body.text.length > MAX_CHAT_TEXT) {
    return { ok: false, error: `Mensaje demasiado largo (máx ${MAX_CHAT_TEXT} caracteres).` };
  }
  const supabase = await createServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) return { ok: false, error: 'Sesión inválida' };
  if (!(await consume(userData.user.id, 'chat', LIMITS.chatManagerMessage))) {
    return { ok: false, error: 'Demasiados mensajes seguidos. Espera un momento.' };
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      report_id: reportId,
      sender: 'zone_manager',
      sender_user_id: userData.user.id,
      text: body.text ?? null,
      image_url: body.imageUrl ?? null,
    })
    .select('id')
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? 'No se pudo enviar' };
  return { ok: true, data: { id: data.id } };
}

/**
 * Sube una foto adjunta del comercial y devuelve la URL pública.
 * Recibe FormData con campo "file" — server actions no aceptan Blob raw.
 * Bucket `evidence`. Path: incidents/{reportId}/manager_{ts}.jpg
 */
export async function uploadManagerChatPhotoAction(
  reportId: string,
  formData: FormData,
): Promise<Result & { url?: string }> {
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: 'No se recibió un archivo válido' };
  }
  try {
    const url = await uploadBlobToStorage({
      bucket: 'evidence',
      path: `incidents/${reportId}/manager_${Date.now()}.jpg`,
      blob: file,
    });
    return { ok: true, url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Upload falló' };
  }
}

/**
 * Cierra el caso desde el lado comercial.
 * Estado terminal: 'manager_resolved'. La parada y el reporte siguen su flujo
 * normal — el comercial decide via chat lo que el chofer debe hacer después.
 */
export async function resolveByManagerAction(reportId: string): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('delivery_reports')
    .update({
      chat_status: 'manager_resolved',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/incidents/${reportId}`);
  return { ok: true };
}
