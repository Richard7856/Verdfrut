// Queries de user_profiles + flujo de invitación.
//
// La invitación usa supabase.auth.admin.inviteUserByEmail que requiere SERVICE_ROLE_KEY.
// El service role bypass RLS — usar SOLO desde Server Actions con requireRole('admin').

import 'server-only';
import { createServerClient, createServiceRoleClient } from '@verdfrut/supabase/server';
import type { TableUpdate } from '@verdfrut/supabase';
import type { UserProfile, UserRole } from '@verdfrut/types';
import { createDriver } from './drivers';

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  zone_id: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

const PROFILE_COLS = 'id, email, full_name, role, zone_id, phone, is_active, created_at';

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    zoneId: row.zone_id,
    phone: row.phone,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export async function listUsers(opts?: { role?: UserRole; zoneId?: string }): Promise<UserProfile[]> {
  const supabase = await createServerClient();
  let q = supabase.from('user_profiles').select(PROFILE_COLS).order('full_name');
  if (opts?.role) q = q.eq('role', opts.role);
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);

  const { data, error } = await q;
  if (error) throw new Error(`[users.list] ${error.message}`);
  return (data ?? []).map(toProfile);
}

export async function getUserProfile(id: string): Promise<UserProfile | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select(PROFILE_COLS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`[users.get] ${error.message}`);
  return data ? toProfile(data) : null;
}

interface InviteUserInput {
  email: string;
  fullName: string;
  role: UserRole;
  zoneId: string | null;
  phone?: string | null;
  /** Si role='driver', se crea automáticamente el registro en drivers. */
  licenseNumber?: string | null;
}

/**
 * Invita un usuario nuevo:
 *   1. Crea el auth.user via Supabase Auth Admin (envía magic-link/email de invitación)
 *   2. Inserta la fila en user_profiles
 *   3. Si role='driver', crea fila en drivers
 *
 * Si cualquier paso falla, intenta rollback del auth user. (Best effort — no es transaccional.)
 */
export async function inviteUser(input: InviteUserInput): Promise<{ userId: string }> {
  const admin = createServiceRoleClient();

  // 1. Crear auth user con invite (envía email).
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.fullName },
  });
  if (inviteError || !invited.user) {
    throw new Error(`[users.invite] ${inviteError?.message ?? 'No se pudo invitar'}`);
  }
  const userId = invited.user.id;

  // 2. Insertar profile. Usamos service role para bypass RLS (la sesión del invitado aún no existe).
  const { error: profileError } = await admin.from('user_profiles').insert({
    id: userId,
    email: input.email,
    full_name: input.fullName,
    role: input.role,
    zone_id: input.zoneId,
    phone: input.phone ?? null,
  });
  if (profileError) {
    // Rollback best-effort.
    await admin.auth.admin.deleteUser(userId).catch(() => {});
    throw new Error(`[users.invite] Insert profile: ${profileError.message}`);
  }

  // 3. Si es driver, crear fila en drivers.
  if (input.role === 'driver') {
    if (!input.zoneId) {
      throw new Error('[users.invite] Driver requiere zone_id');
    }
    try {
      await createDriver({
        userId,
        zoneId: input.zoneId,
        licenseNumber: input.licenseNumber ?? null,
      });
    } catch (err) {
      // Rollback best-effort de profile y auth.
      try { await admin.from('user_profiles').delete().eq('id', userId); } catch { /* ignore */ }
      try { await admin.auth.admin.deleteUser(userId); } catch { /* ignore */ }
      throw err;
    }
  }

  return { userId };
}

export async function updateUser(
  id: string,
  input: { fullName?: string; phone?: string | null; zoneId?: string | null; isActive?: boolean },
): Promise<void> {
  const supabase = await createServerClient();
  const update: TableUpdate<'user_profiles'> = {};
  if (input.fullName !== undefined) update.full_name = input.fullName;
  if (input.phone !== undefined) update.phone = input.phone;
  if (input.zoneId !== undefined) update.zone_id = input.zoneId;
  if (input.isActive !== undefined) update.is_active = input.isActive;

  const { error } = await supabase.from('user_profiles').update(update).eq('id', id);
  if (error) throw new Error(`[users.update] ${error.message}`);
}
