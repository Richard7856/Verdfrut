// Bandeja de incidencias — lista los reports con chat abierto.
// Sprint 11. RLS filtra por zona automáticamente para zone_managers.

import Link from 'next/link';
import { EmptyState, PageHeader, Card, Badge } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { listOpenIncidents } from '@/lib/queries/incidents';
import type { ChatStatus } from '@verdfrut/types';

export const metadata = { title: 'Incidencias' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<ChatStatus, { text: string; tone: 'info' | 'warning' | 'success' | 'danger' }> = {
  open: { text: 'Abierto', tone: 'warning' },
  driver_resolved: { text: 'Resuelto por chofer', tone: 'success' },
  manager_resolved: { text: 'Cerrado', tone: 'success' },
  timed_out: { text: 'Tiempo agotado', tone: 'danger' },
};

const TYPE_LABEL: Record<'entrega' | 'tienda_cerrada' | 'bascula', string> = {
  entrega: 'Incidencia en entrega',
  tienda_cerrada: 'Tienda cerrada',
  bascula: 'Báscula',
};

export default async function IncidentsPage() {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const incidents = await listOpenIncidents();

  return (
    <>
      <PageHeader
        title="Incidencias"
        description="Casos abiertos por choferes desde la app móvil. Toca para responder en el chat."
      />
      {incidents.length === 0 ? (
        <EmptyState
          title="Sin incidencias abiertas"
          description="Cuando un chofer abra un chat por tienda cerrada, báscula, rechazo o merma, aparecerá aquí en tiempo real."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {incidents.map((r) => {
            const statusKey = (r.chatStatus ?? 'open') as ChatStatus;
            const status = STATUS_LABEL[statusKey];
            return (
              <li key={r.id}>
                <Link href={`/incidents/${r.id}`} className="block">
                  <Card className="border-[var(--color-border)] hover:bg-[var(--vf-surface-2)]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {r.storeName} <span className="text-[var(--color-text-muted)]">· {r.storeCode}</span>
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {TYPE_LABEL[r.type]}
                          {r.chatOpenedAt &&
                            ` · abierto ${new Date(r.chatOpenedAt).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}`}
                        </p>
                      </div>
                      <Badge tone={status.tone}>{status.text}</Badge>
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
