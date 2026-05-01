// Home — redirige al dashboard apropiado según el rol.
// Esta ruta NO está en (app) porque el layout shell asume rol resuelto.

import { redirect } from 'next/navigation';
import { requireProfile } from '@/lib/auth';
import { homeForRole } from '@/lib/auth';

export default async function HomePage() {
  const profile = await requireProfile();
  redirect(homeForRole(profile.role));
}
