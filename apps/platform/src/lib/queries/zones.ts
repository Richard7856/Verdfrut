// Queries de zones. Server-only.
// Convención: una función por intención de negocio, NO un wrapper genérico de la tabla.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { TableUpdate } from '@verdfrut/supabase';
import type { Zone } from '@verdfrut/types';

interface ZoneRow {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

function toZone(row: ZoneRow): Zone {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function listZones(): Promise<Zone[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('zones')
    .select('id, code, name, is_active, created_at')
    .order('code');

  if (error) throw new Error(`[zones.list] ${error.message}`);
  return (data ?? []).map(toZone);
}

export async function createZone(input: { code: string; name: string }): Promise<Zone> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('zones')
    .insert({ code: input.code, name: input.name })
    .select('id, code, name, is_active, created_at')
    .single();

  if (error) throw new Error(`[zones.create] ${error.message}`);
  return toZone(data);
}

export async function updateZone(
  id: string,
  input: { code?: string; name?: string; isActive?: boolean },
): Promise<Zone> {
  const supabase = await createServerClient();
  const update: TableUpdate<'zones'> = {};
  if (input.code !== undefined) update.code = input.code;
  if (input.name !== undefined) update.name = input.name;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { data, error } = await supabase
    .from('zones')
    .update(update)
    .eq('id', id)
    .select('id, code, name, is_active, created_at')
    .single();

  if (error) throw new Error(`[zones.update] ${error.message}`);
  return toZone(data);
}
