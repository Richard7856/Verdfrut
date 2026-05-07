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
  must_reset_password: boolean;
  created_at: string;
}

const PROFILE_COLS = 'id, email, full_name, role, zone_id, phone, is_active, must_reset_password, created_at';

function toProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    zoneId: row.zone_id,
    phone: row.phone,
    isActive: row.is_active,
    mustResetPassword: row.must_reset_password,
    createdAt: row.created_at,
  };
}

/**
 * URL pública de la driver app para que el invite/recovery link
 * apunte ahí y no al platform. En desarrollo: localhost:3001. En prod:
 * driver.verdfrut.com.
 */
function getDriverAppUrl(): string {
  // Permite override por env. Default razonable para desarrollo local.
  return process.env.DRIVER_APP_URL ?? 'http://localhost:3001';
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

interface InviteUserResult {
  userId: string;
  /**
   * Link de invite que el chofer abre para establecer su contraseña.
   * Apunta al `redirectTo` configurado (driver app o platform según rol).
   * Útil para mostrarlo en UI y que el admin pueda copiar/compartir vía WhatsApp
   * cuando el email no llega o el chofer no tiene email funcional.
   */
  inviteLink: string;
}

/**
 * Determina a qué app debe apuntar el redirect del invite:
 *   - driver / zone_manager → driver app (`/auth/callback`)
 *   - admin / dispatcher    → platform (`/auth/callback` propio cuando exista,
 *     por ahora `/login` que aceptará el token automáticamente vía Supabase SSR)
 */
function inviteRedirectFor(role: UserRole): string {
  const driverApp = getDriverAppUrl();
  const platform = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  switch (role) {
    case 'driver':
    case 'zone_manager':
      return `${driverApp}/auth/callback`;
    case 'admin':
    case 'dispatcher':
      return `${platform}/login`;
  }
}

/**
 * Convierte el `action_link` que devuelve `auth.admin.generateLink` en un link
 * copiable para el admin.
 *
 * Para links de la driver app (/auth/callback): apunta a /auth/invite con el
 * token en ?t= en lugar de ir directo al Route Handler. Esto evita que los
 * previews de WhatsApp/iMessage fetcheen la URL y consuman el token antes de que
 * el chofer lo abra — issue #11. El token solo se consume cuando el chofer toca
 * el botón "Activar mi cuenta" (JS del cliente).
 *
 * Para otros targets (platform /login, etc.): mantiene el flujo legacy con
 * token_hash en query string, ya que el problema de preview afecta principalmente
 * a links enviados por WhatsApp a choferes.
 */
function buildServerCallbackLink(
  properties: { hashed_token?: string | null; verification_type?: string | null } | null | undefined,
  redirectTo: string,
): string {
  const hashedToken = properties?.hashed_token;
  const verificationType = properties?.verification_type;
  if (!hashedToken || !verificationType) return '';
  const url = new URL(redirectTo);

  if (url.pathname === '/auth/callback') {
    // Driver app: landing page que no consume el token en page load
    url.pathname = '/auth/invite';
    url.searchParams.set('t', hashedToken);
    url.searchParams.set('type', verificationType);
  } else {
    // Platform u otro target: flujo legacy server-side callback
    url.searchParams.set('token_hash', hashedToken);
    url.searchParams.set('type', verificationType);
  }

  return url.toString();
}

/**
 * Invita un usuario nuevo:
 *   1. Crea el auth.user via Supabase Auth Admin (envía magic-link/email de invitación).
 *   2. Inserta la fila en user_profiles con must_reset_password=true.
 *   3. Si role='driver', crea fila en drivers.
 *   4. Genera un invite link copiable (paralelo al email) — útil cuando el chofer
 *      no tiene email funcional, el admin puede mandárselo por WhatsApp.
 *
 * Si cualquier paso falla, intenta rollback del auth user. (Best effort — no es transaccional.)
 */
export async function inviteUser(input: InviteUserInput): Promise<InviteUserResult> {
  const admin = createServiceRoleClient();
  const redirectTo = inviteRedirectFor(input.role);

  // 1. Crear auth user con invite (envía email).
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(input.email, {
    data: { full_name: input.fullName },
    redirectTo,
  });
  if (inviteError || !invited.user) {
    throw new Error(`[users.invite] ${inviteError?.message ?? 'No se pudo invitar'}`);
  }
  const userId = invited.user.id;

  // 2. Insertar profile con must_reset_password=true (debe establecer password al entrar).
  const { error: profileError } = await admin.from('user_profiles').insert({
    id: userId,
    email: input.email,
    full_name: input.fullName,
    role: input.role,
    zone_id: input.zoneId,
    phone: input.phone ?? null,
    must_reset_password: true,
  });
  if (profileError) {
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
      try { await admin.from('user_profiles').delete().eq('id', userId); } catch { /* ignore */ }
      try { await admin.auth.admin.deleteUser(userId); } catch { /* ignore */ }
      throw err;
    }
  }

  // 4. Generar invite link paralelo (no manda email — sólo retorna URL para copiar).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'invite',
    email: input.email,
    options: { redirectTo },
  });
  if (linkErr) {
    // No fatal — la invite por email ya salió. Logueamos y devolvemos string vacío.
    console.error('[users.invite] No se pudo generar link copiable:', linkErr);
    return { userId, inviteLink: '' };
  }

  return { userId, inviteLink: buildServerCallbackLink(linkData?.properties, redirectTo) };
}

/**
 * Genera un nuevo recovery link para un usuario existente.
 * Caso de uso: el invite original expiró o el chofer perdió la contraseña.
 * También sirve para "forzar reset": el admin marca must_reset_password=true
 * y le pasa este link al chofer.
 */
export async function generateRecoveryLink(email: string): Promise<string> {
  const admin = createServiceRoleClient();
  const platformDefault = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Buscar el rol para decidir redirectTo.
  const { data: profile } = await admin
    .from('user_profiles')
    .select('role')
    .eq('email', email)
    .maybeSingle();

  const redirectTo = profile?.role
    ? inviteRedirectFor(profile.role as UserRole)
    : `${platformDefault}/login`;

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  });

  if (error || !data?.properties) {
    throw new Error(`[users.generateRecoveryLink] ${error?.message ?? 'Sin link'}`);
  }

  const link = buildServerCallbackLink(data.properties, redirectTo);
  if (!link) {
    throw new Error('[users.generateRecoveryLink] No se pudo construir el link de callback');
  }
  return link;
}

/**
 * Marca a un usuario como "debe establecer contraseña nueva" en el próximo login.
 * El admin lo usa cuando un chofer reporta que olvidó su contraseña, o cuando
 * sospecha credenciales comprometidas.
 *
 * Devuelve el recovery link para que el admin se lo pase al chofer.
 */
export async function forcePasswordReset(userId: string): Promise<string> {
  const admin = createServiceRoleClient();

  const { data: profile, error: getErr } = await admin
    .from('user_profiles')
    .select('email')
    .eq('id', userId)
    .single();

  if (getErr || !profile) {
    throw new Error(`[users.forcePasswordReset] No se encontró el usuario`);
  }

  const { error: flagErr } = await admin
    .from('user_profiles')
    .update({ must_reset_password: true })
    .eq('id', userId);

  if (flagErr) {
    throw new Error(`[users.forcePasswordReset] Flag: ${flagErr.message}`);
  }

  return generateRecoveryLink(profile.email);
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
