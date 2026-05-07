// Detalle de un caso del comercial — chat + contexto del report.
// Server component que carga el state inicial; el hijo client maneja realtime.

import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { getIncident, listIncidentMessages } from '@/lib/queries/incidents';
import { IncidentChatClient } from './incident-chat-client';
import type { ChatStatus, IncidentDetail } from '@verdfrut/types';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ reportId: string }>;
}

const STATUS_TONE: Record<ChatStatus, 'info' | 'warning' | 'success' | 'danger'> = {
  open: 'warning',
  driver_resolved: 'success',
  manager_resolved: 'success',
  timed_out: 'danger',
};

export default async function IncidentDetailPage({ params }: Props) {
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');
  const { reportId } = await params;
  const report = await getIncident(reportId);
  if (!report) notFound();
  const messages = await listIncidentMessages(reportId);

  const incidents = (report.incidentDetails ?? []) as IncidentDetail[];
  const status = (report.chatStatus ?? 'open') as ChatStatus;

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col">
      <div className="flex-shrink-0">
        <PageHeader
          title={`${report.storeName}`}
          description={`${report.storeCode} · ${typeLabel(report.type)}`}
          action={<Badge tone={STATUS_TONE[status]}>{statusLabel(status)}</Badge>}
        />
        {incidents.length > 0 && (
          <Card className="mb-4 border-[var(--color-border)]">
            <p className="text-xs font-medium text-[var(--color-text-muted)]">Incidencias declaradas</p>
            <ul className="mt-2 space-y-1 text-sm text-[var(--color-text)]">
              {incidents.map((it, idx) => (
                <li key={idx}>
                  • <strong>{it.quantity} {it.unit}</strong> de {it.productName}
                  <span className="text-[var(--color-text-muted)]"> ({incidentTypeLabel(it.type)})</span>
                  {it.notes && <span className="text-[var(--color-text-muted)]"> — {it.notes}</span>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)]">
        <IncidentChatClient
          reportId={reportId}
          chatStatus={status}
          initialMessages={messages}
          viewerUserId={profile.id}
        />
      </div>
    </div>
  );
}

function typeLabel(t: 'entrega' | 'tienda_cerrada' | 'bascula'): string {
  return t === 'entrega' ? 'Incidencia en entrega' : t === 'tienda_cerrada' ? 'Tienda cerrada' : 'Báscula';
}

function statusLabel(s: ChatStatus): string {
  return s === 'open'
    ? 'Abierto'
    : s === 'driver_resolved'
    ? 'Resuelto por chofer'
    : s === 'manager_resolved'
    ? 'Cerrado'
    : 'Tiempo agotado';
}

function incidentTypeLabel(t: IncidentDetail['type']): string {
  return t === 'rechazo' ? 'Rechazo' : t === 'faltante' ? 'Faltante' : t === 'sobrante' ? 'Sobrante' : 'Devolución';
}
