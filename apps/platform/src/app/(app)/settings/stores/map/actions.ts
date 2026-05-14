'use server';

// Server actions del mapa de tiendas:
// - updateStoreLocationAction: persiste nuevas coords tras drag + marca verified.
// - createStoreFromPlaceAction: crea tienda con datos de Google Places.

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { requireRoomForStores } from '@/lib/plans-gate';
import { updateStore, createStore } from '@/lib/queries/stores';

interface UpdateLocationInput {
  storeId: string;
  lat: number;
  lng: number;
}

export async function updateStoreLocationAction(
  input: UpdateLocationInput,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireRole('admin', 'dispatcher');

    if (!Number.isFinite(input.lat) || input.lat < -90 || input.lat > 90) {
      return { ok: false, error: 'lat inválida' };
    }
    if (!Number.isFinite(input.lng) || input.lng < -180 || input.lng > 180) {
      return { ok: false, error: 'lng inválida' };
    }

    await updateStore(input.storeId, {
      lat: input.lat,
      lng: input.lng,
      coordVerified: true,
    });

    revalidatePath('/settings/stores');
    revalidatePath('/settings/stores/map');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

interface CreateFromPlaceInput {
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  zoneId: string;
}

export async function createStoreFromPlaceAction(
  input: CreateFromPlaceInput,
): Promise<{ ok: boolean; storeId?: string; error?: string }> {
  try {
    await requireRole('admin', 'dispatcher');
    // ADR-095. Gate por límite de tiendas del plan.
    await requireRoomForStores(1);

    const code = input.code.toUpperCase().trim();
    if (!/^[A-Z0-9-]{2,30}$/.test(code)) {
      return { ok: false, error: 'Código inválido (2-30 chars, A-Z, 0-9, guiones).' };
    }
    if (!input.name.trim() || input.name.length > 100) {
      return { ok: false, error: 'Nombre 1-100 chars.' };
    }
    if (!input.address.trim()) {
      return { ok: false, error: 'Dirección requerida.' };
    }
    if (!input.zoneId) {
      return { ok: false, error: 'Zona requerida.' };
    }

    const store = await createStore({
      code,
      name: input.name.trim(),
      address: input.address.trim(),
      lat: input.lat,
      lng: input.lng,
      zoneId: input.zoneId,
    });
    // Marcar coord_verified=true post-creación (createStore no acepta el flag).
    // El pin de Google Places ya está validado por el operador en el modal.
    await updateStore(store.id, { coordVerified: true });

    revalidatePath('/settings/stores');
    revalidatePath('/settings/stores/map');
    return { ok: true, storeId: store.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    if (msg.includes('duplicate') || msg.includes('23505')) {
      return { ok: false, error: 'Ya existe una tienda con ese código.' };
    }
    return { ok: false, error: msg };
  }
}
