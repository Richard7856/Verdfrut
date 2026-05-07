// Lista de tiros (dispatches). ADR-024.
// Agrupados por fecha (hoy / mañana / siguiente / pasados).

import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader, Button } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { listDispatchSummaries, type DispatchSummary } from '@/lib/queries/dispatches';
import { listZones } from '@/lib/queries/zones';
import type { DispatchStatus } from '@verdfrut/types';
import { CreateDispatchButton } from './create-dispatch-button';

export const metadata = { title: 'Tiros' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<DispatchStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  planning: { text: 'Planeación', tone: 'neutral' },
  dispatched: { text: 'En curso', tone: 'info' },
  completed: { text: 'Completado', tone: 'success' },
  cancelled: { text: 'Cancelado', tone: 'danger' },
};

export default async function DispatchesPage() {
  await requireRole('admin', 'dispatcher');
  const [summaries, zones] = await Promise.all([
    listDispatchSummaries(),
    listZones(),
  ]);

  const byBucket = bucketByDate(summaries);

  return (
    <>
      <PageHeader
        title="Tiros"
        description="Cada tiro agrupa las rutas que salen juntas en una operación. Agrega rutas a un tiro y publícalas en bloque."
        action={<CreateDispatchButton zones={zones} />}
      />

      {summaries.length === 0 ? (
        <EmptyState
          title="Sin tiros"
          description='Crea tu primer tiro (ej. "Tiro CDMX matutino") y dentro agrega las rutas. Las rutas existentes pueden vincularse a un tiro desde su detalle.'
        />
      ) : (
        <div className="flex flex-col gap-6">
          {byBucket.map(([label, items]) => (
            <section key={label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                {label}
              </h2>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {items.map((s) => {
                  const status = STATUS_LABEL[s.dispatch.status];
                  return (
                    <li key={s.dispatch.id}>
                      <Link href={`/dispatches/${s.dispatch.id}`} className="block">
                        <Card className="border-[var(--color-border)] hover:bg-[var(--vf-surface-2)]">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                                {s.dispatch.name}
                              </p>
                              <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                                {s.dispatch.date} · {s.routeCount} ruta{s.routeCount === 1 ? '' : 's'} · {s.completedStops}/{s.totalStops} paradas
                              </p>
                              {s.dispatch.notes && (
                                <p className="mt-1 line-clamp-2 text-xs text-[var(--color-text-subtle)]">
                                  {s.dispatch.notes}
                                </p>
                              )}
                            </div>
                            <Badge tone={status.tone}>{status.text}</Badge>
                          </div>
                        </Card>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Agrupa por fecha relativa: Hoy / Mañana / Próximos / Pasados.
 * El orden de retorno es estable.
 */
function bucketByDate(items: DispatchSummary[]): Array<[string, DispatchSummary[]]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().slice(0, 10);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  const order: Array<[string, DispatchSummary[]]> = [
    ['Hoy', []],
    ['Mañana', []],
    ['Próximos', []],
    ['Pasados', []],
  ];
  for (const s of items) {
    if (s.dispatch.date === todayStr) order[0]![1].push(s);
    else if (s.dispatch.date === tomorrowStr) order[1]![1].push(s);
    else if (s.dispatch.date > todayStr) order[2]![1].push(s);
    else order[3]![1].push(s);
  }
  return order.filter(([, v]) => v.length > 0);
}

// Suprimir warning de Button no usado si la EmptyState no lo usa.
void Button;
