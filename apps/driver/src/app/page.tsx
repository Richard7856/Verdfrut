// Home de la driver app. Resuelve el rol y redirige.
//   - driver       → /route   (lista de paradas del día)
//   - zone_manager → /supervisor (mapa de zona)
// Si no hay sesión, el proxy ya hizo redirect a /login antes de llegar aquí.

import { redirect } from 'next/navigation';
import { requireDriverProfile, homeForDriverRole } from '@/lib/auth';

export default async function HomePage() {
  const profile = await requireDriverProfile();
  redirect(homeForDriverRole(profile.role));
}
