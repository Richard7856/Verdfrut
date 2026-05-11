// Landing page del zone_manager (su única página).
// Si tiene 1+ chat abierto → redirect al más reciente.
// Si no tiene chats abiertos → muestra estado vacío con explicación.
//
// Modelo de roles V2: el zone_manager solo opera el chat. Esta página es su
// home permanente. Cuando llega un push del chofer, el push lleva directo a
// /incidents/[reportId] — pero si entra manual a la app, esta página actúa
// como router automático.

import { redirect } from 'next/navigation';
import { Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listOpenIncidents } from '@/lib/queries/incidents';

export const metadata = { title: 'Mi chat activo' };
export const dynamic = 'force-dynamic';

export default async function ActiveChatPage() {
  // Permitir admin también — útil para que el admin pueda "switch" a la vista
  // del zone_manager desde su navegador para QA.
  const profile = await requireRole('zone_manager', 'admin', 'dispatcher');

  // RLS filtra automáticamente: zone_manager solo ve los reports de su zona.
  // Admin/dispatcher ven todos los abiertos.
  const incidents = await listOpenIncidents();

  // Si hay chat abierto, ir directo al más reciente
  if (incidents.length > 0) {
    const latest = incidents[0]; // ya viene ordenado por chat_opened_at desc
    if (latest) {
      redirect(`/incidents/${latest.id}`);
    }
  }

  // Estado vacío — no hay chats abiertos
  return (
    <>
      <PageHeader
        title="Mi chat activo"
        description={`Hola ${profile.fullName}. Esta es tu vista de operación: aquí responderás a los choferes cuando reporten un problema.`}
      />

      <Card>
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="text-4xl">💬</span>
          <p className="text-base font-medium text-[var(--color-text)]">
            Sin chats abiertos por ahora
          </p>
          <p className="max-w-md text-sm text-[var(--color-text-muted)]">
            Cuando un chofer reporte un problema durante su ruta, recibirás una
            notificación push y este lugar te llevará directo al chat.
          </p>
          <p className="mt-2 text-xs text-[var(--color-text-subtle)]">
            Asegúrate de tener las notificaciones activadas en tu navegador.
          </p>
        </div>
      </Card>
    </>
  );
}
