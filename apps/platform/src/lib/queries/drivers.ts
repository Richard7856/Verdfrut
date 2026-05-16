// Queries de drivers. Server-only.
// Driver = UserProfile con role='driver' + datos operativos extras (licencia, etc.)

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { TableUpdate } from '@tripdrive/supabase';
import type { Driver } from '@tripdrive/types';
import { isSandboxMode } from '@/lib/workbench-mode';

interface DriverRow {
  id: string;
  user_id: string;
  zone_id: string;
  license_number: string | null;
  license_expires_at: string | null;
  is_active: boolean;
  created_at: string;
  user_profiles: {
    full_name: string;
    phone: string | null;
  } | null;
}

const DRIVER_COLS = `
  id, user_id, zone_id, license_number, license_expires_at, is_active, created_at,
  user_profiles!drivers_user_id_fkey ( full_name, phone )
`;

function toDriver(row: DriverRow): Driver {
  return {
    id: row.id,
    userId: row.user_id,
    fullName: row.user_profiles?.full_name ?? '(sin nombre)',
    phone: row.user_profiles?.phone ?? '',
    zoneId: row.zone_id,
    licenseNumber: row.license_number,
    licenseExpiresAt: row.license_expires_at,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function listDrivers(opts?: {
  zoneId?: string;
  activeOnly?: boolean;
  /** ADR-112: en real filtra is_sandbox=false; en sandbox no filtra. */
  sandbox?: boolean;
}): Promise<Driver[]> {
  const supabase = await createServerClient();
  let q = supabase.from('drivers').select(DRIVER_COLS);
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  if (opts?.activeOnly) q = q.eq('is_active', true);

  const sandbox = opts?.sandbox ?? (await isSandboxMode());
  if (!sandbox) q = q.eq('is_sandbox', false);

  const { data, error } = await q;
  if (error) throw new Error(`[drivers.list] ${error.message}`);
  return (data ?? []).map((row) => toDriver(row as unknown as DriverRow));
}

export async function getDriverByUserId(userId: string): Promise<Driver | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('drivers')
    .select(DRIVER_COLS)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`[drivers.getByUserId] ${error.message}`);
  return data ? toDriver(data as unknown as DriverRow) : null;
}

/**
 * Bulk fetch de drivers por sus IDs. Usado al validar asignación al crear ruta.
 */
export async function getDriversByIds(ids: string[]): Promise<Driver[]> {
  if (ids.length === 0) return [];
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('drivers')
    .select(DRIVER_COLS)
    .in('id', ids);

  if (error) throw new Error(`[drivers.getByIds] ${error.message}`);
  return (data ?? []).map((row) => toDriver(row as unknown as DriverRow));
}

interface CreateDriverInput {
  userId: string;
  zoneId: string;
  licenseNumber?: string | null;
  licenseExpiresAt?: string | null;
}

/**
 * Crea el registro de driver para un user_profile existente.
 * El user_profile debe haber sido creado previamente con role='driver'.
 */
export async function createDriver(input: CreateDriverInput): Promise<{ id: string }> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('drivers')
    .insert({
      user_id: input.userId,
      zone_id: input.zoneId,
      license_number: input.licenseNumber ?? null,
      license_expires_at: input.licenseExpiresAt ?? null,
    })
    .select('id')
    .single();

  if (error) throw new Error(`[drivers.create] ${error.message}`);
  return { id: data.id };
}

export async function updateDriver(
  id: string,
  input: { zoneId?: string; licenseNumber?: string | null; isActive?: boolean },
): Promise<void> {
  const supabase = await createServerClient();
  const update: TableUpdate<'drivers'> = {};
  if (input.zoneId !== undefined) update.zone_id = input.zoneId;
  if (input.licenseNumber !== undefined) update.license_number = input.licenseNumber;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { error } = await supabase.from('drivers').update(update).eq('id', id);
  if (error) throw new Error(`[drivers.update] ${error.message}`);
}
