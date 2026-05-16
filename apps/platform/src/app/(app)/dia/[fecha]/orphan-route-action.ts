'use server';

// Crear ruta huérfana (UX-Fase 3 / ADR-119).
//
// Tras relajar dispatch_id NOT NULL (migración 053), una ruta puede vivir sin
// pertenecer a un tiro. Este action permite crearla directo desde /dia sin
// requerir el flow previo de "Armar tiro".
//
// Diseño:
//   - Reusa createDraftRoute con dispatchId=null.
//   - El status arranca en DRAFT (mismo que routes con dispatch_id, sin
//     diferencia de máquina de estados).
//   - El tag is_sandbox lo decide createDraftRoute via el cookie del request
//     (ADR-113): si el admin está en modo planeación, la ruta queda sandbox.

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createDraftRoute } from '@/lib/queries/routes';

interface CreateOrphanRouteInput {
  date: string; // YYYY-MM-DD
  vehicleId: string;
  zoneId: string;
  driverId?: string | null;
}

export interface CreateOrphanRouteResult {
  ok: boolean;
  error?: string;
  routeId?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createOrphanRouteAction(
  input: CreateOrphanRouteInput,
): Promise<CreateOrphanRouteResult> {
  try {
    const profile = await requireRole('admin', 'dispatcher');
    if (!DATE_RE.test(input.date)) {
      return { ok: false, error: 'Fecha inválida (formato YYYY-MM-DD).' };
    }
    if (!UUID_RE.test(input.vehicleId)) {
      return { ok: false, error: 'Camioneta requerida.' };
    }
    if (!UUID_RE.test(input.zoneId)) {
      return { ok: false, error: 'Zona requerida.' };
    }
    const driverId = input.driverId && UUID_RE.test(input.driverId) ? input.driverId : null;

    // Nombre por default — el dispatcher lo puede renombrar después en
    // /routes/[id]. Usamos la fecha para que sea autoexplicativo en listas.
    const route = await createDraftRoute({
      name: `Ruta ${input.date}`,
      date: input.date,
      vehicleId: input.vehicleId,
      driverId,
      zoneId: input.zoneId,
      createdBy: profile.id,
      // ADR-119: explícitamente null para crear huérfana. Antes de migración
      // 053 esto causaba violación NOT NULL.
      dispatchId: null,
    });

    revalidatePath(`/dia/${input.date}`);
    revalidatePath('/routes');
    return { ok: true, routeId: route.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    return { ok: false, error: msg };
  }
}
