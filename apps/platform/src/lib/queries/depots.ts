// Queries de depots (CEDIS / Hubs). Server-only.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { TableUpdate } from '@verdfrut/supabase';
import type { Depot } from '@verdfrut/types';

interface DepotRow {
  id: string;
  zone_id: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

const DEPOT_COLS =
  'id, zone_id, code, name, address, lat, lng, contact_name, contact_phone, notes, is_active, created_at';

function toDepot(row: DepotRow): Depot {
  return {
    id: row.id,
    zoneId: row.zone_id,
    code: row.code,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function listDepots(opts?: { zoneId?: string }): Promise<Depot[]> {
  const supabase = await createServerClient();
  let q = supabase.from('depots').select(DEPOT_COLS).order('code');
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  const { data, error } = await q;
  if (error) throw new Error(`[depots.list] ${error.message}`);
  return (data ?? []).map(toDepot);
}

export async function getDepot(id: string): Promise<Depot | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('depots')
    .select(DEPOT_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[depots.get] ${error.message}`);
  return data ? toDepot(data) : null;
}

interface CreateDepotInput {
  zoneId: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
}

export async function createDepot(input: CreateDepotInput): Promise<Depot> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('depots')
    .insert({
      zone_id: input.zoneId,
      code: input.code,
      name: input.name,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      notes: input.notes ?? null,
    })
    .select(DEPOT_COLS)
    .single();
  if (error) throw new Error(`[depots.create] ${error.message}`);
  return toDepot(data);
}

export async function updateDepot(
  id: string,
  input: Partial<CreateDepotInput> & { isActive?: boolean },
): Promise<void> {
  const supabase = await createServerClient();
  const update: TableUpdate<'depots'> = {};
  if (input.code !== undefined) update.code = input.code;
  if (input.name !== undefined) update.name = input.name;
  if (input.address !== undefined) update.address = input.address;
  if (input.lat !== undefined) update.lat = input.lat;
  if (input.lng !== undefined) update.lng = input.lng;
  if (input.zoneId !== undefined) update.zone_id = input.zoneId;
  if (input.contactName !== undefined) update.contact_name = input.contactName;
  if (input.contactPhone !== undefined) update.contact_phone = input.contactPhone;
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.isActive !== undefined) update.is_active = input.isActive;
  const { error } = await supabase.from('depots').update(update).eq('id', id);
  if (error) throw new Error(`[depots.update] ${error.message}`);
}
