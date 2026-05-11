// Página de anomalías — admin/dispatcher only. S18.5.
//
// Lista 3 tipos de anomalías que el sistema detecta automáticamente:
//   - silent_driver: chofer IN_PROGRESS que dejó de reportar GPS
//   - route_delayed: ruta con ETA pasada y sin completar
//   - chat_open_long: chat de incidencia sin resolver
//
// Cada anomalía tiene CTAs claras según el caso:
//   - silent_driver  → "Abrir mapa" (ver última posición conocida)
//   - route_delayed  → "Ver ruta" (revisar paradas, posibles problemas)
//   - chat_open_long → "Abrir chat" (responder al chofer)

import Link from 'next/link';
import { PageHeader, Card, Badge } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listActiveAnomalies, type Anomaly, type AnomalyKind } from '@/lib/queries/anomalies';

export const metadata = { title: 'Anomalías' };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<AnomalyKind, string> = {
  silent_driver: '📵 Chofer silencioso',
  route_delayed: '⏰ Ruta atrasada',
  chat_open_long: '💬 Chat sin resolver',
};

const KIND_DESC: Record<AnomalyKind, string> = {
  silent_driver: 'No reporta GPS desde hace más de 5 minutos.',
  route_delayed: 'La hora estimada de cierre ya pasó.',
  chat_open_long: 'Hay un caso abierto sin respuesta del comercial.',
};

export default async function AnomaliesPage() {
  // V2: solo admin/dispatcher.
  await requireRole('admin', 'dispatcher');
  const anomalies = await listActiveAnomalies();

  // Agrupar por tipo para el render
  const byKind = anomalies.reduce<Record<AnomalyKind, Anomaly[]>>(
    (acc, a) => {
      acc[a.kind].push(a);
      return acc;
    },
    { silent_driver: [], route_delayed: [], chat_open_long: [] },
  );

  const total = anomalies.length;

  return (
    <>
      <PageHeader
        title="Anomalías activas"
        description={
          total === 0
            ? 'Todo está bajo control. No hay anomalías detectadas en este momento.'
            : `${total} anomalía${total === 1 ? '' : 's'} requiere${total === 1 ? '' : 'n'} atención.`
        }
        breadcrumb={
          <Link href="/incidents" className="hover:underline">
            Incidencias
          </Link>
        }
      />

      {total === 0 ? (
        <Card>
          <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">
            ✅ Sin anomalías activas. Esta página se actualiza automáticamente cada minuto.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {(Object.keys(byKind) as AnomalyKind[]).map((kind) => {
            const items = byKind[kind];
            if (items.length === 0) return null;
            return (
              <section key={kind}>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  {KIND_LABEL[kind]} · {items.length}
                </h2>
                <p className="mb-3 text-xs text-[var(--color-text-muted)]">{KIND_DESC[kind]}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((a) => (
                    <AnomalyCard key={`${a.kind}-${a.routeId}-${a.detectedAt}`} anomaly={a} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function AnomalyCard({ anomaly }: { anomaly: Anomaly }) {
  const minutes = (anomaly.details['minutes_silent'] ??
    anomaly.details['minutes_late'] ??
    anomaly.details['minutes_open']) as number | undefined;
  const reportId = anomaly.details['report_id'] as string | undefined;
  const hasActiveGap = anomaly.details['has_active_gap'] as boolean | undefined;

  // Resolver target del CTA según tipo
  let actionHref = `/routes/${anomaly.routeId}`;
  let actionLabel = 'Ver ruta';
  if (anomaly.kind === 'chat_open_long' && reportId) {
    actionHref = `/incidents/${reportId}`;
    actionLabel = 'Abrir chat';
  } else if (anomaly.kind === 'silent_driver') {
    actionHref = `/map`;
    actionLabel = 'Ver mapa';
  }

  return (
    <Card className="border-[var(--color-border)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-[var(--color-text)]">
            {anomaly.driverName ?? 'Sin chofer'}
            {anomaly.storeName && ` · ${anomaly.storeName}`}
          </p>
          {minutes !== undefined && (
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              hace {minutes} min
              {hasActiveGap ? ' · gap activo (Waze?)' : ''}
            </p>
          )}
        </div>
        <Badge tone={anomaly.severity === 'high' ? 'danger' : 'warning'}>
          {anomaly.severity === 'high' ? 'Alto' : 'Medio'}
        </Badge>
      </div>
      <div className="mt-3 flex justify-end">
        <Link
          href={actionHref}
          className="rounded-[var(--radius-md)] bg-[var(--vf-green-600,#15803d)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--vf-green-700,#14532d)]"
        >
          {actionLabel} →
        </Link>
      </div>
    </Card>
  );
}
