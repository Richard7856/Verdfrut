'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createVehicle, updateVehicle } from '@/lib/queries/vehicles';
import {
  optionalString,
  requireNumber,
  requireString,
  requireUuid,
  runAction,
  type ActionResult,
} from '@/lib/validation';

export async function createVehicleAction(formData: FormData): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');

  return runAction(async () => {
    const plate = requireString('placa', formData.get('plate'), {
      maxLength: 16,
      pattern: /^[A-Z0-9-]+$/,
      patternMsg: 'Placa solo permite mayúsculas, números y guiones',
    }).toUpperCase();
    const alias = optionalString(formData.get('alias'), { maxLength: 60 });
    const zoneId = requireUuid('zona', formData.get('zone_id'));
    const weightKg = requireNumber('peso (kg)', formData.get('capacity_weight'), {
      min: 1,
      max: 100000,
      integer: true,
    });
    const volumeM3 = requireNumber('volumen (m³)', formData.get('capacity_volume'), {
      min: 1,
      max: 1000,
      integer: true,
    });
    const boxes = requireNumber('cajas', formData.get('capacity_boxes'), {
      min: 1,
      max: 10000,
      integer: true,
    });
    const depotIdRaw = formData.get('depot_id');
    const depotId = depotIdRaw && depotIdRaw !== '' ? String(depotIdRaw) : null;
    const depotLat = formData.get('depot_lat');
    const depotLng = formData.get('depot_lng');

    // Specs opcionales (mig 042 + AI enrichment).
    const make = optionalString(formData.get('make'), { maxLength: 40 });
    const model = optionalString(formData.get('model'), { maxLength: 60 });
    const yearRaw = formData.get('year');
    const year =
      yearRaw && yearRaw !== ''
        ? requireNumber('año', yearRaw, { min: 1990, max: 2100, integer: true })
        : null;
    const engineRaw = formData.get('engine_size_l');
    const engineSizeL =
      engineRaw && engineRaw !== ''
        ? requireNumber('motor (L)', engineRaw, { min: 0.5, max: 20 })
        : null;
    const fuelRaw = formData.get('fuel_consumption_l_per_100km');
    const fuelConsumption =
      fuelRaw && fuelRaw !== ''
        ? requireNumber('consumo (L/100km)', fuelRaw, { min: 1, max: 100 })
        : null;
    const notes = optionalString(formData.get('notes'), { maxLength: 500 });

    await createVehicle({
      plate,
      alias,
      zoneId,
      capacity: [weightKg, volumeM3, boxes],
      depotId,
      // Sólo aplican si depot_id es null (override por vehículo).
      depotLat:
        !depotId && depotLat !== null && depotLat !== ''
          ? requireNumber('latitud depósito', depotLat, { min: -90, max: 90 })
          : null,
      depotLng:
        !depotId && depotLng !== null && depotLng !== ''
          ? requireNumber('longitud depósito', depotLng, { min: -180, max: 180 })
          : null,
      make,
      model,
      year,
      engineSizeL,
      fuelConsumptionLPer100km: fuelConsumption,
      notes,
    });

    revalidatePath('/settings/vehicles');
  });
}

export async function updateVehicleAction(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');

  return runAction(async () => {
    const plate = requireString('placa', formData.get('plate'), {
      maxLength: 16,
      pattern: /^[A-Z0-9-]+$/,
      patternMsg: 'Placa solo permite mayúsculas, números y guiones',
    }).toUpperCase();
    const alias = optionalString(formData.get('alias'), { maxLength: 60 });
    const zoneId = requireUuid('zona', formData.get('zone_id'));
    const weightKg = requireNumber('peso (kg)', formData.get('capacity_weight'), {
      min: 1,
      max: 100000,
      integer: true,
    });
    const volumeM3 = requireNumber('volumen (m³)', formData.get('capacity_volume'), {
      min: 1,
      max: 1000,
      integer: true,
    });
    const boxes = requireNumber('cajas', formData.get('capacity_boxes'), {
      min: 1,
      max: 10000,
      integer: true,
    });
    const depotIdRaw = formData.get('depot_id');
    const depotId = depotIdRaw && depotIdRaw !== '' ? String(depotIdRaw) : null;
    const depotLat = formData.get('depot_lat');
    const depotLng = formData.get('depot_lng');

    const make = optionalString(formData.get('make'), { maxLength: 40 });
    const model = optionalString(formData.get('model'), { maxLength: 60 });
    const yearRaw = formData.get('year');
    const year =
      yearRaw && yearRaw !== ''
        ? requireNumber('año', yearRaw, { min: 1990, max: 2100, integer: true })
        : null;
    const engineRaw = formData.get('engine_size_l');
    const engineSizeL =
      engineRaw && engineRaw !== ''
        ? requireNumber('motor (L)', engineRaw, { min: 0.5, max: 20 })
        : null;
    const fuelRaw = formData.get('fuel_consumption_l_per_100km');
    const fuelConsumption =
      fuelRaw && fuelRaw !== ''
        ? requireNumber('consumo (L/100km)', fuelRaw, { min: 1, max: 100 })
        : null;
    const notes = optionalString(formData.get('notes'), { maxLength: 500 });

    await updateVehicle(id, {
      plate,
      alias,
      zoneId,
      capacity: [weightKg, volumeM3, boxes],
      depotId,
      depotLat:
        !depotId && depotLat !== null && depotLat !== ''
          ? requireNumber('latitud depósito', depotLat, { min: -90, max: 90 })
          : null,
      depotLng:
        !depotId && depotLng !== null && depotLng !== ''
          ? requireNumber('longitud depósito', depotLng, { min: -180, max: 180 })
          : null,
      make,
      model,
      year,
      engineSizeL,
      fuelConsumptionLPer100km: fuelConsumption,
      notes,
    });

    revalidatePath('/settings/vehicles');
    revalidatePath(`/settings/vehicles/${id}`);
  });
}

export async function toggleVehicleActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    await updateVehicle(id, { isActive });
    revalidatePath('/settings/vehicles');
  });
}
