'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createZone, updateZone } from '@/lib/queries/zones';

interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function createZoneAction(formData: FormData): Promise<ActionResult> {
  await requireRole('admin');
  const code = String(formData.get('code') ?? '').trim().toUpperCase();
  const name = String(formData.get('name') ?? '').trim();

  if (!code || !name) return { ok: false, error: 'Código y nombre son obligatorios' };
  if (!/^[A-Z0-9-]{2,16}$/.test(code)) {
    return { ok: false, error: 'Código debe ser 2-16 chars [A-Z, 0-9, -]' };
  }

  try {
    await createZone({ code, name });
    revalidatePath('/settings/zones');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function toggleZoneActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole('admin');
  try {
    await updateZone(id, { isActive });
    revalidatePath('/settings/zones');
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
