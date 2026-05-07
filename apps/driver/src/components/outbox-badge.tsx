'use client';

// Badge flotante / inline que muestra cuántos cambios están pendientes de
// subir al server. Cuando hay items `failed`, se vuelve rojo y deja al chofer
// reintentar manualmente.
//
// Toca para abrir un panel con la lista detallada y botón "Reintentar todo".

import { useState } from 'react';
import { useOutboxSnapshot } from '@/lib/outbox/use-outbox-snapshot';
import { listItems, retryFailed } from '@/lib/outbox';
import type { OutboxItem } from '@/lib/outbox';

const TYPE_LABELS: Record<OutboxItem['type'], string> = {
  advance_step: 'Avanzar paso',
  set_evidence: 'Guardar evidencia',
  patch_report: 'Actualizar reporte',
  submit_report: 'Enviar reporte',
  submit_non_entrega: 'Cerrar sin entrega',
  convert_to_entrega: 'Convertir a entrega',
  upload_photo: 'Subir foto',
  send_chat_message: 'Enviar mensaje',
  resolve_chat_by_driver: 'Cerrar chat',
};

export function OutboxBadge() {
  const snap = useOutboxSnapshot();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<OutboxItem[]>([]);

  if (snap.pendingTotal === 0) return null;

  const hasFailed = snap.failed > 0;
  const tone = hasFailed
    ? 'bg-[var(--color-danger)] text-white'
    : 'bg-[var(--color-warn)] text-[var(--color-warn-fg)]';

  async function openPanel() {
    setItems(await listItems());
    setOpen(true);
  }

  async function onRetry() {
    await retryFailed();
    setItems(await listItems());
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}
        aria-label="Ver cambios pendientes"
      >
        <span aria-hidden>{hasFailed ? '⚠️' : '⏳'}</span>
        <span>
          {snap.pendingTotal} {snap.pendingTotal === 1 ? 'cambio pendiente' : 'cambios pendientes'}
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end bg-black/40"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full rounded-t-2xl bg-[var(--vf-surface-1)] p-4 shadow-xl safe-bottom max-h-[70vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-[var(--color-text)]">Cambios pendientes</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-[var(--color-text-muted)]"
              >
                Cerrar
              </button>
            </header>

            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              Estos cambios se subirán cuando vuelva la red. Si alguno falla muchas veces, puedes reintentarlo manualmente.
            </p>

            <ul className="space-y-2">
              {items.filter((it) => it.status !== 'done').map((it) => (
                <li
                  key={it.id}
                  className="rounded-lg border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {TYPE_LABELS[it.type]}
                    </span>
                    <StatusChip status={it.status} attempts={it.attempts} />
                  </div>
                  {it.lastError && (
                    <p className="mt-1 text-xs text-[var(--color-danger-fg)]">{it.lastError}</p>
                  )}
                </li>
              ))}
              {items.filter((it) => it.status !== 'done').length === 0 && (
                <li className="text-sm text-[var(--color-text-muted)]">Sin pendientes.</li>
              )}
            </ul>

            {hasFailed && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-4 w-full rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-[var(--color-primary-fg)]"
              >
                Reintentar fallidos ({snap.failed})
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatusChip({ status, attempts }: { status: OutboxItem['status']; attempts: number }) {
  const map: Record<OutboxItem['status'], { text: string; cls: string }> = {
    pending: { text: attempts > 0 ? `Reintentando (${attempts})` : 'Esperando red', cls: 'bg-[var(--vf-surface-3)] text-[var(--color-text-muted)]' },
    in_flight: { text: 'Subiendo…', cls: 'bg-[var(--color-info)] text-[var(--color-info-fg)]' },
    failed: { text: `Falló (${attempts})`, cls: 'bg-[var(--color-danger)] text-white' },
    done: { text: 'Listo', cls: 'bg-[var(--color-success)] text-[var(--color-success-fg)]' },
  };
  const { text, cls } = map[status];
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>{text}</span>;
}
