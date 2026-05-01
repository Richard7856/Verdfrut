'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createStore, updateStore } from '@/lib/queries/stores';
import {
  optionalString,
  optionalTime,
  requireLat,
  requireLng,
  requireNumber,
  requireString,
  requireUuid,
  runAction,
  type ActionResult,
} from '@/lib/validation';

export async function createStoreAction(formData: FormData): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');

  return runAction(async () => {
    const code = requireString('código', formData.get('code'), {
      maxLength: 32,
      pattern: /^[A-Z0-9-]+$/,
      patternMsg: 'Código solo permite mayúsculas, números y guiones',
    }).toUpperCase();
    const name = requireString('nombre', formData.get('name'), { maxLength: 120 });
    const zoneId = requireUuid('zona', formData.get('zone_id'));
    const address = requireString('dirección', formData.get('address'), { maxLength: 240 });
    const lat = requireLat(formData.get('lat'));
    const lng = requireLng(formData.get('lng'));
    const contactName = optionalString(formData.get('contact_name'), { maxLength: 120 });
    const contactPhone = optionalString(formData.get('contact_phone'), { maxLength: 24 });
    const receivingWindowStart = optionalTime(formData.get('receiving_window_start'));
    const receivingWindowEnd = optionalTime(formData.get('receiving_window_end'));
    const serviceMinutes = formData.get('service_minutes');
    const serviceTimeSeconds =
      serviceMinutes !== null && serviceMinutes !== ''
        ? requireNumber('tiempo de servicio', serviceMinutes, { min: 1, max: 240, integer: true }) * 60
        : undefined;

    // Demanda multidimensional [peso_kg, volumen_m3, cajas]. Si los 3 vienen → custom.
    // Si faltan, queries usa el DEFAULT_DEMAND.
    const demandWeightRaw = formData.get('demand_weight');
    const demandVolumeRaw = formData.get('demand_volume');
    const demandBoxesRaw = formData.get('demand_boxes');
    let demand: number[] | undefined;
    if (demandWeightRaw && demandVolumeRaw && demandBoxesRaw) {
      demand = [
        requireNumber('demanda peso', demandWeightRaw, { min: 1, max: 100000, integer: true }),
        requireNumber('demanda volumen', demandVolumeRaw, { min: 1, max: 1000, integer: true }),
        requireNumber('demanda cajas', demandBoxesRaw, { min: 1, max: 10000, integer: true }),
      ];
    }

    await createStore({
      code,
      name,
      zoneId,
      address,
      lat,
      lng,
      contactName,
      contactPhone,
      receivingWindowStart,
      receivingWindowEnd,
      serviceTimeSeconds,
      demand,
    });

    revalidatePath('/settings/stores');
  });
}

export async function toggleStoreActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    await updateStore(id, { isActive });
    revalidatePath('/settings/stores');
  });
}
