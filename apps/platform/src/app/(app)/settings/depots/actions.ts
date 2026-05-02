'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createDepot, updateDepot } from '@/lib/queries/depots';
import {
  optionalString,
  requireLat,
  requireLng,
  requireString,
  runAction,
  type ActionResult,
} from '@/lib/validation';

export async function createDepotAction(formData: FormData): Promise<ActionResult> {
  await requireRole('admin');
  return runAction(async () => {
    const zoneId = requireString('zona', formData.get('zone_id'));
    const code = requireString('código', formData.get('code'), {
      maxLength: 16,
      pattern: /^[A-Z0-9-]{2,16}$/,
      patternMsg: 'Código debe ser 2-16 chars [A-Z, 0-9, -]',
    }).toUpperCase();
    const name = requireString('nombre', formData.get('name'), { maxLength: 120 });
    const address = requireString('dirección', formData.get('address'), { maxLength: 250 });
    const lat = requireLat(formData.get('lat'));
    const lng = requireLng(formData.get('lng'));
    const contactName = optionalString(formData.get('contact_name'), { maxLength: 120 });
    const contactPhone = optionalString(formData.get('contact_phone'), { maxLength: 24 });
    const notes = optionalString(formData.get('notes'), { maxLength: 500 });

    await createDepot({
      zoneId,
      code,
      name,
      address,
      lat,
      lng,
      contactName,
      contactPhone,
      notes,
    });
    revalidatePath('/settings/depots');
    revalidatePath('/settings/vehicles');
  });
}

export async function toggleDepotActiveAction(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  await requireRole('admin');
  return runAction(async () => {
    await updateDepot(id, { isActive });
    revalidatePath('/settings/depots');
  });
}
