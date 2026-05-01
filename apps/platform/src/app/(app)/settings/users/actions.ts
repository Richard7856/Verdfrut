'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { inviteUser, updateUser } from '@/lib/queries/users';
import {
  optionalString,
  requireString,
  runAction,
  type ActionResult,
} from '@/lib/validation';
import type { UserRole } from '@verdfrut/types';

const VALID_ROLES: UserRole[] = ['admin', 'dispatcher', 'zone_manager', 'driver'];

export async function inviteUserAction(formData: FormData): Promise<ActionResult> {
  await requireRole('admin');

  return runAction(async () => {
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

    // zone_manager y driver requieren zona; admin y dispatcher pueden tener null.
    if ((role === 'zone_manager' || role === 'driver') && !zoneId) {
      throw new Error(`Rol ${role} requiere asignar una zona`);
    }

    const licenseNumber = optionalString(formData.get('license_number'), { maxLength: 60 });

    await inviteUser({
      email,
      fullName,
      role,
      zoneId,
      phone,
      licenseNumber,
    });

    revalidatePath('/settings/users');
  });
}

export async function toggleUserActiveAction(id: string, isActive: boolean): Promise<ActionResult> {
  await requireRole('admin');
  return runAction(async () => {
    await updateUser(id, { isActive });
    revalidatePath('/settings/users');
  });
}
