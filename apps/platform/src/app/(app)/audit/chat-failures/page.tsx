// Audit: fallos de escalación de push del chat (ADR-052 / issue #122).
//
// Cuando el chofer manda primer mensaje en un chat, el server escala vía
// `sendChatPushToZoneManagers`. Si esa función falla (VAPID mal, subscription
// expirada, network), antes solo iba a console.error → el zone_manager nunca
// se enteraba del chat.
//
// Mitigación ADR-052: persistimos un audit row en `chat_ai_decisions` con
// `category='unknown'` + `rationale LIKE 'ESCALATION_PUSH_FAILED:%'`. Esta
// pantalla los lista para que un operador pueda re-enviar manualmente o
// detectar patrones (VAPID mal seteada).

import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { createServiceRoleClient } from '@verdfrut/supabase/server';
import { formatDateTimeInZone } from '@verdfrut/utils';

export const metadata = { title: 'Auditoría · Fallos de escalación' };
export const dynamic = 'force-dynamic';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface FailureRow {
  id: string;
  reportId: string;
  messageId: string;
  driverText: string;
  rationale: string;
  classifiedAt: string;
}

export default async function ChatFailuresAuditPage() {
  await requireRole('admin', 'dispatcher');

  // Service role para bypass RLS — esta pantalla es de auditoría operativa y
  // necesita ver todos los fallos cross-zone.
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('chat_ai_decisions')
    .select('id, report_id, message_id, driver_message_text, rationale, classified_at')
    .like('rationale', 'ESCALATION_PUSH_FAILED:%')
    .order('classified_at', { ascending: false })
    .limit(200);

  if (error) {
    return (
      <>
        <PageHeader title="Fallos de escalación de chat" />
        <Card className="border-[var(--color-danger-border)] bg-[var(--color-danger-bg)]">
          <p className="text-sm" style={{ color: 'var(--color-danger-fg)' }}>
            Error leyendo audit: {error.message}
          </p>
        </Card>
      </>
    );
  }

  const failures: FailureRow[] = (data ?? []).map((r) => ({
    id: r.id as string,
    reportId: r.report_id as string,
    messageId: r.message_id as string,
    driverText: (r.driver_message_text as string) ?? '',
    rationale: (r.rationale as string) ?? '',
    classifiedAt: r.classified_at as string,
  }));

  return (
    <>
      <PageHeader
        title="Fallos de escalación de chat"
        description={`${failures.length} fallo${failures.length === 1 ? '' : 's'} registrado${failures.length === 1 ? '' : 's'}. Cada fila es un mensaje del chofer donde el push al zone manager NO se entregó — investigar VAPID + subscriptions.`}
      />

      {failures.length === 0 ? (
        <EmptyState
          title="Sin fallos registrados"
          description="Si ves esto y has tenido tráfico de chat, todo está funcionando como se espera. Los fallos quedan registrados en chat_ai_decisions con rationale='ESCALATION_PUSH_FAILED:'."
        />
      ) : (
        <Card padded={false}>
          <ul className="divide-y" style={{ borderColor: 'var(--vf-line)' }}>
            {failures.map((f) => (
              <li key={f.id} className="px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 flex items-center gap-2">
                      <Badge tone="danger">push falló</Badge>
                      <span className="font-mono text-[11px] text-[var(--vf-text-mute)]">
                        {formatDateTimeInZone(f.classifiedAt, TZ)}
                      </span>
                    </p>
                    <p className="mb-1 text-[var(--color-text)]">
                      <span className="font-mono text-[11px] text-[var(--vf-text-mute)]">
                        Reporte:
                      </span>{' '}
                      <Link
                        href={`/incidents/${f.reportId}`}
                        className="font-mono text-[12px] text-[var(--vf-green-600)] underline-offset-2 hover:underline"
                      >
                        {f.reportId.slice(0, 8)}…
                      </Link>
                    </p>
                    {f.driverText && (
                      <p className="mb-1 truncate text-[var(--color-text)]">
                        <span className="text-[11px] text-[var(--vf-text-mute)]">
                          Mensaje:
                        </span>{' '}
                        {f.driverText}
                      </p>
                    )}
                    <p className="text-[11px] text-[var(--vf-text-mute)]">
                      {f.rationale.replace(/^ESCALATION_PUSH_FAILED:\s*/, '')}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 border-[var(--color-info-border,#3b82f6)] bg-[var(--vf-surface-2)]">
        <p className="mb-1 text-xs font-medium text-[var(--color-text)]">
          ¿Cómo accionar estos fallos?
        </p>
        <ul className="space-y-1 text-xs text-[var(--color-text-muted)]">
          <li>
            • Click en el ID del reporte → abre el chat. Si está abierto, el
            zone manager ya puede responder normalmente.
          </li>
          <li>
            • Si aparecen muchos fallos seguidos del mismo mensaje "VAPID no
            configurado", el server no tiene las VAPID keys — revisar Vercel
            env vars.
          </li>
          <li>
            • Si aparecen "subscription expired", el zone manager tiene su PWA
            desinstalada o desactualizada — pedirle que re-active push notifs.
          </li>
        </ul>
      </Card>
    </>
  );
}
