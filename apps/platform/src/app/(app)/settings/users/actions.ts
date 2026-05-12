'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import {
  forcePasswordReset,
  generateRecoveryLink,
  inviteUser,
  updateUser,
} from '@/lib/queries/users';
import {
  optionalString,
  requireString,
  runAction,
  type ActionResult,
} from '@/lib/validation';
import type { UserRole } from '@tripdrive/types';

// `as const` hace el array readonly — defensa contra mutación accidental
// desde otro request en el server runtime (módulo compartido).
const VALID_ROLES = ['admin', 'dispatcher', 'zone_manager', 'driver'] as const satisfies readonly UserRole[];

/**
 * El resultado del invite incluye el link copiable para el caso "chofer sin email
 * funcional" (Opción C del flow de auth). El admin puede pasarlo por WhatsApp.
 */
export interface InviteActionResult extends ActionResult {
  inviteLink?: string;
}

export async function inviteUserAction(formData: FormData): Promise<InviteActionResult> {
  await requireRole('admin');

  let inviteLink: string | undefined;
  const result = await runAction(async () => {
    const email = requireString('email', formData.get('email'), {
      pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      patternMsg: 'Email inválido',
      maxLength: 120,
    }).toLowerCase();
    const fullName = requireString('nombre', formData.get('full_name'), { maxLength: 120 });
    const role = requireString('rol', formData.get('role')) as UserRole;
    if (!VALID_ROLES.includes(role)) {
      throw new Error('Rol inválido');
    }
    const phone = optionalString(formData.get('phone'), { maxLength: 24 });
    const zoneIdRaw = formData.get('zone_id');
    const zoneId = zoneIdRaw && zoneIdRaw !== '' ? String(zoneIdRaw) : null;

    if ((role === 'zone_manager' || role === 'driver') && !zoneId) {
      throw new Error(`Rol ${role} requiere asignar una zona`);
    }

    const licenseNumber = optionalString(formData.get('license_number'), { maxLength: 60 });

    const res = await inviteUser({
      email,
      fullName,
      role,
      zoneId,
      phone,
      licenseNumber,
    });
    inviteLink = res.inviteLink;

    revalidatePath('/settings/users');
  });

  return { ...result, inviteLink: result.ok ? inviteLink : undefined };
}

export async function toggleUserActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole('admin');
  return runAction(async () => {
    await updateUser(id, { isActive });
    revalidatePath('/settings/users');
  });
}

/**
 * Fuerza al usuario a establecer una contraseña nueva.
 * Devuelve el recovery link para que el admin se lo pase al chofer (WhatsApp).
 */
export interface ForceResetResult extends ActionResult {
  resetLink?: string;
}

export async function forcePasswordResetAction(userId: string): Promise<ForceResetResult> {
  await requireRole('admin');
  let resetLink: string | undefined;
  const result = await runAction(async () => {
    resetLink = await forcePasswordReset(userId);
    revalidatePath('/settings/users');
  });
  return { ...result, resetLink: result.ok ? resetLink : undefined };
}

/**
 * Regenera un recovery link sin tocar el flag must_reset_password.
 * Útil cuando el invite original expiró pero el usuario ya estableció contraseña antes.
 */
export interface RegenerateLinkResult extends ActionResult {
  link?: string;
}

export async function regenerateRecoveryLinkAction(email: string): Promise<RegenerateLinkResult> {
  await requireRole('admin');
  let link: string | undefined;
  const result = await runAction(async () => {
    link = await generateRecoveryLink(email);
  });
  return { ...result, link: result.ok ? link : undefined };
}
