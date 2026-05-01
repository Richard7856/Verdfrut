// Queries de stores. Server-only.
// El optimizador necesita: lat, lng, time windows, service time.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { TableUpdate } from '@verdfrut/supabase';
import type { Store } from '@verdfrut/types';

interface StoreRow {
  id: string;
  code: string;
  name: string;
  zone_id: string;
  address: string;
  lat: number;
  lng: number;
  contact_name: string | null;
  contact_phone: string | null;
  receiving_window_start: string | null;
  receiving_window_end: string | null;
  service_time_seconds: number;
  demand: number[] | null;
  is_active: boolean;
  created_at: string;
}

const STORE_COLS =
  'id, code, name, zone_id, address, lat, lng, contact_name, contact_phone, receiving_window_start, receiving_window_end, service_time_seconds, demand, is_active, created_at';

// Demanda default cuando una tienda no la tiene seteada (ej: stores creadas antes de la migración).
// Convención: [peso_kg, volumen_m3, cajas].
const DEFAULT_DEMAND = [100, 1, 5];

function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    zoneId: row.zone_id,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    receivingWindowStart: row.receiving_window_start,
    receivingWindowEnd: row.receiving_window_end,
    serviceTimeSeconds: row.service_time_seconds,
    demand: row.demand ?? DEFAULT_DEMAND,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function listStores(opts?: { zoneId?: string; activeOnly?: boolean }): Promise<Store[]> {
  const supabase = await createServerClient();
  let q = supabase.from('stores').select(STORE_COLS).order('code');
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  if (opts?.activeOnly) q = q.eq('is_active', true);

  const { data, error } = await q;
  if (error) throw new Error(`[stores.list] ${error.message}`);
  return (data ?? []).map(toStore);
}

export async function getStore(id: string): Promise<Store | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from('stores').select(STORE_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`[stores.get] ${error.message}`);
  return data ? toStore(data) : null;
}

/**
 * Obtiene varias stores por id en un solo query. Útil para construir el payload del optimizer.
 */
export async function getStoresByIds(ids: string[]): Promise<Store[]> {
  if (ids.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase.from('stores').select(STORE_COLS).in('id', ids);
  if (error) throw new Error(`[stores.getByIds] ${error.message}`);
  return (data ?? []).map(toStore);
}

interface CreateStoreInput {
  code: string;
  name: string;
  zoneId: string;
  address: string;
  lat: number;
  lng: number;
  contactName?: string | null;
  contactPhone?: string | null;
  receivingWindowStart?: string | null;
  receivingWindowEnd?: string | null;
  serviceTimeSeconds?: number;
  /** Demanda multidimensional [peso_kg, volumen_m3, cajas]. Default DEFAULT_DEMAND. */
  demand?: number[];
}

export async function createStore(input: CreateStoreInput): Promise<Store> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('stores')
    .insert({
      code: input.code,
      name: input.name,
      zone_id: input.zoneId,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      receiving_window_start: input.receivingWindowStart ?? null,
      receiving_window_end: input.receivingWindowEnd ?? null,
      service_time_seconds: input.serviceTimeSeconds ?? 900,
      demand: input.demand ?? DEFAULT_DEMAND,
    })
    .select(STORE_COLS)
    .single();

  if (error) throw new Error(`[stores.create] ${error.message}`);
  return toStore(data);
}

interface UpdateStoreInput {
  code?: string;
  name?: string;
  zoneId?: string;
  address?: string;
  lat?: number;
  lng?: number;
  contactName?: string | null;
  contactPhone?: string | null;
  receivingWindowStart?: string | null;
  receivingWindowEnd?: string | null;
  serviceTimeSeconds?: number;
  isActive?: boolean;
}

export async function updateStore(id: string, input: UpdateStoreInput): Promise<Store> {
  const supabase = await createServerClient();
  const update: TableUpdate<'stores'> = {};
  if (input.code !== undefined) update.code = input.code;
  if (input.name !== undefined) update.name = input.name;
  if (input.zoneId !== undefined) update.zone_id = input.zoneId;
  if (input.address !== undefined) update.address = input.address;
  if (input.lat !== undefined) update.lat = input.lat;
  if (input.lng !== undefined) update.lng = input.lng;
  if (input.contactName !== undefined) update.contact_name = input.contactName;
  if (input.contactPhone !== undefined) update.contact_phone = input.contactPhone;
  if (input.receivingWindowStart !== undefined) update.receiving_window_start = input.receivingWindowStart;
  if (input.receivingWindowEnd !== undefined) update.receiving_window_end = input.receivingWindowEnd;
  if (input.serviceTimeSeconds !== undefined) update.service_time_seconds = input.serviceTimeSeconds;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { data, error } = await supabase
    .from('stores')
    .update(update)
    .eq('id', id)
    .select(STORE_COLS)
    .single();

  if (error) throw new Error(`[stores.update] ${error.message}`);
  return toStore(data);
}
