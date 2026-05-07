'use client';

// Monta el hook de auto-logout. No renderiza UI.
// Vive en el root layout junto con OutboxMount — corre durante toda la sesión.

import { useInactivityLogout } from '@/lib/use-inactivity-logout';

export function InactivityGuard() {
  useInactivityLogout();
  return null;
}
