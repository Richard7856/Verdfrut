'use server';

import { revalidatePath } from 'next/cache';
import { logger } from '@tripdrive/observability';
import { requireRole } from '@/lib/auth';
import { createStore, updateStore, getStore } from '@/lib/queries/stores';
import {
  optionalString,
  optionalTime,
  requireLat,
  requireLng,
  requireNumber,
  requireString,
  requireUuid,
  runAction,
  ValidationError,
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

/**
 * Edita los campos editables de una tienda desde `/settings/stores/[id]`.
 * Maneja también lat/lng (cuando el admin movió el pin en el mapa) y
 * coord_verified (toggle explícito cuando confirma manualmente).
 *
 * Si las coords cambian (lat o lng != valor previo), automáticamente sube
 * `coord_verified=true` — la heurística asume que un cambio manual es ground
 * truth. El admin puede destildar el flag si lo quiere "tentativo".
 */
export async function updateStoreAction(id: string, formData: FormData): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const storeId = requireUuid('id', id);
    const prev = await getStore(storeId);
    if (!prev) throw new ValidationError('id', 'Tienda no encontrada');

    const name = requireString('nombre', formData.get('name'), { maxLength: 120 });
    const address = requireString('dirección', formData.get('address'), { maxLength: 240 });
    const lat = requireLat(formData.get('lat'));
    const lng = requireLng(formData.get('lng'));
    const contactName = optionalString(formData.get('contact_name'), { maxLength: 120 });
    const contactPhone = optionalString(formData.get('contact_phone'), { maxLength: 24 });
    const receivingWindowStart = optionalTime(formData.get('receiving_window_start'));
    const receivingWindowEnd = optionalTime(formData.get('receiving_window_end'));
    const serviceMinutesRaw = formData.get('service_minutes');
    const serviceTimeSeconds =
      serviceMinutesRaw !== null && serviceMinutesRaw !== ''
        ? requireNumber('tiempo de servicio', serviceMinutesRaw, { min: 1, max: 240, integer: true }) * 60
        : undefined;

    // El toggle viene como string "on" / null para checkboxes nativos.
    const coordVerifiedRaw = formData.get('coord_verified');
    const userCheckedVerified = coordVerifiedRaw === 'on' || coordVerifiedRaw === 'true';

    // Heurística: si el admin movió el pin (lat/lng difieren > ~1m), asumimos
    // ground truth → verified=true salvo que explícitamente destildó el flag.
    const coordsChanged =
      Math.abs(lat - prev.lat) > 0.00001 || Math.abs(lng - prev.lng) > 0.00001;
    const coordVerified = coordsChanged ? true : userCheckedVerified;

    await updateStore(storeId, {
      name,
      address,
      lat,
      lng,
      contactName,
      contactPhone,
      receivingWindowStart,
      receivingWindowEnd,
      serviceTimeSeconds,
      coordVerified,
    });

    revalidatePath('/settings/stores');
    revalidatePath(`/settings/stores/${storeId}`);
  });
}

/**
 * Re-geocodifica una tienda desde su dirección usando Google Geocoding API.
 * Útil cuando el admin acaba de actualizar `address` y quiere coords frescas
 * sin tener que mover el pin manualmente.
 *
 * Devuelve la propuesta como `lat/lng/formattedAddress` para que el cliente
 * la confirme antes de guardar (NO escribe en BD por sí solo). Es una API
 * de "preview" — el commit lo hace `updateStoreAction`.
 */
export interface GeocodeProposal extends ActionResult {
  lat?: number;
  lng?: number;
  formattedAddress?: string;
  locationType?: string;
}

export async function geocodeStoreAddressAction(address: string): Promise<GeocodeProposal> {
  await requireRole('admin', 'dispatcher');
  if (!address || address.length < 5) {
    return { ok: false, error: 'Dirección muy corta para geocodificar' };
  }

  const key = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!key) {
    return { ok: false, error: 'GOOGLE_GEOCODING_API_KEY no configurada en el server' };
  }

  try {
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json?' +
      new URLSearchParams({ address, components: 'country:MX', key });
    const res = await fetch(url);
    const data = (await res.json()) as {
      status: string;
      error_message?: string;
      results?: Array<{
        geometry: { location: { lat: number; lng: number }; location_type: string };
        formatted_address: string;
      }>;
    };
    if (data.status !== 'OK' || !data.results?.[0]) {
      return { ok: false, error: `Geocoding sin resultados (${data.status})` };
    }
    const r = data.results[0];
    return {
      ok: true,
      lat: r.geometry.location.lat,
      lng: r.geometry.location.lng,
      formattedAddress: r.formatted_address,
      locationType: r.geometry.location_type,
    };
  } catch (err) {
    await logger.error('[geocodeStoreAddressAction] error', { err, address });
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
