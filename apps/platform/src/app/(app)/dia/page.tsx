// /dia (sin fecha) → redirige a hoy en TZ del tenant.
//
// Sirve como entry-point del sidebar: el dispatcher hace click en "Día" y cae
// directo en la vista del día actual sin tener que elegir fecha primero.

import { redirect } from 'next/navigation';
import { todayInZone } from '@tripdrive/utils';

export const dynamic = 'force-dynamic';

export default function DiaIndexPage() {
  const tz = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';
  redirect(`/dia/${todayInZone(tz)}`);
}
